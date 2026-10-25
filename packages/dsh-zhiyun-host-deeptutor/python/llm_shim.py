"""上游 LLM 层的桥接垫片（llm_shim）。

契约：``docs/contracts.md`` §13 —— 把上游的模型入口重定向到桥的反向请求
``llm.stream`` / ``llm.complete``。**不得修改 vendor 文件**，所以这里是纯运行时
monkeypatch（可重复 install / restore）。

## 为什么要动四层入口而不只是两个

上游取模型的路径是**两段式**的：

1. 进门：任何能力的第一步都是 ``get_llm_config()``（见
   ``agents/question/capability.py:42``、``agents/question/pipeline.py:420``）。
   宿主环境下 ``data/user/settings/model_catalog.json`` 不存在，
   ``_get_llm_config_from_resolver()`` 会直接抛
   ``LLMConfigError("No active LLM model is configured. ...")`` —— **上游在能调模型
   之前就死了**，这时连 ``complete``/``stream`` 都不会被调用。
2. 调模型：``agents/base_agent.py`` 的 ``call_llm()`` / ``stream_llm()``，它们用的是
   import 时就绑定好的 ``complete`` / ``stream`` 别名。
3. 但 ``deep_question`` / ``deep_solve`` / ``deep_research`` / ``explore_context``
   在 1.6.x 已迁到 ``runtime/agentic`` 引擎：它们**绕过** ``services.llm``，自己
   ``build_openai_client()`` 拿一个 OpenAI SDK 客户端直接
   ``await client.chat.completions.create(...)``（``labeled_step.py:454``、
   ``agents/question/pipeline.py:1120`` …）。合成配置里的 base_url 是永不可解析的
   ``llm-shim.host.invalid``，所以这条路径会去拨号、拿 502 —— 前三层一行都走不到。

所以必须同时补上：

- ``get_llm_config`` —— 用**宿主运行快照合成的 LLMConfig** 顶替，让上游以为模型已配好；
- ``complete`` / ``stream`` / ``complete_with_config`` —— 真正把调用送过桥；
- ``build_openai_client`` / ``_build_openai_client`` —— 返回假客户端，把
  ``chat.completions.create`` 也翻译成一次桥的反向请求（见「第四层」小节）。

## 覆盖策略：身份比对 + 全量扫描

上游有 30+ 处 ``from deeptutor.services.llm.config import get_llm_config``：

- **函数体内惰性 import** 的地方（``capability.py`` / ``tools/*`` / ``book/blocks/*``）
  每次调用都重新取模块属性，所以只要改掉 ``deeptutor.services.llm.config`` 这个**源头
  模块**的属性就自动覆盖；
- **模块级 import** 的地方（``services/llm/__init__.py``、``factory.py``、``client.py``、
  ``provider_factory.py``、``agents.subagents.*`` …）已经绑进了自己的命名空间，必须
  逐个改。

因此 ``install()`` 的做法是：先记下**源头模块**里那几个函数对象的身份，然后遍历
``sys.modules`` 里所有已加载的 ``deeptutor.*`` 模块，**只替换「属性值 is 原函数」的
那些**。这样既不会漏，也不会误伤同名但语义不同的属性（比如某个模块自己的 ``stream``
工具函数）。

之后才 import 的模块，因为源头属性已被替换，它们的 ``from ... import`` 自然拿到垫片。
"""

from __future__ import annotations

import sys
import uuid
from contextvars import ContextVar
from typing import Any, AsyncIterator, Awaitable, Callable, Iterable

#: 一次模型调用的统一形状（与契约 §3.2 的 llm.stream 参数一致）
Callback = Callable[[str, dict[str, Any]], Awaitable[Any]]

#: 需要**主动 import 一遍**再 patch 的消费者模块。
#: 只影响「install 当时就报出名字」，不影响覆盖正确性（源头属性已换，后来者自动继承）。
CONSUMER_MODULES: tuple[str, ...] = (
    "deeptutor.services.llm",
    "deeptutor.services.llm.factory",
    "deeptutor.services.llm.client",
    "deeptutor.services.llm.config",
    "deeptutor.services.llm.provider_factory",
    "deeptutor.services.llm.image_caption_cache",
    "deeptutor.agents.base_agent",
    "deeptutor.agents.question.pipeline",
    "deeptutor.runtime.agentic.client",
)

#: 源头模块 → 需要被替换的属性名。顺序有意义：先换源头，后来 import 的自动继承。
CANONICAL_ENTRIES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("deeptutor.services.llm.config", ("get_llm_config",)),
    ("deeptutor.services.llm.factory", ("complete", "stream", "complete_with_config")),
)

#: 合成配置里的占位端点。``.invalid`` 是 RFC 2606 保留的**永不可解析**域名，
#: 用来保证「即使上游某条路径真去拨号，也绝不会打到真实端点」。
SHIM_BASE_URL = "http://llm-shim.host.invalid/v1"

#: 合成配置里的占位密钥。真 key 永远不过桥（见 build_params 的注释）。
SHIM_API_KEY = "host-managed"

#: 宿主没选模型时的报错文案（指向宿主设置，而不是上游的 Settings > Catalog）。
NO_SELECTION_MESSAGE = (
    "宿主未选择模型：请在工作台的模型设置里选一个供应商与模型行，"
    "再重新发起这次运行"
)

SELECTION_FIELDS: tuple[str, ...] = (
    "provider",
    "model",
    "temperature",
    "maxTokens",
    "reasoningEffort",
)

#: 当前 run 的运行快照（契约 §8）。ContextVar 保证并发 run 之间互不串味；
#: 模块级兜底给「在别的线程/事件循环里被读」的极端情况（例如日志线程）。
_SELECTION_VAR: ContextVar[dict[str, Any] | None] = ContextVar(
    "zhiyun_llm_selection", default=None
)
_SELECTION_FALLBACK: dict[str, Any] = {}

_STATE: dict[str, Any] = {
    "installed": False,
    "originals": {},
    "patched": [],
}


# ── 运行快照（selection） ───────────────────────────────────────────────────


