# 讲台求生 · EAB 增量交付清单

> 交付日期：2026-10-23｜交付总监：岳上线（主理人）
> 增量内容：E 教学任务与学情配置 → A 学情驱动 AI 学生 → B 3 分钟专项技能练习
> 线上链接：https://jiangtai-survival.app.workbuddy.host/?sharecode=2WZXYSXJ6D
> 固定演示：https://jiangtai-survival.app.workbuddy.host/?sharecode=2WZXYSXJ6D&jtq-demo=1

---

## 一、交付内容

### E. 教学任务与学情配置
- 位置：`section#trainingInput` 内 `details#teachingConfig`（19 个控件，id 见规格 §1.2）
- 存储：`localStorage['jtq_profile']`，纯本机，不进云端、不进排行榜
- 教学任务：课题、课时类型（6 档）、教学目标/重点/难点（各 ≤5 条）、评价方式、计划课时
- 学情：班级水平（4 档）、已学前置知识、常见错误、班级规模、课堂活跃度
- 折叠摘要 chip 显示「已配置：课题、课型、班级水平」；未配置时显示「未配置学情（使用默认班级画像）」
- 字段变更即时保存，不设必经提交关

### A. 学情驱动 AI 学生
- `/api/student/chat` 与 `/api/classroom/round` 新增**可选** `profile` 字段
- 学情注入 AI 学生 prompt：提问难度（basic/core/advanced）、卡点落点（命中用户填写的「常见错误」）
- 三学生课堂基线随学情浮动；`state_reason` 追加学情后缀
- 响应新增 `profile_applied` / `difficulty` / `profile_summary` / `profile_effect` / `students[].base_state`
- **向后兼容**：不带 profile 时 prompt 与基线与改造前逐字/逐值相同（回归测试已断言）

### B. 3 分钟专项技能练习
- 新增 tab `pane-drill`（`button.tab[data-tab="drill"]`）
- 新增接口：`GET /api/drill/skills`（五技能清单）、`POST /api/drill`（评分）
- 五技能：提问与等待 / 语速与口头禅 / 板书结构 / 导入设计 / 过渡衔接
- 真倒计时 180 秒（`Date.now()` 差值，不数 tick），归零仍可提交
- 分档：≥85 优秀 / 60–84 合格 / <60 需改进
- 结果只归档本机成长档案（`localStorage['jtq_drill_records']`），**不进排行榜、不进云端**

---

## 二、改动清单

### 新增文件
| 文件 | 作用 |
|---|---|
| `app/lib/profile.js` | 学情权威定义：枚举中文映射、默认画像、归一化、派生参数、提问池分档 |
| `app/lib/drill.js` | 五技能定义、规则兜底评分、LLM 结果证据校验 |
| `app/tests/eab-profile-drill.test.js` | 19 条 node:test 用例 |
| `docs/site-spec-eab.md` | 冻结的增量站点规格卡（唯一事实来源） |
| `docs/content-eab-draft.md` | 冻结的界面文案 |

### 修改文件
| 文件 | 变更 |
|---|---|
| `app/server.js` | 新增 2 条路由；2 个接口透传 profile；并发闸门 + sharecode 网关 + 讲稿长度上限 |
| `app/lib/engine.js` | studentChat/classroomRound 支持 profile；新增 drill/drillSkills/profileDefaults |
| `app/lib/prompts.js` | 新增 profileContextBlock、drillPrompt；两处 prompt 追加式注入学情 |
| `app/public/index.html` | 新增 `details#teachingConfig`、`pane-drill`、pane-chat 内 5 个状态容器 |
| `app/public/app.js` | Profile 读写/归一化/透传、专项练习渲染、演示护栏 |
| `app/public/styles.css` | `.cfg-*` / `.drill-*` 样式，沿用既有视觉变量 |
| `app/public/demo-data.js` | 新增 5 个 DEMO key |
| `讲台求生-离线版.html` | 重建（408 KB） |

