# 讲台求生 · 增量站点规格卡（E 教学任务与学情 / A 学情驱动 AI 学生 / B 3 分钟专项技能练习）

> 版本：v1.0（冻结）｜日期：2026-03｜适用代码库：`E:/ai网页/jiangtai-qiusheng/`（`app/` 为应用根）
> 角色：文构间（requirement-architect）｜本卡为前端与后端的**唯一施工图**，字段名/类型/必填性以本卡为准，禁止各自定义。
> 硬约束：零第三方依赖（不新增 npm 包、不引框架、不改技术栈）；不破坏现有 15 个接口与既有前端行为；所有新增字段**可选且向后兼容**；`?jtq-demo=1` 演示模式必须覆盖全部新功能且不污染 localStorage；**禁止任何伪造数据**——所有展示结果必须来自真实计算或真实 LLM 输出，规则兜底必须在 UI 明确标注「本地规则判定」。

---

## 0. 结论速览

| 项 | 结论 |
|---|---|
| E 存储方案 | **纯前端 localStorage + 随请求体透传，不新建任何 profile API**（理由见 §3.1） |
| 新增接口 | `GET /api/drill/skills`、`POST /api/drill`（共 2 个） |
| 修改接口 | `POST /api/student/chat`、`POST /api/classroom/round`（仅**新增可选** body 字段 `profile`，响应仅新增可选字段） |
| 新增后端文件 | `app/lib/profile.js`、`app/lib/drill.js` |
| 修改后端文件 | `app/lib/engine.js`、`app/lib/prompts.js`、`app/server.js` |
| 新增前端文件 | 无（沿用 `index.html` / `app.js` / `styles.css` / `demo-data.js` 四个既有文件） |
| 本次不做 | 云端存学情、用户账号体系、多人班级管理、练习记录云同步、图像识别板书、语音测评 |

---

## 1. 页面 / 视图清单

现有 `app/public/index.html` 为**单页多区块**结构，三入口导航为：`准备试讲`（`section#trainingInput`）→ `复盘与演练`（`section#trainingResults`）→ `成长档案`（tab `pane-growth`）。本次三项增量**不新增页面、不新增路由**，全部落进既有区块。

| 增量 | 落在哪个既有区块 | 新增内容 | 是否需要后端数据 |
|---|---|---|---|
| **E 教学任务与学情配置** | 「准备试讲」区块 `section#trainingInput` 内，`#trainingAdvanced`（高级设置 details）**之前**，新增一个独立折叠面板 `details#teachingConfig` | 表单（12 个控件）+ 「已配置」摘要 chip | 否（仅前端 localStorage） |
| **A 学情驱动 AI 学生** | 「复盘与演练」→ tab `pane-chat`（AI 学生拆台） | 学情生效提示条 ×2（单人模式 / 三学生模式）、学生卡「提问难度」标签 | 是（复用现有 `/api/student/chat`、`/api/classroom/round`，仅传参） |
| **B 3 分钟专项技能练习** | 「复盘与演练」→ **新增 tab** `pane-drill`（插在 `pane-chat` 之后、`pane-crisis` 之前） | 技能选择、任务卡、3 分钟计时、逐字稿输入、评分结果、历史记录 | 是（新接口 `GET /api/drill/skills`、`POST /api/drill`） |

### 1.1 既有区块锚点（施工时对照，勿改 id）

- 准备试讲：`section#trainingInput` → `#subjectInput`、`#gradeInput`、`#subjectKeyInput`、`#scriptInput`、`#durationInput`、`#analyzeBtn`
- 复盘与演练：`section#trainingResults` → `.tabs`（`button.tab[data-tab=report|improve|chat|crisis|pano|growth]`）→ `.tabpane#pane-*`
- AI 学生：`#pane-chat` → `#chatModeBar`、`#soloMode`（`#personaBar`、`#chatLog`、`#chatForm`）、`#classMode`（`#classStudents`、`#classLog`、`#classForm`、`#classNextBtn`）
- 成长档案：`#pane-growth` → `#growthBody`（含 `#growthList`、`#ifiasTrail` 等）

### 1.2 新增 DOM 容器与 id 命名表（**冻结**）

命名规范：`jtq-` 前缀仅用于 localStorage key；DOM id 一律「区块前缀 + 语义」，全小写连字符在 `id` 中不使用连字符（沿用现有 camelCase 风格，如 `classStudents`）。新增 id 一律以 `cfg` / `drill` / `profile` 开头，便于全局检索与回归测试定位。

#### E 项：`details#teachingConfig`（放在 `section#trainingInput` 内，`#trainingAdvanced` 之前）

| id | 标签 | 类型 | 说明 |
|---|---|---|---|
| `cfgPanel` | — | `<details>` | 折叠面板容器（summary 标题：「⚙ 教学任务与学情（可选，不填也能跑）」） |
| `cfgTaskGroup` | `<fieldset>` | — | 「本次试讲的教学任务」分组 |
| `cfgTopic` | 课题 | `input[type=text]` | 教学任务课题，可留空（留空则回退到 `#subjectInput`） |
| `cfgLessonType` | 课时类型 | `select` | 新授课/复习课/习题课/实验课/讲评课/公开课 |
| `cfgObjectives` | 教学目标 | `textarea` | **每行一条**，最多 5 条，每条 ≤ 60 字 |
| `cfgKeyPoints` | 教学重点 | `textarea` | 每行一条，最多 5 条 |
| `cfgDifficulties` | 教学难点 | `textarea` | 每行一条，最多 5 条 |
| `cfgAssessment` | 评价方式 | `select` | 形成性评价/终结性评价/两者兼有/不评价 |
| `cfgDurationMin` | 计划课时(分钟) | `input[type=number]` | 0–180，0 = 未填 |
| `cfgClassGroup` | `<fieldset>` | — | 「学情」分组 |
| `cfgClassLevel` | 班级水平 | `select` | 基础薄弱/中等偏弱/中等/优秀 |
| `cfgPriorKnowledge` | 已学前置知识 | `textarea` | 每行一条，最多 5 条 |
| `cfgCommonErrors` | 常见错误 | `textarea` | 每行一条，最多 5 条 |
| `cfgClassSize` | 班级规模(人) | `input[type=number]` | 1–80，默认 45 |
| `cfgActivity` | 课堂活跃度 | `select` | 偏低/一般/较高 |
| `cfgSaveBtn` | — | `button` | 「保存配置」（写 localStorage） |
| `cfgResetBtn` | — | `button` | 「清空配置」（恢复默认值） |
| `cfgStatusTip` | — | `<p>` | 状态/校验提示（成功·已保存 / 错误文案） |
| `cfgSummaryChip` | — | `<span>` | 头部 chip，显示「学情：中等 · 3 个目标」（未配置时隐藏） |