def normalize_selection(selection: Any) -> dict[str, Any]:
    """把宿主传来的运行快照收敛成固定字段（未知字段丢弃，None 保留为空）。"""
    if not isinstance(selection, dict):
        return {}
    out: dict[str, Any] = {}
    for key in SELECTION_FIELDS:
        value = selection.get(key)
        if value is None or value == "":
            continue
        out[key] = value
    return out


def set_selection(selection: Any) -> dict[str, Any]:
    """设置**当前 run** 的模型快照。返回规范化后的快照（便于回执/日志）。"""
    normalized = normalize_selection(selection)
    _SELECTION_VAR.set(normalized or None)
    _SELECTION_FALLBACK.clear()
    if normalized:
        _SELECTION_FALLBACK.update(normalized)
    return normalized


def clear_selection() -> None:
    """结束当前 run：清掉快照，后续 get_llm_config 会如实报「没配模型」。"""
    _SELECTION_VAR.set(None)
    _SELECTION_FALLBACK.clear()


def current_selection() -> dict[str, Any]:
    """读当前 run 的模型快照；没有则返回空 dict（不是 None，方便直接 get）。"""
    scoped = _SELECTION_VAR.get()
    if scoped:
        return dict(scoped)
    return dict(_SELECTION_FALLBACK)


def selection_summary() -> dict[str, Any]:
    """``status()`` 用的一行摘要。"""
    current = current_selection()
    return {
        "selectedModel": str(current.get("model") or "") or None,
        "selectedProvider": str(current.get("provider") or "") or None,
    }


# ── 上游调用参数 → 桥参数 ──────────────────────────────────────────────────


def _text(value: Any) -> str:
    return "" if value is None else str(value)


def _resolve_config(config: Any = None) -> Any:
    """拿一份 LLMConfig 用来补默认 model / temperature / max_tokens。

    ⚠️ 这里**不能再调上游 get_llm_config()**：我们正在替换它，互相调用会成环。
    只在上游主动把 config 递进来时用；否则用运行快照兜底。
    """
    return config


def build_messages(
    prompt: str,
    system_prompt: str | None,
    messages: Iterable[dict[str, Any]] | None,
) -> list[dict[str, Any]]:
    """上游的 (prompt, system_prompt, messages) 三件套 → 宿主 messages。"""
    if messages:
        out: list[dict[str, Any]] = []
        for item in messages:
            if not isinstance(item, dict):
                continue
            role = _text(item.get("role")) or "user"
            out.append({"role": role, "content": item.get("content")})
        return out
    built: list[dict[str, Any]] = []
    if system_prompt:
        built.append({"role": "system", "content": str(system_prompt)})
    built.append({"role": "user", "content": _text(prompt)})
    return built


def build_params(
    *,
    prompt: str = "",
    system_prompt: str | None = None,
    messages: Iterable[dict[str, Any]] | None = None,
    model: str | None = None,
    api_key: Any = None,
    base_url: str | None = None,
    binding: str | None = None,
    reasoning_effort: str | None = None,
    config: Any = None,
    **kwargs: Any,
) -> dict[str, Any]:
    """上游调用参数 → 契约 §3.2 的 llm.stream / llm.complete 参数。

    三条**有意为之**的取舍：

    1. ``api_key`` / ``base_url`` / ``api_version`` **不往桥上传**：宿主模型不接受上游
       的凭据，把它们塞进 NDJSON 只会让密钥顺着日志落地。真 key 永远不过桥。
    2. ``provider`` **不往桥上传**：上游说的 binding（``custom`` / ``openai`` …）是
       「上游视角的供应商」，宿主的 provider 来自运行快照。传上去会让 Node 拿一个
       宿主不认识的 provider 去 resolveModelInfo，直接 E_CAPABILITY_UNAVAILABLE。
    3. ``model`` 只在**与运行快照一致**时透传。上游可能因为能力级模型覆盖而传一个
       宿主根本没有的模型名；那种情况下传 ``None`` 让 Node 用快照，并把上游原名放进
       ``upstreamModel`` 便于排障。
    """
    snapshot = current_selection()
    selected_model = _text(snapshot.get("model")) or ""
    requested_model = _text(model) or _text(getattr(config, "model", "")) or ""

    bridge_model: str | None
    upstream_model: str | None = None
    if requested_model and (not selected_model or requested_model == selected_model):
        bridge_model = requested_model
    elif requested_model:
        bridge_model = None
        upstream_model = requested_model
    else:
        bridge_model = None

    effort = reasoning_effort
    if effort is None:
        effort = getattr(config, "reasoning_effort", None)
    if effort is None:
        effort = snapshot.get("reasoningEffort")

    temperature = kwargs.pop("temperature", None)
    if temperature is None:
        temperature = getattr(config, "temperature", None)
    if temperature is None:
        temperature = snapshot.get("temperature")
    max_tokens = kwargs.pop("max_tokens", None)
    if max_tokens is None:
        max_tokens = getattr(config, "max_tokens", None)
    if max_tokens is None:
        max_tokens = snapshot.get("maxTokens")
    timeout_ms = kwargs.pop("timeout_ms", None)
    if timeout_ms is None:
        timeout_seconds = kwargs.pop("timeout", None)
        timeout_ms = int(float(timeout_seconds) * 1000) if timeout_seconds else None

    params: dict[str, Any] = {
        "model": bridge_model,
        "provider": None,
        "messages": build_messages(prompt, system_prompt, messages),
        "temperature": temperature,
        "maxTokens": max_tokens,
        "reasoningEffort": effort,
    }
    if upstream_model:
        params["upstreamModel"] = upstream_model
    if binding:
        # 仅作诊断字段，Node 侧不会拿它当 provider 用。
        params["upstreamBinding"] = _text(binding)
    response_format = kwargs.pop("response_format", None) or kwargs.pop("responseFormat", None)
    if response_format is not None:
        params["responseFormat"] = response_format
    tools = kwargs.pop("tools", None)
    if tools is not None:
        params["tools"] = tools
    if timeout_ms is not None:
        params["timeoutMs"] = int(timeout_ms)
    # 其余上游专有 kwargs（max_retries / retry_delay / exponential_backoff /
    # image_data …）都是"上游自己重试/拼图"的实现细节，宿主侧不接受，丢弃并记录，
    # 但**不要因此报错** —— 上游传它们只是为了兼容旧调用点。
    ignored = sorted(
        key
        for key in kwargs
        if key
        not in {
            "api_key",
            "base_url",
            "api_version",
            "extra_headers",
            "provider_mode",
            "provider_name",
            "context_window",
            "wire_api",
            "api_format",
        }
    )
    if ignored:
        params["ignoredUpstreamParams"] = ignored
    return params


