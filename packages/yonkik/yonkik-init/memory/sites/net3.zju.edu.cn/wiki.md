# 上网认证 net3.zju.edu.cn

## 处置（2026-11-22）

| 项 | 结果 |
|---|---|
| 本地解析 | **getaddrinfo ENOTFOUND** |
| 公网 DoH | **NXDOMAIN** |
| 判读 | **不能据此判定下线**——浙大域名存在 split-horizon |

## split-horizon 的证据

`speedtest.zju.edu.cn` 与 `s.zju.edu.cn` 在公网 DoH 中**同样是 NXDOMAIN**，但本地实测 HTTP 200 可访问。
说明「公网查不到」≠「不存在」——校内视图与公网视图本就不同。

详见 `sites/_dns-split-horizon.md`。
