# 讲台求生 · 数据契约统一交付清单

> 交付日期：2026-10-25｜交付总监：岳上线（主理人）
> 批次主题：两批改造 —— ① 统一等待指标数据契约 ② 整理教学环节语义
> 线上链接：https://jiangtai-survival.app.workbuddy.host/?sharecode=2WZXYSXJ6D
> 固定演示：https://jiangtai-survival.app.workbuddy.host/?sharecode=2WZXYSXJ6D&jtq-demo=1

---

## 一、这批做了什么

**核心目标**：让「同一个字段有固定含义、每个结果知道自己的来源」，而不是多个模块各自猜指标。

### 第一批：等待指标统一

新增唯一出口 `app/lib/wait-metrics.js`，所有文本推断的等待值都从这里产出：

```js
wait_metrics: {
  moments: [
    { quote: '同学们，这一步为什么这样做？', wait_sec: 0.8, source: 'text-heuristic', reaction: '文本推断：可能很快进入下一句' }
  ],
  average_sec: 0.8,
  source: 'text-heuristic',
  note: '等待秒数由讲稿上下文推断，不是音频时间戳实测值；average_sec 是逐条推断值的平均，不是实测平均等待。'
}
```

**冻结语义**：
- `average_sec` 是**推断值的平均**，不是实测等待
- **没有提问时 `moments` 为空数组、`average_sec` 为 `null`** —— 不塞伪造的 0 秒条目
- 没有可靠音频时间戳时，`questions.avg_wait_sec` 保持 `null`
- `source` 取值体系：`text-heuristic`（规则推断）/ `model-inference`（模型推断）/ `timestamp`（预留，实测时启用）/ `unmeasured`（不可测量）
- **旧字段保留兼容**：`wait_moments` / `wait_source` / `wait_note` 仍返回，取值等于新契约

**验收核心项已达成**：`/api/analyze.wait_metrics.moments` 与 `/api/heatmap.wait_metrics.moments` **逐字相同**（同一讲稿、规则模式）——两个接口不再各算各的。

### 第二批：教学环节语义整理

四套本不是同一种数据的「环节」被彻底分开：

| 体系 | 字段 | 语义 |
|---|---|---|
| 七环节 | `knowledge` | 逐字稿里匹配到的通用教学环节线索 |
| 四段稿 | `segments` | 练习用口述稿（导入/新授/互动/小结） |
| 学科知识点 | `subject_knowledge` | 模型给的学科内容线索，**需人工确认** |
| 时间分配 | `time_allocation` | 课堂活动时间估算（新增 `source:'text-heuristic'`） |

```js
knowledge: {
  covered: ['情境引入', '知识推导'],
  missing: ['课堂互动'],
  cover_percent: 86,
  scheme: 'generic-seven-phase-cues-v1',
  source: 'text-keyword-rules'
}

subject_knowledge: {
  covered: [ {point, evidence_quote} ],
  needs_review: [ {point, reason} ],
  scope_note: '本判断没有完整教案作为知识点分母；没有完整教案或知识点清单，不能计算学科知识覆盖率。'
}
```

**模型不得覆盖 `knowledge`** —— 合并层强制取规则版，模型伪造的 `covered:['逆定理']` 会被拦下。模型只能通过 `subject_knowledge` 表达学科判断，且 `evidence_quote` 必须是逐字稿原样子串。

---

## 二、改动清单

