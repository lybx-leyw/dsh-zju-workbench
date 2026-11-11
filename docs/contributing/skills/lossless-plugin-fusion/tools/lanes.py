#!/usr/bin/env python3
"""泳道图生成器 —— 把一份 JSON 规格渲染成与 examples/architecture-full-chain.html 同款的 HTML。

为什么要有这个工具
==================

在第 1 步里手写泳道图的 HTML，真实的失败方式不是「不会写」，而是**每次剪枝都要重抄一遍**：
节点一多，手改就一定会漏改某一处箭头或某个 side chip；剪枝后忘记更新前驱后继更是常态。
所以把「结构」抽成 JSON，把「外观」固定在模板里，剪枝时只改 spec 里的 `cut` 字段。

另外它替第 5 步做了两件人容易忘的事：
  * `--report` 直接打印每条泳道的前驱 / 后继 —— 用户被要求写「前驱是什么、后继是什么」时，
    复制输出即可，不用自己数箭头。
  * `--check` 会把「剪了前置但留着后继」「引用了不存在的泳道」判为错误并非零退出。

用法
====

    # 生成
    python3 tools/lanes.py spec.json --out docs/show/xxx-fusion-lanes.html

    # 只看结构（前驱/后继/剪枝状态），不生成 HTML
    python3 tools/lanes.py spec.json --report

    # 校验（CI / agent 自检用；有错误时退出码为 1）
    python3 tools/lanes.py spec.json --check

    # 临时剪掉几条，不修改 spec 文件
    python3 tools/lanes.py spec.json --prune L4,L6 --out out.html

Windows 上 `python3` 不可用时用 `py tools/lanes.py`。

规格格式
========

见 examples/fusion-spec.example.json；下面是要点的摘要。

顶层：
    title       页面主标题
    subtitle    主标题下的一行小字
    eyebrow     页眉左侧的等宽小字，如 "图 1 · 某插件 · 数据流"
    fig_head    页眉右侧的等宽小字，如 "FIG.1 — SIGNAL FLOW · rev.2026-11"
    lede        导语（HTML，可用 `code` 与 *em* 标记）
    meta        [{"v": "11", "k": "Lanes"}, ...] 计量条
    legend      ["数据源 · 外部事实", ...]；想画虚线图例用 {"text": "...", "dash": true}
    bands       [{"title": "Ⅰ · 加工链", "range": "L1 — L4"}]
    lanes       泳道数组（见下）
    notes       底部观察；[{"no": "01", "kind": "warn|proc|tool", "title": "...", "paras": [...]}]
    footer      [{"head": "怎么读", "text": "..."}]

泳道：
    id          "L1"（必须唯一，报告与剪枝都靠它）
    no          "01"（显示用；缺省取 id 里的数字）
    name        泳道名
    sub         副题（一句话说清这条流在干什么）
    accent      src | proc | ui | tool | ghost
    cut         true 时整条画成删除线（剪枝后保留，不物理删除）
    feeds       ["L2", "L3"] —— 这条流把数据交给谁。用于 --report 与 --check
    rows        [{"label": "终点 A · 人", "items": [...]}]
    side        [{"cap": "终点"}, {"chip": "学习页 `page-study`"}]

row 里的 items 按顺序排列，每项是下列之一：
    {"t": "识别", "pkg": "core/parser", "in": "4 页拼图", "out": "页文字 + 块"}
    {"t": "阅读讲义", "em": "written / draft 逐点标记"}         # 没有明确入出时用 em
    {"t": "...", "raw": "<code>x</code> 原文"}                  # 需要自定义 HTML 时
    {"grp": "core/parser · 四步", "items": [...]}               # 虚线分组框
    {"arrow": "normal" | "plus" | "cut", "sym": "+"}            # 默认 normal
    {"rowlabel": "终点 B · agent", "split": true}                # split 表示左竖线在左边
    {"cont": "↳"}                                               # 续行记号

节点用 `kind` 决定着色，缺省继承泳道的 accent；要单独指定写 `"kind": "ui"`。

文本里的反引号包成 <code>，星号包成 <em>；其余 HTML 会被转义。
"""

from __future__ import annotations

import argparse
import html
import json
import re
import sys
from pathlib import Path

ACCENTS = {"src", "proc", "ui", "tool", "ghost"}
KINDS = {"src", "proc", "ui", "tool", "ghost"}

# ────────────────────────────── 内联标记 ──────────────────────────────

_CODE = re.compile(r"`([^`]+)`")
_EM = re.compile(r"\*([^*]+)\*")


def md(text: str) -> str:
    """把 `code` 与 *em* 标记转成 HTML；先整体转义，再把标记还原。"""
    if text is None:
        return ""
    s = html.escape(str(text), quote=False)
    s = _CODE.sub(lambda m: f"<code>{m.group(1)}</code>", s)
    s = _EM.sub(lambda m: f"<em>{m.group(1)}</em>", s)
    return s


