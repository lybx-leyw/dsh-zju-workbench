# 运行与配置

命令用法见 [SKILL.md](../SKILL.md)。

Node.js 24+。首次在 Skill 目录执行 `npm install`，安装固定版本的 Electron 44.0.0；Skill 用自己的浏览器，不依赖系统浏览器或其他应用。被应用托管时浏览器由应用提供（`WEREAD_BROWSER_ENDPOINT`），可以用 `npm install --omit=optional` 不装 Electron。

公众号只从微信读书查找，不读取本机微信。

## 配置

默认读取 Skill 根目录的 `.env`；同名的系统环境变量优先。`.env` 已被 Git 忽略。也可用 `WEREAD_ENV_FILE` 指定另一份环境配置文件。

| 变量 | 作用 |
|---|---|
| `WEREAD_ENV_FILE` | 指定环境配置文件；不设时读取 Skill 根目录的 `.env` |
| `WEREAD_DATA_DIR` | 数据目录，默认 `%APPDATA%/weread-skill` |
| `WEREAD_BROWSER_ENDPOINT` | 宿主应用提供的浏览器管道。设了就连它，不启动自带的 Electron；登录状态、窗口和识别模型都由宿主管 |
| `WEREAD_DISABLED` | 设为 1 时一条命令都不执行，返回 `plugin_disabled`。给宿主应用关掉这项功能用 |
| `WEREAD_INTERACTIVE` | 设为 0 表示这次命令没有人在场：要扫码或要验证时不开窗口，直接返回 `login_required`、`verification_required` |
| `WEREAD_VISION_ENDPOINT`、`_MODEL`、`_API_KEY` | 验证码识别模型（chat-completions 接口）。ENDPOINT 和 MODEL 均填写后启用识别；API_KEY 按服务要求填写。需要答题而未启用识别时由用户在窗口完成 |
| `WEREAD_VISION_THINKING`、`_REASONING_EFFORT`、`_RESPONSE_FORMAT`、`_MAX_TOKENS` | 原样传给模型接口的可选参数 |
| `WEREAD_VISION_AUDIO_INPUT` | 模型不支持音频输入时设为 false，语音题会直接报错而不发送请求 |

数据目录里只有两样东西：`browser/` 保存微信读书登录及原文站点的浏览器会话；`tracked.json` 是跟踪名单和已返回过的文章。删除 `browser/` 即退出登录。

## 登录

`login` 打开 Skill 自带的浏览器窗口，用户扫码后登录状态留在浏览器配置目录里，之后的命令直接复用。检测到过期时尝试续期一次，失败则返回 `login_required`，需要重新执行 `login`。已有登录仍然有效时检查后返回。`login --check` 只看浏览器里有没有登录记录，不联网也不开窗口；`logout` 清掉登录状态。

所有正文读取都使用自带浏览器，包括 `--source local`。普通页面在后台加载；配置了识别模型时自动验证也保持隐藏，扫码登录或未配置识别模型时显示窗口。同一个数据目录同时只能有一个命令使用浏览器，冲突时返回 `browser_busy`。

隐藏 Electron 窗口不等同于 Headless；验证失败时按返回的错误处理。

## 验证码

识别模型只收到题目文字和题图或音频，不接触登录信息和票据。支持六图/九宫格选图、文字和图形顺序点选、单拼块滑块、语音数字；模型把握不足或题型不认识时不作答并报错，重新执行命令会拿到新题。验证能否完成取决于站点与实际题型，失败时按返回的错误处理。

插件的 PTA 登录选择共享模块的 `verifyPta` 模式。它在本机浏览器中解码已加载的题图，去掉拼块透明边缘与描边后进行纹理匹配，不读取视觉模型配置、不调用模型。匹配不确定或不是单拼块时交还官方窗口；拖动成功必须收到官方票据才会继续登录。上述视觉模型配置只影响微信读书、微信原文等模型识别流程。

## 常见结果与错误

业务命令成功时返回 `ok: true`。`read` 的文章在 `article` 字段中；`download` 返回 `file` 和 `images`。业务失败时返回 `ok: false`、`status`、`message`，进程以非零状态退出。

| 状态 | 处理方式 |
|---|---|
| `account_ambiguous`、`article_ambiguous` | 根据 `candidates` 补全公众号名称或标题 |
| `login_required` | 执行 `login`，在自带窗口重新登录 |
| `verification_required` | 需要验证，而这次命令不能开窗口（`WEREAD_INTERACTIVE=0`）；在有人在场时重新执行 |
| `plugin_disabled` | 宿主应用里这项功能关着 |
| `browser_busy` | 等使用同一数据目录的上一条命令结束 |
| `verification_timeout`、`verification_cancelled` | 本次验证或取文未完成，重新执行原命令 |
| `verification_page_not_ready` | 微信读书首页未在限定时间内完成初始化，尚未启动验证码；稍后重试 |
| `recognition_uncertain`、`unsupported_verification` | 识别把握不足或题型未适配，查看 message；可不配置识别模型，改在窗口里完成验证 |
| `rate_limited`、`article_rate_limited`、`verification_rate_limited` | 等待一段时间再试 |
| `article_deleted` | 原文已删除，无法取得正文 |

公众号查找只用微信读书。`--url` 直接进入取文流程，不需要先查公众号。
