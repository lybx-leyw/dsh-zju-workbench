# 本地读取

同步自 `D:\Code\Projects\dingtalk-skill` 的 2026-10-16 工作区。保留其只读查询行为，Python 数据库、消息和内容解析已改写为 Node。全局数据库密钥按已知 x64 CPU vendor 格式生成候选并以数据库页头校验，不需要本机编译器或 PowerShell 7。

默认数据根目录 `%APPDATA%/DingTalk`。桌面壳用 Windows 应用数据目录补齐缺失的 APPDATA；独立命令缺少 APPDATA 时使用当前用户的 `AppData/Roaming`，不会相对工作目录查找。

macOS（2026-11-02 照 dingtalk-skill 的 `codex/macos-support` 分支加上，spdc-elm 的 0553971，在 Apple 芯片、钉钉 9.0.2 上实测过；那个分支的 PR 还没合进 dingtalk-skill 的 main）：依次看 `~/Library/Application Support/DingTalkMac` 和两个 App Store 沙盒（`~/Library/Containers/5ZSL2CJU2T.com.dingtalk.mac/…`、`com.alibaba.DingTalkMac/…` 下的 `Data/Library/Application Support/DingTalkMac`），只认里面有钉钉数据的，几个都有时报 `data_dir_ambiguous` 并列出候选。Mac 钉钉的全局库密钥不取 CPU，是固定的 CPUID 字符串 `7197016915918185882701231384169` 的前 16 个 ASCII 字节，同样先用全局库页头校验，校验不过报 `database_key_unavailable`。账号库的密钥派生、目录结构和 Windows 一样。我们没有 Mac，这一段只用合成数据测过；Intel Mac 和 9.0.2 以外的版本原分支也没有实测。数据不在默认位置时用 `--data-dir` 或 `DINGTALK_DATA_DIR` 指定 DingTalk 数据根目录（插件把配置里的「聊天数据位置」经这个变量传进来）；指到某个 `_v2`/`_v3` 账号文件夹或它的 `DBFiles` 时退回根目录，指到 DingTalk 的上一层时进到 DingTalk。v2 账号从目录名取得数字 UID，以 `MD5(uid)` 的十六进制前 16 个字符派生密钥；v3 账号从全局库选取 UID（不读取令牌字段），再结合 `user_config` 的 salt 派生密钥。两种格式都逐个验证数据库页头，多账号必须明确选择。

同一个 UID 的 `_v2` 和 `_v3` 目录都校验通过时只列 v3。v3 是较新的格式，钉钉升级后新消息写进 v3，旧的 `_v2` 目录可能还留在磁盘上；两个都列出来，账号选择框里会出现两项一模一样的 UID，按 UID 选账号也选不出唯一一个。只留 v3 还和加入 v2 支持之前的行为一致，已有的监控不受影响。只有 v2 目录的账号照常列出。

v3 的全局库每次查找最多解密一次。没有 `globalStorage` 时报 `database_missing`；全局库密钥校验不过或读取失败时，报它自己的原因。全局库出错只影响 v3 账号：同一个目录里能校验的 v2 账号照常列出，一个账号都找不到时才把全局库的错误报出来。

AES-128-ECB 解密后在内存中检查页结构，校验 WAL header 和 frame checksum，只应用已提交帧。重复读取文件以检测并发写入；不一致或格式不兼容时明确失败，不改源库、不写明文副本。

消息 ID 为 `会话ID/服务端ID`；没有服务端 ID 时使用本地标识。保留大于 JavaScript 安全整数范围的 ID。历史分表与最后消息缓存先按最新版本去重，再执行内容筛选，避免旧缓存重新暴露已撤回消息。

消息含 `chatId/chatName/sender/sentAt/text/type/contentStatus`。`contentStatus` 可为 parsed、summary_only、metadata_only、recalled、shielded、encrypted、empty_or_unsupported。普通查询无网络访问。AI 整理由应用的监控服务在用户选中该模式后调用当前模型。