def extract_text(response: Any) -> str:
    """llm.* 响应 → 上游期望的纯文本。"""
    if isinstance(response, str):
        return response
    if isinstance(response, dict):
        content = response.get("content")
        if isinstance(content, str):
            return content
        if content is None:
            return ""
        return _text(content)
    if response is None:
        return ""
    return _text(response)


def extract_usage(response: Any) -> dict[str, int]:
    if not isinstance(response, dict):
        return {}
    usage = response.get("usage")
    if not isinstance(usage, dict):
        return {}
    out: dict[str, int] = {}
    for key in ("input", "output", "total", "prompt_tokens", "completion_tokens", "total_tokens"):
        value = usage.get(key)
        if isinstance(value, bool):
            continue
        if isinstance(value, (int, float)):
            out[key] = int(value)
    return out


# ── 合成 LLMConfig（补上游的"进门闸"） ────────────────────────────────────


def _config_error(message: str) -> BaseException:
    """尽量抛上游自己的 LLMConfigError（上游的 except 分支认这个类型）。

    **只在异常模块已经加载时才用它**：为了造一个报错对象而去 import 整条上游
    依赖链，等于让「宿主没选模型」这件小事把上游拖进来（也会让不依赖上游的自检
    出现假阳性）。上游真在跑时它早已在 ``sys.modules`` 里，走不到下面的兜底。
    """
    module = sys.modules.get("deeptutor.services.llm.exceptions")
    if module is not None:
        error_type = getattr(module, "LLMConfigError", None)
        if isinstance(error_type, type):
            return error_type(message)
    return RuntimeError(message)


def build_synthetic_config(selection: dict[str, Any] | None = None) -> Any:
    """用运行快照合成一份上游 ``LLMConfig``。

    ``provider_name`` 固定 ``custom``：``services/provider_registry.py`` 里它的 spec 是
    ``backend="openai_compat"``，是「任意 OpenAI 兼容端点」的落点，也是唯一不会要求
    特定厂商凭据的选项。``api_format`` / ``wire_api`` 交给上游 ``__post_init__`` 按
    provider 推导，不自己硬写。

    没有 ``model`` 时**必须抛**：宿主没配模型就该报「没配模型」，
    静默返回空配置会让「五态」里的 ``configured`` 变成谎言。
    """
    snapshot = normalize_selection(selection if selection is not None else current_selection())
    model = _text(snapshot.get("model")) or ""
    if not model:
        raise _config_error(NO_SELECTION_MESSAGE)
    try:
        from deeptutor.services.llm.config import LLMConfig  # type: ignore
    except Exception as exc:  # pragma: no cover - 依赖环境
        raise _config_error(
            f"上游 deeptutor.services.llm.config 不可用，无法合成模型配置：{exc}"
        ) from exc

    temperature = snapshot.get("temperature")
    max_tokens = snapshot.get("maxTokens")
    effort = snapshot.get("reasoningEffort")
    try:
        return LLMConfig(
            model=model,
            api_key=SHIM_API_KEY,
            base_url=SHIM_BASE_URL,
            binding="custom",
            provider_name="custom",
            provider_mode="standard",
            temperature=float(temperature) if temperature is not None else 0.7,
            max_tokens=int(max_tokens) if max_tokens is not None else 4096,
            reasoning_effort=_text(effort) or None,
        )
    except Exception as exc:  # pragma: no cover - 上游字段变化
        raise _config_error(f"合成模型配置失败：{type(exc).__name__}: {exc}") from exc


def make_get_llm_config() -> Callable[..., Any]:
    """构造替换 ``get_llm_config`` 的函数。"""

    def get_llm_config() -> Any:
        return build_synthetic_config()

    get_llm_config.__doc__ = (
        "经宿主桥合成的 LLM 配置（llm_shim 替换上游实现）；"
        "宿主没选模型时抛 LLMConfigError。"
    )
    return get_llm_config


# ── 模型调用：complete / stream / complete_with_config ─────────────────────


async def _call(callback: Callback, method: str, params: dict[str, Any]) -> Any:
    # 桥的错误已经是 BridgeError（带 kind），原样往上抛；上游的重试逻辑会看到它。
    return await callback(method, params)


def make_complete(callback: Callback) -> Callable[..., Awaitable[str]]:
    """构造替换 ``deeptutor.services.llm.complete`` 的函数。"""

    async def complete(
        prompt: str,
        system_prompt: str = "You are a helpful assistant.",
        model: str | None = None,
        api_key: Any = None,
        base_url: str | None = None,
        api_version: str | None = None,
        binding: str | None = None,
        messages: list[dict[str, Any]] | None = None,
        max_retries: int = 0,
        retry_delay: float = 0.0,
        exponential_backoff: bool = False,
        allow_image_fallback: bool | None = None,
        **kwargs: Any,
    ) -> str:
        params = build_params(
            prompt=prompt,
            system_prompt=system_prompt,
            messages=messages,
            model=model,
            api_key=api_key,
            base_url=base_url,
            binding=binding,
            **kwargs,
        )
        response = await _call(callback, "llm.complete", params)
        return extract_text(response)

    complete.__doc__ = "经宿主桥完成的 LLM 调用（llm_shim 替换上游实现）。"
    return complete


