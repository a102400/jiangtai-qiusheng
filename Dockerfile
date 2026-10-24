FROM node:22-alpine

# 若需要本地语音转写，取消下面两行注释（会让镜像变大，但断网也能转写）
# RUN apk add --no-cache ffmpeg python3 py3-pip
# RUN pip3 install --no-cache-dir faster-whisper

WORKDIR /app

COPY app/package.json ./
# 本项目零运行时依赖，install 会瞬间完成；保留这一步只是为了兼容 Node 版本校验
RUN npm install --omit=dev || true

COPY app/ ./

ENV PORT=3000
EXPOSE 3000

# 上传目录
RUN mkdir -p uploads

CMD ["node", "server.js"]