**技术栈零变更**：仍为 Node.js 零依赖后端 + 原生 HTML/CSS/JS，无 npm 包、无框架、无构建链。

---

## 三、验收证据（主理人独立复核，非成员自述）

### 3.1 静态与单元
```
node --check server.js lib/*.js public/*.js scripts/*.js tests/*.js   → 全部通过
node --test tests/*.test.js                                           → tests 26 / pass 26 / fail 0
node scripts/build-standalone.js                                      → 生成离线版 408.2 KB
```

### 3.1b 维度 key 体系一致性（专项收尾项）
五个技能的 `dimensions[].key` 在**规则路径与 LLM 路径下完全一致**：
```
question_wait     question_design, wait_time, wait_marker, fake_question
pace_filler       speech_rate, filler_count, filler_density
board_structure   board_signal, structure_marker, coverage, missing_knowledge
intro_design      intro_signal, intro_hook, intro_length, concrete_example
transition        transition_marker, coverage, coverage_penalty, closing
```
实测 `两路一致: true`（LLM 返回 `density/wait/marker/fake` 等模型自定 key，经 `mapToCanonicalKey` 三级映射后与规则路径逐字相同）。

### 3.2 契约符合度
- 规格 §1.2 的 **49 个 DOM id 逐条核对，零缺失**
- 规格 §2.3 归一化实测：非法枚举回落默认、数组裁到 5 条、每条裁到 60 字、size 999→80、durationMin 999→180
- 规格 §2.5 派生参数实测：weak/basic/good/excellent 四档 difficulty/askDepth/Δ 全部吻合；activity 系数 high=1.15（0.55→0.6325）、size=80 时走神学生 Δ 额外 −2
- 规格 §3.5 错误码实测：缺 skill→400、短稿→400、未知 skill→404

### 3.3 向后兼容（最大风险项）
```
不带 profile：base_state = {52,62}/{88,90}/{42,35}  ← 与原 STUDENT_STATE_BASE 逐值相同
level=weak ：base_state = {44,50}/{44,50}/{29,23}  ← 专注均 ≤44、理解均 ≤50
level=excellent：{58,68}/{94,96}/{48,41}，difficulty 小霸=advanced / 小走=basic
```

### 3.4 学情真实生效（真实 LLM，同一提问对比）
```
不带学情：学霸型问「钝角三角形是不是也能套？」      ← 原理/变式，difficulty=core
弱班学情：问「a是不是那条斜边的斜率啊？」            ← 直接命中配置的常见错误，difficulty=basic
```

### 3.5 防伪造
- `evidence[].quote` 五技能实测 100% 为讲稿原样子串（`indexOf` 校验，规则与 LLM 两路都做）
- `dimensions[].evidence` 为统计描述（如「当前 33 字/分」）而非引文，不冒充原句
- 规则兜底时 `engine='rule'` + `source_note` 明示「本地规则判定」，UI 显示来源标签

### 3.6 浏览器实测（无头 Edge + 同源 iframe 探针）
```
演示模式 localStorage 实际内容：["jiangtai_theme"]     ← 无 jtq_profile / jtq_drill_records，未污染
正常模式保存 → localStorage['jtq_profile'] 结构完全符合规格 §2
刷新回填    → level/activity/size/errors/topic 全部正确恢复
状态联动    → chip「已配置：二次函数、新授课、优秀」
              soloNote「提问难度基线：advanced，学生更可能卡在：把a当成斜率」
              classTag「学情已生效」
技能卡渲染  → 5 张
```

### 3.7 线上验证（发布后）
```
/api/health            → aiMode:"live"，deepseek-chat
/api/drill/skills      → 5 技能，default_skill=question_wait，duration_sec=180
/api/drill (POST)      → score/grade/summary/dimensions 真实返回
线上演示页              → 正常渲染，标注「演示模式：以下为演示数据」
线上正常页              → pane-drill / teachingConfig / cfgClassLevel 均在
并发闸门                → 连打 5 次 /api/drill 全部 HTTP 200，耗时 4.6–4.8s 无递增
```

