# 讲台求生 · 判定口径与降级可见化交付清单

> 交付日期：2026-10-25｜交付总监：岳上线（主理人）
> 批次主题：① 拆分「问句」与「互动任务」判定 ② 限流/欠费对用户可见 ③ **明确不启用** `source:'timestamp'`
> 线上链接：https://jiangtai-survival.app.workbuddy.host/?sharecode=2WZXYSXJ6D
> 固定演示：https://jiangtai-survival.app.workbuddy.host/?sharecode=2WZXYSXJ6D&jtq-demo=1

---

## 一、这批做了什么

### 1. 问句与互动任务判定拆分

**问题**：项目里「等待时间推断」和「教学环节分类」用同一套松散问句判定（`/[?？]|吗|呢|是不是|.../`），导致陈述句被当提问：
- 「今天我们先看看勾股定理**呢。**」→ 被判为提问
- 「**请同桌讨论这道题。**」→ 被判为提问（其实是互动任务）
- 结果：时间分配把陈述句算进「互动分钟」、环节切分把陈述句划进「互动」环节 → 互动环节可能为空、18 分钟被判成「过渡」

**拆分为两个概念**：

| 判定 | 用途 | 位置 |
|---|---|---|
| `isQuestionSentence()` | 「是不是在向学生提问」→ 决定是否产生一个等待样本 | `app/lib/wait-metrics.js` |
| `isInteractiveSentence()` | 「是不是在组织学生互动（讨论/练习/板演/齐读…）」→ 决定是否归入互动环节 | `app/lib/wait-metrics.js` |

**关键取舍**：
- 句末语气词「吗/呢/呗」**不能单独**作为问句证据，必须有疑问结构佐证（「学**什么**呢？」是问句，「勾股定理**呢**。」不是）
- 疑问词**不必在句首**（否则「李同学，你说说这一步为什么这样设」这类无问号问句会漏判 —— 那是上一批刚修好的能力）
- 排除名词用法与高误判词：「学习**如何**上好一节课」、「分为**几个**步骤」、「**大家好**，今天我们讲…」

**新增** `splitTeachingUnits()`（保留句末标点的教学单元切分）供时间分配与环节切分使用。

### 2. 限流/欠费对用户可见

**问题**：模型调用失败时 `engine.analyze()` 静默降级到规则引擎，前端只看到 `engine:'rule'`，用户不知道发生了什么（上一批线上实测 `AI_HTTP_402` 欠费，用户看到的是「服务端规则计算 · 不代表模型评价」—— 技术准确，产品误导）。

**修复分两层**：

**① `lib/deepseek.js` —— 上游状态码映射成稳定错误码**（根治）
```js
429 → rate_limit_exceeded
402 → insufficient_balance
401/403 → auth_failed
404 → model_not_found
5xx → upstream_error
其它 → upstream_http_error
```
错误对象带 `err.status` / `err.code` / `err.upstreamBody`，上层**不再需要正则匹配 message**。`NO_API_KEY` / `AI_EMPTY_RESPONSE` / 网络异常 / 超时也都有稳定 code。

**② `lib/engine.js` —— 降级原因透传**
新增字段 `report.fallback_reason`：

| 取值 | 触发条件 | 前端标签 |
|---|---|---|
| `none` | 模型调用成功 | （不显示降级） |
| `key-not-configured` | 服务端没配 Key | 服务端规则计算 · 未配置模型 |
| `rate-limited` | 429 | **规则计算 · 模型请求过于频繁，请稍后重试** |
| `insufficient-balance` | 402 | 规则计算 · 模型账户余额不足，请联系部署方充值 |
| `auth-failed` | 401/403 | 规则计算 · 模型密钥无效，请联系部署方检查 |
| `model-error` | 其它失败 | 规则计算 · 模型请求失败，已降级 |

**语义要求（已落实）**：降级后返回的**仍是规则引擎计算结果**，所以每条文案都**先说清「规则计算」再说降级原因** —— 不允许只显示一条错误信息让用户误以为报告没生成。

### 3. 明确不启用 `source:'timestamp'`

**决定：不启用。** 理由（技术依据已核实）：

`app/lib/transcribe.js` 的 Whisper 分段返回 `{start, end, text}` —— **有分段时间戳，但完全没有 `speaker` 字段**。