# ────────────────────────────── 渲染 ──────────────────────────────


def render_io(item: dict) -> str:
    if "raw" in item:
        return item["raw"]
    parts = []
    if "in" in item:
        parts.append(f"<b>入</b>{md(item['in'])}")
    if "out" in item:
        parts.append(f"<b>出</b>{md(item['out'])}")
    if parts:
        return "<br>".join(parts)
    if "em" in item:
        return f"<em>{md(item['em'])}</em>"
    return ""


def default_kind(lane: dict) -> str:
    """节点缺省着色：ghost 泳道里的节点默认也是 ghost，其余默认 proc。

    不能直接用泳道的 accent —— accent 同时用来染泳道编号，而一条泳道里
    往往 src / proc / ui 混排（例如「skill 文件 → agent 指令」）。用 accent
    当缺省会让整条泳道的节点变成同一个颜色，读者反而看不出形态变化。
    """
    return "ghost" if lane.get("accent") == "ghost" else "proc"


def render_node(item: dict, lane: dict) -> str:
    kind = item.get("kind") or default_kind(lane)
    if kind not in KINDS:
        raise ValueError(f"未知的 kind: {kind!r}")
    cls = f"node n-{kind}"
    if item.get("cut"):
        cls += " cut"
    title = md(item.get("t", ""))
    pkg = item.get("pkg")
    head = f"{title}<small>{md(pkg)}</small>" if pkg else title
    io = render_io(item)
    io_html = f'\n<div class="io">{io}</div>' if io else ""
    return f'<div class="{cls}">\n<div class="t">{head}</div>{io_html}\n</div>'


def render_arrow(item: dict) -> str:
    kind = item.get("arrow", "normal")
    if kind == "plus":
        sym = item.get("sym", "+")
        return f'<span class="arw plus"><span class="pl">{html.escape(sym)}</span></span>'
    if kind == "cut":
        return '<span class="arw cut"></span>'
    return '<span class="arw"></span>'


def render_rowlabel(item: dict) -> str:
    cls = "row-label split" if item.get("split") else "row-label"
    return f'<span class="{cls}">{md(item["rowlabel"])}</span>'


def render_item(item: dict, lane: dict) -> str:
    if "arrow" in item:
        return render_arrow(item)
    if "rowlabel" in item:
        return render_rowlabel(item)
    if "cont" in item:
        return f'<span class="cont-mark">{html.escape(item["cont"])}</span>'
    if "grp" in item:
        inner = "\n".join(render_item(i, lane) for i in item.get("items", []))
        return (
            f'<div class="grp" data-label="{html.escape(item["grp"])}">\n{inner}\n</div>'
        )
    if "chip" in item:
        return f'<span class="chip">{md(item["chip"])}</span>'
    if "cap" in item:
        return f'<span class="cap">{md(item["cap"])}</span>'
    return render_node(item, lane)


def render_lane(lane: dict) -> str:
    accent = lane.get("accent", "proc")
    if accent not in ACCENTS:
        raise ValueError(f"{lane.get('id')}: 未知的 accent {accent!r}")
    cut_cls = " cut" if lane.get("cut") else ""
    no = lane.get("no") or re.sub(r"\D", "", str(lane.get("id", "")))
    rows_html = []
    for row in lane.get("rows", []):
        label = row.get("label")
        lead = (
            f'<span class="row-label">{md(label)}</span>\n' if label else ""
        )
        items = "\n".join(render_item(i, lane) for i in row.get("items", []))
        rows_html.append(f'<div class="row">\n{lead}{items}\n</div>')
    side = lane.get("side") or []
    side_html = ""
    if side:
        side_html = (
            '<div class="side">\n'
            + "\n".join(render_item(i, lane) for i in side)
            + "\n</div>"
        )
    return f"""<section class="lane{cut_cls}" data-lane="{html.escape(str(lane.get('id','')))}" style="--accent:var(--c-{accent})">
<div class="lane-no">{html.escape(str(no))}</div>
<div class="lane-name">
<span class="nm">{md(lane.get('name',''))}</span>
<span class="ab">{md(lane.get('sub',''))}</span>
</div>
<div class="lane-body">
<div class="flow">
{chr(10).join(rows_html)}
</div>
{side_html}
</div>
</section>"""


def render_band(band: dict) -> str:
    return (
        '<div class="band-div"><span>'
        + md(band.get("title", ""))
        + '</span><span class="r">'
        + md(band.get("range", ""))
        + "</span></div>"
    )


def render_legend(entries) -> str:
    out = []
    for e in entries:
        if isinstance(e, str):
            out.append(f'<span><i style="background:var(--c-proc)"></i>{md(e)}</span>')
        elif e.get("dash"):
            out.append(f'<span><i class="dash"></i>{md(e.get("text", ""))}</span>')
        else:
            c = e.get("color", "proc")
            out.append(
                f'<span><i style="background:var(--c-{c})"></i>{md(e.get("text", ""))}</span>'
            )
    return '<div class="legend">\n' + "\n".join(out) + "\n</div>"


