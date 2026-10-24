# 讲台求生 · 全栈版（Node 后端 + 真实大模型接口）

这是**真正前后端分离、真实调用大模型 API** 的版本。
不是静态 Mock —— 前端通过 `fetch` 调同源 `/api/*`，后端用 Node 原生 HTTP 服务处理，并真正向大模型发起请求。

> 同级目录下的 `../index.html` 是纯静态官网 / Plan B 演示版；
> 当前 `app/` 才是可交互、可接真实模型的**全栈应用**。

---

## 一、它做到了什么

| 模块 | 能力 | 是否真的调用 AI |
|------|------|----------------|
| AI 导师复盘 | 输入讲稿 → 输出结构化报告（语速、等待、口头禅、提问、环节覆盖、评分、行动建议） | 配了 Key 走大模型；没配则走本地规则引擎**真实计算** |
| 改进建议生成 | 输出改进版逐字稿（真删口头禅、伪提问改留白提问、补齐缺失环节）+ 板书建议 + 分层作业 | 同上，两层都会真实改写文本 |
| AI 学生拆台 | 调皮 / 学霸 / 走神三种人格，多轮上下文追问，不重复提问 | 同上，多轮对话带完整 history |

**双重模式自动切换**（这是刻意设计的可靠性保证）：
- `.env` 里配了 `AI_API_KEY` → 走真实大模型（页面顶部显示「● 真实大模型已接入」）
- 没配 Key、或调用超时 / 报错 → **自动降级**到本地规则引擎（顶部显示「○ 演示模式」），Demo 永不白屏

---

## 二、零依赖：不用 npm install

后端只用到 Node 内置模块（`http` / `fs` / `path`）和 Node 18+ 的全局 `fetch`。
**没有任何第三方依赖**，所以：

```bash
cd app
node server.js
```

打开 <http://localhost:3000> 即可。不需要 install、不怕网络问题、不怕 `node_modules` 爆炸。

> 需要 Node ≥ 18（推荐 20/22）。`package.json` 里 `dependencies` 是空的，这是有意为之。

---

## 三、接真实大模型（30 秒）

```bash
cp .env.example .env
```

然后编辑 `.env`：

```bash
AI_API_KEY=sk-你的密钥
AI_BASE_URL=https://api.deepseek.com
AI_MODEL=deepseek-chat
```

重启 `node server.js`，顶部徽章会变成「● 真实大模型已接入」。

**换模型只需改两行**（都是 OpenAI 兼容格式）：

| 服务商 | AI_BASE_URL | AI_MODEL |
|--------|-------------|----------|
| DeepSeek | `https://api.deepseek.com` | `deepseek-chat` |
| 通义千问 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus` |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |

### 安全红线
- `.env` **绝不提交 Git**（请自行建 `.gitignore` 写入 `.env`）
- 密钥只在 `server.js` 里 `process.env` 读取，**前端代码里没有任何密钥**
- 任何变量都不要加 `NEXT_PUBLIC_` 之类的前缀 —— 那类前缀会把它下发到浏览器

---

## 四、目录结构

```
app/
├── server.js            # HTTP 服务 + 静态托管 + 三个 API 路由（零依赖）
├── package.json         # 依赖为空，只有一个 start 脚本
├── .env.example         # 环境变量示例
├── lib/
│   ├── deepseek.js      # 大模型调用封装（超时、错误处理、JSON 剥离）
│   ├── prompts.js       # 三条核心 Prompt + 三种学生人格题库
│   ├── analyzer.js      # 本地规则分析引擎（真实统计 + 真实改写文本）
│   └── engine.js        # 统一调度：优先 LLM，失败自动降级规则引擎
└── public/
    ├── index.html       # 前端页面
    ├── styles.css       # 样式
    └── app.js           # 前端交互（fetch 调 /api/*，无任何密钥）