#### A 项：`pane-chat` 内新增

| id | 位置 | 说明 |
|---|---|---|
| `profileBar` | `#pane-chat` 顶部（`#chatModeBar` 之前） | 学情生效状态条：显示当前学情摘要 + 「去配置」跳转按钮 `profileBarEditBtn` |
| `profileBarEditBtn` | 同上 | 点击滚动并展开 `#teachingConfig` |
| `soloProfileNote` | `#soloMode` 顶部 | 单人模式：显示「提问难度基线：<basic/core/advanced>，学生更可能卡在：<…>」 |
| `classProfileNote` | `#classMode` 顶部（`#pressureBar` 之前） | 三学生模式：显示学情对基线的影响说明 + `classProfileTag` |
| `classProfileTag` | 同上 | 徽标：`学情已生效` / `默认学情` |

> 学生卡「提问难度」标签不新增独立容器：由前端在渲染 `#classStudents` 内每个学生卡时追加 `class="difficulty-tag"`，值为后端返回的 `students[].difficulty`（basic/core/advanced）。

#### B 项：新增 tab `pane-drill`

| id | 说明 |
|---|---|
| `pane-drill` | tabpane 容器（对应 `button.tab[data-tab="drill"]`，文案「⏱ 3 分钟专项练习」） |
| `drillEmpty` | 空态说明（含「先完成一次分析即可带入讲稿」的提示） |
| `drillSkillList` | 技能卡片列表容器（由 `GET /api/drill/skills` 渲染 5 张卡） |
| `drillSkillCards` | 技能卡容器（每卡含 key/label/focus/brief/自评要点） |
| `drillTaskBox` | 当前练习任务卡（标题、任务说明、要点、计时） |
| `drillTimer` | 倒计时显示（`mm:ss`，180 → 0，归零后显示「时间到」并允许提交） |
| `drillTimerStartBtn` / `drillTimerStopBtn` | 开始/停止计时 |
| `drillTranscript` | `textarea`：本次 3 分钟讲稿/要点（≥30 字才可提交） |
| `drillCharHint` | 字数提示（沿用 `#charHint` 风格） |
| `drillSubmitBtn` | 「提交本次练习」 |
| `drillResult` | 结果容器（默认 hidden） |
| `drillScore` | 总分（0–100） |
| `drillGrade` | 等级（优秀/合格/需改进） |
| `drillEngineTag` | **来源标签**：LLM 实时分析 / **本地规则判定**（规则兜底必须显示此标签） |
| `drillSummary` | 一句话总评 |
| `drillDims` | 分维度评分列表（每项：维度名、分数、依据、改进动作） |
| `drillEvidence` | 原文证据列表（每条必须是讲稿中**原样出现**的片段） |
| `drillSuggestions` | 改进建议列表 |
| `drillNextBtn` | 「再练一个技能」（随机跳到另一技能） |
| `drillHistoryCount` | 历史练习次数 |
| `drillHistoryList` | 历史练习记录列表（来自 localStorage） |
| `drillClearHistoryBtn` | 清空历史 |

---

## 2. 数据结构定义（前后端共用，冻结）

### 2.1 Profile（教学任务 + 学情）

后端权威定义在 `app/lib/profile.js`（`DEFAULT_PROFILE`、`normalizeProfile()`、`deriveLevelParams()`），前端在 `app/public/app.js` 内**镜像一份同构常量**（`window.JTQ_PROFILE_DEFAULTS`），**以本表为唯一真源**。

```js
// Profile 顶层
{
  version: 1,                 // number，固定 1
  task: { /* 见 2.2 */ },
  class: { /* 见 2.3 */ },     // 注意：字段名 class 为 JS 保留字名，此处仅作对象属性名使用
  updatedAt: 0                // number，epoch ms，保存时写入
}
```

#### 2.2 `task`（本次试讲的教学任务）

| 字段 | 类型 | 必填 | 取值范围 | 默认值 | 说明 |
|---|---|---|---|---|---|
| `topic` | string | 否 | ≤ 40 字 | `''` | 教学任务课题；为空时消费方回退到 `subject` |
| `lessonType` | string | 否 | `new` \| `review` \| `exercise` \| `lab` \| `assessment` \| `public` | `'new'` | 课时类型 |
| `objectives` | string[] | 否 | 0–5 条，每条 ≤ 60 字 | `[]` | 教学目标 |
| `keyPoints` | string[] | 否 | 0–5 条，每条 ≤ 60 字 | `[]` | 教学重点 |
| `difficulties` | string[] | 否 | 0–5 条，每条 ≤ 60 字 | `[]` | 教学难点 |
| `assessment` | string | 否 | `formative` \| `summative` \| `both` \| `none` | `'formative'` | 评价方式 |
| `durationMin` | number | 否 | 0–180 整数，0 = 未填 | `0` | 计划课时（分钟） |

#### 2.3 `class`（学情）

| 字段 | 类型 | 必填 | 取值范围 | 默认值 | 说明 |
|---|---|---|---|---|---|
| `level` | string | 否 | `weak` \| `basic` \| `good` \| `excellent` | `'good'` | 班级水平 |
| `priorKnowledge` | string[] | 否 | 0–5 条，每条 ≤ 60 字 | `[]` | 已学前置知识 |
| `commonErrors` | string[] | 否 | 0–5 条，每条 ≤ 60 字 | `[]` | 常见错误 |
| `size` | number | 否 | 1–80 整数 | `45` | 班级规模 |
| `activity` | string | 否 | `low` \| `mid` \| `high` | `'mid'` | 课堂活跃度 |

#### 2.4 枚举中文映射（前端下拉与后端标签共用）

| 枚举 | 中文 |
|---|---|
| lessonType | `new`=新授课、`review`=复习课、`exercise`=习题课、`lab`=实验课、`assessment`=讲评课、`public`=公开课 |
| assessment | `formative`=形成性评价、`summative`=终结性评价、`both`=两者兼有、`none`=不评价 |
| level | `weak`=基础薄弱、`basic`=中等偏弱、`good`=中等、`excellent`=优秀 |
| activity | `low`=偏低、`mid`=一般、`high`=较高 |