def render_meta(entries) -> str:
    if not entries:
        return ""
    cells = "\n".join(
        f'<div><div class="v">{html.escape(str(e.get("v","")))}</div>'
        f'<div class="k">{md(e.get("k",""))}</div></div>'
        for e in entries
    )
    return f'<div class="meta">\n{cells}\n</div>'


def render_notes(notes) -> str:
    if not notes:
        return ""
    blocks = []
    for n in notes:
        kind = n.get("kind", "proc")
        paras = "\n".join(f"<p>{md(p)}</p>" for p in n.get("paras", []))
        blocks.append(
            f'<div class="note {html.escape(kind)}">\n'
            f'<div class="note-no">{html.escape(str(n.get("no","")))}</div>\n'
            f'<div class="note-body"><h3>{md(n.get("title",""))}</h3>\n{paras}\n</div>\n</div>'
        )
    count = len(notes)
    return (
        '<div class="notes">\n'
        f'<div class="notes-hd"><span>观察</span><span class="rt">NOTES · {count:02d}</span></div>\n'
        + "\n".join(blocks)
        + "\n</div>"
    )


def render_footer(items) -> str:
    if not items:
        return ""
    cols = "\n".join(
        f'<p><b>{md(i.get("head",""))}</b>{md(i.get("text",""))}</p>' for i in items
    )
    return f'<footer>\n<div class="colophon">\n{cols}\n</div>\n<div class="endmark">End of Figure</div>\n</footer>'


# ────────────────────────────── 模板 ──────────────────────────────