def make_stream(callback: Callback) -> Callable[..., AsyncIterator[str]]:
    """构造替换 ``deeptutor.services.llm.stream`` 的函数。

    上游签名要求返回 ``AsyncGenerator[str, None]``，并且有一个可选的 ``outcome``
    参数要在结束时被填上 finish_reason / usage（上游靠它区分"说完"与"被 max_tokens
    截断"，见 ``services/llm/types.py`` 的 ``StreamOutcome``）。
    """

    async def stream(
        prompt: str,
        system_prompt: str = "You are a helpful assistant.",
        model: str | None = None,
        api_key: Any = None,
        base_url: str | None = None,
        api_version: str | None = None,
        binding: str | None = None,
        messages: list[dict[str, Any]] | None = None,
        max_retries: int = 0,
        retry_delay: float = 0.0,
        exponential_backoff: bool = False,
        allow_image_fallback: bool | None = None,
        outcome: Any = None,
        **kwargs: Any,
    ) -> AsyncIterator[str]:
        params = build_params(
            prompt=prompt,
            system_prompt=system_prompt,
            messages=messages,
            model=model,
            api_key=api_key,
            base_url=base_url,
            binding=binding,
            **kwargs,
        )
        response = await _call(callback, "llm.stream", params)
        text = extract_text(response)
        if outcome is not None:
            finish = ""
            if isinstance(response, dict):
                finish = _text(response.get("finishReason"))
            try:
                outcome.finish_reason = finish
                outcome.usage = extract_usage(response)
            except Exception:
                # outcome 是上游 dataclass；属性名变化时不要让整次调用失败。
                pass
        # 上游把流当成"一串文本块"消费，这里整块给出即可：分块粒度不是语义。
        if text:
            yield text

    stream.__doc__ = "经宿主桥流式完成的 LLM 调用（llm_shim 替换上游实现）。"
    return stream


def make_complete_with_config(callback: Callback) -> Callable[..., Awaitable[str]]:
    """``factory.complete_with_config(config, prompt, ...)`` 的替换。"""

    async def complete_with_config(
        config: Any,
        prompt: str,
        system_prompt: str = "You are a helpful assistant.",
        messages: list[dict[str, Any]] | None = None,
        max_retries: int = 0,
        retry_delay: float = 0.0,
        exponential_backoff: bool = False,
        allow_image_fallback: bool | None = None,
        **kwargs: Any,
    ) -> str:
        params = build_params(
            prompt=prompt,
            system_prompt=system_prompt,
            messages=messages,
            model=getattr(config, "model", None),
            binding=getattr(config, "provider_name", None) or getattr(config, "binding", None),
            config=config,
            **kwargs,
        )
        response = await _call(callback, "llm.complete", params)
        return extract_text(response)

    complete_with_config.__doc__ = "经宿主桥完成的 LLM 调用（llm_shim 替换上游实现）。"
    return complete_with_config


# ── 第四层：agentic 引擎自建的 OpenAI 客户端 ──────────────────────────────
#
# 为什么前三层还不够：``deep_question`` / ``deep_solve`` / ``deep_research`` /
# ``explore_context`` 这些能力在 1.6.x 已经搬到 ``runtime/agentic`` 引擎上，它们
# **不经过** ``services.llm.complete/stream``，而是自己拿一个 OpenAI SDK 客户端直接
# ``await client.chat.completions.create(...)``：
#
#   deeptutor/agents/question/pipeline.py:491   client = build_openai_client(self.client_config)
#   deeptutor/agents/loop/pipeline.py:1778      def _build_openai_client(self): return build_openai_client(...)
#   deeptutor/runtime/agentic/labeled_step.py:454  await client.chat.completions.create(**kwargs)
#
# 宿主环境拿不到真 key（合成配置里的 base_url 是 ``llm-shim.host.invalid``），所以
# 这条路径会去拨号并报 502/连不上 —— 前三层垫片一行都不会被走到。因此必须把
# ``build_openai_client`` 本身换成「返回假客户端」的版本：假客户端的 ``create()``
# 只做一件事 —— 把参数翻成契约 §3.2 的 ``llm.stream`` / ``llm.complete`` 反向请求，
# 再把桥拿回来的整份结果摊成上游认得的 OpenAI chunk 序列。
#
# 假客户端**刻意 duck-typing**（不 import openai 的 pydantic 模型）：上游读的是
# ``chunk.choices[0].delta.content`` / ``chunk.usage`` 这类属性路径，普通对象就够，
# 而依赖 openai SDK 会让「依赖没装完就跑不起来」的边界重新出现。

#: 只 patch 这两个名字，不动其余 OpenAI 相关符号（Provider 适配器走的是另一条路）。
AGENTIC_CLIENT_ENTRIES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("deeptutor.runtime.agentic.client", ("build_openai_client", "_build_openai_client")),
)

#: 上游 ``labeled_step`` 只记录 finish_reason、不分支，但事件会把它透给用户，
#: 所以用**上游认得的词表**（``tool_calls`` 是下划线，不是宿主的 ``tool-calls``）。
FINISH_REASON_MAP: dict[str, str] = {
    "stop": "stop",
    "length": "length",
    "max-tokens": "length",
    "max_tokens": "length",
    "tool-calls": "tool_calls",
    "tool_calls": "tool_calls",
    "content-filter": "content_filter",
    "content_filter": "content_filter",
}


class _Usage:
    """OpenAI ``CompletionUsage`` 的最小替身。

    ``services/llm/usage_frame.token_counts()`` 在「普通对象」分支里按属性名读
    ``prompt_tokens`` / ``completion_tokens`` / ``total_tokens``，所以只需要这三个。
    """

    __slots__ = ("prompt_tokens", "completion_tokens", "total_tokens")

    def __init__(self, prompt_tokens: int = 0, completion_tokens: int = 0, total_tokens: int = 0):
        self.prompt_tokens = int(prompt_tokens or 0)
        self.completion_tokens = int(completion_tokens or 0)
        self.total_tokens = int(total_tokens or 0)


class _DeltaFunction:
    __slots__ = ("name", "arguments")

    def __init__(self, name: str = "", arguments: str = "") -> None:
        self.name = name
        self.arguments = arguments


class _DeltaToolCall:
    """``runtime/agentic/tool_call_stream.py`` 读 ``index/id/function.name/function.arguments``。"""

    __slots__ = ("index", "id", "type", "function")

    def __init__(self, index: int, call_id: str, name: str, arguments: str) -> None:
        self.index = index
        self.id = call_id
        self.type = "function"
        self.function = _DeltaFunction(name, arguments)


class _Delta:
    __slots__ = ("content", "reasoning_content", "reasoning", "tool_calls")

    def __init__(
        self,
        content: str | None = None,
        reasoning: str | None = None,
        tool_calls: list[Any] | None = None,
    ) -> None:
        self.content = content
        # 上游同时读 ``reasoning_content``（DeepSeek 风格）与 ``reasoning``（部分网关），
        # 两个名字给同一个值，省得上游为「哪个字段有货」再分支一次。
        self.reasoning_content = reasoning
        self.reasoning = reasoning
        self.tool_calls = tool_calls