```

---

## 五、接口文档

所有接口返回统一结构：`{ ok: boolean, data?: any, error?: string }`

### `GET /api/health`
查看当前模式。返回 `{ ok, aiMode: 'live'|'demo', model, hasKey, tip }`

### `POST /api/analyze`
请求：`{ transcript, subject?, grade?, durationSec? }`
返回讲稿复盘报告，字段与 `../prompts/core-prompts.md` 中的约定一致：
`overall_score / summary / speech_rate / pauses / filler_words / questions / knowledge / interaction / suggestions / engine`

> `speech_rate.estimated` 为 `true` 表示未填 `durationSec`、时长按 4 分钟估算，语速结果仅供参考。

### `POST /api/improve`
请求：`{ transcript, analysis?, subject? }`
返回：`{ improved_script, key_changes[], blackboard_design, layered_homework, next_focus, engine }`

### `POST /api/student/chat`
请求：`{ messages: [{role:'teacher'|'student', content}], persona: 'naughty'|'geek'|'drift', topic, transcript }`
返回：`{ reply, persona, label, engine }` —— 多轮靠 `messages` 数组保持上下文。

---

## 六、已验证结果（本机实测，非推测）

```
① node --check 全部通过
② GET  /api/health            → {"ok":true,"aiMode":"demo",...}
③ GET  /                      → HTTP 200（静态首页正常）
④ POST /api/analyze           → 给定 120s / 约 202 字 → 语速 101 字/分（偏慢，estimated:false）
                                口头禅合计 14 次（那个3/然后6/就是5，真实统计）
                                环节覆盖 71%，缺失：知识推导、课堂互动
⑤ POST /api/improve           → 开头已清理干净："今天我们学习勾股定理，a平方加b平方等于c平方…"
                                key_changes: 删口头禅3处 / 伪提问改留白提问 / 补齐3个缺失环节
⑥ POST /api/student/chat      → 首问："老师，那这个结论要是放到特殊情况，还成立吗？"
                                老师回答后追问自动换题："老师你一直在讲公式，可是我连为什么要这样设都还没搞懂诶。"
⑦ 异常输入 "太短"             → {"ok":false,"error":"讲稿内容太短，无法分析"}（正确拦截）
```

### 回归测试脚本（改完代码必跑）

```bash
node tests/punct-regression.js        # 改进稿标点清洗：5/5
node tests/cloud-transcribe.test.js   # 云端转写解析：11/11（本地 mock，不需要真 Key）
```

---

## 六·五、语音转写两条通道

上传视频/音频时用，配了就自动启用：**本地优先，本地不可用自动回落云端。**

| 通道 | 优点 | 前置条件 | 环境变量 |
|------|------|----------|----------|
| **B 云端 Whisper**（推荐） | 即配即用，不用下载上 GB 模型 | 一个 OpenAI 兼容音频接口的 Key | `WHISPER_API_KEY` `WHISPER_BASE_URL` `WHISPER_MODEL` |
| **A 本地 faster-whisper** | 完全离线，现场断网也能跑 | `pip install faster-whisper` + 下载模型文件 | `PYTHON_PATH` `TRANSCRIBE_MODE=local` |

云端各家配置对照（**模型名必须与 Base URL 配套，填错会 404**）：

| 服务商 | `WHISPER_BASE_URL` | `WHISPER_MODEL` |
|--------|--------------------|------------------|
| OpenAI | `https://api.openai.com/v1` | `whisper-1` |
| 硅基流动 SiliconFlow | `https://api.siliconflow.cn/v1` | `FunAudioLLM/SenseVoiceSmall` |
| Groq | `https://api.groq.com/openai/v1` | `whisper-large-v3` |

> 云端请求统一用 `response_format=verbose_json`，才能拿到带时间戳的 `segments` —— 前端的语速曲线依赖它。
> 若某家服务忽略该参数只回纯文本，程序会自动降级为「只有全文、无曲线」，不会报错。
> 单文件上限 25MB，超限会提前给出提示而不是等到接口报 413。