CSS = """
:root{
  --paper:#f3f0e8; --paper-hi:#fbf9f3; --paper-lo:#eae5d8;
  --ink:#191813; --ink-2:#3a372f; --ink-3:#6b6558; --ink-4:#978f7e;
  --rule:#d6d0bf; --rule-2:#c0b8a3; --rule-3:#a79e86;
  --c-src:#235d9e; --c-proc:#9c611a; --c-ui:#ab382c; --c-tool:#2b6749; --c-ghost:#8a8477;
  --serif:"Source Han Serif SC","Noto Serif SC","Songti SC","STSong","SimSun",Georgia,serif;
  --sans:"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Segoe UI",system-ui,sans-serif;
  --mono:"Cascadia Code","JetBrains Mono",ui-monospace,SFMono-Regular,Consolas,"SF Mono",monospace;
  --ease:cubic-bezier(.22,.61,.36,1);
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;scroll-behavior:smooth}
body{
  margin:0;color:var(--ink);background-color:var(--paper);
  background-image:
    radial-gradient(1200px 700px at 50% -8%, #fcfaf5 0%, transparent 60%),
    radial-gradient(900px 600px at 92% 100%, #eee9dc 0%, transparent 68%);
  font:14px/1.7 var(--sans);-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;
}
body::before{
  content:"";position:fixed;inset:0;z-index:0;pointer-events:none;opacity:.40;mix-blend-mode:multiply;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='150' height='150'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.82' numOctaves='4' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='150' height='150' filter='url(%23n)' opacity='.15'/%3E%3C/svg%3E");
}
#prog{
  position:fixed;top:0;left:0;height:2px;width:0;z-index:50;
  background:linear-gradient(90deg,var(--c-src),var(--c-proc) 42%,var(--c-ui) 72%,var(--c-tool));
  transition:width .1s linear;
}
.wrap{position:relative;z-index:1;max-width:1560px;margin:0 auto;padding:64px 40px 110px}
code{
  font-family:var(--mono);font-size:.87em;color:var(--ink-2);
  background:rgba(25,24,19,.045);padding:.5px 4px;border-radius:2px;white-space:nowrap;
}
header{margin-bottom:40px}
.fig-head{
  display:flex;align-items:baseline;gap:14px;padding-bottom:9px;border-bottom:1.5px solid var(--ink);
  font-family:var(--mono);font-size:9.5px;font-weight:600;
  letter-spacing:.26em;text-transform:uppercase;color:var(--ink-3);
}
.fig-head .no{color:var(--c-ui);letter-spacing:.2em}
.fig-head .rt{margin-left:auto;letter-spacing:.16em;font-weight:400;color:var(--ink-4)}
h1{
  margin:28px 0 0;font-family:var(--serif);font-size:clamp(34px,4vw,54px);
  font-weight:700;line-height:1.06;letter-spacing:-1.4px;color:var(--ink);
}
h1 .thin{
  display:block;margin-top:12px;font-family:var(--sans);
  font-size:clamp(14px,1.45vw,17px);font-weight:400;letter-spacing:.12em;color:var(--ink-3);
}
.lede{margin:26px 0 0;max-width:820px;font-size:14.5px;line-height:1.88;color:var(--ink-2);text-align:justify}
.lede b{font-weight:600;color:var(--ink);box-shadow:inset 0 -1px 0 var(--rule-3)}
.meta{
  display:flex;flex-wrap:wrap;margin:38px 0 0;
  border-top:1px solid var(--rule-2);border-bottom:1px solid var(--rule-2);
}
.meta div{flex:1 1 118px;padding:13px 0 14px;border-right:1px solid var(--rule)}
.meta div:last-child{border-right:none}
.meta div:not(:first-child){padding-left:22px}
.meta .v{
  font-family:var(--mono);font-size:20px;font-weight:600;letter-spacing:-.03em;
  line-height:1.15;color:var(--ink);font-variant-numeric:tabular-nums;
}
.meta .k{font-size:9.5px;letter-spacing:.17em;color:var(--ink-4);margin-top:5px;text-transform:uppercase}
.legend{
  display:flex;flex-wrap:wrap;gap:10px 26px;align-items:center;
  margin:26px 0 12px;font-size:11.5px;color:var(--ink-3);
}
.legend span{display:inline-flex;align-items:center;gap:8px;white-space:nowrap}
.legend i{display:block;width:18px;height:2px}
.legend i.dash{height:0;border-top:2px dashed var(--c-ghost);background:none}
.stage{
  position:relative;margin-top:6px;border:1px solid var(--rule-2);
  background-color:var(--paper-hi);
  background-image:radial-gradient(circle at 1px 1px, rgba(25,24,19,.05) 1px, transparent 1px);
  background-size:20px 20px;
}
.stage .reg{position:absolute;width:11px;height:11px;pointer-events:none;z-index:3}
.stage .reg::before,.stage .reg::after{content:"";position:absolute;background:var(--rule-3)}
.stage .reg::before{left:50%;top:0;bottom:0;width:1px;transform:translateX(-.5px)}
.stage .reg::after{top:50%;left:0;right:0;height:1px;transform:translateY(-.5px)}
.stage .reg.tl{top:-6px;left:-6px}
.stage .reg.tr{top:-6px;right:-6px}
.stage .reg.bl{bottom:-6px;left:-6px}
.stage .reg.br{bottom:-6px;right:-6px}
.band-div{
  display:flex;align-items:baseline;gap:12px;padding:9px 18px 8px;
  background:var(--paper-lo);border-bottom:1px solid var(--rule-2);
  font-family:var(--mono);font-size:9px;font-weight:600;
  letter-spacing:.22em;text-transform:uppercase;color:var(--ink-3);
}
.band-div .r{margin-left:auto;letter-spacing:.16em;font-weight:400;color:var(--ink-4)}
.lane{
  --accent:var(--c-proc);display:grid;grid-template-columns:70px 176px minmax(0,1fr);
  border-bottom:1px solid var(--rule);position:relative;
  opacity:0;transform:translateY(8px);animation:lane-in .6s var(--ease) forwards;
}
.lane:last-of-type{border-bottom:none}
.lane:nth-of-type(1){animation-delay:.03s}
.lane:nth-of-type(2){animation-delay:.07s}
.lane:nth-of-type(3){animation-delay:.11s}
.lane:nth-of-type(4){animation-delay:.15s}
.lane:nth-of-type(5){animation-delay:.19s}
.lane:nth-of-type(6){animation-delay:.23s}
.lane:nth-of-type(7){animation-delay:.27s}
.lane:nth-of-type(8){animation-delay:.31s}
.lane:nth-of-type(9){animation-delay:.35s}
.lane:nth-of-type(10){animation-delay:.39s}
.lane:nth-of-type(11){animation-delay:.43s}
@keyframes lane-in{to{opacity:1;transform:none}}
.lane-no{
  position:relative;padding:21px 0 0 15px;font-family:var(--mono);font-size:11px;
  font-weight:600;letter-spacing:.05em;color:var(--accent);border-right:1px solid var(--rule);
}
.lane-no::after{
  content:"";position:absolute;right:-1px;top:21px;width:2px;height:15px;
  background:var(--accent);transition:height .34s var(--ease);
}
.lane:hover .lane-no::after{height:calc(100% - 42px)}
.lane-name{padding:19px 15px 21px 17px;border-right:1px solid var(--rule)}
.lane-name .nm{
  display:block;font-family:var(--serif);font-size:14.5px;font-weight:700;
  line-height:1.5;letter-spacing:-.15px;color:var(--ink);
}
.lane-name .ab{display:block;margin-top:6px;font-size:10.5px;line-height:1.65;color:var(--ink-4)}
.lane-body{padding:20px 22px 21px;display:flex;flex-direction:column;gap:12px;min-width:0}
.flow{display:flex;flex-direction:column;gap:12px;min-width:0}
.row{display:flex;flex-wrap:wrap;align-items:stretch;row-gap:12px;min-width:0}
.cont-mark{
  flex:0 0 24px;align-self:center;font-family:var(--mono);font-size:12px;
  line-height:1;color:var(--rule-3);text-align:left;user-select:none;
}
.row-label{
  flex:0 0 auto;align-self:center;font-family:var(--mono);font-size:8.5px;font-weight:600;
  letter-spacing:.16em;text-transform:uppercase;color:var(--ink-4);
  padding-right:12px;margin-right:2px;border-right:1px solid var(--rule);
}
.row-label.split{
  border-right:none;border-left:1px solid var(--rule);
  padding-right:0;padding-left:12px;margin-left:0;margin-right:2px;
}
.node{
  --ac:var(--c-proc);position:relative;flex:0 1 auto;max-width:360px;
  background:var(--paper-hi);border:1px solid var(--rule-2);padding:9px 12px 9px 14px;
  transition:border-color .18s var(--ease),background .18s var(--ease),box-shadow .18s var(--ease);
}
.node::before{
  content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--ac);
  transform:scaleY(.4);transform-origin:top;transition:transform .28s var(--ease);
}
.node:hover::before{transform:scaleY(1)}
.node:hover{border-color:var(--ac);background:#fefcf7;box-shadow:0 0 0 3px rgba(25,24,19,.032)}
.node .t{
  display:flex;align-items:baseline;gap:10px;justify-content:space-between;
  font-size:12.5px;font-weight:600;letter-spacing:-.05px;line-height:1.45;
  color:var(--ink);margin-bottom:3px;
}
.node .t small{
  font-family:var(--mono);font-size:8.5px;font-weight:400;letter-spacing:.01em;
  color:var(--ink-4);white-space:nowrap;flex-shrink:0;
}
.node .io{font-size:10.5px;line-height:1.66;color:var(--ink-3)}
.node .io b{
  font-family:var(--mono);font-size:8px;font-weight:600;letter-spacing:.08em;
  color:var(--ink-4);margin-right:5px;vertical-align:.6px;
}
.node .io em{font-style:normal;color:var(--ink-2)}
.node .io code{font-size:9.5px;background:rgba(25,24,19,.05)}
.n-src{--ac:var(--c-src);background:linear-gradient(180deg,rgba(35,93,158,.055),rgba(35,93,158,.012))}
.n-proc{--ac:var(--c-proc);background:linear-gradient(180deg,rgba(156,97,26,.045),rgba(156,97,26,.008))}
.n-ui{--ac:var(--c-ui);background:linear-gradient(180deg,rgba(171,56,44,.05),rgba(171,56,44,.01))}
.n-tool{--ac:var(--c-tool);background:linear-gradient(180deg,rgba(43,103,73,.05),rgba(43,103,73,.01))}
.n-src:hover,.n-proc:hover,.n-ui:hover,.n-tool:hover{background:#fefcf7}
.n-ghost{
  --ac:var(--c-ghost);border-style:dashed;border-color:var(--rule-2);
  background-image:repeating-linear-gradient(45deg,transparent 0 7px,rgba(138,132,119,.08) 7px 8px);
}
.n-ghost:hover{border-color:var(--c-ghost);background-color:#f7f4eb}
.n-ghost .t{color:var(--ink-3)}
.n-ghost .io em{color:var(--c-ui);font-weight:500}
.arw{flex:0 0 30px;align-self:center;position:relative;height:1px;color:var(--rule-3)}
.arw::before{content:"";position:absolute;left:2px;right:8px;top:0;height:1px;background:currentColor}
.arw::after{
  content:"";position:absolute;right:3px;top:0;width:5px;height:5px;
  border-top:1px solid currentColor;border-right:1px solid currentColor;
  transform:translateY(-2.5px) rotate(45deg);
}
.arw.plus::before,.arw.plus::after{display:none}
.arw.plus .pl{
  position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);
  font-family:var(--mono);font-size:11px;line-height:1;color:var(--ink-4);
  background:var(--paper-hi);padding:0 2px;
}
.arw.cut::before{border-top:1px dashed var(--c-ghost);background:none;opacity:.8}
.arw.cut::after{border-color:var(--c-ghost)}
.grp{
  position:relative;display:flex;align-items:stretch;flex:0 1 auto;
  border:1px dashed var(--rule-3);padding:11px 9px 9px;background:rgba(156,97,26,.026);
}
.grp::before{
  content:attr(data-label);position:absolute;top:-7px;left:12px;
  background:var(--paper-hi);padding:0 7px;font-family:var(--mono);
  font-size:8px;letter-spacing:.1em;color:var(--ink-4);text-transform:uppercase;
}
.grp .node{background:rgba(254,252,247,.7)}
.side{
  display:flex;flex-wrap:wrap;align-items:center;gap:6px 7px;
  padding-top:11px;border-top:1px dotted var(--rule-2);
}
.side .cap{
  font-family:var(--mono);font-size:8px;font-weight:600;letter-spacing:.17em;
  text-transform:uppercase;color:var(--ink-4);
  padding-right:10px;margin-right:2px;border-right:1px solid var(--rule);
}
.chip{
  display:inline-flex;align-items:center;gap:5px;border:1px solid var(--rule);
  background:rgba(255,255,255,.45);padding:3px 8px;font-size:10.5px;line-height:1.55;
  color:var(--ink-2);white-space:nowrap;
  transition:border-color .16s var(--ease),background .16s var(--ease);
}
.chip:hover{border-color:var(--rule-3);background:#fefcf7}
.chip code{background:none;padding:0;font-size:9.5px;color:var(--ink-3)}
/* 剪枝：整条或单节点保留在原位，用删除线标出 —— 不能物理删除，否则复核时
   分不清「这条是剪掉的」还是「这条从来就没画」。
   注意：删除线必须写在 .t / .io 这两个文本元素上。写在 .node 上不生效 ——
   .t 是 flex 容器，text-decoration 不会传播进它的子项，实测 ComputedStyle
   仍然是 none，节点只会变灰而看不出「被划掉」。 */
.lane.cut .lane-name .nm,.lane.cut .lane-name .ab{text-decoration:line-through;color:var(--ink-4)}
.lane.cut .node{opacity:.42;filter:grayscale(.6)}
.lane.cut .node::before{background:var(--ink-4)}
.lane.cut .node .t,.lane.cut .node .io,
.lane.cut .node .t small,.lane.cut .node .io b{text-decoration:line-through}
.lane.cut .side,.lane.cut .grp{opacity:.45}
.lane.cut .chip{text-decoration:line-through}
.lane.cut .arw{opacity:.5}
.node.cut{opacity:.42;filter:grayscale(.6)}
.node.cut::before{background:var(--ink-4)}
.node.cut .t,.node.cut .io,.node.cut .t small,.node.cut .io b{text-decoration:line-through}
.notes{margin-top:54px}
.notes-hd{
  display:flex;align-items:baseline;gap:14px;padding-bottom:9px;
  border-bottom:1.5px solid var(--ink);font-family:var(--mono);font-size:9.5px;
  font-weight:600;letter-spacing:.26em;text-transform:uppercase;color:var(--ink-3);
}
.notes-hd .rt{margin-left:auto;letter-spacing:.15em;font-weight:400;color:var(--ink-4)}
.note{display:grid;grid-template-columns:52px minmax(0,1fr);border-bottom:1px solid var(--rule)}
.note-no{
  padding:19px 0 22px;font-family:var(--mono);font-size:11px;
  font-weight:600;letter-spacing:.05em;color:var(--nc,var(--c-proc));
}
.note-body{padding:17px 0 22px}
.note-body h3{
  margin:0 0 8px;font-family:var(--serif);font-size:16px;font-weight:700;
  letter-spacing:-.2px;line-height:1.45;color:var(--ink);
}
.note-body p{margin:0 0 8px;max-width:910px;font-size:13px;line-height:1.85;color:var(--ink-2);text-align:justify}
.note-body p:last-child{margin-bottom:0}
.note.warn{--nc:var(--c-ui)}
.note.proc{--nc:var(--c-proc)}
.note.tool{--nc:var(--c-tool)}
footer{margin-top:54px}
.colophon{
  display:grid;grid-template-columns:repeat(auto-fit,minmax(258px,1fr));
  gap:0 44px;border-top:1.5px solid var(--ink);padding-top:18px;
}
.colophon p{margin:0 0 14px;font-size:11.5px;line-height:1.9;color:var(--ink-3);text-align:justify}
.colophon p b{
  display:block;margin-bottom:4px;font-family:var(--mono);font-size:8.5px;
  font-weight:600;letter-spacing:.17em;text-transform:uppercase;color:var(--ink-2);
}
.endmark{
  margin-top:28px;text-align:right;font-family:var(--mono);font-size:9px;
  letter-spacing:.24em;color:var(--ink-4);text-transform:uppercase;
}
@media (max-width:1180px){
  .wrap{padding:44px 24px 80px}
  .lane{grid-template-columns:56px minmax(0,1fr)}
  .lane-no{grid-row:1 / span 2;padding-top:19px}
  .lane-name{grid-column:2;border-right:none;padding:17px 18px 0}
  .lane-name .ab{display:inline;margin-left:9px}
  .lane-body{grid-column:2;padding:12px 18px 19px}
}
@media (max-width:780px){
  .wrap{padding:30px 15px 66px}
  .node{max-width:none;flex:1 1 100%}
  .arw{flex:0 0 100%;height:14px;transform:rotate(90deg)}
  .grp{flex:1 1 100%;padding:12px 8px}
  .meta div{flex:1 1 46%}
  .note{grid-template-columns:34px minmax(0,1fr)}
  .side .cap{border-right:none;padding-right:0}
  .cont-mark{flex:0 0 100%;text-align:left;transform:rotate(90deg);margin:2px 0 0 2px}
}
@media (prefers-reduced-motion:reduce){
  *,*::before,*::after{animation:none !important;transition:none !important}
  .lane{opacity:1;transform:none}
}
@media print{
  body{background:#fff}
  body::before,#prog{display:none}
  .wrap{max-width:none;padding:0}
  .lane{break-inside:avoid;opacity:1;transform:none;animation:none}
  .node:hover{box-shadow:none;background:inherit}
  .stage{background-image:none}
  .band-div{break-after:avoid}
}
"""