class _Message:
    __slots__ = ("role", "content", "reasoning_content", "tool_calls")

    def __init__(
        self,
        content: str = "",
        reasoning: str | None = None,
        tool_calls: list[Any] | None = None,
    ) -> None:
        self.role = "assistant"
        self.content = content
        self.reasoning_content = reasoning
        self.tool_calls = tool_calls


class _Choice:
    __slots__ = ("index", "delta", "message", "finish_reason", "provider_specific_fields")

    def __init__(
        self,
        *,
        index: int = 0,
        delta: _Delta | None = None,
        message: _Message | None = None,
        finish_reason: str | None = None,
    ) -> None:
        self.index = index
        self.delta = delta
        self.message = message
        self.finish_reason = finish_reason
        # Anthropic 的签名思考块走这个字段；我们不做 native 适配，给 None 即可。
        self.provider_specific_fields = None


class _Chunk:
    __slots__ = ("id", "object", "created", "model", "choices", "usage")

    def __init__(
        self,
        *,
        chunk_id: str,
        model: str,
        choices: list[_Choice],
        usage: _Usage | None = None,
    ) -> None:
        self.id = chunk_id
        self.object = "chat.completion.chunk"
        self.created = 0
        self.model = model
        self.choices = choices
        self.usage = usage


class _CompletionResponse:
    """非流式（``stream=False``）入口的返回形状。"""

    __slots__ = ("id", "object", "created", "model", "choices", "usage")

    def __init__(
        self, *, reply_id: str, model: str, message: _Message, usage: _Usage
    ) -> None:
        self.id = reply_id
        self.object = "chat.completion"
        self.created = 0
        self.model = model
        self.choices = [_Choice(message=message, finish_reason="stop")]
        self.usage = usage


class _FakeAsyncStream:
    """把桥拿回来的**整份**结果摊成 OpenAI 流式 chunk 序列。

    上游是逐 chunk 消费的，但**分块粒度不是语义**（它把 content 一段段拼起来做
    label 探测），所以这里一次性给出也能正确工作；真正有语义的是**顺序**：
    正文 → 工具调用 → finish_reason → usage 尾帧。最后那帧 usage 必须单独发，
    因为上游对「已经见过 finish_reason 但还没见过 usage」留了
    ``_USAGE_TRAILER_GRACE_TIMEOUT_S`` 的等待窗口 —— 不给尾帧它就会白等一次超时。
    """

    def __init__(self, chunks: Iterable[_Chunk]) -> None:
        self._chunks: list[_Chunk] = list(chunks)
        self._index = 0

    def __aiter__(self) -> "_FakeAsyncStream":
        return self

    async def __anext__(self) -> _Chunk:
        if self._index >= len(self._chunks):
            raise StopAsyncIteration
        chunk = self._chunks[self._index]
        self._index += 1
        return chunk

    async def close(self) -> None:
        self._chunks = []
        self._index = 0

    async def aclose(self) -> None:
        await self.close()


def _attach_tool_ids(built: Any, original: Any) -> None:
    """给 ``role=tool`` 的消息补上 ``callId``。

    ``build_params`` 只保留 role/content，而宿主 ``toHostMessages`` 靠
    ``message.callId || message.tool_call_id`` 把工具结果与那次调用对上。对不上
    就等于把工具结果变成一条普通用户发言 —— 模型会以为自己没调过工具。
    """

    if not isinstance(built, list) or not isinstance(original, list):
        return
    sources = [item for item in original if isinstance(item, dict)]
    for out, src in zip(built, sources):
        if not isinstance(out, dict):
            continue
        if _text(out.get("role")) != "tool":
            continue
        call_id = (
            _text(src.get("tool_call_id")) or _text(src.get("callId")) or _text(src.get("id"))
        )
        if call_id:
            out["callId"] = call_id


class _FakeCompletions:
    """``client.chat.completions`` 的替身：唯一职责是把调用送过桥。"""

    def __init__(self, callback: Callback, config: Any) -> None:
        self._callback = callback
        self._config = config

    async def create(self, **kwargs: Any) -> Any:
        snapshot = current_selection()
        if not (_text(snapshot.get("model")) or _text(kwargs.get("model"))):
            # 没选模型时**当场**报「宿主未选择模型」，而不是让一个占位 route 去桥
            # 那里兜一圈再变成 E_CAPABILITY_UNAVAILABLE —— 文案要指向宿主设置。
            raise _config_error(NO_SELECTION_MESSAGE)

        stream = bool(kwargs.get("stream"))
        params = build_params(
            messages=kwargs.get("messages"),
            model=kwargs.get("model"),
            binding=getattr(self._config, "binding", None),
            reasoning_effort=kwargs.get("reasoning_effort"),
            temperature=kwargs.get("temperature"),
            max_tokens=kwargs.get("max_tokens") or kwargs.get("max_completion_tokens"),
            tools=kwargs.get("tools"),
        )
        _attach_tool_ids(params.get("messages"), kwargs.get("messages"))

        response = await _call(
            self._callback, "llm.stream" if stream else "llm.complete", params
        )
        payload = response if isinstance(response, dict) else {}

        text = extract_text(response)
        reasoning = _text(payload.get("reasoning")) or None
        raw_calls = payload.get("toolCalls")
        calls = [item for item in raw_calls if isinstance(item, dict)] if isinstance(raw_calls, list) else []

        counts = extract_usage(payload)
        usage = _Usage(
            prompt_tokens=counts.get("prompt_tokens") or counts.get("input") or 0,
            completion_tokens=counts.get("completion_tokens") or counts.get("output") or 0,
            total_tokens=counts.get("total_tokens") or counts.get("total") or 0,
        )
        finish = FINISH_REASON_MAP.get(_text(payload.get("finishReason")).lower(), "stop")
        if calls:
            finish = "tool_calls"
        model_name = _text(payload.get("model")) or _text(kwargs.get("model")) or "host-model"
        reply_id = f"chatcmpl-shim-{uuid.uuid4().hex[:16]}"

        if not stream:
            message = _Message(
                content=text,
                reasoning=reasoning,
                tool_calls=[
                    _DeltaToolCall(
                        index,
                        _text(call.get("id")) or f"call_{index}",
                        _text(call.get("name")),
                        _text(call.get("arguments")),
                    )
                    for index, call in enumerate(calls)
                ]
                or None,
            )
            return _CompletionResponse(
                reply_id=reply_id, model=model_name, message=message, usage=usage
            )

        chunks: list[_Chunk] = []
        if text or reasoning:
            chunks.append(
                _Chunk(
                    chunk_id=reply_id,
                    model=model_name,
                    choices=[_Choice(delta=_Delta(content=text or None, reasoning=reasoning))],
                )
            )
        for index, call in enumerate(calls):
            chunks.append(
                _Chunk(
                    chunk_id=reply_id,
                    model=model_name,
                    choices=[
                        _Choice(
                            delta=_Delta(
                                tool_calls=[
                                    _DeltaToolCall(
                                        index,
                                        _text(call.get("id")) or f"call_{index}",
                                        _text(call.get("name")),
                                        _text(call.get("arguments")),
                                    )
                                ]
                            )
                        )
                    ],
                )
            )
        # finish_reason 帧：上游靠它结束本轮（``finish_reason_seen``）。
        chunks.append(
            _Chunk(
                chunk_id=reply_id,
                model=model_name,
                choices=[_Choice(finish_reason=finish)],
            )
        )
        # usage 尾帧：choices 为空，上游会先记 usage 再跳出。
        chunks.append(
            _Chunk(
                chunk_id=reply_id,
                model=model_name,
                choices=[],
                usage=usage,
            )
        )
        return _FakeAsyncStream(chunks)