所以即使启用 timestamp，测到的也只是「提问结束到下一段语音开始」的间隔，**不能称为「学生思考等待时间」**。只有同时具备「提问结束时间」+「学生回应开始时间」，才能测出真实等待。

**落地护栏**：
- 前端 `WAIT_SOURCE_LABELS` **已删除** `'timestamp'` 条目（若误产出则显示「来源未明确」——宁可说不清楚，也不要说错）
- 后端 `SOURCE_TIMESTAMP` 常量保留但**不产出**
- 界面不出现任何「实测」措辞
- 未来接入条件：转写分段提供 `speaker` 字段且能识别教师/学生

---

## 二、改动清单

### 后端
| 文件 | 改动 |
|---|---|
| `app/lib/wait-metrics.js` | `isQuestionLike` → **`isQuestionSentence`**（严格版）+ 新增 **`isInteractiveSentence`**；保留标点切句；问句/互动任务判定统一出口 |
| `app/lib/heatmap.js` | 新增 `splitTeachingUnits()`；`ruleTimeAllocation` / `ruleSegments` 改用它；互动分类改用 `isInteractiveSentence`；时间分配的问句计数改用 `isQuestionSentence`；LLM 分支回落规则版时 `wait_metrics.source` 为 `text-heuristic` |
| `app/lib/drill.js` | 删除本地同名 `isQuestionSentence`（收敛到 `wait-metrics.js` 唯一实现）；**全部松散问号正则收敛**（含 `intro_design` 的 ask 成分）；`countWaitAfterQuestions` 改用保留标点切句；`buildStat` 新增句级 `questionCount`/`thinkingCount`；`waitCoverage` 分母与 evidence 改用句级计数；密度显示三档保真 |
| `app/lib/deepseek.js` | 新增 `mapUpstreamCode()`；错误对象带 `status`/`code`/`upstreamBody`；`NO_API_KEY`/`AI_EMPTY_RESPONSE`/网络异常/超时各有稳定 code |
| `app/lib/engine.js` | 新增 `isRateLimitError`/`isInsufficientBalanceError`/`isAuthError`；`analyze()` 等函数透传 `fallback_reason`；`crisisStart` 由硬编码 `engine:'llm'` 改为诚实标记 |
| `app/scripts/e2e-fallback-reason.js` | **新增**。真实链路（非 mock）自测脚本，不含任何 Key/BaseURL 字面量 |

### 前端
| 文件 | 改动 |
|---|---|
| `app/public/app.js` | 新增 `describeSourceLabel()` / `sourceTagClassName()` / `FALLBACK_REASON_DEGRADED`；**四处来源标签统一走同一套判断**（主分析 / 云端详情 / 专项练习 / 历史记录）；新增 `.rule-degraded` 样式；`WAIT_SOURCE_LABELS` 删除 `timestamp` 条目 |
| `app/public/styles.css` | 新增降级标签样式（深色主题适配） |

### 测试
新增 `app/tests/question-vs-interactive.test.js`、`app/tests/fallback-reason.test.js`。

**技术栈零变更**，无新增依赖，无新增/删除接口。

---

## 三、验收证据（主理人独立复核）

### 3.1 静态与单元
```
node --check server.js lib/*.js public/*.js scripts/*.js tests/*.js   → 全部通过
node --test tests/*.test.js                                           → tests 110 / pass 110 / fail 0
node scripts/build-standalone.js                                      → 离线版 439.4 KB
```
（基线 70 → 110 条，新增 40 条回归）

### 3.2 问句判定 10 条验证点
```
✅ 今天我们学什么呢？                → 问句
✅ 今天我们先看看勾股定理呢。         → 非问句（「呢」不再单独成立）
✅ 谁来回答？                       → 问句
✅ 我们把这个过程分为几个步骤来完成。  → 非问句
✅ 李同学，你说说这一步为什么这样设（无问号）→ 问句（旧能力未回退）
✅ 大家好，今天我们讲勾股定理。        → 非问句
✅ 今天我们来学习如何上好一节数学课。  → 非问句
✅ 请同桌讨论这道题。→ 互动任务 true、问句 false
✅ 懂了吗？/ 行吗？/ 好不好？/ 李同学…为什么…？ → 全部仍为问句
```