---

## 四、过程中拦下的缺陷（已修复并复验）

| 缺陷 | 发现方式 | 后果 | 状态 |
|---|---|---|---|
| `server.js` 语法错误：并发闸门把 `try/catch/finally` 嵌套写坏，`finally` 挂到 `catch` 后 | 主理人独立跑 `node --check`（成员自述「通过」为假） | **服务完全起不来** | 已修复并复验 |
| 闸门 `releaseHeavy()` 可能漏释放 | 同上 | 后续请求永久挂起 | 已挂到最外层 `finally`，连打 5 次验证 |
| `res.headersSent` 后再写响应头 | 同上 | ERR_HTTP_HEADERS_SENT | 已加防护 |
| 规格 §2.5 韩文笔误「点명」 | 主理人读规格时发现 | 语义错误 | 已修正为「需点名」 |
| 规格内部矛盾 3 处（未知 skill 错误码、过短文案、weak 档基线上限） | 复核时发现 | 实现分歧 | 已拍板并写入规格 |
| 前端 DEMO key 缺口（5 个） | 后端交接时发现，前端未覆盖 | 演示模式新功能不可用 | 已补齐并实测 |
| `dimensions[].key` 两套命名体系（规则用内部 key、LLM 用模型自定 key） | 主理人实测发现，后端首轮只映射了 LLM 路径 | 聚合历史会静默拿到脏数据 | 已统一为规范 key，两路实测一致 |
| `server.js` 并发闸门 `try/catch/finally` 嵌套写坏 | 主理人独立 `node --check`（成员自述通过为假） | 服务完全起不来 | 已修复；另新增 `server-boot-gate.test.js` 启动回归 |

---

## 五、已知风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| 学情仅存本机，不跨设备 | 换设备需重填 | 后续增量可复用 `cloud.js` 做同步 |
| 专项练习记录仅本机，不进排行榜 | 无公开榜单激励 | 有意为之：微练习分掺入会污染榜单可比性 |
| 板书结构技能只评讲稿陈述，不做图像识别 | 板书画面质量不在评分内 | 图像评分仍走既有 `/api/blackboard` |
| 等待/停顿仍为文本启发式，非音频实测 | 等待秒数为推断值 | 沿用既有 `source:'text-heuristic'` 标注，UI 明示 |
| 学情不影响 `/api/analyze` 复盘报告 | 复盘分与学情无关 | 有意为之：避免改变既有评分口径，需另立增量并重测 |

---

## 六、后续可做（不阻塞上线）

1. 学情云端同步（复用 `cloud.js`）
2. 专项练习记录进成长档案曲线，做技能雷达图
3. 按短板自动生成 7 天训练计划
4. 语音输入接入专项练习
5. 学情影响复盘报告（需先重测评分口径）
6. 板书结构技能接入图像识别

---

## 七、养护说明

- **启动**：`cd app && node server.js`（默认 3000 端口，`PORT` 可覆盖）
- **测试**：`cd app && npm test`
- **重建离线版**：`cd app && node scripts/build-standalone.js`
- **密钥**：仅在 `app/.env` 的 `AI_API_KEY`，禁止 `NEXT_PUBLIC_` 前缀，禁止出现在任何前端文件
- **无 Key 行为**：自动降级本地规则引擎，UI 显示「本地规则判定」，不伪造 LLM 结果
- **演示模式**：`?jtq-demo=1`，不发网络请求、不写 localStorage、不污染轨迹/徽章/报告/排行榜
- **新增接口约定**：请求 `Content-Type: application/json`，成功 `{ok:true,data}`，失败 `{ok:false,error}`；`data.engine` 必标 `llm`/`rule`