### 后端
| 文件 | 改动 |
|---|---|
| `app/lib/wait-metrics.js` | **新建**。保留标点切句 + 四层问句判定 + 防误判规则 + 等待估算 + 汇总 |
| `app/lib/analyzer.js` | 引入 `wait_metrics`；`knowledge` 加 `scheme`/`source`；`improveScriptRule` 增加七环节白名单防御；新增 `subject_knowledge`（规则分支） |
| `app/lib/engine.js` | 合并层保护 `knowledge`；`merged.wait_metrics` 取规则版；新增 `normalizeSubjectKnowledge`（证据原样校验）+ `normalizeScopeNote`（拒绝百分比） |
| `app/lib/heatmap.js` | 委托 `wait-metrics.js`；LLM 分支用 `normalizeModelWaitMoments`、规则分支用 `buildTextWaitMetrics`；`time_allocation` 加 `source` |
| `app/lib/prompts.js` | `analyzePrompt` 删除 `knowledge` 契约，改为 `subject_knowledge`；删除依赖模型产出 `cover_percent` 的评分约束；`dangerPrompt` 补「确认式提问」类型 |

### 前端
| 文件 | 改动 |
|---|---|
| `app/public/app.js` | 读 `wait_metrics`（带旧字段回退）；`waitColor` 不可测量→中性灰；`renderHeatmap` 空数组空态 + 来源标签 + 逐条来源；`weakestDims` 用 asked/genuine/fake；海报三卡改「提问设计」；**新增 `renderPhaseCue`（七环节清单）**、**新增 `renderSubjectKnowledge`（学科内容核对）**；`Number(null)===0` 修复 |
| `app/public/index.html` | 新增「🧭 通用教学环节线索」「📎 学科内容核对」两个区块；标题改名 |
| `app/public/styles.css` | 新增 `.subject-review-list`、`.phase-cue-list` 样式（含深色主题） |
| `app/public/demo-data.js` | 补 `wait_metrics`、`knowledge.scheme/source`、`subject_knowledge` |

### 测试
`app/tests/wait-contract.test.js`（新）、`app/tests/knowledge-contract.test.js`（新），`wait-metric.test.js` 扩充。

**技术栈零变更**，无新增依赖，无新增接口，无删除接口。

---

## 三、标题改名对照表

| 区块 | 改前 | 改后 |
|---|---|---|
| planBox | 📋 教案覆盖检查 | 📋 **教案逐点比对** |
| （新增） | — | 🧭 **通用教学环节线索** |
| （新增） | — | 📎 **学科内容核对**（模型提示，需人工确认） |
| curriculumBox | 📐 课标对照 | 📐 **课程目标与标准对照** |
| heatmapBox | ⏱️ 提问等待热力图 | ⏱️ **提问等待热力图**（来源标签化） |
| pieBox | 🥧 一节课的时间分配 | 🥧 **课堂活动时间估算** |
| segments | 🧩 分环节改进稿 | 🧩 **四段练习口述稿** |

> 说明：规格原表把「教案覆盖检查 → 通用教学环节线索」，但 `planBox` 实际装的是**教案知识点逐条比对**（讲透/提到/漏讲），与七环节不是同一口径。照搬会让标题自相矛盾（自己叫这个名字又说与同名区块不同口径）。已修正为：教案比对回归自己的语义，七环节另起独立区块摊开展示。

---

## 四、验收证据（主理人独立复核）

### 4.1 静态与单元
```
node --check server.js lib/*.js public/*.js scripts/*.js tests/*.js   → 全部通过
node --test tests/*.test.js                                           → tests 70 / pass 70 / fail 0
node scripts/build-standalone.js                                      → 离线版 431.2 KB
```
（基线 40 → 70 条，新增 30 条回归）

### 4.2 等待契约
```
有问号问句  moments=1  avg=2.5  source=text-heuristic
真无问句    moments=0  avg=null
陈述句      moments=0  avg=null
伪提问      moments=2  avg=0.5

一致性：analyze.wait_metrics.moments === heatmap.wait_metrics.moments  →  true
questions.avg_wait_sec = null | source = unmeasured
```

### 4.3 「等于」误触发修复（主理人逐词验证）
```
数学词（8 个，全部不再误触发 3 秒）：
  等于/不等于/等于号/等于式/a 等于 b/两边相等/等腰三角形/等边三角形  →  2.5 ✅
真等待信号（10 个，全部保留 3 秒）：
  等一等/等一下/稍等/等待/想一想/停顿/沉默/别急/慢慢来/先想想  →  3 ✅
```