### 3.3 drill.js 口径统一（改造前后对比）
```
【改造前】讲稿：李同学，你说说这一步为什么这样设。我们（停顿）一下。
  wait_time       0  | 整段未检测到提问，无等待证据      ← 明明有提问却说没提问
  question_design 0  | 每分钟 0.00 个需要思考的提问

【改造后】
  question_design  65 | 约每 3 分钟 1 个需要思考的提问（句级问句判定）
  wait_time      100 | 提问后写了等待 1 处 / 共 1 个提问（句级问句判定，文本证据，非实测秒数）
  wait_marker     33 | 讲稿里标出等待 1 处
  fake_question  100 | 未检测到封闭式提问
```

密度显示三档保真（**不许把非零显示成 0**）：
```
真无提问      → 每分钟 0 个需要思考的提问
0.33 个/分钟   → 约每 3 分钟 1 个需要思考的提问
2.0 个/分钟    → 每分钟 2.0 个需要思考的提问
```

### 3.4 降级原因（桩模型，5 种场景）
```
429 限流     fallback_reason= rate-limited           engine=rule  报告完整? true
402 欠费     fallback_reason= insufficient-balance   engine=rule  报告完整? true
401 密钥错   fallback_reason= auth-failed            engine=rule  报告完整? true
普通错误     fallback_reason= model-error            engine=rule  报告完整? true
无 Key      fallback_reason= key-not-configured     engine=rule
```
**降级后报告仍完整**（`overall_score` 是数字、`knowledge`/`wait_metrics` 齐全）—— 满足「不能让用户误以为报告没生成」。

### 3.5 浏览器实测 8 个标签场景（无头 Edge + 同源 iframe 探针）
```
llm                       → 模型生成 · 反馈需结合原文核对
rule + rate-limited       → 规则计算 · 模型请求过于频繁，请稍后重试
rule + insufficient-balance → 规则计算 · 模型账户余额不足，请联系部署方充值
rule + auth-failed        → 规则计算 · 模型密钥无效，请联系部署方检查
rule + model-error        → 规则计算 · 模型请求失败，已降级
rule + key-not-configured → 服务端规则计算 · 未配置模型
rule + 无 fallback_reason → 服务端规则计算 · 不等同于固定示例
offline-demo              → 固定示例 · 非对当前讲稿的分析
console errors: []
```
**429 不进入固定演示数据路径** ✅：`'offline-demo'` 只由前端 `?jtq-demo=1` 产生。

### 3.6 线上验证（发布后）
```
/api/analyze：
  engine = rule
  fallback_reason = insufficient-balance        ← Key 欠费被准确识别
  wait_metrics.source = text-heuristic | average_sec = 2.5
  knowledge.missing = ["课堂互动","作业布置"]
```

---

## 四、本批拦下并修复的缺陷

| 缺陷 | 发现方式 | 后果 | 状态 |
|---|---|---|---|
| **陈述句被当提问**（「呢」结尾、「请同桌讨论」） | 主理人实测 | 时间分配与环节切分把陈述句算成互动，互动环节可能为空 | 已修：拆分为问句/互动任务两个判定 |
| **规格的正则自相矛盾**（`/(?:吗|呢)$/` 会把「勾股定理呢。」判为问句，与验证清单冲突） | 主理人核对规格时发现 | 照抄无法同时满足两条要求 | 已裁决：语气词需疑问结构佐证 |
| **规格的疑问词要求在句首** | 主理人核对规格时发现 | 照抄会回退上一批修好的「无问号问句」能力 | 已裁决：疑问词不必句首，但排除名词用法与高误判词 |
| **`drill.js` 同名不同义的 `isQuestionSentence`** | 成员自查 + 主理人核实 | 同一份代码两个口径，典型的维护陷阱 | 已修：收敛到 `wait-metrics.js` 唯一实现 |
| **`drill.js` 分子分母口径分裂**（问号计数 vs 句级） | 主理人复现 | 明明有提问却报「整段未检测到提问」 | 已修：统一为句级 |
| **同一卡片两个数字自相矛盾**（「每分钟 0.00 个」vs「共 1 个提问」） | 主理人复现 | 用户认为是 bug | 已修：两个维度同源 |
| **密度显示把非零显示成 0** | 主理人复现（**主理人自己的指令引入的**） | 1 个提问显示成「每分钟 0 个」 | 已修：三档保真显示 |
| **`deepseek.js` 状态码只在 message 文本里** | 主理人读码时发现 | `isRateLimitError` 读不到 `error.status`，判定不可靠 | 已修：映射稳定错误码（根治） |
| **`crisisStart` 硬编码 `engine:'llm'`** | 成员自查上报 | 模型失败却标「模型生成」，静默撒谎 | 已修：改为诚实标记 |
| **前端 `timestamp` 标签未落地护栏** | 主理人复核时发现 | 将来 bug 会让界面显示「时间戳测量」 | 已修：删除该条目（宁可说不清楚，也不要说错） |

