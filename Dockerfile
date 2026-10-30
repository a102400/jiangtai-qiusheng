FROM node:22-alpine

# 若需要本地语音转写，取消下面两行注释（会让镜像变大，但断网也能转写）
# RUN apk add --no-cache ffmpeg python3 py3-pip
# RUN pip3 install --no-cache-dir faster-whisper

WORKDIR /app

COPY app/package.json ./
# 本项目零运行时依赖，install 会瞬间完成；保留这一步只是为了兼容 Node 版本校验
RUN npm install --omit=dev || true

COPY app/ ./

# ---- 密钥防线（双层）----
# 第 1 层是 app/.dockerignore（COPY 阶段就不复制 .env）
# 第 2 层是下面这行：即使 .dockerignore 被人误删/被绕过，这里也会清掉；
# 若清理后仍存在 .env，构建立即失败（宁可部署失败，也不让密钥进镜像层）。
RUN rm -f .env .env.local .env.* 2>/dev/null; \
    if [ -f .env ] || [ -f .env.local ]; then \
      echo "FATAL: .env 仍存在于镜像中，构建中止（密钥不得进入镜像）" >&2; exit 1; \
    fi

ENV PORT=3000
EXPOSE 3000

# 上传目录
RUN mkdir -p uploads

CMD ["node", "server.js"]