### 4.4 环节语义
```
analyzeRule().knowledge：
  covered=[情境引入,知识推导,公式结论,例题讲解,小结回顾]
  missing=[课堂互动,作业布置]
  cover_percent=71  scheme=generic-seven-phase-cues-v1  source=text-keyword-rules
  covered/missing 全部 ∈ 七环节  →  true

模型污染拦截（伪造 knowledge.covered=['逆定理','面积法']、cover_percent=99）：
  合并后 covered=[情境引入,公式结论,例题讲解,小结回顾]  ← 污染被拦下
  cover_percent=57  ← 仍是规则值，不是模型的 99

改进稿防污染（missing=['逆定理','勾股定理公式','面积法','课堂互动']）：
  输出含「逆定理」        → false
  输出含「勾股定理公式」  → false
  合法项「课堂互动」补写  → true

subject_knowledge 规则分支：
  {covered:[], needs_review:[], scope_note:'离线规则模式：没有完整教案或知识点清单，不能计算学科知识覆盖率。'}
subject_knowledge LLM 分支（桩模型实测）：
  covered[0]={point:'勾股定理', evidence_quote:'今天我们学习勾股定理。'}  ← 证据经原样校验
  scope_note 强制拼接兜底说明，拒绝任何百分比
```

### 4.5 浏览器实测（无头 Edge + 同源 iframe 探针，演示模式）
```
「🧭 通用教学环节线索」：情境引入已出现线索 / 知识推导已出现线索 / … / 课堂互动未检测到线索 / …
  「共 7 个环节，其中 5 个在逐字稿里匹配到了线索。」
  「未检测到线索」只说明逐字稿里没匹配到该环节的特征表达，不等于这节课没做这个环节。
「📋 教案逐点比对」：左侧粘入教案后…这是「你贴的这份教案」的比对，与上方七环节线索不是同一口径。
「📎 学科内容核对」：已出现：勾股定理…（固定演示）/ 待核对：逆定理…
热力图：等待来源：固定演示。…｜来源：文本推断
h3 顺序：⚠️危险瞬间 → 🧭通用教学环节线索 → 📋教案逐点比对 → 📎学科内容核对 → 📐课程目标与标准对照 → ⏱️提问等待热力图
console errors: []
localStorage keys: ["jiangtai_theme"]   ← 未新增 key
```

### 4.6 措辞合规
```
「教学完成度」/「教学质量」    → 全文 0 命中
「知识点掌握率」              → 3 处，全部是否定用法（"不是知识点掌握率"）
```

### 4.7 线上验证
```
/api/analyze（Key 余额不足→规则分支）：
  engine=rule
  wait_metrics={moments:[{quote:'李同学，你说说这一步为什么这样设？',wait_sec:2.5,source:'text-heuristic'}], average_sec:2.5, ...}
  knowledge={covered:[5项], missing:[2项], cover_percent:71, scheme:'generic-seven-phase-cues-v1', source:'text-keyword-rules'}
  subject_knowledge.scope_note=离线规则模式：没有完整教案或知识点清单，不能计算学科知识覆盖率。
```

---

## 五、本批拦下并修复的缺陷

