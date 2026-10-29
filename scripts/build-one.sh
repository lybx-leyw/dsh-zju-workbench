#!/usr/bin/env bash
# 用 esbuild 的 CLI 直接重建一个客户端包。
#
# 为什么不用 `npm run build`：Node 里的 esbuild 走 spawn 起子进程，在本机被拦成
# EPERM；而同一个 esbuild.exe 从 shell 直接执行是正常的。参数与 scripts/build.mjs
# 的 buildClientPackage 逐项对齐（entry/outfile/format/target/jsx/external/loader/
# define/banner/footer），改那边时这里要跟着改。
set -euo pipefail

NAME="${1:?用法: build-one.sh <包名>}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ESBUILD="$ROOT/node_modules/@esbuild/win32-x64/esbuild.exe"
PKG="$ROOT/packages/$NAME"

[ -x "$ESBUILD" ] || { echo "找不到 esbuild：$ESBUILD" >&2; exit 1; }
[ -f "$PKG/src/client.jsx" ] || { echo "$NAME 没有 src/client.jsx，不是客户端包" >&2; exit 1; }

# external = HOST_SEEDS + package.json 的 dsh.client.external（与 build.mjs 同一来源）
#
# ⚠️ esbuild 的 CLI 只认「一个 --external 一个模块」，不认逗号分隔
#    （`--external:a,b` 会被当成一个字面量模块名，于是 ui-primitives 这种
#     HOST_SEEDS 里的包反而被当普通依赖打进去，接着报一堆第三方包解析不到）。
#    所以这里生成成一个参数数组，而不是拼成字符串。
EXTERNAL_ARGS=$(node -e '
const fs = require("fs"), path = require("path");
const root = process.argv[1], name = process.argv[2];
const manifest = JSON.parse(fs.readFileSync(path.join(root, "packages", name, "package.json"), "utf8"));
const seeds = ["react","react/jsx-runtime","react-dom","react-dom/client","@deepseek-ai/cordis",
  "@deepseek-ai/dsh-client-store","@deepseek-ai/dsh-client-ui-slots",
  "@deepseek-ai/dsh-client-ui-primitives","@deepseek-ai/dsh-client-ui-dockkit"];
const declared = manifest.dsh?.client?.external ?? [];
console.log([...seeds, ...declared].map((m) => `--external:${m}`).join(" "));
' "$ROOT" "$NAME")

PROFILE=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).profile)' "$ROOT/runtime.lock.json")

"$ESBUILD" "$PKG/src/client.jsx" \
  --outfile="$PKG/lib/client.js" \
  --bundle --format=cjs --platform=browser --target=es2022 --jsx=automatic \
  $EXTERNAL_ARGS \
  --loader:.css=text --loader:.svg=text --loader:.md=text \
  --define:process.env.NODE_ENV='"production"' \
  --define:__ZHIYUN_PROFILE__="\"$PROFILE\"" \
  --banner:js="window.__ModuleLoader__.load({id:\"$NAME\",factory:(require)=>{var module={exports:{}};var exports=module.exports;" \
  --footer:js='return module.exports;}});' \
  --log-level=warning

echo "Built $NAME"