class _FakeChat:
    __slots__ = ("completions",)

    def __init__(self, callback: Callback, config: Any) -> None:
        self.completions = _FakeCompletions(callback, config)


class FakeOpenAIClient:
    """``build_openai_client()`` 的返回物：只有 chat.completions 与 close。"""

    __slots__ = ("chat",)

    def __init__(self, callback: Callback, config: Any) -> None:
        self.chat = _FakeChat(callback, config)

    async def close(self) -> None:
        return None

    async def aclose(self) -> None:
        return None


def make_build_openai_client(callback: Callback) -> Callable[..., Any]:
    """构造替换 ``runtime.agentic.client.build_openai_client`` 的函数。

    上游签名是 ``build_openai_client(config) -> client``；``_build_openai_client``
    多两个只影响真实 SDK 的关键字参数（``disable_ssl_verify`` / ``sdk_max_retries``），
    假客户端一律收下并忽略 —— 「要不要校验证书」对一条走桥的调用没有意义。
    """

    def build_openai_client(config: Any = None, *args: Any, **kwargs: Any) -> Any:
        return FakeOpenAIClient(callback, config)

    build_openai_client.__doc__ = (
        "经宿主桥转发模型调用的假 OpenAI 客户端（llm_shim 替换上游实现）；"
        "上游拿到的 chat.completions.create 会变成一次 llm.stream 反向请求。"
    )
    return build_openai_client


# ── 装配 / 卸载 ───────────────────────────────────────────────────────────


#: 上游给这几个函数起的**别名**（同一对象被 import 到不同名字下）。
#: 例如 ``agents/base_agent.py:28`` 就是 ``from deeptutor.services.llm import complete
#: as llm_complete`` —— 名字变了、对象还是同一个。install 因此按**对象身份**扫属性，
#: 而不是按属性名匹配（见 ``install()``）。
ALIAS_NAMES: tuple[str, ...] = (
    "llm_complete",
    "llm_stream",
    "llm_call",
    "get_llm_config_from_resolver",
)


def _import_module(name: str) -> Any:
    import importlib

    module = sys.modules.get(name)
    if module is not None:
        return module
    try:
        return importlib.import_module(name)
    except Exception:
        return None


def _canonical_originals() -> dict[str, Any]:
    """记下源头模块里那几个函数的身份（替换与还原都以它为准）。"""
    originals: dict[str, Any] = {}
    for module_name, attributes in CANONICAL_ENTRIES + AGENTIC_CLIENT_ENTRIES:
        module = _import_module(module_name)
        if module is None:
            continue
        for attribute in attributes:
            original = getattr(module, attribute, None)
            if callable(original):
                originals[attribute] = original
    return originals


def _eager_consumers() -> None:
    """尽量把已知消费者 import 进来，让 install 当场就能报出它们的名字。"""
    for name in CONSUMER_MODULES:
        _import_module(name)


def install(callback: Callback, *, logger: Callable[[str], None] | None = None) -> list[str]:
    """把上游模型入口换到桥上。返回被改写的模块名列表（幂等）。

    只替换「当前值 is 源头原函数」的属性 —— 见模块 docstring 的覆盖策略说明。
    """
    if _STATE.get("installed"):
        return list(_STATE.get("patched") or [])

    fake_client = make_build_openai_client(callback)
    replacements: dict[str, Callable[..., Any]] = {
        "get_llm_config": make_get_llm_config(),
        "complete": make_complete(callback),
        "stream": make_stream(callback),
        "complete_with_config": make_complete_with_config(callback),
        # agentic 引擎直连 OpenAI SDK 的入口（见「第四层」小节）。
        "build_openai_client": fake_client,
        "_build_openai_client": fake_client,
    }
    originals = _canonical_originals()
    if not originals:
        # 上游根本没加载成功：不装、不报错，由上层按 deps-missing 处理。
        if logger:
            logger("llm_shim 未安装：上游模块尚未加载")
        return []

    _eager_consumers()

    # 建立「原函数对象 → 替换函数」的映射。用 id() 作键，因为函数对象不可哈希式比较
    # 语义之外还要处理绑定的别名（``complete as llm_complete`` 是同一个对象）。
    by_identity = {id(original): replacements[attribute] for attribute, original in originals.items() if attribute in replacements}

    patched: list[str] = []
    saved: dict[str, dict[str, Any]] = {}
    for module_name, module in list(sys.modules.items()):
        if module is None or not str(module_name).startswith("deeptutor"):
            continue
        touched: dict[str, Any] = {}
        # 按**对象身份**扫该模块的全部属性名：查 ``touched`` 时不看名字，只看
        # 「这个属性的值是不是就是上游那个原函数」。这样：
        #   - ``complete``（原名）和 ``llm_complete``（别名）都能命中；
        #   - 某个模块恰好有同名但不同语义的属性（比如自己的 stream 工具）不会被误伤。
        for attribute_name, value in list(vars(module).items()):
            replacement = by_identity.get(id(value))
            if replacement is None or value is replacement:
                continue
            touched[attribute_name] = value
            setattr(module, attribute_name, replacement)
        if touched:
            saved[module_name] = touched
            patched.append(module_name)

    _STATE.update({"installed": True, "originals": saved, "patched": patched})
    if logger:
        logger(f"llm_shim 已接管上游模型入口：{', '.join(patched) or '（没有可用模块）'}")
    return patched


