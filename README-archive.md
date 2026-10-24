# 讲台求生 · 师范生 AI 试讲教练

> Slogan：上台前，先被 AI 拆台一次。
> 一句话：上传一段试讲视频，AI 从「教学内容、互动提问、语速节奏、板书/PPT、学生反应」多维度打分，并模拟学生现场提问。

---

## 一、当前交付物说明

本目录包含一个**可直接部署上线的静态单页**：

| 文件 | 说明 |
|------|------|
| `index.html` | 完整响应式官网 + 可交互 Demo（零依赖、零构建，双击即可本地打开） |
| `README.md` | 本文档：部署上线指南 + 全栈升级方案 + 路演脚本 |
| `AI-DEV-GUIDE.md` | **用 AI 开发本站的完整指南**：两层 AI、工具清单、48h 修订版作战表、必须人工把关的 5 件事 |
| `prompts/core-prompts.md` | **三条可直接复制的核心 Prompt**（复盘 / 学生拆台 / 改进建议）+ 参数建议 + 调用示例 |

**页面包含的区块：**

1. Hero 首屏（痛点开场 + 报告预览卡）
2. 痛点分析（3 张卡）
3. 三大核心模块（AI 导师复盘 / AI 学生拆台 / 改进建议生成）
4. **在线交互 Demo**（可点击操作：粘贴讲稿 → AI 复盘报告 → AI 学生多轮提问）
5. 实现流程（接收 → 转写 → LLM 分析 → 报告）
6. 部署上线说明
7. 页脚

> Demo 区目前是**带模拟数据的交互原型**，不需要后端即可演示完整业务流程。
> 接入真实 Whisper + LLM 后，前端流程完全不变，只需替换数据接口（见第四节）。

---

## 二、本地预览

任选一种：

```bash
# 方式 1：Python（任意系统自带）
python -m http.server 8080
# 浏览器打开 http://localhost:8080

# 方式 2：Node
npx serve .
```

也可以直接双击 `index.html` 用浏览器打开（Demo 全部为前端逻辑，无需服务器）。

---

## 三、部署上线（三条路线，任选其一）

### 路线 A：Vercel（最推荐，30 秒上线，自动 HTTPS）

**适用**：想最快拿到公网链接、路演现场直接展示。

1. 把 `index.html` 放到一个文件夹，推到 GitHub 仓库（也可不推，见下方「拖拽方式」）。
2. 打开 <https://vercel.com> → 右上角 **Add New → Project**。
3. 导入你的 GitHub 仓库；框架预设（Framework Preset）选 **Other**。
4. **Build Command 留空**、**Output Directory 留空**（因为是纯静态，无需构建）。
5. 点 **Deploy**，等待约 30 秒，拿到 `https://xxx.vercel.app`。
6. 自定义域名（可选）：项目 → **Settings → Domains** → 添加域名 → 按提示到域名商处添加 `CNAME` 记录。

> **免 Git 方式**：安装 Vercel CLI 后执行 `vercel deploy --prod` 也可直接上传当前目录。

**验证**：部署完成后用手机 4G 打开链接，确认移动端排版正常（页面已做响应式，768px / 1024px 断点）。

---

### 路线 B：Netlify Drop（最快，连 GitHub 都不用）

1. 打开 <https://app.netlify.com/drop>。
2. 把包含 `index.html` 的文件夹**直接拖进网页虚线框**。
3. 几秒后自动生成 `https://xxx.netlify.app`。
4. 可在 **Site settings → Change site name** 改成好记的名字，例如 `jiangtai-qiusheng`。

---

### 路线 C：GitHub Pages（校内网络友好，完全免费）

1. 新建 GitHub 仓库，把 `index.html` 放到仓库**根目录**（不是子目录）。
2. 仓库 **Settings → Pages → Build and deployment**。
3. Source 选 **Deploy from a branch**，Branch 选 `main`，目录选 `/ (root)`，保存。
4. 约 1–2 分钟后访问 `https://<用户名>.github.io/<仓库名>/`。

> 注意：免费版 GitHub Pages 要求仓库为 **Public**。若校内访问 GitHub 慢，优先选路线 A/B。

---

## 四、升级成真实全栈（接入 Whisper + LLM）

当 Demo 验证完流程、需要真实 AI 能力时，按下面的路径升级。

### 4.1 架构调整

当前单文件 HTML → 迁移到 **Next.js 14（App Router）**，用 API Routes 做后端代理。

**为什么必须走后端代理**：OpenAI / DeepSeek 的 API Key 一旦写在前端 JS 里，任何人打开浏览器 DevTools 都能拿到你的密钥并盗刷。**密钥只能存在于服务端环境变量**。

```
浏览器 → /api/transcribe（服务端）→ Whisper API
浏览器 → /api/analyze   （服务端）→ DeepSeek / 通义千问
浏览器 → /api/student   （服务端）→ LLM（带讲稿上下文的多轮对话）
```

### 4.2 环境变量（`.env.local`，绝不提交到 Git）

```bash
DEEPSEEK_API_KEY=sk-xxxxxxxx
OPENAI_API_KEY=sk-xxxxxxxx        # 如用 Whisper API
NEXT_PUBLIC_SITE_URL=https://xxx.vercel.app
```

> 规则：只有 `NEXT_PUBLIC_` 前缀的变量会进入浏览器，**密钥绝对不能加这个前缀**。
> 同时把 `.env.local` 写进 `.gitignore`。