### 2.5 派生参数（`lib/profile.js` 的 `deriveLevelParams()`，后端计算，前端不复制）

| level | difficulty | askDepth | handRaiseRate | baseAttentionΔ | baseComprehensionΔ | respondStyle |
|---|---|---|---|---|---|---|
| `weak` 基础薄弱 | `basic` | 1 | 0.25 | −8 | −12 | 迟疑、需老师点명才答（实现用「需点名」） |
| `basic` 中等偏弱 | `basic` | 1 | 0.40 | −4 | −6 | 犹豫、答一半 |
| `good` 中等 | `core` | 2 | 0.55 | 0 | 0 | 正常应答 |
| `excellent` 优秀 | `advanced` | 3 | 0.70 | +6 | +6 | 主动追问原理/变式 |

`activity` 系数：`low`×0.85、`mid`×1.00、`high`×1.15，乘到 `handRaiseRate`（上限 0.9）。
`size` 仅作为 prompt 上下文与「集体反应强度」参考（`size` 越大 → 走神学生 `baseAttentionΔ` 再 −2，不低于 5），**不改变基线主结构**。
`commonErrors` 非空 → 学生提问/卡点优先围绕常见错误；`priorKnowledge` 非空 → 优秀/中等班学生**不重复询问**已学前置知识中的条目。

### 2.6 DrillRecord（专项练习记录，存 localStorage）

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | `drill_<timestamp>_<rand4>` |
| `skill` | string | 五选一，见 §2.7 |
| `skillLabel` | string | 技能中文名 |
| `score` | number | 0–100 整数 |
| `grade` | string | `优秀` \| `合格` \| `需改进` |
| `createdAt` | number | epoch ms |
| `durationSec` | number | 本次练习实际秒数（1–600） |
| `transcript` | string | 本次练习讲稿（≤ 5000 字） |
| `dimensions` | Array | `{key,label,score,weight,evidence,fix}` 数组（≤ 6） |
| `suggestions` | Array | `{title,detail}` 数组（≤ 5） |
| `engine` | string | `llm` \| `rule` |
| `profileSnapshot` | object | 练习时的 Profile 快照（`{level, lessonType}` 摘要即可） |

### 2.7 五项专项技能（key / label / focus / 判定依据）

| key | label | focus（练习目标） | 判定依据（复用现有能力） |
|---|---|---|---|
| `question_wait` | 提问与等待 | 把封闭式提问换成真提问，并真的留白 | `analyzeRule().questions`（asked / genuine / fake / avg_wait_sec）+ 文本中「等待/停顿/默数」标记 |
| `pace_filler` | 语速与口头禅 | 控速、去掉口头禅 | `analyzeRule().speech_rate` + `filler_words` |
| `board_structure` | 板书结构 | 让板书承担结构（课题→推导→结论） | 讲稿中板书陈述 + `analyzeRule().knowledge.covered/missing`（**不做图像识别**） |
| `intro_design` | 导入设计 | 前 15% 讲稿完成情境/冲突/复习衔接 | 讲稿首段文本 + `knowledge.covered` 中的导入锚点 |
| `transition` | 过渡衔接 | 环节之间有过渡句，小结收口 | `analyzeRule().knowledge.cover_percent` + 过渡词命中 |

---

## 3. 接口契约（冻结，字段级）

统一约定：请求 `Content-Type: application/json`；成功响应 `{"ok":true,"data":{…}}`；失败 `{"ok":false,"error":"<中文错误文案>"}`；HTTP 状态码 400（参数错）、404（资源不存在）、405（方法不支持）、500（内部错误）。所有新接口**必须**在响应 `data.engine` 中标注 `llm` / `rule`，前端据此显示「本地规则判定」标签。

### 3.1 结论：E 的存储方式 —— **不建 profile API**

**结论：教学任务与学情只存前端 localStorage（key `jtq_profile`），并在每次请求时随 body 透传给后端；不新增 `GET/POST /api/profile`。**

理由（四条，任一都足以否决建 API）：

1. **后端无数据库、无用户体系**：零依赖后端只有 `app/uploads` 一个写文件目录，且无鉴权。任何 `/api/profile` 只能退化为「把一个人的学情写进一个全局文件」——多人使用时互相覆盖，是错的设计。
2. **数据是"本次训练上下文"而非"账号资产"**：学情服务于「这一次试讲」，作用域天然是单次会话/单台设备。成长档案已有 `cloud.js` 的云同步通道，若日后确需跨设备，正确做法是复用 `cloud.js`（本次不做，见 §7）。
3. **透传反而更契合 LLM 消费方式**：后端在生成 prompt 时需要的是**当次快照**（学情在学生提问过程中可能变化），随请求携带天然保证 prompt 与渲染一致；服务端存储反而要处理「读到的是旧学情」的竞态。
4. **零依赖约束下的最小改动面**：新增一个 API 意味着 server.js 多一条路由、engine 多一个方法、还要自建一个无鉴权的写文件端点——收益为零、风险与安全债为正。

**唯一的例外**：`/api/drill` 的**评分依据**必须包含学情（题目难度要贴合学情），因此 `POST /api/drill` 的 body **携带 `profile` 快照**——这是「消费」而非「存储」，不违反本结论。

### 3.2 `POST /api/student/chat`（**修改**，向后兼容）

请求 body：

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `messages` | Array<{role:'teacher'\|'student', content:string}> | 否 | `[]` | 既有字段，语义不变 |
| `persona` | string | 否 | `'naughty'` | 既有字段，语义不变 |
| `customPersona` | string | 否 | `''` | 既有字段，语义不变 |
| `topic` | string | 否 | `''` | 既有字段，语义不变 |
| `transcript` | string | 否 | `''` | 既有字段，语义不变 |
| **`profile`** | object \| null | **否** | `null` | **新增**学情快照，结构见 §2.1/2.2/2.3。缺省或非法 → 走原逻辑，行为与现状**完全一致** |

响应 `data`：

| 字段 | 类型 | 必返 | 说明 |
|---|---|---|---|
| `reply` | string | 是 | 学生发言（既有） |
| `persona` | string | 是 | 既有 |
| `label` | string | 是 | 既有 |
| `engine` | string | 是 | 既有（`llm`/`rule`） |
| **`profile_applied`** | boolean | 是（新增） | 是否真的注入了学情上下文 |
| **`difficulty`** | string | 是（新增） | 本轮提问难度：`basic`/`core`/`advanced`；未注入学情时 = `core` |
| **`profile_summary`** | string | 是（新增） | 一句话学情摘要（≤ 40 字），用于 UI 展示；未注入时为 `''` |