def restore() -> None:
    """把上游模型入口恢复原状（测试与卸载用）。"""
    saved = _STATE.get("originals") or {}
    for module_name, attributes in saved.items():
        module = sys.modules.get(module_name)
        if module is None:
            continue
        for attribute, original in attributes.items():
            setattr(module, attribute, original)
    _STATE.update({"installed": False, "originals": {}, "patched": []})


def is_installed() -> bool:
    return bool(_STATE.get("installed"))


def status() -> dict[str, Any]:
    """``status`` / ``capabilities`` 里的 ``llmShim`` 字段（Lead 钉的读取路径）。"""
    return {
        "installed": is_installed(),
        "patchedModules": list(_STATE.get("patched") or []),
        **selection_summary(),
    }


__all__ = [
    "AGENTIC_CLIENT_ENTRIES",
    "CONSUMER_MODULES",
    "FakeOpenAIClient",
    "NO_SELECTION_MESSAGE",
    "SELECTION_FIELDS",
    "build_messages",
    "build_params",
    "build_synthetic_config",
    "clear_selection",
    "current_selection",
    "extract_text",
    "extract_usage",
    "install",
    "is_installed",
    "make_build_openai_client",
    "make_complete",
    "make_complete_with_config",
    "make_get_llm_config",
    "make_stream",
    "normalize_selection",
    "restore",
    "selection_summary",
    "set_selection",
    "status",
]


# ── 自检（不 import 上游：pip 没装完也必须能跑） ───────────────────────────


