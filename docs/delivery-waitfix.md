# 讲台求生 · 等待指标口径修正交付清单

> 交付日期：2026-10-25｜交付总监：岳上线（主理人）
> 批次主题：统一等待指标口径 —— 文本推断值不得冒充实测值，也不得作为扣分依据
> 线上链接：https://jiangtai-survival.app.workbuddy.host/?sharecode=2WZXYSXJ6D
> 固定演示：https://jiangtai-survival.app.workbuddy.host/?sharecode=2WZXYSXJ6D&jtq-demo=1

---

## 一、本批做了什么

**核心语义**：没有音频时间戳时，真实等待时间**不可测量**。文本启发式推算的等待秒数只能作为「逐次文本推断值」展示并显式标注，**不能**：
1. 以「平均实测等待」的形式出现在普通报告里；
2. 参与任何评分扣减；
3. 作为「最弱维度」判断依据；
4. 出现在危险瞬间的原句里（因为那不是讲稿原句）。

**统一后的字段口径**：

| 场景 | `avg_wait_sec` | `source` / `wait_source` | 说明 |
|---|---|---|---|
| 普通分析（规则） | `null` | `'unmeasured'` | 不可测量 |
| 普通分析（LLM） | `null`（强制覆盖模型输出） | `'unmeasured'` | 不可测量 |
| 热力图（逐次） | 每条独立值或 `null` | `'text-inferred'` | 文本推断，逐条标注 |
| 固定演示 | 示例秒数 | `'offline-demo'` | 明确标注「示例」 |

**保留 `avg_wait_sec` 字段名但改值**，不删字段，避免旧历史记录与旧渲染函数崩溃。

---

## 二、改动清单

### 后端
| 文件 | 改动 |
|---|---|
| `app/lib/analyzer.js` | 等待估算改为内部参考 `waitEstimate`；删除 `score -= avgWait<2?10:avgWait<3?5:0`；删除基于 `avgWait` 的建议块；`questions` 返回 `avg_wait_sec:null` / `source`+`wait_source`:'unmeasured' |
| `app/lib/engine.js` | LLM 合并时强制 `avg_wait_sec: null` + `'unmeasured'`；`dangerMoments()` 改为「确认式提问」判定（依据 asked/fake_questions，不含秒数） |
| `app/lib/prompts.js` | 评分标准删除「等待 ≥3 秒，不足 2 秒重点扣分」，改为按提问设计评价；`dangerPrompt` 的 type 枚举补「确认式提问」 |
| `app/lib/export.js` | PDF 提问行改读 `asked`/`genuine_questions`，兼容旧记录 `total`/`authentic` |
| `app/lib/drill.js` | 等待维度改用文本证据（asked/genuine/fake + 等待标记），不再依赖 `avg_wait_sec`；`metrics.avg_wait_sec` → `null` + `wait_source:'unmeasured'`；维度 key 未动（冻结） |
| `app/lib/heatmap.js` | 逐次条目带 `source:'text-inferred'`；「整段未检测到提问」条目 `wait_sec: null` + 中性文案；`normalizeMoment` 缺值 → `null`（不再默认 1）；`wait_source:'text-inferred'` |
| `app/tests/wait-metric.test.js` | **新增**，永久回归测试 |

### 前端
| 文件 | 改动 |
|---|---|
| `app/public/app.js` | `waitColor()` 不可测量 → 中性灰 `#64748b`；`renderHeatmap(moments, meta)` 读 `meta.wait_note`、图例改「文本推断」、新增灰色「无法测量」项、无提问显「?」；调用方传 `data`；`weakestDims()` 改用 asked/genuine/fake 三值判定；海报三卡改「提问设计 / 候选思考题 N 次」；指标卡等待项区分演示与正常 |
| `app/public/cloud.js` | 云端详情提问行改读 `asked`/`genuine_questions`，兼容 `total`/`authentic` |
| `app/public/demo-data.js` | `DEMO_ANALYSIS.questions` 补 `fake_questions`/`source`/`wait_source`/`note`；`DEMO_HEATMAP` 补逐条 `source`；`DEMO_DRILL_RESULT` 去掉「平均留白 1.4 秒」表述 |

**技术栈零变更**，无新增依赖，无新增接口。

---

## 三、验收证据（主理人独立复核，非成员自述）

### 3.1 静态与单元
```
node --check server.js lib/*.js public/*.js scripts/*.js tests/*.js   → 全部通过
node --test tests/*.test.js                                           → tests 40 / pass 40 / fail 0
node scripts/build-standalone.js                                      → 离线版 414.8 KB
```

### 3.2 等待口径（规则 + LLM 双路）
```
规则 analyzeRule：
  avg_wait_sec = null | source = unmeasured | wait_source = unmeasured
  asked/genuine/fake = 1 / 1 / 0
  建议含秒数? false

LLM analyze（真实 deepseek-chat）：
  avg_wait_sec = null | source = unmeasured | wait_source = unmeasured
  asked=3 genuine=1 fake=2
  建议含秒数? false
  note = 当前输入没有可靠音频时间戳，无法测量真实提问等待时间。热力图中的逐次等待值属于文本推断。
```

### 3.3 评分不再因等待秒数变化
构造三段讲稿（仅提问部分不同，其余一致）：
```
无提问        score=64  asked=0 fake=0 genuine=0  wait=null
含3个伪提问   score=71  asked=3 fake=3 genuine=0  wait=null
含1个开放提问 score=85  asked=1 fake=0 genuine=1  wait=null
```
等待估算已完全退出评分链，分数只由 asked/genuine/fake 决定。