**向后兼容细则**
- 请求体**不含** `profile` → `profile_applied=false`、`difficulty='core'`、`profile_summary=''`，且 prompt 文本与改造前**逐字相同**（学情块整段不拼接，不留空行占位）。
- 请求体含 `profile` 但字段非法（如 `level='xxx'`）→ **按 `normalizeProfile()` 归一化**（非法枚举落回默认值，缺字段补默认），**不报错**；归一化后与「无 profile」等价的部分不影响原有行为。
- 规则兜底（无 Key）时，学情影响**仅体现在选词池**（见 §5.3），不影响 `persona` 选择逻辑与 `label`。

### 3.3 `POST /api/classroom/round`（**修改**，向后兼容）

请求 body：

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `topic` | string | 否 | `''` | 既有 |
| `transcript` | string | 否 | `''` | 既有 |
| `teacherAnswer` | string | 否 | `''` | 既有 |
| `pressure` | number | 否 | `0` | 既有 |
| `history` | Array | 否 | `[]` | 既有 |
| **`profile`** | object \| null | **否** | `null` | **新增**学情快照，结构同上 |

响应 `data`：

| 字段 | 类型 | 必返 | 说明 |
|---|---|---|---|
| `students` | Array | 是 | 既有数组，**每项**在既有字段之外新增（见下） |
| `backchannel` | object \| null | 是 | 既有 |
| `pressure_delta` | number | 是 | 既有 |
| `pressure_reason` | string | 是 | 既有 |
| `verdict` | string | 是 | 既有 |
| `engine` | string | 是 | 既有 |
| **`profile_applied`** | boolean | 是（新增） | 学情是否生效 |
| **`profile_effect`** | string | 是（新增） | ≤ 50 字，说明学情如何影响本轮（规则兜底时由本地生成） |
| **`students[].difficulty`** | string | 是（新增） | 该生本轮提问难度 `basic`/`core`/`advanced` |
| **`students[].base_state`** | object | 是（新增） | `{attention:number, comprehension:number}`，学情调整后的**基线值**（未注入学情时 = 既有 `STUDENT_STATE_BASE`） |

**向后兼容细则**
- 无 `profile` → `profile_applied=false`、`profile_effect=''`、`students[].difficulty='core'`、`students[].base_state` = 原 `STUDENT_STATE_BASE` 对应值；`students[].attention/comprehension` 的计算公式**与改造前逐字一致**（`normStudentState` 的既有逻辑不改，只把「基线取值来源」从常量改为「常量 + 学情偏移」）。
- 有 `profile` → 基线 = `STUDENT_STATE_BASE[key] + deriveLevelParams(level)` 的偏移量，再叠加既有「压力惩罚 / 老师回应奖励」，最后 `clampPct` 到 5–100。
- **既有 `students[].state_reason` 语义不变**；仅在学情生效时，允许后端在其末尾追加 `（学情：基础薄弱）` 之类后缀（前端原样显示，不影响既有断言）。

### 3.4 `GET /api/drill/skills`（**新增**）

请求：无 body、无参数。

响应 `data`：

| 字段 | 类型 | 必返 | 说明 |
|---|---|---|---|
| `skills` | Array<Skill> | 是 | 长度 5，顺序固定（见 §2.7） |
| `default_skill` | string | 是 | 默认选中 `question_wait` |
| `duration_sec` | number | 是 | 固定 `180`（3 分钟） |
| `engine` | string | 是 | `rule`（本接口纯本地定义，不调 LLM） |

`Skill` 对象：

| 字段 | 类型 | 说明 |
|---|---|---|
| `key` | string | 技能 key |
| `label` | string | 中文名 |
| `focus` | string | 一句话练习目标（≤ 30 字） |
| `brief` | string | 任务说明（≤ 120 字），**直接来自真实练习指引** |
| `checklist` | string[] | 自评要点，3–5 条，每条 ≤ 30 字 |
| `starter` | string | 起手句模板（≤ 60 字），给用户起手用 |

错误码：405（非 GET）、500。

> **为什么用 GET 而非把技能表硬编码在前端**：技能定义同时被后端规则兜底与前端 UI 消费，浏览器无法 `require` `app/lib/*.js`（无构建链）。后端单一真源 + 演示模式一份 `demo-data.js` 副本，是当前架构下唯一不产生「双份定义漂移」的做法。

### 3.5 `POST /api/drill`（**新增**）

请求 body：

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `skill` | string | **是** | — | 五选一 skill key；未知 → 400 `未知技能：<key>` |
| `transcript` | string | **是** | — | 本次 3 分钟讲稿/要点；去空白后 < 30 字 → 400 `练习内容太短（至少 30 字）` |
| `durationSec` | number | 否 | `180` | 实际练习秒数，1–600，超范围则截断 |
| `task` | string | 否 | `''` | 任务说明文本（来自 `/api/drill/skills` 的 `brief`） |
| `profile` | object \| null | 否 | `null` | 学情快照（用于贴合题目难度与建议口径） |
| `subject` | string | 否 | `''` | 学科名 |
| `subjectKey` | string | 否 | `'auto'` | 学科 key（`lib/subjects.js`） |
| `grade` | string | 否 | `''` | 年级 |

响应 `data`：

| 字段 | 类型 | 必返 | 说明 |
|---|---|---|---|
| `skill` | string | 是 | 技能 key |
| `skill_label` | string | 是 | 技能中文名 |
| `duration_sec` | number | 是 | 实际使用的秒数 |
| `score` | number | 是 | 0–100 整数 |
| `grade` | string | 是 | `优秀`（≥85）\| `合格`（60–84）\| `需改进`（<60） |
| `summary` | string | 是 | 一句话总评（≤ 80 字） |
| `dimensions` | Array<Dim> | 是 | 3–5 项 |
| `evidence` | Array<Evidence> | 是 | 0–6 条，**每条 quote 必须是 transcript 中原样出现的子串** |
| `suggestions` | Array<Suggestion> | 是 | 1–5 条 |
| `next_drill` | object | 是 | `{skill, reason}`，推荐下一个技能 |
| `metrics` | object | 是 | 规则统计子集（见下） |
| `engine` | string | 是 | `llm` \| `rule` |
| `source_note` | string | 是 | 数据来源说明（规则兜底时必须含「本地规则判定」语义） |