def _selftest() -> int:
    failures: list[str] = []

    def check(label: str, condition: bool, detail: str = "") -> None:
        if not condition:
            failures.append(f"{label}{('：' + detail) if detail else ''}")

    set_selection({"provider": "p", "model": "m1", "temperature": 0.2, "maxTokens": 64, "junk": 1})
    check("selection 只留白名单字段", current_selection() == {
        "provider": "p",
        "model": "m1",
        "temperature": 0.2,
        "maxTokens": 64,
    }, str(current_selection()))
    check("selection_summary 报出模型", selection_summary()["selectedModel"] == "m1", str(selection_summary()))

    params = build_params(
        prompt="出题",
        system_prompt="你是老师",
        model="m1",
        binding="custom",
        temperature=0.2,
        max_tokens=64,
        api_key="should-not-leak",
        base_url="http://should-not-leak.example",
    )
    check("messages 有 system 与 user", [m["role"] for m in params["messages"]] == ["system", "user"], str(params))
    check("与快照一致的 model 透传", params["model"] == "m1", str(params.get("model")))
    check("provider 不上桥（避免宿主不认识的上游 binding）", params["provider"] is None, str(params.get("provider")))
    check("上游 binding 只作诊断字段", params.get("upstreamBinding") == "custom", str(params.get("upstreamBinding")))
    check("temperature 快照/入参透传", params["temperature"] == 0.2, str(params.get("temperature")))
    check("maxTokens 透传", params["maxTokens"] == 64, str(params.get("maxTokens")))
    serialized = repr(params)
    check("api_key 不出现在桥参数里", "should-not-leak" not in serialized, serialized[:200])
    check("base_url 不出现在桥参数里", "should-not-leak.example" not in serialized, serialized[:200])

    # 上游要求一个宿主没有的模型时：不上桥，降级为 upstreamModel 诊断字段。
    foreign = build_params(prompt="x", model="upstream-only-model")
    check("陌生模型不污染 route", foreign["model"] is None, str(foreign.get("model")))
    check("陌生模型记进 upstreamModel", foreign.get("upstreamModel") == "upstream-only-model", str(foreign))

    # 没选模型时必须抛，且文案指向宿主设置（不能静默返回空配置）。
    clear_selection()
    try:
        make_get_llm_config()()
    except BaseException as exc:  # noqa: BLE001 - 上游异常类型可能不可 import
        message = str(exc)
        check("无 selection 时 get_llm_config 抛错", True)
        check("错误文案指向宿主设置", "宿主" in message and "模型" in message, message)
    else:
        check("无 selection 时 get_llm_config 抛错", False, "没有抛异常")

    check("无 selection 时 status().selectedModel 为空", status()["selectedModel"] is None, str(status()))
    check("install 前 installed=false", status()["installed"] is False, str(status()))

    check("extract_text 处理 str", extract_text("abc") == "abc")
    check("extract_text 处理 dict", extract_text({"content": "xyz"}) == "xyz")
    check("extract_text 处理 None", extract_text(None) == "")
    check(
        "extract_usage 只留数字",
        extract_usage({"usage": {"input": 3, "output": 4, "total": 7, "junk": "x"}})
        == {"input": 3, "output": 4, "total": 7},
        str(extract_usage({"usage": {"input": 3, "output": 4, "total": 7, "junk": "x"}})),
    )

    set_selection({"provider": "p", "model": "m1"})

    async def fake_callback(method: str, arguments: dict[str, Any]) -> Any:
        return {"content": "桥来的文本", "usage": {"input": 1, "output": 2}, "finishReason": "stop"}

    async def run() -> None:
        complete = make_complete(fake_callback)
        text = await complete("hi")
        check("complete 走桥拿文本", text == "桥来的文本", text)

        class Outcome:
            finish_reason = ""
            usage: dict[str, int] = {}

        outcome = Outcome()
        stream = make_stream(fake_callback)
        chunks = [chunk async for chunk in stream("hi", outcome=outcome)]
        check("stream 产出文本", "".join(chunks) == "桥来的文本", str(chunks))
        check("stream 回填 finish_reason", outcome.finish_reason == "stop", str(outcome.finish_reason))
        check("stream 回填 usage", outcome.usage.get("output") == 2, str(outcome.usage))

        config_impl = make_complete_with_config(fake_callback)

        class Cfg:
            model = "m1"
            provider_name = "custom"
            temperature = 0.1
            max_tokens = 8
            reasoning_effort = None

        text2 = await config_impl(Cfg(), "hi")
        check("complete_with_config 走桥", text2 == "桥来的文本", text2)

    import asyncio

    asyncio.run(run())

    # ── 第四层：agentic 假客户端 ──────────────────────────────────────────
    # 这一段**不 import 上游**，只验证假客户端自己的翻译规则与 chunk 顺序，
    # 因为上游有没有装好不该决定自检能不能过。

    set_selection({"provider": "p", "model": "m1"})

    async def agentic_run() -> None:
        seen: list[tuple[str, dict[str, Any]]] = []

        async def fake_bridge(method: str, arguments: dict[str, Any]) -> Any:
            seen.append((method, arguments))
            return {
                "content": "LABEL_A 正文",
                "reasoning": "内部推理",
                "toolCalls": [
                    {"id": "call_1", "name": "search", "arguments": '{"q":"x"}'}
                ],
                "usage": {"input": 11, "output": 22, "total": 33},
                "finishReason": "tool-calls",
                "model": "host-model-x",
            }

        factory = make_build_openai_client(fake_bridge)
        client = factory(config=None)
        check("假客户端有 chat.completions.create", hasattr(client.chat.completions, "create"))

        kwargs = {
            "model": "m1",
            "stream": True,
            "messages": [
                {"role": "system", "content": "你是老师"},
                {"role": "user", "content": "出题"},
                {"role": "tool", "tool_call_id": "call_0", "content": "工具结果"},
            ],
            "temperature": 0.3,
            "max_tokens": 128,
            "stream_options": {"include_usage": True},
            "tools": [{"type": "function", "function": {"name": "search"}}],
        }
        response_stream = await client.chat.completions.create(**kwargs)
        check("流式入口收到 llm.stream", seen and seen[-1][0] == "llm.stream", str(seen[-1:] or None))
        sent = seen[-1][1] if seen else {}
        check("system 消息进桥", [m["role"] for m in sent.get("messages", [])][:2] == ["system", "user"], str(sent.get("messages")))
        tool_message = next((m for m in sent.get("messages", []) if m.get("role") == "tool"), {})
        check("tool 消息补上 callId", tool_message.get("callId") == "call_0", str(tool_message))
        check("stream_options 不出桥", "stream_options" not in sent, str(sorted(sent)))
        check("tools 透传到桥", isinstance(sent.get("tools"), list), str(sent.get("tools")))

        chunks = [chunk async for chunk in response_stream]
        kinds = [
            "usage"
            if getattr(chunk, "usage", None) is not None and not chunk.choices
            else ("tool" if chunk.choices and chunk.choices[0].delta and chunk.choices[0].delta.tool_calls else ("content" if chunk.choices and chunk.choices[0].delta else "finish"))
            for chunk in chunks
        ]
        check(
            "chunk 顺序：正文 → 工具 → finish → usage",
            kinds == ["content", "tool", "finish", "usage"],
            str(kinds),
        )
        content_chunk = chunks[0]
        check("正文在 delta.content", content_chunk.choices[0].delta.content == "LABEL_A 正文", str(content_chunk.choices[0].delta.content))
        check(
            "推理同时给 reasoning_content 与 reasoning",
            content_chunk.choices[0].delta.reasoning_content == "内部推理"
            and content_chunk.choices[0].delta.reasoning == "内部推理",
            str(content_chunk.choices[0].delta.reasoning_content),
        )
        tool_delta = chunks[1].choices[0].delta.tool_calls[0]
        check("工具调用有 index/id/name/arguments", tool_delta.index == 0 and tool_delta.id == "call_1" and tool_delta.function.name == "search" and tool_delta.function.arguments == '{"q":"x"}', str(tool_delta.function.name))
        check("finish_reason 用上游词表 tool_calls", chunks[2].choices[0].finish_reason == "tool_calls", str(chunks[2].choices[0].finish_reason))
        usage_frame = chunks[-1].usage
        check("usage 尾帧三件套", (usage_frame.prompt_tokens, usage_frame.completion_tokens, usage_frame.total_tokens) == (11, 22, 33), str((usage_frame.prompt_tokens, usage_frame.completion_tokens, usage_frame.total_tokens)))
        check("usage 尾帧 choices 为空", chunks[-1].choices == [], str(chunks[-1].choices))

        # 非流式入口：上游 research 管线就是这么调的（stream=False）。
        seen.clear()
        completion = await client.chat.completions.create(
            model="m1", stream=False, messages=[{"role": "user", "content": "调研"}]
        )
        check("非流式入口收到 llm.complete", seen and seen[-1][0] == "llm.complete", str(seen[-1:] or None))
        check("非流式返回 message.content", completion.choices[0].message.content == "LABEL_A 正文", str(completion.choices[0].message.content))
        check("非流式返回 usage", completion.usage.total_tokens == 33, str(completion.usage.total_tokens))

        # 没选模型时必须当场报「宿主未选择模型」（进入上游重试/兜底之前）。
        clear_selection()
        try:
            await client.chat.completions.create(model=None, stream=True, messages=[])
        except BaseException as exc:  # noqa: BLE001 - 上游异常类型可能不可 import
            check("假客户端无 selection 时抛错", "宿主" in str(exc) and "模型" in str(exc), str(exc))
        else:
            check("假客户端无 selection 时抛错", False, "没有抛异常")

    set_selection({"provider": "p", "model": "m1"})
    asyncio.run(agentic_run())

    clear_selection()
    print("llm_shim selftest")
    print(f"checks: {'FAILED' if failures else 'ok'}")
    for failure in failures:
        print(f"  FAIL {failure}")
    return 0 if not failures else 1


if __name__ == "__main__":
    sys.exit(_selftest() if "--selftest" in sys.argv else 0)