### 4.3 核心 API Route 示例（`app/api/analyze/route.ts`）

> 以下为教学示意代码，展示「服务端代理 + 结构化输出」的写法，实际接入时按所选模型文档微调。

```ts
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const { transcript } = await req.json();

  // 1. 结构化 Prompt：让模型直接输出 JSON，前端才好渲染图表
  const prompt = `你是一位资深教研员。请分析以下师范生试讲逐字稿。
只输出 JSON，不要任何解释文字，字段如下：
{
  "speech_rate":   {"value": 数字, "unit": "字/分钟", "judge": "偏快/适中/偏慢"},
  "pause_count":   {"value": 数字, "desc": "停顿超过2秒的次数"},
  "filler_words":  {"total": 数字, "detail": {"那个": 数字, "然后": 数字, "就是": 数字}},
  "question_count":{"value": 数字, "avg_wait_seconds": 数字},
  "knowledge_cover":{"percent": 数字, "missing": ["缺失的知识点"]},
  "suggestions":   [{"title": "建议标题", "detail": "具体可执行的改法"}],
  "improved_script": "改写后的逐字稿全文"
}

试讲逐字稿：
${transcript}`;

  // 2. 在服务端带上密钥调用模型，浏览器完全看不到 Key
  const res = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
    }),
  });

  const data = await res.json();
  return NextResponse.json(data);
}
```

### 4.4 AI 学生的 System Prompt（拆台效果的关键）

```
你扮演一个{{调皮/学霸/走神}}风格的初中生，正在听一位实习老师讲《{{课题}}》。
规则：
1. 每次只问一个问题，口语化、简短（不超过 40 字），像一个真实初中生会问的话。
2. 必须基于老师刚才讲的内容来问，可以挑边界条件、可以超纲、也可以答非所问。
3. 老师回答后，你可以顺着追问，但不要重复已问过的问题。
4. 绝对不要夸老师，也不要替老师解答。
5. 不要暴露你是 AI。

老师刚才讲的内容片段：
{{transcript_chunk}}
```

> 调参心得：`temperature` 设 0.8–1.0 让提问更有「人味」和意外感；讲稿上下文只喂**最近 1–2 分钟**的片段即可，控制在成本的同时保证相关性。

### 4.5 Whisper 转写（获取时间戳，才能算停顿）

```python
# 本地离线方案（推荐黑客松现场，免网络依赖）
from faster_whisper import WhisperModel
model = WhisperModel("small", device="cpu", compute_type="int8")
segments, _ = model.transcribe("lecture.mp3", word_timestamps=True)
for s in segments:
    print(f"[{s.start:.1f}s -> {s.end:.1f}s] {s.text}")
```

停顿由相邻 segment 的 `start - 上一end` 计算；语速 = 总字数 / 总分钟数。

### 4.6 部署组合

| 层 | 平台 |
|----|------|
| 前端 Next.js | Vercel（免费额度足够） |
| 后端 API Routes | 同在 Vercel，无需额外部署 |
| 若用 FastAPI（Python AI 生态） | Render / Railway |
| 数据库 + 登录 + 视频存储 | Supabase |

---

## 五、黑客松路演脚本（2 分钟版）

> 目标：不讲技术参数，只制造一个「哇塞」瞬间。

1. **（0–20s）场景开场**
   「请问在座各位，有没有试讲过——台下鸦雀无声，自己大脑一片空白？（停顿）我做过，而且我不知道自己哪里讲得不好。因为同学们只会鼓掌，不会告诉我。」

2. **（20–50s）产品亮相 + 现场邀请**
   「这是《讲台求生》。我想请台下这位同学，对着麦克风随便讲 1 分钟任意知识点。」

3. **（50–90s）高光时刻 —— AI 学生提问**
   讲完立刻点「让学生提问」，屏幕上跳出学生的问题。**这是全场记忆点。**

4. **（90–110s）量化价值**
   「我们还给出了一份报告：语速多少、口头禅几次、提问后等待了多久——全部可量化、可执行。」

5. **（110–120s）收尾**
   「师范生的每一次练习，都值得一次真实的反馈。谢谢。」

### Plan B（现场网络不稳时必备）

- **预录演示视频**：提前用 OBS 录一段完整的「讲 1 分钟 → AI 提问」流程，MP4 存本地。
- **前端兜底数据**：当前 `index.html` 的 Demo 区就是纯前端模拟数据，断网也能完整演示交互，把它当成 Plan B 的交互备份。
- **本地跑 Whisper**：`faster-whisper small` 在笔记本 CPU 上可离线转写，实测 4 分钟音频约 40–60 秒，完全不依赖网络。

---

## 六、合规与安全提醒

- 用户上传的试讲视频属个人数据，存储需加密，并提供一键删除。
- 涉及真人肖像，分析报告默认匿名化处理，导出分享链接时不要暴露姓名。
- 所有 LLM 输出内容建议加一层基础敏感词过滤，避免生成不当内容。
- 接入任何第三方 API 前，确认其服务条款允许商用/参赛用途。

---

## 七、下一步可迭代方向

- [ ] 视觉模型识别板书 / PPT 页面，判断排版是否清晰
- [ ] 多人课堂模拟：同时出现调皮 + 学霸 + 走神三名学生
- [ ] 接入摄像头做微表情紧张度检测
- [ ] 对接师范技能训练中心课程，生成班级练习报告
- [ ] 多次试讲对比，绘制成长曲线

---

© 2026 讲台求生团队 · 华师 AI 黑客松