SCRIPT = """
(function(){
  var bar = document.getElementById('prog');
  if (!bar) return;
  var raf = 0;
  function paint(){
    raf = 0;
    var doc = document.documentElement;
    var max = doc.scrollHeight - doc.clientHeight;
    bar.style.width = (max > 0 ? (doc.scrollTop / max) * 100 : 0) + '%';
  }
  function onScroll(){ if (!raf) raf = requestAnimationFrame(paint); }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  paint();
})();
"""


def render_html(spec: dict) -> str:
    bands = spec.get("bands") or []
    band_starts = {}
    # band 用在它前面：spec 里按顺序给 bands，每条泳道可带 "band": 索引
    lanes = spec.get("lanes") or []
    parts = []
    for lane in lanes:
        bi = lane.get("_band")
        if bi is not None and bi not in band_starts:
            band_starts[bi] = True
            parts.append(render_band(bands[bi]))
        parts.append(render_lane(lane))
    # 没被任何泳道引用的 band 放在末尾之前不显示（视为作者笔误，由 --check 报）
    stage_inner = "\n\n".join(parts)

    subtitle = spec.get("subtitle")
    h1 = md(spec.get("title", ""))
    if subtitle:
        h1 += f'<span class="thin">{md(subtitle)}</span>'

    return f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{html.escape(spec.get('title', '泳道图'))}</title>