### 3.4 危险瞬间不再用秒数
```
type=口头禅扎堆 | quote=（"然后" 出现 1 次）
type=确认式提问 | quote=讲稿中存在 2 个确认式提问   ← 含秒数=false
无提问讲稿：不再产出等待类风险
```

### 3.5 热力图（规则分支，主理人独立复验）
```
有提问（"李同学，你说说这一步为什么这样设？"）
  → [{"q":"李同学，你说说这一步为什么这样设？","w":2.5,"src":"text-inferred"}]
无提问（真无问句）
  → [{"q":"（整段未检测到提问）","w":null}]        ← 中性态
陈述句（含"那么"，易误判）
  → 仍为「整段未检测到提问」，未被误判
wait_source = text-inferred
wait_note = 本图每条等待秒数都是文本推断值：…不是音频时间戳实测值；模型未给出可用秒数的条目一律标为不可测量（null）
```

### 3.6 浏览器实测（无头 Edge + 同源 iframe 探针，演示模式）
```
热力图图例：文本推断偏短 / 文本推断中等 / 文本推断有留白 / 文本推断口径的固定演示示例值（示例）
中性色存在（#64748b）: true
提示语读的是后端 wait_note: ✓
指标卡：示例等待 1.1 秒（示例）｜固定示例等待值，非当前讲稿实测。
        文本提问 2 次｜"真提问"候选值：0；仅为启发式或模型分类，不代表有效互动。
console errors: []
localStorage keys: ["jiangtai_theme"]   ← 未新增 key，护栏完好
```

### 3.7 海报不溢出（canvas 实测，非目测）
```
canvas 540×960，卡片内宽 148-20=128px
"168 字/分"      → 23px  w=106/128
"1.1 秒"         → 23px  w=65/128
"3 次"           → 23px  w=44/128
"未提供"         → 23px  w=69/128
"候选思考题 2 次" → 17px  w=123/128
allFit = true
```

### 3.8 线上验证（发布后）
```
/api/analyze  → avg_wait_sec=null, source=unmeasured, wait_source=unmeasured
/api/heatmap  → wait_source=text-inferred, moments=[{"q":"李同学…","w":2.5}]
```

---

## 四、本批拦下并修复的缺陷

| 缺陷 | 发现方式 | 后果 | 状态 |
|---|---|---|---|
| **规则分支把有问句讲稿误判为「整段未检测到提问」** | 主理人独立复验规则分支时发现 | 本批把「无提问」改为中性态后，**有提问的课会显示成「无法测量」**，比原来更误导 | 已修：保留问号判定依据 + 覆盖「你说说/为什么/怎么/哪」等无问号问句；陈述句不误判 |
| `lib/drill.js` 消费 `avg_wait_sec` | 主理人调度前排查跨模块依赖 | `avg_wait_sec` 置 null 后专项练习等待维度会算出 NaN 分 | 已修：改用文本证据判定 |
| `normalizeMoment` 的 `\|\| 1` 把缺失值伪造成 1 秒 | 同上 | 模型没给秒数时前端显示假的「1s」 | 已修：缺值 → `null` |
| 演示模式 `avg_wait_sec` 恒 null 会让指标卡退化 | 主理人发现规格遗漏 | 演示时「示例等待」不再显示 | 已修：演示走内置 DEMO 兜底 + 「（示例）」标注 |
| `DEMO_DRILL_RESULT` 的「平均留白 1.4 秒」 | 前端成员自查发现并主动上报 | 演示数据里残留把平均等待当实测值的表述 | 已改（主理人批准保留该规格外改动） |

---

## 五、已知遗留与风险

| 遗留 | 影响 | 处置 |
|---|---|---|
| **时间分配与环节切分仍把陈述句当问句**（`ruleTimeAllocation` / `ruleSegments` 与 `ruleWaitMoments` 同根因） | 「互动」环节可能为空、「18 分钟」被判成「过渡」 | **不在本批**。属独立议题，需单独验证既有口径；已列入下一批候选 |
| 热力图与主分析仍是两个接口 | 两者的等待数据不同源 | 规格明确本批不动。若要统一，需抽出 `app/lib/wait-metrics.js` 供两者共用规则生产函数，模型推断仍须单列 |
| 规则引擎的长停顿仍标 `text-heuristic` | 不是「无法测量」 | 本批按规格保留；后续可改为「文本停顿线索」 |
| LLM 分支可能把陈述句判为提问 | 热力图出现非提问条目 | 模型行为，本批仅保证每条都有 `source` 标注 |

---

## 六、下一批候选（按优先级）

1. **修 `ruleTimeAllocation` / `ruleSegments` 的问句误判**（同一根因，影响时间分配与环节切分两个既有模块）
2. 抽出 `app/lib/wait-metrics.js`，让 `analyzer.js` 与 `heatmap.js` 共用逐次等待的规则生产函数
3. 长停顿字段改标「文本停顿线索」，与「不可测量」区分
4. 统一 `analyze` 与 `heatmap` 的等待数据源

---

## 七、养护说明

- **启动**：`cd app && node server.js`（默认 3000 端口）
- **测试**：`cd app && npm test`（当前 40 条）
- **重建离线版**：`cd app && node scripts/build-standalone.js`
- **新增/修改接口约定**：成功 `{ok:true,data}`，失败 `{ok:false,error}`；`data.engine` 必标 `llm`/`rule`
- **等待字段约定**：`questions.avg_wait_sec` 恒为 `null`（演示除外）；`questions.source`/`wait_source` = `'unmeasured'`；热力图逐次条目 `source` = `'text-inferred'`，不可测量项 `wait_sec` = `null`
- **演示模式**：`?jtq-demo=1`，不发网络请求、不写 localStorage、不污染轨迹/徽章/报告/排行榜
