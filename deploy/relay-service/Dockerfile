# 中转站镜像。
#
# 魔搭 docker 创空间的硬要求（官方文档 docker.md）：监听 0.0.0.0:7860，端口不可改，
# 且 8080 已被平台进程占用 —— 所以这里不写 8080，也不从 7860 改成别的。
#
# 服务只用 Python 标准库（http.server / json / hmac），不装任何依赖：
# 镜像越小启动越快，平台对长阻塞启动也越宽容。
#
# 持久化：/mnt/workspace 是平台声明的持久化卷（重启仍在，但转移/重命名创空间会丢）。
# 数据本来就归用户自己抓，丢了重推一次即可 —— 这正是选它的原因。
FROM python:3.12-slim

WORKDIR /app
COPY server.py /app/server.py

ENV RELAY_PORT=7860
EXPOSE 7860

# 只跑一个进程：ThreadingHTTPServer 自己开线程处理并发，
# 而起多个 worker 会各自 hold 不同的进程内状态，对这个 append-only 服务没有收益。
CMD ["python", "-u", "/app/server.py"]