`Dim`：`{key:string, label:string, score:number(0-100), weight:number(0-1), evidence:string(≤60字), fix:string(≤60字)}`
`Evidence`：`{quote:string(≤40字, 原文子串), reason:string(≤50字), fix:string(≤60字)}`
`Suggestion`：`{title:string(≤20字), detail:string(≤100字)}`
`metrics`：`{chars_per_min:number, filler_total:number, questions_asked:number, genuine_questions:number, fake_questions:number, avg_wait_sec:number, cover_percent:number, pause_count:number, matched_markers:number}`

错误码：`400`（缺 `skill` / 缺 `transcript` / 内容过短）、`404`（未知 skill）、`500`（内部错误）。
**注意**：`transcript` 过短必须 400，**不得**返回编造评分。

### 3.6 现有 15 个接口的处置

**全部不改**。`/api/analyze`、`/api/improve`、`/api/danger`、`/api/curriculum`、`/api/lesson-plan`、`/api/heatmap`、`/api/panorama`、`/api/compare`、`/api/ifias`、`/api/ifias-batch`、`/api/hollow`、`/api/crisis/start`、`/api/crisis/respond`、`/api/blackboard`、`/api/transcribe` 的 method/path/body/response **一字不改**。

> **明确不做的诱惑**：把学情塞进 `/api/analyze` 的 prompt 看起来很香，但会改变既有报告文案与评分口径，直接违反「不破坏现有行为」。教学任务与学情在本次增量中**只影响 A（AI 学生）与 B（专项练习）**。若日后要影响复盘报告，应作为独立增量并单独立项。

---

## 4. 目录结构与文件清单

```
app/
├─ server.js                  [改] 新增 2 条路由：GET /api/drill/skills、POST /api/drill
│                                  并在 /api/student/chat、/api/classroom/round 透传 body.profile
├─ lib/
│  ├─ engine.js               [改] studentChat/classroomRound 支持 profile；新增 drillSkills()、drill()
│  ├─ prompts.js              [改] 新增 profileContextBlock(v)、drillPrompt(v)
│  ├─ profile.js              [新] Profile 权威定义：DEFAULT_PROFILE / normalizeProfile() /
│  │                               deriveLevelParams() / PROFILE_LABELS（枚举中文映射）
│  └─ drill.js                [新] 五技能定义 SKILLS、规则评分 drillRule()、证据抽取与校验
└─ public/
   ├─ index.html              [改] 新增 details#teachingConfig、pane-drill、相关 DOM 容器
   ├─ app.js                  [改] profile 读写/透传、drill 渲染、demo 兜底映射
   ├─ styles.css              [改] .cfg-* / .drill-* 样式（沿用现有 CSS 变量）
   └─ demo-data.js            [改] 新增 5 个 DEMO key
docs/
└─ site-spec-eab.md           [新] 本文件
app/tests/
└─ profile-drill.test.js      [新] node --test 用例：profile 归一化、向后兼容（无 profile 时
                                   classroomRound/studentChat 输出与改造前一致）、drill 契约校验
```

**命名规范**
- 后端模块文件：全小写单词，`-` 连接（现有风格为无分隔单文件；新增两文件均单词，无复合词）。
- 导出函数：camelCase；常量全大写（`SKILLS`、`DEFAULT_PROFILE`）。
- 前端全局函数：`cfg*` / `drill*` 前缀（与 DOM id 前缀一一对应），避免与 `app.js` 现有 4500 行命名冲突。
- localStorage key：`jtq_profile`、`jtq_drill_records`（沿用 `jtq_` 前缀惯例）。
- **所有新增 localStorage 读写必须包 try/catch**（隐私模式会抛异常，现有 `jtq_nickname` 已如此处理）。

---

## 5. 双引擎兜底策略（无 API Key / 断网 / 演示模式）

### 5.1 通用约定

- 判定入口统一用 `ai.hasKey()`（`lib/deepseek.js` 已封装），模式信息由 `GET /api/health` 的 `aiMode` 决定。
- LLM 分支失败（超时 / 非 JSON / 空内容）→ **自动降级到规则兜底**，并在 `data.engine` 写 `rule`。
- 前端规则兜底结果的 `engineTag` **必须**显示「本地规则判定（无 API Key / 模型不可用）」，与 LLM 结果视觉上可区分（沿用 `#engineTag` 既有样式）。
- 演示模式（`?jtq-demo=1`）：`app.js` 的 `post()` 直接返回 `demo-data.js` 固定内容，**不发网络请求**；`data.engine` 统一被改写为 `offline-demo`（既有逻辑 `cloned.engine = 'offline-demo'`）。新增的 `GET /api/drill/skills` 在演示模式下也必须走本地副本（见 §5.5）。

### 5.2 `POST /api/drill` 规则兜底算法（`lib/drill.js` 的 `drillRule()`）

**总原则：先跑一次真实统计（复用 `analyzeRule()`，绝不重新造统计器），再按技能选取对应的判定分支。** 所有分数由真实数字推导，证据句必须从讲稿原文截取。

统一前置：
1. `const stat = analyzeRule({transcript, subject, grade, durationSec: durationSec||180})` → 取得 `speech_rate.chars_per_min`、`filler_words.total/detail`、`questions.{asked,genuine,fake,avg_wait_sec}`、`pauses.count_gt_2s`、`knowledge.{covered,missing,cover_percent}`。
2. 切句：按 `。！？；\n` 切为句数组，保留原文与序号，供证据抽取（quote 必须是原句子串）。

各技能判定（score 为该技能 0–100 分，`evidence` 引用真实句子/真实数字）：