| 缺陷 | 发现方式 | 后果 | 状态 |
|---|---|---|---|
| **等待估算被「等于」误触发**（单字「等」匹配数学词） | 主理人端到端实测发现 `wait_sec` 从 2.5 变 3 | 数学课讲稿里「等于」高频，`wait_sec` 系统性偏高，点名规则被完全遮蔽 | 已修：改为上下文匹配（等一等/等一下/稍等…），8 个数学词 + 10 个真信号逐词验证 |
| **规格的 `splitSentences` 会丢问号** | 主理人调度前排查 | 照抄会回退上一批已修的问句误判 bug | 已改：模块内自包含保留标点切句 + 四层问句判定 |
| **规格标题表把教案比对误标为七环节** | 主理人 Gate 复核 | 页面自相矛盾（同名又说不同口径） | 已修：教案回归「教案逐点比对」，七环节另起区块 |
| `Number(null) === 0` 把缺值渲染成红色「0s」 | 前端成员自查发现 | 凭空造出一个结论 | 已修：显式挡空值 |
| `drill.js` 消费 `avg_wait_sec` | 主理人排查跨模块依赖 | 置 null 后专项练习会算 NaN 分 | 上一批已修，本批保持 |
| `normalizeMoment` 的 `\|\| 1` 伪造成默认值 | 同上 | 模型没给秒数时显示假的 1s | 上一批已修，本批由 wait-metrics 统一收口 |

---

## 六、已知遗留与风险

| 遗留 | 影响 | 处置 |
|---|---|---|
| **API Key 余额不足**（`AI_HTTP_402`） | 线上当前走规则分支，「学科内容核对」为空 + scope_note | **非代码问题**。充值后 LLM 分支立即恢复，无需改代码。降级行为正确 |
| 限流被误分类为「规则引擎模式」 | 模型限流（429）时用户看到「服务端规则计算」，看不到「请求过于频繁」 | 既有错误分类问题，本批未动，列入下一批候选 |
| `time_allocation` 在无提问讲稿下退化为全 0 | 前端显示「时间数据不足」 | 既有行为，本批未动，列入下一批候选 |
| `ruleTimeAllocation` / `ruleSegments` 仍把陈述句当问句 | 「互动」环节可能为空、「18 分钟」被判成「过渡」 | 上一批遗留，同根因，需单独立项验证既有口径 |
| 热力图与主分析仍是两个接口 | `analyze` 无时间戳、`heatmap` 有 LLM 分支 | 规格明确本批不动。`wait_metrics` 已统一数据生产函数，接口层仍分离 |

---

## 七、下一批候选（按优先级）

1. **修 `ruleTimeAllocation` / `ruleSegments` 的问句误判**（同上根因，影响时间分配与环节切分）
2. **限流与降级的错误分类**：把 429/402 等外部依赖故障与「无 Key 规则模式」区分开，UI 分别提示
3. `time_allocation` 无提问讲稿的退化处理（当前全 0）
4. 抽出 `lib/wait-metrics.js` 的时间戳路径（`source:'timestamp'`），接入真实音频时间戳后启用 `questions.avg_wait_sec` 实测值

---

## 八、养护说明

- **启动**：`cd app && node server.js`（默认 3000 端口）
- **测试**：`cd app && npm test`（当前 70 条）
- **重建离线版**：`cd app && node scripts/build-standalone.js`
- **离线版用法**：必须带 `?jtq-demo=1`（不带会提示「无法连接服务端」——这是上一批既定设计，正常训练失败不降级为示例数据）
- **等待字段约定**：
  - `wait_metrics.moments[].source`：`text-heuristic` / `model-inference`
  - `wait_metrics.source`：同上 + `timestamp`（预留）/ `unmeasured`
  - `wait_metrics.average_sec`：无有效值时为 `null`
  - `questions.avg_wait_sec`：恒为 `null`（演示除外）
  - 旧字段 `wait_moments` / `wait_source` / `wait_note` 保留兼容
- **环节字段约定**：
  - `knowledge.covered/missing` **只含七环节**：`情境引入` `知识推导` `公式结论` `例题讲解` `课堂互动` `小结回顾` `作业布置`
  - `knowledge.scheme` = `generic-seven-phase-cues-v1`，`source` = `text-keyword-rules`
  - 学科内容只走 `subject_knowledge`，**不参与 `cover_percent`**
  - `segments` 永远四段，`time_allocation.source` = `text-heuristic`
- **演示模式**：`?jtq-demo=1`，不发网络请求、不写 localStorage、不污染轨迹/徽章/报告/排行榜