---

## 五、已知遗留与风险

| 遗留 | 影响 | 处置 |
|---|---|---|
| **API Key 余额不足**（`AI_HTTP_402`） | 线上走规则分支 | **非代码问题**。充值即恢复。降级已可见（用户会看到「模型账户余额不足，请联系部署方充值」） |
| **8 个 lib 侧接口未带 `fallback_reason`** | `curriculum` / `hollow` / `ifias` / `lessonplan` / `panorama` / `blackboard` 等的内容型接口降级时仍不区分原因 | 本批主动不补（改动面与本批目标不成比例）。已列入下一批 |
| **部分模块 `engine` 仍写死 `'llm'`** | `/api/lesson-plan` / `/api/curriculum` / `/api/ifias` 返回的 `engine` 不反映真实来源 | 同上，下一批 |
| **导入段切片导致 `intro_hook` 漏判** | `intro_design` 技能只看讲稿前 15% 字数，导入段里的问号落在切片外 → 提问信号识别不到 | 根因是切片算法不是问句判定，本批不动，下一批 |
| **改版 `engine` 字段会丢 `fallback_reason`** | 历史报告按 `engine` 判版本，`fallback_reason` 是新增字段 | 本批接受的取舍。`engine` 历史包袱重，不动 |
| `time_allocation` 在无提问讲稿下退化为全 0 | 前端显示「时间数据不足」 | 既有行为，两批遗留 |
| `ruleTimeAllocation` / `ruleSegments` 的问句误判 | — | **本批已修**（改用 `isQuestionSentence` / `isInteractiveSentence`） |

---

## 六、下一批候选（按优先级）

1. **8 个 lib 侧接口补 `fallback_reason`**（含 `curriculum` / `hollow` / `ifias` / `lessonplan` / `panorama` / `blackboard`），并修正写死的 `engine:'llm'`
2. **`intro_design` 导入段切片算法**（导致提问信号漏判）
3. `time_allocation` 无提问讲稿的退化处理
4. **接入带 `speaker` 的转写数据后**，实现 `source:'timestamp'` 真实测量路径（当前已具备 `start`/`end`，缺 `speaker`）

---

## 七、养护说明

- **启动**：`cd app && node server.js`（默认 3000 端口）
- **测试**：`cd app && npm test`（当前 110 条）
- **真实链路自测**：`cd app && node scripts/e2e-fallback-reason.js`（需有效 Key；当前 Key 欠费会走 402 分支）
- **重建离线版**：`cd app && node scripts/build-standalone.js`
- **离线版用法**：必须带 `?jtq-demo=1`
- **问句判定约定**：
  - 唯一实现：`app/lib/wait-metrics.js` 的 `isQuestionSentence()`
  - 互动任务：`isInteractiveSentence()`（含讨论/练习/板演/齐读/朗读/同桌交流等）
  - **其它模块一律不得再写松散问号正则**（`/[?？]|吗|呢|.../`）
  - 教学单元切分用 `splitTeachingUnits()` / `splitSentencesKeepPunct()`（**保留标点**，问号是判定依据）
- **降级原因约定**：
  - 取值表见 §1.2，**前后端必须逐字一致**
  - 报告对象新增 `fallback_reason`；LLM 成功时为 `'none'`
  - 前端标签必须**先说报告是什么，再说降级原因**
- **`source:'timestamp'` 约定**：
  - **当前不产出**。前端标签表**不含**该值
  - 启用前置条件：转写分段提供 `speaker` 字段且能识别教师/学生
  - 在此之前，任何界面都不得出现「实测」措辞