---

## 七、部署上线（注意与静态版不同）

### 当前线上版本（实际在跑）

| 项目 | 值 |
|------|------|
| **平台** | WorkBuddy 站点托管（`app.workbuddy.host`） |
| **在线地址** | `https://jiangtai-survival.app.workbuddy.host/?sharecode=2WZXYSXJ6D` |
| **主页** | `https://jiangtai-survival.app.workbuddy.host/landing.html?sharecode=2WZXYSXJ6D` |
| **鉴权** | 平台强制 `?sharecode=` 校验，**API 请求也必须带该参数**，缺失会返回 403 平台拦截页 |
| **发布单元** | 整个 `app/` 目录（`app/server.js` + `app/public/` + `app/lib/`） |

> **sharecode 是平台级强制鉴权，没有关闭选项。** 改代码后重新发布即可，无需另配域名或证书。

### 自建/迁移路线（如果将来要脱离平台托管）

**重要**：全栈版是传统 `server.listen()` 长驻服务，**不能直接拖到 Vercel/Netlify 静态托管**（它们需要 Serverless handler 或静态文件）。推荐：

| 平台 | 做法 | 说明 |
|------|------|------|
| **Render** | New Web Service → 连仓库 → Build 留空 → Start `node app/server.js` | 免费额度够演示，注意免费实例会休眠 |
| **Railway** | 一键部署 Node 项目，自动识别 | 环境变量在后台面板填 `AI_API_KEY` |
| **云服务器 / 宝塔** | `node server.js` + Nginx 反代 3000 端口 | 最稳，校内演示可控 |
| Docker | `FROM node:22-alpine` + `CMD ["node","server.js"]` | 便于迁移 |

如果确实想上 **Vercel**：需要把 `server.js` 改写成导出 `handler` 的 Serverless Function，并把三个路由拆成 `api/*.js`。这是另一条改造路线，静态版 `../index.html` 才是「Vercel 一键」的那条。

> 根目录的 `render.yaml` 与 `Dockerfile` 已按上述路线配好，可直接使用。

---

## 八、视频转写：已实现，但需要下载模型

功能链路已经打通 —— 前端选择视频 → `POST /api/transcribe` → 服务端转写 → 文本与真实时长自动填入。

本机相关软件**统一装在 D 盘**（这是本项目明确的安装约定）：

| 软件 | 位置 | 说明 |
|------|------|------|
| Python 独立环境 | `D:\Tools\jiangtai-whisper\venv` | 内含 `faster-whisper` / `av` / `numpy`，**桌面有快捷方式** |
| ffmpeg | `D:\Tools\ffmpeg\bin\ffmpeg.exe` | 绿色版，无需安装，**桌面有快捷方式** |

`lib/transcribe.js` 已把 D 盘的 Python 排在第一位，会自动识别。

### 已知限制：模型首次下载被网络阻断（重要）

依赖全部就绪，但 whisper 的**模型文件**需要从网上拉，本机实测两次都失败：

- HuggingFace 官方 → `502 Bad Gateway`
- 国内镜像 `hf-mirror.com` → `401 Unauthorized`

**结果：本地转写目前跑不通**，这是网络问题而非代码缺陷。三条出路：

1. 换网络再试（例如手机热点）；
2. 从能访问的机器拷贝模型目录到本机缓存
   `~/.cache/huggingface/hub/models--Systran--faster-whisper-small`；
3. 改用云端 Whisper API —— 在 `.env` 里配 `OPENAI_API_KEY`，系统会自动切到通道 B。

**注意：即使模型下不来，粘贴文本讲稿的完整功能完全不受影响**，路演流程也不需要改动。

### 为什么没装 ffmpeg 也能用

`transcribe.py` 优先用 **PyAV（`av`）** 解码音视频 —— 它随 `faster-whisper` 一起安装，自带解码能力，不依赖系统 ffmpeg。ffmpeg 只作为备用方案存在。
