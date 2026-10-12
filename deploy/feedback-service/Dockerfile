# 反馈收集服务的镜像。
#
# 魔搭 Studio 的 docker 类型要求**必须监听 0.0.0.0:7860**（8080 被平台占用）。
# 服务本身只用 Python 标准库，因此基础镜像可以有 sdk 也可以没有 —— 选官方
# python slim，装的东西越少启动越快、越不容易在平台上卡住。
#
# 持久化：/mnt/workspace 是魔搭声明的持久化目录（重启仍可能丢，已确认接受）。
FROM python:3.12-slim

WORKDIR /app

# 没有第三方依赖：server.py 只用标准库（http.server / json / os / re）。
COPY server.py /app/server.py

ENV FEEDBACK_PORT=7860
EXPOSE 7860

CMD ["python", "/app/server.py"]