| skill | 规则判定逻辑（全部基于真实统计） |
|---|---|
| `question_wait` | ① 有效提问密度 = `genuine_questions / (durationSec/60)`；密度 ≥ 1.0/min 得 40 分，0.3–1.0 得 25–39，< 0.3 得 ≤ 24。② `fake_questions` 每 1 处 −6 分（上限 −20）。③ `avg_wait_sec` ≥ 3 得 30 分，2–3 得 15–29，< 2 得 ≤ 14。④ 讲稿中出现「(停顿)」「…」「默数」「等 3 秒」「大家想想」等等待标记，每 1 处 +5（上限 +15）。⑤ 未达 60 分的维度必须从原文找出对应的封闭式提问句作为 evidence。 |
| `pace_filler` | ① `chars_per_min` 在 120–150 得 50 分，偏离每 10 字/分 −3（上限 −35），> 175 或 < 100 直接封顶 55。② `filler_words.total` 每 2 处 −5（上限 −30）。③ 口头禅密度 = `total / (chars/100)`，> 4 处/百字 再 −10。④ 证据引用出现次数最多的口头禅所在原句。 |
| `board_structure` | ① 讲稿中命中板书标记词（「板书」「写下来」「黑板」「大屏」「PPT」「投影」）的句数 ≥ 3 得 30 分，1–2 得 15–29，0 得 0。② 是否出现结构标记（「课题」「第一步」「第二」「结论」「所以」「因此」）≥ 3 个不同标记 得 30 分，1–2 得 12–29，0 得 0。③ `knowledge.cover_percent` 线性映射 0–100 → 0–40 分。④ 缺 `knowledge.missing` 中的条目 → 每条 −8（上限 −24）。**不涉及任何图像识别。** |
| `intro_design` | ① 取讲稿前 15% 文本（按字数切）作为导入段。② 命中「情境/冲突/问题/复习/上节课/还记得/猜一猜」等导入信号词：命中 ≥ 2 得 50 分，1 得 28，0 得 0。③ 导入段含问号或「？」类提问 得 20 分。④ 导入段 ≥ 40 字 得 15 分（过短说明直接开讲），< 20 字 −10。⑤ 导入段若无任何具体情境名词（数字/图形/生活场景词）→ −10。 |
| `transition` | ① 命中过渡词（「接下来」「下面」「回到」「再看」「因此」「所以」「小结」「总结」「最后」）的句子数 ≥ 4 得 45 分，2–3 得 25–44，1 得 12，0 得 0。② `knowledge.cover_percent` 映射 0–100 → 0–35 分。③ `cover_percent < 50`（环节覆盖不足）→ −15。④ 讲稿末句含「小结/总结/作业/下课」之一得 20 分。 |

**总分校准**（三个技能共同的算法口径）：
- 每个技能按上表算「原始分」，再按 `weight`（各技能固定权重见 §5.4）加权平均 → `raw`。
- 调整：讲稿过短（< 60 字）→ `raw × 0.8`（并在 summary 说明「样本过短，评分仅供参考」）。
- `score = clamp(round(raw), 0, 100)`；`grade`：`≥85 优秀`、`60–84 合格`、`< 60 需改进`。
- `evidence`：从真实句数组里按技能规则挑出**最能支撑扣分**的 1–4 句，quote 必须是原文子串（后端需 `indexOf` 校验，校验失败则丢弃该条）。
- `suggestions`：每条必须引用一个真实数字（如「当前 168 字/分」），禁止空泛。
- `source_note`：`'本地规则判定：基于讲稿文本的真实统计（语速/提问/口头禅/环节覆盖），非音频实测'。

### 5.3 A 项规则兜底（无 Key 时学情如何生效）

`POST /api/student/chat`（无 Key 路径，现为 `persona.asks/follow` 池）改造：
1. 保持既有 persona 池与 `label` 不变。
2. 在 `lib/drill.js` 之外新增 `lib/profile.js` 导出的 `pickAskForLevel(pool, level)`：
   - `weak`/`basic`：优先选**指向基础概念**的句子（含「什么意思」「怎么算」「为什么」「没跟上」等词的优先），把偏原理/偏变式的句子排到最后；
   - `good`：维持原顺序；
   - `excellent`：优先选**追问原理/变式/边界**的句子（含「如果」「反过来」「还成立吗」「本质」「证明」等词）。
3. `excellent` 级的 `persona.geek` 权重提升：单人模式下 `difficulty='advanced'` 时，回答/追问句式更可能带「为什么/本质」。
4. 规则兜底时 `profile_summary` 由本地生成（如「学情：基础薄弱 · 提问聚焦基础概念」）。

`POST /api/classroom/round`（无 Key 路径）改造：
- `STUDENT_STATE_BASE` **不删不改**，改为 `baseFor(key, profile)`：无 profile → 原值；有 profile → 原值 + `deriveLevelParams(level)` 偏移（`baseAttentionΔ`/`baseComprehensionΔ`），再走既有 `normStudentState` 的压力/回应公式。
- 走神学生（小走）在 `weak` 级额外 `attention −3`（更易走神），在 `excellent` 级 `hand_raise` 概率更高（`handRaiseRate` 提升 → 允许小走偶尔主动发言）。
- `difficulty` 字段在规则路径按 `deriveLevelParams(level).difficulty` 直接赋值（三人共用同一学情时三人的 `difficulty` 相同；`excellent` 时小霸恒为 `advanced`、小走为 `basic`，体现个体差异）。
- 证据：`profile_effect` 文本由本地拼装，例如「学情基础薄弱：基线专注 −8 / 理解 −12，提问更可能停在基础概念」。

### 5.4 LLM 分支要点

- `lib/prompts.js` 新增 `profileContextBlock(v)`：把 profile 渲染成一段**中文自然语言**（不是裸 JSON），包含：班级水平、规模、活跃度、已学前置知识（逐条）、常见错误（逐条）、以及**由 level 推导的行为指令**（如「基础薄弱班：优先提出基础概念层面的疑问，不要主动使用未被讲授的术语；学生可能答不上来」）。**该 block 为空时整段不输出**（保证向后兼容逐字一致）。
- `studentSystem(v)` / `classroomRoundPrompt(v)`：在现有 prompt 末尾追加 `profileContextBlock`（**追加在「老师刚才讲的内容」之前**，保证学生先看学情再看内容）。`classroomRoundPrompt` 的状态分数规则段追加学情基线说明：「本班基线为 <各生基线值>，按此微调」。
- `drillPrompt(v)`：要求输出 JSON `{score, grade, summary, dimensions[], evidence[], suggestions[]}`，并**硬性要求** `evidence[].quote` 必须是逐字稿中的原样片段（≤ 40 字），`dimensions` 3–5 项。后端对 LLM 返回做**逐条 `indexOf` 校验**，不通过的 evidence 直接丢弃；若 `dimensions` 全部校验失败 → 判定 LLM 输出不可用 → 降级规则兜底。
- 温度：`drill` 用 `0.35`（求稳定与可复现）；`student/chat`、`classroom` 保持既有 `0.9`/`0.95` 不变。

### 5.5 `demo-data.js` 需补的 DEMO key（**5 个**）

| key | 内容要求 | 结构 |
|---|---|---|
| `DEMO_PROFILE` | 一份**完整可用的**学情+教学任务示例（教学任务：勾股定理/新授课/3 个目标/重点难点/形成性评价/45 分钟；学情：中等/中等规模/活跃度一般/2 条前置知识/2 条常见错误） | 完整 Profile 对象（§2.1），`updatedAt` 固定值 |
| `DEMO_DRILL_SKILLS` | 5 个技能的完整定义 | `{skills:[Skill×5], default_skill:'question_wait', duration_sec:180, engine:'offline-demo'}`（Skill 结构同 §3.4） |
| `DEMO_DRILL_RESULT` | 一份 3 分钟练习评分示例 | `POST /api/drill` 的 `data` 结构（§3.5），`engine` 会被统一改写为 `offline-demo` |
| `DEMO_CLASSROOM_PROFILE` | 学情生效后的三学生课堂回合 | `POST /api/classroom/round` 的 `data` 结构，额外含 `profile_applied:true`、`profile_effect`、每个学生 `difficulty` 与 `base_state` |
| `DEMO_STUDENT_CHAT_PROFILE` | 学情生效后的单人学生发言 | `{reply, persona, label, engine:'offline-demo', profile_applied:true, difficulty:'basic', profile_summary:'…'}` |

**演示模式硬约束**
- `app.js` 的 `offlineFallback(url, body)` 需新增映射：
  - `/api/drill` → `D.DEMO_DRILL_RESULT`
  - `/api/drill/skills` → `D.DEMO_DRILL_SKILLS`
  - `/api/classroom/round` → **当 body 含 `profile` 且 `profile.level` 非默认时**返回 `D.DEMO_CLASSROOM_PROFILE`，否则返回既有 `D.DEMO_CLASSROOM`（保持既有演示剧本不变）
  - `/api/student/chat` → **当 body 含 `profile`** 返回 `D.DEMO_STUDENT_CHAT_PROFILE`，否则保持既有内联 3 句台词逻辑不变
- **演示模式下不得写入任何 localStorage**（含 `jtq_profile`、`jtq_drill_records`）：`cfgSaveBtn`、`drillSubmitBtn` 在 `JTQ_DEMO_PAGE` 为真时，只更新内存对象并提示「演示模式不保存」，不调用 `localStorage.setItem`。
- 演示模式下 `drillHistoryList` 显示 `DEMO_DRILL_RESULT` 的**单条内存示例**，标注「演示数据」。

---

## 6. 转化路径与摩擦点

**目标动线（学情贯穿全场）**
`准备试讲` 填学情/教学任务（可选，30 秒）→ `复盘与演练` → `AI 学生拆台`（学生提问难度随学情变化）→ `3 分钟专项练习`（针对暴露出的短板做限时微练习）→ `成长档案` 累积练习轨迹。

| 步骤 | 摩擦点 | 削减措施 |
|---|---|---|
| ① 进入准备试讲 | 「又要填一堆表」 | 整个配置面板**默认折叠**、全部选填、10 个控件中 6 个有默认值；`cfgSummaryChip` 一行摘要；「不填也能跑」在面板摘要里直说 |
| ② 保存学情 | 学情填一半被中断 | 即时保存（`change` 事件即写 localStorage），不设「提交」必经关；`cfgSaveBtn` 只是显式确认 |
| ③ 打开 AI 学生 | 不知道学情是否生效 | `#profileBar` 常驻显示「学情已生效 / 默认学情」；`classProfileTag` 徽标在课堂顶部 |
| ④ 学生提问 | 学情"看起来没反应" | `#classProfileNote` 明确写出「基础薄弱班 → 提问更可能停在基础概念、答不上来」，把行为差异**解释给用户**，避免被当成 bug |
| ⑤ 打开专项练习 | 不知道练什么、怕练错方向 | `GET /api/drill/skills` 返回 5 张卡，每张含 focus + 自评要点 + 起手句；`drillNextBtn` 直接推荐下一个技能 |
| ⑥ 3 分钟计时 | 计时器被切后台失真 | 计时用 `Date.now()` 差值计算（不看 tick 次数），切后台回来自动校正；归零后按钮仍可提交 |
| ⑦ 提交评分 | 分数看不懂 | 结果首屏固定四件套：分数 + 等级 + **来源标签** + 一句话总评；`drillEvidence` 每条带原文引用 |
| ⑧ 重复练习 | 每次都从零挑技能 | `drillHistoryList` 按技能聚合，显示「提问与等待：练过 3 次，最好 78」 |