<style>{CSS}</style>
</head>
<body>
<div id="prog"></div>
<div class="wrap">

<header>
<div class="fig-head">
<span class="no">{md(spec.get('eyebrow', ''))}</span>
<span>{md(spec.get('fig_head', ''))}</span>
<span class="rt">{md(spec.get('rev', ''))}</span>
</div>
<h1>{h1}</h1>
{f'<p class="lede">{md(spec["lede"])}</p>' if spec.get('lede') else ''}
{render_meta(spec.get('meta'))}
</header>

{render_legend(spec.get('legend') or [])}

<div class="stage">
<span class="reg tl"></span><span class="reg tr"></span><span class="reg bl"></span><span class="reg br"></span>

{stage_inner}

</div>

{render_notes(spec.get('notes'))}

{render_footer(spec.get('footer'))}

</div>
<script>{SCRIPT}</script>
</body>
</html>
"""


# ────────────────────────────── 校验与报告 ──────────────────────────────

TERMINAL_KINDS = {"ui", "tool"}


def walk_items(items):
    for it in items:
        yield it
        if "items" in it:
            yield from walk_items(it["items"])


def lane_terminals(lane: dict) -> list:
    terminal = []
    for row in lane.get("rows", []):
        for it in walk_items(row.get("items", [])):
            if "arrow" in it or "rowlabel" in it or "cont" in it or "chip" in it or "cap" in it:
                continue
            kind = it.get("kind") or default_kind(lane)
            if kind in TERMINAL_KINDS:
                terminal.append(it.get("t", "?"))
    return terminal


def analyze(spec: dict) -> tuple:
    """返回 (rows, errors, warnings)。rows 供 --report 打印。"""
    lanes = spec.get("lanes") or []
    errors, warnings = [], []
    seen = {}
    order = []
    for idx, lane in enumerate(lanes):
        lid = lane.get("id")
        if not lid:
            errors.append(f"第 {idx+1} 条泳道缺少 id")
            continue
        if lid in seen:
            errors.append(f"泳道 id 重复：{lid}")
        seen[lid] = lane
        order.append(lid)

    feeders = {}  # target -> [source]
    for lane in lanes:
        lid = lane.get("id")
        for target in lane.get("feeds", []) or []:
            if target not in seen:
                errors.append(f"{lid}: feeds 指向不存在的泳道 {target}")
                continue
            feeders.setdefault(target, []).append(lid)

    rows = []
    for lane in lanes:
        lid = lane.get("id")
        cut = bool(lane.get("cut"))
        preds = feeders.get(lid, [])
        succs = lane.get("feeds", []) or []
        terminals = lane_terminals(lane)
        # 只在「既没有终端、也没有后继」时告警：这说明这条流画到一半断了，
        # 第 9 步不会有任何东西可裁决。有后继的泳道不告警 —— 它的终端在后继那条里。
        if not cut and not terminals and not succs:
            warnings.append(
                f"{lid} 既无 ui/tool 终端也无后继 —— 这条流是断的；"
                f"要么补终端，要么标成 cut"
            )
        if cut:
            live_succ = [s for s in succs if s in seen and not seen[s].get("cut")]
            if live_succ:
                errors.append(
                    f"{lid} 已剪，但仍向未剪的 {', '.join(live_succ)} 供数 —— "
                    f"要么一起剪，要么改成从别的来源取数"
                )
        else:
            cut_preds = [p for p in preds if seen.get(p, {}).get("cut")]
            if cut_preds:
                errors.append(
                    f"{lid} 未剪，但它的前驱 {', '.join(cut_preds)} 已剪 —— 起点悬空"
                )
        rows.append(
            {
                "id": lid,
                "name": lane.get("name", ""),
                "cut": cut,
                "preds": preds,
                "succs": succs,
                "terminals": terminals,
            }
        )

    # band 未被引用
    for i, band in enumerate(spec.get("bands") or []):
        if not any(l.get("_band") == i for l in lanes):
            warnings.append(f"band 第 {i+1} 项「{band.get('title','')}」没有泳道引用")
    return rows, errors, warnings


def do_report(spec: dict) -> tuple:
    rows, errors, warnings = analyze(spec)
    out = []
    for r in rows:
        state = "CUT " if r["cut"] else "live"
        out.append(f"{r['id']:<5} {state} {r['name']}")
        out.append(f"      前驱：{'、'.join(r['preds']) if r['preds'] else '—（起点）'}")
        out.append(f"      后继：{'、'.join(r['succs']) if r['succs'] else '—（终点）'}")
        out.append(
            f"      终端：{'、'.join(r['terminals']) if r['terminals'] else '—（无 ui/tool 终端）'}"
        )
    if warnings:
        out.append("")
        out.append("警告：")
        out.extend(f"  · {w}" for w in warnings)
    if errors:
        out.append("")
        out.append("错误：")
        out.extend(f"  ! {e}" for e in errors)
    return "\n".join(out), errors


# ────────────────────────────── 入口 ──────────────────────────────


def load_spec(path: Path) -> dict:
    spec = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(spec, dict):
        raise SystemExit("spec 顶层必须是对象")
    lanes = spec.get("lanes") or []
    bands = spec.get("bands") or []
    cursor = 0
    for lane in lanes:
        band = lane.get("band")
        if band is None:
            if bands:
                cursor = min(cursor, len(bands) - 1)
                lane["_band"] = cursor
        else:
            if not isinstance(band, int) or not (0 <= band < len(bands)):
                raise SystemExit(f"{lane.get('id')}: band 索引越界（共 {len(bands)} 个）")
            lane["_band"] = band
            cursor = band
    return spec


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(
        description="把泳道图 JSON 规格渲染成 HTML；同时提供剪枝报告与校验。",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__.split("规格格式")[0].strip(),
    )
    ap.add_argument("spec", type=Path, help="JSON 规格文件")
    ap.add_argument("--out", type=Path, help="输出的 HTML 路径")
    ap.add_argument("--prune", default="", help="临时剪掉的泳道 id，逗号分隔，如 L4,L6")
    ap.add_argument("--restore", default="", help="临时恢复的泳道 id（覆盖 spec 里的 cut:true）")
    ap.add_argument("--report", action="store_true", help="只打印结构报告，不写 HTML")
    ap.add_argument("--check", action="store_true", help="校验；有错误时退出码 1")
    args = ap.parse_args(argv)

    if not args.spec.exists():
        raise SystemExit(f"找不到规格文件：{args.spec}")
    spec = load_spec(args.spec)

    ids = {l.get("id") for l in spec.get("lanes", [])}
    for label, raw, flag in (
        ("--prune", args.prune, True),
        ("--restore", args.restore, False),
    ):
        names = [s.strip() for s in raw.split(",") if s.strip()]
        for name in names:
            if name not in ids:
                raise SystemExit(f"{label} 指定的泳道 {name} 不在 spec 里")
        for name in names:
            for lane in spec["lanes"]:
                if lane.get("id") == name:
                    lane["cut"] = flag

    if args.report or args.check:
        text, errors = do_report(spec)
        print(text)
        if args.check and errors:
            return 1
        if args.check:
            print("\n校验通过。")
        if not args.out:
            return 0

    if args.out:
        html_text = render_html(spec)
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(html_text, encoding="utf-8")
        print(f"已生成 {args.out}（{len(html_text):,} 字符）")
    elif not (args.report or args.check):
        print(render_html(spec))
    return 0


if __name__ == "__main__":
    sys.exit(main())
