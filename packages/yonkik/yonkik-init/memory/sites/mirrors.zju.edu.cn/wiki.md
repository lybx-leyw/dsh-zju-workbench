# mirrors.zju.edu.cn · ZJU Mirror（浙大开源镜像站）

> 免登录只读。nginx/1.31.7，IP `10.202.236.97`（**校内网段，必须绕过 env 代理**）。
> 探索日期 2026-11-20。以下全部为实测，标注了证据。

## 本页索引

- [一句话结论](#一句话结论)
- [入口与可达性](#入口与可达性)
- [接口（全部已单发验证）](#接口全部已单发验证)
- [镜像源清单](#镜像源清单)
- [已移除/变更的源（官方公告原文）](#已移除变更的源官方公告原文)
- [可用性实测](#可用性实测)
- [可复用镜像 URL 模板](#可复用镜像-url-模板)
- [同步时效](#同步时效)
- [坑](#坑)

## 一句话结论

**值得当工具用，而且是本组五站里最实用的一个。** 193 个源、654TB 盘位、校内 10Gbps 链路；
apt/pypi/conda/docker 四类都实测可拉。短板是**时效**而非覆盖面：单个源同步间隔可达数天，
小众源（如 IUS）历史上被整源移除过。

## 入口与可达性

| 项 | 值 | 证据 |
|---|---|---|
| 首页 | `https://mirrors.zju.edu.cn/` → 200，77062B | 实测 |
| 标题 | `ZJU Mirror` / 「浙江大学开源软件镜像站」 | 实测 |
| nginx | `nginx/1.31.7` | 响应头 |
| TLS | TLSv1.3，Let's Encrypt，`cn=mirrors.zju.edu.cn` | 实测 |
| robots.txt | **404**（25567B 的 404 页，不是空） | 实测 |
| 内网判定 | `GET /api/is_campus_network` → `1` | 实测，1=校内 |
| 站点自述 | 「公网上行 v4/v6 各 100Mbps；校内链路 10Gbps」，盘位 `654TB` | `/mirrorz.json` 的 `site` 字段 |

站点是 **Astro 静态站 + React 客户端渲染**：首页 HTML 里 `所有镜像` 区块只有「正在载入镜像状态…」，
真数据由 `/_astro/MirrorExplorer.*.js` 前端 `fetch('/mirrorz.json')` 拉取。
**不要指望从首页 HTML 抓源清单——直接打 `/mirrorz.json`。**

## 接口（全部已单发验证）

| method | path | 用途 | 鉴权 | 关键响应结构 |
|---|---|---|---|---|
| GET | `/mirrorz.json` | **镜像清单真源**（MirrorZ 规范 v1.7） | 无 | `{version:"1.7", site:{url,abbr,name,disk,note,issue,email,group}, info:[], mirrors:[193]{cname,url,status,desc,upstream,size}}` |
| GET | `/<任意目录>/.mirror-index/` | 任意目录的 JSON 目录列表 | 无 | `[{name,type,mtime}]`；`/news/.mirror-index/` 实测返回 4 条公告目录 |
| GET | `/api/is_campus_network` | 判断当前请求是否来自校园网 | 无 | `1` = 校内 / `0` = 校外 / `2` = ?（前端 `network.js` 里 `n(e){return e===1||e===2}` 视为校内） |
| GET | `/news/` | 公告列表页（HTML 目录列表） | 无 | 服务端渲染的「Index of /」页 |
| GET | `/news/<slug>/` | 单篇公告正文 | 无 | HTML；正文可读（见下节原文摘录） |
| GET | `/docs/<distro>/` | 各发行版配置文档（含命令模板） | 无 | HTML；如 `/docs/pypi/` 给出 pip/PDM/Poetry/uv/Homebrew 全套模板 |

**`status` 字段编码（从 `/_astro/MirrorExplorer.*.js` 解出）**：
格式是拼接串，首字母是主状态；`S`=同步完成，`D`=进入等待队列，`Y`=同步中（截至快照），
`F`=最近失败尝试，`P`=暂停同步。串里的前缀字母 `S/D/Y/F/P` 后跟 epoch 秒，
`X<ts>`=计划同步，`N<ts>`=下次同步，`O<ts>`=上次同步成功。

## 镜像源清单

`/mirrorz.json` 实测 **193 个源**（2026-11-20）。按主状态码统计：

| 主状态 | 数量 | 含义 |
|---|---|---|
| `S` | 172 | 同步完成 |
| `Y` | 17 | 同步中（快照时刻） |
| `F` | 4 | **最近一次同步失败**：`alpine`(5.44T)、`flightgear`(322.5G)、`openwrt`(1.78T)、`rocky`(4.72T) |

高频实用源（全在列，含容量）：

| cname | 容量 | upstream |
|---|---|---|
| `ubuntu` | 5.33T | rsync://rsync.archive.ubuntu.com/ubuntu/ |
| `debian` | 1.97T | rsync://mirror.xtom.com.hk/debian/ |
| `pypi` | 50.79T | https://pypi.org |
| `anaconda` | 28.26T | https://repo.anaconda.com |
| `docker-ce` | 1.45T | rsync://mirrors.tuna.tsinghua.edu.cn/docker-ce/ |
| `archlinux` | 123.27G | rsync://taipei.mirror.pkgbuild.com/packages/ |
| `fedora` | 4.48T | rsync://dl.fedoraproject.org/fedora-enchilada/ |
| `epel` | 949.25G | rsync://dl.fedoraproject.org/fedora-epel/ |
| `almalinux` | 2.12T | rsync://rsync.repo.almalinux.org/almalinux/ |
| `centos` | **4.00M**（已被清空到只剩 4M） | rsync://mirrors.tuna.tsinghua.edu.cn/centos/ |
| `ius` | **1.00M**（已被清空） | rsync://origin.repo.ius.io/ius/ |

其余大牌齐全：`alpine` `archlinuxcn` `armbian` `bioconductor` `cachyos` `ceph` `cran` `crates.io`
`crates.io-index` `ctan` `cygwin` `deepin` `devuan` `eclipse` `elasticstack` `elrepo` `endeavouros`
`erlang-solutions` `fdroid` `freebsd` `gentoo` `github-release` `gitlab-ce` `gnu` `homebrew` `homebrew-bottles`
`julia-releases` `kali` `kernel` `kubernetes` `libreoffice` `linuxmint` `llvm-apt` `lxc-images` `macports`
`manjaro` `mongodb` `mozilla` `msys2` `mysql` `netbsd` `neurodebian` `nginx` `nix` `nix-channels`
`nodejs-release` `nvidia` `openbsd` `openeuler` `openkylin` `opensuse` `openwrt` `postgresql` `proxmox`
`qt` `raspbian` `rmi` `ros` `ros2` `rosdistro` `rustup` `sagemath` `slackware` `tailscale` `termux` `tex`
`virtualbox` `voidlinux` `vyos` `winehq` `wireshark` `xanmod` `zerotier` …（完整 193 条见 `/mirrorz.json`）

**`centos-vault` 也在列**（公告里让校外用户迁到这个）。

## 已移除/变更的源（官方公告原文）

`/news/` 下只有 4 篇公告（`/news/.mirror-index/` 实测确认），其中两篇是移除通知。

### 1. 关于分阶段移除 CentOS 镜像的通知 — 2024-06-24（公告署名作者）

原文（节选，逐字）：

> 由于 CentOS 7 在 6 月 30 日结束生命周期，CentOS 传统版本将全部结束支持，上游即将清空镜像仓库中的内容。
> 为避免 CentOS 镜像终止服务产生不便，我们决定分阶段移除该镜像。
> **2024-06-24：停止该软件源与上游的同步**
> **2024-06-30：停止该软件源的校外访问**
> **2026-06-30：移除文件，终止该软件源的校内服务**
>
> 校内用户：请注意 ELRepo 与 EPEL 也即将停止对 CentOS 7 的支持，且 CentOS 7 不再会提供安全更新，
> 您需要尽快迁移至其他发行版。当前我们没有提供 ELRepo Archive 与 EPEL Archive 镜像。
> 校外用户：2024-06-30 后，我们不再提供 CentOS 镜像源，请迁移到其他镜像站的 centos-vault 镜像。

出处：`https://mirrors.zju.edu.cn/news/240624_removal_of_centos_legacy/`

**实测印证**：`GET /centos/7/os/x86_64/repodata/repomd.xml` → **404**。
`/mirrorz.json` 里 `centos` 容量只剩 **4.00M**（等于被清空）。

### 2. 关于移除 IUS 镜像的通知 — 2024-06-05（公告署名作者）

原文（节选，逐字）：

> 由于 CentOS 7 即将 EOL，且 IUS 上游已长时间未维护其软件源，我们计划移除该镜像。
> **2024-06-05：停止该软件源与上游的同步**
> **2024-06-30：隐藏该软件源的前端显示与配置描述**
> **2024-10-01：从服务器移除该软件源的相关文件**

出处：`https://mirrors.zju.edu.cn/news/240605_removal_of_ius/`

**实测印证**：`GET /ius/7/x86_64/repodata/repomd.xml` → **404**。`/mirrorz.json` 里 `ius` 只剩 1.00M。

### 另外两篇（非移除）

- `关于镜像站维护通知` — 2024-04-10 → `/news/240410_maintenance/`
- `欢迎使用全新的浙江大学开源软件镜像站` — 2022-11-15 → `/news/221115_hello_mirror/`

## 可用性实测

全部为**单发 GET**，只看是否真能取到内容（不下载大文件）：

| 目标 | 结果 |
|---|---|
| `ubuntu/dists/noble/Release` | **200，254968B**，`Origin: Ubuntu / Label: Ubuntu / Suite: noble / Version: 24.04 / Codename: noble / Date: 2024-04-25`，含 7 架构（amd64 arm64 armhf i386 ppc64el riscv64 s390x）与 main/restricted/universe/multiverse 全组件 |
| `debian/dists/stable/Release` | **200，138612B**，`Last-Modified: Sat, 12 Sep 2026` |
| `pypi/web/simple/requests/` | **200，60166B**，`<title>Links for requests</title>`（真·PEP 503 simple index） |
| `anaconda/pkgs/main/noarch/repodata.json` | **200，7037813B**，合法 repodata，`Last-Modified: Fri, 20 Nov 2026 00:33:26`（**当天**） |
| `docker-ce/linux/ubuntu/gpg` | **200，3817B**，`Last-Modified: Thu, 19 Nov 2026` |
| `centos/7/os/x86_64/repodata/repomd.xml` | **404**（已移除，符合公告） |
| `ius/7/x86_64/repodata/repomd.xml` | **404**（已移除，符合公告） |

## 可复用镜像 URL 模板

### apt（Ubuntu 24.04 noble）

```
deb https://mirrors.zju.edu.cn/ubuntu/ noble main restricted universe multiverse
deb https://mirrors.zju.edu.cn/ubuntu/ noble-updates main restricted universe multiverse
deb https://mirrors.zju.edu.cn/ubuntu/ noble-backports main restricted universe multiverse
deb https://mirrors.zju.edu.cn/ubuntu/ noble-security main restricted universe multiverse
```

Debian 把 `ubuntu` 换成 `debian`、把 suite 换成 `stable`/`bookworm` 即可。

### pip（站点 `/docs/pypi/` 官方模板）

```bash
# 临时
pip install -i https://mirrors.zju.edu.cn/pypi/web/simple some-package
# 设为默认（注意 simple 不能少，必须 https）
pip config set global.index-url https://mirrors.zju.edu.cn/pypi/web/simple
# 追加备用源
pip config set global.extra-index-url "<url1> <url2>..."
# PDM
pdm config pypi.url https://mirrors.zju.edu.cn/pypi/web/simple
# uv（~/.config/uv/uv.toml 或 %AppData%\uv\uv.toml）
[[index]]
url = "https://mirrors.zju.edu.cn/pypi/web/simple"
default = true
# Homebrew
export HOMEBREW_PIP_INDEX_URL="https://mirrors.zju.edu.cn/pypi/web/simple"
```

站点原文提示：「PyPI 镜像在每次同步成功后**间隔 5 分钟**同步一次」——这是 pypi 的额外节流，不是失败。

### conda / anaconda

```
https://mirrors.zju.edu.cn/anaconda/pkgs/main/
https://mirrors.zju.edu.cn/anaconda/pkgs/free/
https://mirrors.zju.edu.cn/anaconda/pkgs/r/
https://mirrors.zju.edu.cn/anaconda/cloud/conda-forge/
```

### docker registry

```
https://mirrors.zju.edu.cn/docker-ce/linux/ubuntu/     # docker-ce apt 源
https://mirrors.zju.edu.cn/docker-ce/linux/debian/     # docker-ce debian 源
```

站点另有 `/container-images/`（容器 Registry 代理缓存）说明页，本次未深探其 registry 端点，记为候选。

## 同步时效

- `anaconda`：`Last-Modified` 是**当天**（2026-11-20 00:33），基本实时。
- `docker-ce` gpg：前一天（2026-11-19），正常。
- `debian/dists/stable/Release`：2026-09-12 —— **但这是上游 Release 本身的日期，不代表镜像滞后**，作时效证据不可靠。
- `pypi`：官方文档说每 5 分钟同步一次，属最勤的一类。
- 结论：**主流源时效可用；判滞后要看 `/mirrorz.json` 的 `status` 时间戳，不要看文件 mtime。**

## 坑

1. **首页 HTML 抓不到源清单。** `所有镜像` 区块是 JS 客户端渲染，HTML 里只有「正在载入镜像状态…」。
   要清单就打 `GET /mirrorz.json`（57KB，193 条）。
2. **`robots.txt` 返回 404，且 404 页本身有 25KB 的样式**——别把 404 页当内容解析。
3. **`/news/` 是「Index of /」型目录列表**，不能按新版文章页解析；真文章在 `/news/<slug>/`。
4. **`centos` 和 `ius` 目录还在但已空**（4.00M / 1.00M）。看目录存在就以为可用会踩坑，
   必须实际拉 `repodata/repomd.xml` 才算验证。
5. **`alpine`/`openwrt`/`rocky`/`flightgear` 主状态是 `F`（最近一次同步失败）**，用前先查 `/mirrorz.json` 状态。
6. **站点声明「根据相关法律法规，本站不对欧盟用户提供服务」**——境外/代理出口访问可能被拒。
   本机 env 设了 `HTTP_PROXY=<本地代理地址>`，其出口在墙外；实测必须绕过代理直连（`node:https` 不读 env 代理）。
7. **校内/校外行为不同**（CentOS 就是「先停校外、后停校内」）。判断当前身份用 `GET /api/is_campus_network`，
   本次实测 `1`（校内），因此所有结论都基于校内视角。

## 本次探了什么 / 还剩什么候选

**已探**：`/mirrorz.json`、`/.mirror-index/`、`/api/is_campus_network`、`/news/` 全部 4 篇、
`/docs/pypi/`、以及 ubuntu/debian/pypi/anaconda/docker-ce/centos/ius 共 7 条内容的可用性单发。

**候选（未探）**：`/container-images/` 的 registry 端点、`/statistics/` 的流量数据接口、
`/history/`、`/faq/`、`/about/` 的运维联系方式细目、`/en/` 英文版差异。