---

## 7. 范围分层与风险

### 7.1 分层

| 层 | 内容 | 判定 |
|---|---|---|
| **首发必做** | E 的配置表单 + localStorage 持久化 + 归一化；A 的 `profile` 透传进两个 prompt + 课堂基线随学情浮动；B 的 `POST /api/drill` + 技能卡 + 3 分钟计时 + 规则兜底 + demo 兜底 | 缺任一项，三项增量的主链路即断 |
| **首发可做** | `#profileBar` 摘要条 / `profile_effect` 文案 / `drillNextBtn` 推荐 / 历史记录列表 / `DEMO_*` 五个 key 补齐 | 缺失只影响体验与演示顺滑，不影响功能成立 |
| **上线后迭代** | 学情的云端同步（复用 `cloud.js`）、练习记录进成长档案曲线、按技能生成 7 天训练计划、语音输入接入专项练习、班级规模联动集体反应强度 | 独立增量，另立规格卡 |

### 7.2 依赖关系

```
E（profile 定义 + 存储 + 归一化 + 派生参数）
   └─> A（prompt 注入 + 课堂基线浮动）   ← 依赖 E 的 profile 形状
   └─> B（/api/drill 携带 profile 校准难度）← 依赖 E 的 profile 形状
B 另需：/api/drill/skills（自身）+ 复用 analyzeRule（既有）
```
**E 是唯一的阻塞项**。A 与 B 在 E 完成后可并行开工（B 的规则兜底与 UI 可先做，A 需等 profile 字段冻结）。
**建议实施顺序**：E → A → B（与用户确认的顺序一致，且 E 完成即可独立演示）。

### 7.3 技术风险

| # | 风险 | 影响 | 缓解 |
|---|---|---|---|
| R1 | 改 `studentSystem` / `classroomRoundPrompt` 时误改既有文案 → 既有接口行为漂移 | 高 | **追加式**改造：学情 block 为空时整段不输出；加回归测试「无 profile 时 prompt 输出与改造前逐字相同」 |
| R2 | `STUDENT_STATE_BASE` 被改动 → 课堂三学生数值与现状不一致 | 高 | 保留常量不动，新增 `baseFor(key, profile)` 包装；测试断言无 profile 时三个 key 的 `base_state` 等于原常量 |
| R3 | LLM 返回的 evidence 引文不在讲稿中 → 伪造证据 | 高 | 后端 `indexOf` 校验，丢弃不合格 evidence；不合格导致结构不完整则整体降级规则 |
| R4 | 规则兜底的分数被用户当作真实测评 | 中 | `engine='rule'` + `source_note` + UI 必显「本地规则判定」标签；`pauses/questions` 等沿用既有 `source:'text-heuristic'` 说明口径 |
| R5 | `/api/drill` 技能定义在前后端双份漂移 | 中 | 后端单一真源 + 演示模式 `DEMO_DRILL_SKILLS` 副本；两处 key 必须一致，测试断言两份 key 集合相等 |
| R6 | 学情极端值（如 size=80、level=weak）导致基线崩塌/爆表 | 中 | `clampPct(5,100)` + 偏移量上限（注意力 Δ 限 [−12,+8]，理解 Δ 限 [−15,+8]） |
| R7 | 3 分钟计时用 tick 累加导致切后台失真 | 低 | 用 `Date.now()` 差值 |
| R8 | 演示模式写入 localStorage 污染真实轨迹 | 中 | 演示模式下所有写操作短路 + 提示；`jtq_profile`/`jtq_drill_records` 写入前先判 `JTQ_DEMO_PAGE` |
| R9 | 隐私模式 localStorage 抛异常导致配置丢失 | 低 | 所有读写包 try/catch，失败时降级为内存态并提示 |
| R10 | `POST /api/drill` 讲稿过长拖垮 LLM | 低 | 服务端截断至 6000 字符后送 LLM（与既有 `dangerMoments` 同样做法） |

### 7.4 明确的「不做什么」边界

1. **不做**云端存学情（学情只在本机 localStorage；不写服务端文件）。
2. **不做**用户账号 / 登录 / 权限体系（现有 `cloud.js` 登录态与本次无关，不改动）。
3. **不做**多班级、多教师、班级花名册与点名系统。
4. **不做**练习记录云同步与跨设备同步（`jtq_drill_records` 仅本机）。
5. **不做**学情对复盘报告（`/api/analyze`）与课标对照（`/api/curriculum`）的影响——本增量只作用于 A 与 B。
6. **不做**板书图像识别（`board_structure` 技能只评「讲稿中的板书设计陈述」，图像评分仍走既有 `/api/blackboard`）。
7. **不做**语音测评/发音打分/音调分析。
8. **不做**音频时间戳实测（等待/停顿仍为文本启发式，沿用既有 `source` 标注口径）。
9. **不做**「AI 学生自主学习画像」「班级知识图谱」「自动生成 7 天计划」（属上线后迭代）。
10. **不做**为教学任务引入富文本编辑器/Markdown 解析（纯 textarea 一行一条）。
11. **不做**新增任何 npm 依赖、不引入任何框架、不引入构建步骤（`app/lib` 与 `app/public` 仍通过 `<script>` 直接加载）。
12. **不新增路由页面**：`landing.html`、`index.html` 结构不变，不做 URL 路由化。

---

## 8. 验收清单（Definition of Done）

**E**
- [ ] `index.html` 出现 `details#teachingConfig`，12 个控件 id 与 §1.2 完全一致。
- [ ] 填表 → `localStorage['jtq_profile']` 内容符合 §2.1–2.3；刷新后回填。
- [ ] 未填任何配置 → 全站功能与改造前**完全一致**（含课堂基线数值、报告文案）。
- [ ] 非法输入（level='xxx'、size=999、objectives 7 条）被归一化，不抛错。
- [ ] 演示模式下配置**不落** localStorage。

**A**
- [ ] `POST /api/classroom/round` 不带 profile → `students[].base_state` 等于原 `STUDENT_STATE_BASE`，`attention/comprehension` 与改造前逐值相同。
- [ ] 带 `profile.level='weak'` → 三个学生 `base_state.attention` 均 ≤ 44、`comprehension` 均 ≤ 50，且 `profile_applied=true`、`profile_effect` 非空。
- [ ] `POST /api/student/chat` 不带 profile → prompt 与改造前逐字相同（回归测试断言）。
- [ ] 有 Key 时学生提问难度可见差异（weak 问基础、excellent 问原理/变式）；无 Key 时词池顺序可见差异。
- [ ] `pane-chat` 内 `#profileBar`、`#soloProfileNote`、`#classProfileNote`、`#classProfileTag` 均渲染。

**B**
- [ ] `GET /api/drill/skills` 返回 5 个技能，key 与 §2.7 一致。
- [ ] `POST /api/drill` 缺 `skill` → 400；`transcript` < 30 字 → 400；未知 skill → 404。
- [ ] 规则兜底下 `evidence[].quote` 100% 是讲稿原样子串（测试断言）。
- [ ] LLM 分支返回的 evidence 若含非原文片段，该条被丢弃且不报错。
- [ ] 规则兜底时 UI 出现「本地规则判定」标签。
- [ ] 计时归零后仍可提交；计时用 `Date.now()` 差值。
- [ ] 演示模式下 `POST /api/drill` 与 `/api/drill/skills` 均返回 `DEMO_*` 数据，`engine='offline-demo'`，不写 localStorage。
- [ ] `node --test tests/*.test.js` 全绿。

---

**范围建议（砍到哪层能上线）**：只做「首发必做」层即可上线——E 的配置表单+存储、A 的两个接口透传+基线浮动、B 的 `/api/drill`+规则兜底+演示兜底；`#profileBar` 摘要、推荐下一技能、历史记录列表可砍，不影响主链路成立。

**最大风险（一句话）**：在改 `studentSystem` / `classroomRoundPrompt` / `STUDENT_STATE_BASE` 时手滑改动既有文案或基线，导致 15 个既有接口的行为漂移——必须用「无 profile 时 prompt 与基线逐字/逐值一致」的回归测试锁死。

**需要拍板的 3 个决策**：
1. **学情存储是否最终定在 localStorage？**（本卡结论：定，不建 `/api/profile`；若要求跨设备，需另开增量复用 `cloud.js`。）
2. **专项练习的五个技能是否就定这五个？**（本卡定：提问与等待/语速与口头禅/板书结构/导入设计/过渡衔接；板书只评讲稿陈述，不做图像识别。）
3. **学情是否允许影响复盘报告 `/api/analyze`？**（本卡定：不影响，只作用于 AI 学生与专项练习；若要影响需单独立项并重测评分口径。）
