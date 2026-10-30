# 发布上线交接单

> 给任何一次新对话、任何一个账号用。照着做即可，不依赖聊天记录。

## 一、当前状态（2026-10-29 已更新）

| 项目 | 状态 |
|---|---|
| 线上站点 | **在线，且为最新版 m5**（2026-10-30 13:52 发布成功，含 v2 量规 + 2D 教室） |
| 线上地址 | `https://jiangtai-survival.app.workbuddy.host/?sharecode=2WZXYSXJ6D` |
| 已上线内容 | `workbench.html`、等待指标契约、七环节语义、问句/互动拆分、`fallback_reason` 全量透传 |
| 上线前回归 | `node --test tests/*.test.js` → **348/348 全过**；`e2e-fallback-reason.js` → **E2E ALL PASS** |
| 模型状态 | DeepSeek 余额已恢复，线上 `/api/ifias` 实测 `engine:"llm"` |
| 应用 ID | `wbapp_G19b8uinF8NS1zn0yxJPYR`（同时绑定云服务三张表） |

## 二、历史阻断（均已解除，留档备查）

### 1. 发布账号不匹配（已于 2026-10-29 解除）

曾在 10-28 报 `SITES_ACCOUNT_MISMATCH`（应用属于另一账号）。10-29 发布实测成功，说明账号已切回原账号。
若未来再报此错：设置 > 数据管理 > 应用，看列表里有没有《讲台求生 · AI试讲教练》。

### 2. DeepSeek 余额不足（已于 2026-10-29 前解除）

曾返回 `AI_HTTP_402: Insufficient Balance` 并自动降级规则引擎。10-29 线上实测 LLM 调用成功。
注意 `/api/health` 只查 Key 存在不查余额，`"aiMode":"live"` 不等于能调通；判断以真实调用 `engine` 字段为准。

## 三、线上页面清单（2026-10-29 全部上线，实测 200）

| 路由 | 文件 | 用途 |
|---|---|---|
| `/?sharecode=…` | `public/index.html` | 主站（试讲复盘工作台） |
| `/landing.html` | `public/landing.html` | 落地页 |
| `/workbench.html` | `public/workbench.html` | 微格教学训练工作台（纯静态） |
| `/offline.html` | `public/offline.html` | **离线单文件版**（491KB，断网演示用） |
| `/awards.html` | `public/awards.html` | 奖项与赛事检索清单 |
| `/promo/sketch-1.html` | `public/promo/sketch-1.html` | 设计方向A 复盘报告（草稿） |
| `/promo/sketch-2.html` | `public/promo/sketch-2.html` | 设计方向B 巨型数字（草稿） |
| `/promo/sketch-3.html` | `public/promo/sketch-3.html` | 设计方向C 斜切拆台（草稿） |

注意事项：

- 所有页面都走 **sharecode 网关**，不带 `?sharecode=2WZXYSXJ6D` 会返回「链接不完整」页（不是 404，也不是故障）。
- `promo/` 三个草图依赖 jsdelivr 的 Noto 字体 CDN，断网时会掉字体但不影响布局；它们是设计草稿，未从任何导航入口链接。
- `讲台求生-三学生资产脚本/output/*.glb`（9 个）**页面尚未引用**，因此未上线，不构成 404 风险。

## 四、特效层 fx.js（2026-10-29 新增）

主站首页加载 `public/fx.js`，三件事，全部零依赖：

| 特效 | 实现 | 性能护栏 |
|---|---|---|
| 粉笔灰粒子 | 全屏 canvas，24–64 粒自适应，靛蓝/青/天蓝三色 | DPR 封顶 2 倍；连续 90 帧 >26ms 降到 12 粒，再掉帧直接关闭 |
| 背景极光 | 三层 `radial-gradient` + 滚动位移 | 只改 `transform`，不触发重排 |
| 卡片 3D 倾斜 | 最多 4.5°，rAF 插值回正 | 仅 `pointer: fine` 设备启用 |

关闭条件：`prefers-reduced-motion: reduce`、打印、页面进入后台（`visibilitychange` / `pagehide`）。

**拆台高光（2026-10-29 第二轮）**：`question-drill.js` 的 `appendMessage()` 在模拟学生开口时抛
`jtq:student-strike` 事件（业务侧只此 1 行，未加载 fx.js 时静默跳过）。fx.js 收到后：
全屏红闪（径向渐变，约 300ms 衰减）+ 该条消息卡片抖动 0.58s + 28 粒爆散（0.7s 内衰减清空）。
只抖消息卡片不抖 body —— 抖 body 会让所有 `position:fixed` 元素错位。

回归测试：`tests/fx-layer.test.js`（8 例，用 DOM 桩真跑脚本，覆盖挂载 / 降级 / DPR 封顶 /
动效偏好 / 红闪与抖动 / 爆散自动清空）。
离线单文件版已内联 fx.js（`build-standalone.js` 的 `LOCAL_SCRIPTS` 已加入）。

## 四之二、特效层为什么「上线了却看不见」（2026-10-29 复盘）

用户反馈「怎么感觉页面没有变化」，查出**三个叠加的接线断点**，都不是脚本写错：

| # | 断点 | 表现 | 修法 |
|---|---|---|---|
| 1 | `styles.css` 的 `?v=` 从 10-22 起从未变更 | 新加的特效 CSS 在浏览器缓存里不存在，`#fxCanvas` / `#fxAurora` 没有定位规则 | 特效样式抽成独立 `fx.css`，与 `fx.js` 共用版本号 `20261029-fx3`，两者由测试强制一致 |
| 2 | `landing.html` 有 `html, body{background:#DBEAFE!important}` | **html 一旦自带背景，body 背景就不再向上传播到 canvas**，body 自己绘制不透明底色，把 `z-index:-1/-2` 的图层整层遮住 | `fx.css` 用 `html{background-color:transparent!important}` 让出背景（同特异性、后加载者胜），视觉与原来完全一致 |
| 3 | `landing.html` / `workbench.html` 根本没引 fx | 这两个页面一点特效都没有 | 两页各加 `fx.css` + `fx.js`（外链，不改其内联样式），`fx.css` 必须排在内联 `<style>` 之后 |

**同时调亮了可感知度**（原参数在 #DBEAFE 浅蓝底上肉眼几乎看不出）：

| 参数 | 原值 | 现值 |
|---|---|---|
| 粒子密度 | 面积 ÷ 26000，夹 24–64 | 面积 ÷ 13000，夹 40–110 |
| 粒子半径 | 0.6–2.1px | 0.9–3.1px |
| 粒子 alpha | 0.08–0.26 | 0.20–0.46 |
| 极光 alpha | 0.11–0.13 | 0.26–0.30 |
| 极光动感 | 仅随滚动位移 | 叠加 2.6s 周期呼吸（`Math.sin(t/2600)`），不滚动也能看出在动 |
| 卡片倾斜 | 4.5° | 6.5° |

回归护栏：`tests/fx-wiring.test.js`（12 例）锁死「三页面都接线 / fx.css 在内联 style 之后 / 版本号成对 / styles.css 不重复定义 / 粒子密度夹逼 40–110」，
以后任一处断裂都会直接测试失败，不会再靠人眼发现。

## 四之三、材质 / 动效 / 组件状态三层（2026-10-29 新增）

用户要求「毛玻璃、柔阴影、渐变网格、颗粒纹理 + 动效呼吸感 + 3D + 组件系统」。
对照 taste-skill（反 AI 生成感规范，247 站实测）后做的裁决：

| 用户要的 | taste-skill 立场 | 本站做法 |
|---|---|---|
| 毛玻璃 | 禁（glow/glass/backdrop-blur 是 AI 味头号痕迹） | **只给 4 类浮层**（顶栏/弹窗/下拉/Toast），正文卡片一律不透明 |
| 柔阴影 | 禁（低分站 48% vs 高分站 24%） | 分三级，静止卡片 `--elv-1` 几乎无影，只有浮层用 `--elv-3` |
| 渐变网格 | 禁（低分站 52% vs 高分站 22%） | 三团 radial-gradient，alpha ≤ .075，**不写底色**（保住各页原配色） |
| 颗粒纹理 | 禁（无限循环且无开关） | SVG feTurbulence，alpha .05，**`.no-texture` 一键关闭** |
| 弹性动画 | 禁 overshoot（99 站只跑过 2 个） | 用 expo-out 的急停感代替回弹 |
| 漂浮几何体 / Three.js | 禁 floating shapes | **不引 Three.js**（~600KB、离线失效），粒子层加深度视差 |
| 组件系统 + 状态反馈 | 完全支持 | 全力做，这是「像正经产品」的核心 |

**三个新文件**

| 文件 | 内容 |
|---|---|
| `public/material.css` | 圆角收敛 4 档（原来散落 8 种）、三级高程、浮层毛玻璃、颗粒+网格、`.no-texture` 总开关 |
| `public/motion.css` | 实测 token（expo/quint/in-out 曲线、140/180/240/800ms）、滚动渐入、按压反馈、数字滚动、骨架屏 |
| `public/ui.css` | 按钮 5 状态（含 `btn-loading`）、输入 error/hint、空态、Toast、进度条、`sr-only` |
| `public/motion.js` | IntersectionObserver 渐入（自动挂区块、只播一次、首屏不等待）、数字滚动、MutationObserver 补挂异步内容 |

**三条安全底线（由测试锁死）**

1. 隐藏态全部在 `html.js` 之下 —— 脚本没跑，内容照常可见，不会白屏；
2. `prefers-reduced-motion: reduce` → motion.js 直接 return，不注册任何观察者；
3. 不引任何外部库，`@import` 与 http 外链由测试禁止。

**层叠顺序（错一位材质就盖不住）**：`styles.css → fx.css → material.css → motion.css → ui.css`

回归：`tests/material-motion.test.js`（16 例）。基线 201 → **217/217**。
离线版重建 535,034B，三层样式与 motion.js 全部内联。

## 四之四、报告卡片逐张渐入 + 标题行升起 + 粒子深度视差（2026-10-29 第二轮）

三项一起做，共同点：**都是「看起来没生效」的同一类问题——元素在错误的时机被标成已入场**。

### B · 报告卡片不再「整块闪一下」

根因有两条，都在 `motion.js`：

| # | 问题 | 后果 |
|---|---|---|
| 1 | `#resultBody` 初始 `hidden`，但扫描时不判可见性 | 卡片在隐藏状态下就被标 `is-in`，等报告出来时过渡早已播完，等于没有动画 |
| 2 | 面板内有 ≥2 张卡片时，只给面板挂 reveal | 整块淡入一次，卡片各自不动 |

修法：

- `visible(el)` 用 `getClientRects().length` 判可见，隐藏容器的元素**不挂隐藏态**，等它可见再挂；
- `collect()` 改成两趟：先找面板，面板内有 ≥2 张卡片就**下沉**（面板自己不淡入，卡片逐个入场）；第二趟只留最外层；
- `MutationObserver` 增加 `attributes` 监听（`hidden` / `class`），报告出箱、切 tab 都会触发补挂；
- 新增 `hasMountedCard()`：已下沉过的面板永不再挂 —— 否则二次扫描时「卡片已挂载 → 下沉判定为空 → 面板被挂隐藏态」，内容会二次闪动；
- 错峰 `--rv`（0–8 档 × 45ms）写进 `motion.css` 的 transition-delay。

### C · 标题遮罩行升起

`motion.css` 里早就有 `[data-lines] .line` 的规则，但**没有 JS 去拆行**，所以一直没生效。

- `splitLines()` 用逐字符探针测实际断行位置，再包成 `.line > span`，写 `--i`；
- 拆完必须**隔一帧**再加 `is-in`，同帧加上等于起止态同时成立，动画不会播；
- 只拆**纯文本**标题（`el.children.length === 0`）：landing 的双语 `.i18n-en/.i18n-zh` 一旦被 `textContent` 拍平，语言切换直接失效；
- 160 字以上不拆（避免几百个 span）；
- 也因此**没有**写 `[data-lines]{display:block}`：那是同特异性的属性选择器，会在 motion.css 后加载时把 landing 隐藏的语言顶出来。
- 接入：`index.html` 的 `#workspaceHeading`、`workbench.html` 的 `<h1>`。

### D · 粒子深度视差（不引 Three.js）

每颗粒子新增 `z ∈ [0.25, 1]`，半径 / 亮度 / 飘速 / 位移幅度全部按 z 缩放：

- 视差来源从「整个画布 `ctx.translate`」改成**逐粒位移** —— 整体平移所有点同幅移动，眼睛读不出纵深；
- 鼠标横向 ×36、纵向 ×22、滚动 ×0.07，均乘 z；
- 滚动位移用取模接回（`((oy+28)%span+span)%span-28`），长页面滚两屏粒子也不会全跑光。

**回归**：`tests/motion-report.test.js`（9 例，DOM 桩真跑 motion.js）+ `tests/fx-layer.test.js` 扩到 11 例（+3 例深度视差）。基线 217 → **229/229**。
离线版重建 542,493B（529.8 KB）。版本号统一 `?v=20261029-m2`（fx.css 与 fx.js 必须成对，由测试锁死）。

## 四之五、三个 skill 到底落成了什么（2026-10-29，含模板溯源）

用户追问「你利用上那几个 skill 里的模板了吗」。**诚实的答案是：taste-skill 的规范用了，
react-bits 的源码模板搬了，GSAP 的库没引。** 逐项对照如下。

### 真正从模板搬过来的东西

| 来源 | 具体内容 | 落在哪 |
|---|---|---|
| React Bits `AnimatedList`（registry 源码 `AnimatedList-JS-CSS`） | 29 点 `linear()` 弹簧曲线，峰值 **1.0828**（约 8.3% 过冲后收敛） | `msg.css` 的 `--rb-spring` |
| 同上 | `transform 620ms spring / opacity 300ms cubic-bezier(.22,1,.36,1)` | `msg.css` 入场过渡 |
| 同上 | 位移模型 `slide: translate3d(0,±28px,0) scale(.98)`、`fade: translate3d(0,±4px,0)` | `msg.css` 三种方向（学生上浮 / 教师右进 / 系统淡入） |
| 同上 | `stagger` 默认 `0.05s` | `msg.js` 错峰 50ms；同时把 `motion.css` 的报告卡片错峰从 45ms **改成 50ms**，两处节奏统一 |
| React Bits `TextType`（`TextType-JS-CSS`） | `cursorStyle=bar` 光标形状、`cursorBlinkDuration=0.5s`、`hold=0.7×dur`、`fade=0.45×dur`、`sine.inOut` | `msg.css` 的 `.msg-caret` |
| taste-skill `references/motion.md` | Awwwards 99 站实测的曲线与时长（按压 140ms / hover 180ms / 显现 800ms）、overshoot 禁令 | `motion.css` 全套 token |
| taste-skill `references/app-screens.md` | 组件状态清单（loading / error / empty / toast / progress） | `ui.css` |
| GSAP `gsap-timeline` 的 position 语义（`"<"` 同起、`"<0.2"` 相对起点） | 编排思想，不是代码 | `msg.js` 的「同批合并 + 递增延时」实现 |

### 为什么没引 GSAP / react-bits 的 npm 包

1. 项目**零依赖、无构建链、无 React**：`npx shadcn add @react-bits/...` 要求 shadcn + Tailwind，装不了；
   react-bits 全部组件是 `.jsx`，在无 JSX 编译的静态页里等于死代码。
2. GSAP 需 CDN，而 `build-standalone.js` 会**主动剥掉 CDN 脚本**（离线版断网要能用）。
   引 GSAP = 离线版直接失去动效。
3. 两个库都会带来 100–600KB 体积与一个新的失效点，而实际需要的只是**曲线、时长、错峰**这几组数值。

### 唯一改动过的参数（必须交代）

`AnimatedList` 的 slide 位移是 **28px**，本站改成 **18px**。
理由：对话气泡行间距只有 12px，28px 会让新消息在起始帧压住上一条，密集对话里读起来是"抖动"而非"入场"。
曲线、时长、缓动、缩放比例（0.98）**全部原值保留**。

### 本轮新增 / 改动

| 文件 | 改动 |
|---|---|
| `public/msg.css` | 新建。弹簧入场 + TextType 光标 + 三点等待态 + reduced-motion/print 全关 |
| `public/msg.js` | 新建。MutationObserver 自动挂入场，业务文件零改动 |
| `public/question-drill.js` | 补 `showTyping()` / `hideTyping()`：原来等待时对话区毫无反馈 |
| `public/fx.js` | `shakeEl()` 遇到 `data-entering` 先等 660ms（入场 transition 与抖动 animation 抢 transform 会互相覆盖） |
| `public/motion.css` | 错峰 45ms → 50ms（对齐 AnimatedList） |
| `scripts/build-standalone.js` | 内联清单加 `msg.css` / `msg.js` |

**两个容易漏的接线点（已写进测试）**

1. `#questionDrillConversation` 是 `question-drill.js` **运行时创建**的，静态 HTML 里没有。
   `msg.js` 必须"一边挂一边补"，并对晚到容器临时观察 body —— 叠加 8 秒兜底，页面本就没有对话区时自动撤，
   不让落地页永远扫全站 DOM。
2. `landing.html` / `workbench.html` **没有对话区**，因此**不引** `msg.css` / `msg.js`（引了就是白挂观察器）。

**回归**：`tests/msg-motion.test.js`（15 例，DOM 桩真跑 msg.js + 校验 msg.css 的曲线采样点与门控）。
基线 229 → **244/244**。离线版 542.8KB，msg.css/msg.js 已内联，无外部引用残留。

## 四之六、数字滚动 + 结论句模糊渐入 + 时间分配口径 + 参数对照表（2026-10-29 第四轮，m4）

用户点了 A/B/C/D 四项全做。这一轮**新增两个脚本文件**，并且修掉一个一直存在的对比度问题。

### A · 报告分数真的「滚」起来了（`countup.js`）

**先交代一件事**：`motion.js` 里原本就有一个 `[data-roll]` 的数字滚动实现，
但它**从来没有被任何页面标过 `data-roll`** —— 是死代码。这一轮把那段删掉，换成按
React Bits `CountUp` 原式重写的 `countup.js`（零依赖，无 React）。

从模板搬过来、能被测试单独验证的数值行为：

| 参数 | 值 | 说明 |
|---|---|---|
| `CELL` | 1.2em | 每格高度；每列 4 格（偏移 -1/0/1/2） |
| `STAGGER` | 0.07s | 同批各列起跑错峰，且压进总时长的 40% |
| 总分时长 | 2s | 模板默认值 |
| 指标卡时长 | 1.1s | 本站调过：6 个数字同时滚 2 秒像没加载完 |
| `easeOut` | `cubicBezier(0.33,1,0.68,1)` | 实测 0.15→0.386、0.5→0.872 |
| 行进量 | `delta = mod10(to-from) + 10*turns`<br>`turns = min(floor(|Δ|/10^(place+1)), max(0,3-rank))` | 0→87 时十位走 8 格、个位走 37 格 |
| 动态模糊 | `σ = min(cell*0.05, speed*cell/600)` | 只在运动中加，落位必须清零 |

**两处与模板不同（都已写进测试）**：

1. **落位后换回纯文本**。模板会把滚动 DOM 留着，导致 `textContent` 读出「012908…」一整串格子，
   复制与读屏全是乱码。落位时替换成一个文本节点，视觉完全等价。
2. **分数环与数字同一条曲线**。`.ring` 自带 `transition:background .6s`，逐帧写 `conic-gradient`
   会被它拖着走（表现成追不上的果冻），动画期间临时 `transition:none`，落位再交还。

顺带修了环本身：原来是**实心圆盘 + 深色数字压在靛蓝扇面上**（对比度约 2.4:1，「分」字几乎看不见）。
现在加一圈内盘 `inset:9px`，变成真正的刻度环，数字落在卡片底色上。截图：`视觉验证截图/m4-ring-donut.png`。

### B · 结论句逐字模糊渐入（`blurtext.js`）

来源 React Bits `BlurText` 的 `blur` 档，三帧参数原样：`blur 10→5→0`、`y +50→-5→0`、
`times [0,.5,1]`、**linear**（模板里唯一用线性的一档）、单字 700ms（0.35s×2 段）。

为中文只改两处：

1. 模板按空格分词，中文整句没有空格 → 改成按字拆（模板本身也有 `animateBy="char"` 这一档），
   并把句读标点**粘在前一个字上**（否则「，」会单独成片被挤到行首）。
2. 字级错峰 `min(200ms, 1000ms/(片数-1))`：40 个字若按 200ms 排，最后一位要 8 秒才出现。

只接在 `#scoreSummary`（报告结论句）上，由 `app.js` 显式 `mount()`，不做全站自动扫描。

### C · 时间分配「不伪造」的口径已锁死

遗留待办 #3 的代码其实**早已修好**（`normalizeAlloc()` 全 0 → null，规则分支一律 null，
前端 null/全 0 → 「未测量」）。这一轮做的是**补回归**，外加补一个真实缺口：

- 新增 `tests/time-allocation.test.js`（7 例）：规则分支 null / 模型全 0 → null / 模型漏字段 → null /
  非法值夹零后仍 null / 合法值必须带 `source=text-heuristic`。
- **真实缺口**：饼图有值时**没有标来源**，读者会把「教师 26 分钟」当成实测数据。
  现在图上明确写「按逐字稿文本推断的分钟数（非实测课堂计时）」。

### D · 参数对照表（`public/motion-spec.html`）

一页 60 项、十个分区，默认全部「要」，只点不要的那几项；支持复制成一段文本丢回给我。
`tests/motion-spec.test.js` 会从**源码**读真值再要求页面里出现同样的字符串
（`DURATION`/`GRID_DURATION`/`STAGGER`/`CELL`/`STEP`/`DELAY`/`--msg-enter-dist`/`MAX_DEG`/粒子密度分母/`--blur`），
改了源码忘改表会立刻红。

### 本轮新增 / 改动

| 文件 | 改动 |
|---|---|
| `public/countup.js` | 新建（零依赖移植 CountUp：roll + count 双模式） |
| `public/blurtext.js` | 新建（BlurText blur 档，中文按字拆） |
| `public/motion.css` | 删掉死代码 `.roll` 段；新增 `.cu*` 与 `.bt-piece` 关键帧 |
| `public/motion.js` | 删掉从未被使用的 `setupRolls()` / `buildRoll()` |
| `public/app.js` | 总分改走 `jtqCount.score()`（保留静态兜底）；结论句 `jtqBlurText.mount()`；饼图补来源行 |
| `public/styles.css` | 分数环改内盘（对比度修复） |
| `public/motion-spec.html` | 新建（参数对照表） |
| `index.html` | 引 `countup.js` / `blurtext.js`（必须在 `app.js` 之前），`app.js` 版本号首次从 10-22 提到 m4 |
| `scripts/build-standalone.js` | 内联清单加 `countup.js` / `blurtext.js` |
| 全部 `?v=` | m3 → **m4**（`styles.css` 变更，三页同步） |

**回归**：41 个新例（countup 18 / blurtext 11 / time-allocation 7 / motion-spec 5）。
基线 244 → **285/285**。离线版 567.4KB，两个新脚本已内联，外部引用 0。

**没做的**：无头浏览器不推进 rAF，所以「滚动过程」只有单元测试与一帧中间态截图
（`视觉验证截图/m4-roll-midframe.png`），**流畅度仍需真人目视**。

## 四之七、三张 SVG 学生立绘接入 2D 教室（2026-10-30）

用户提供了三份 SVG 立绘源码（哑光水粉纸感风格），要求接进 2D 模拟课堂。
之前 2D 教室的学生是**纯 Canvas 代码手绘**（圆头 + 圆角矩形身体 + 两个圆点眼睛），
零素材引用。

### 素材落位

三张母版 + 九张状态图（3 角色 × 3 状态）。母版是唯一数据源，
状态图由 `app/scripts/build-student-assets.js` 生成，**不要手改生成产物**。

| 角色 | 母版 | 状态图 | viewBox |
|---|---|---|---|
| 小霸（geek·学霸） | `public/assets/students/portraits/geek.svg` | `public/assets/students/svg/geek-{default,closed,raise}.svg` | 620×800 |
| 小皮（naughty·调皮） | `public/assets/students/portraits/naughty.svg` | `public/assets/students/svg/naughty-{default,closed,raise}.svg` | 600×760 |
| 小走（drift·走神） | `public/assets/students/portraits/drift.svg` | `public/assets/students/svg/drift-{default,closed,raise}.svg` | 600×740 |

角色映射：戴眼镜的男生 → 学霸；偏分短发女生 → 调皮；黄色圆润角色 → 走神。

状态含义：`default` 张嘴（发言中）/ `closed` 闭嘴（默认）/ `raise` 举手。
每张 SVG 含八个功能分组：`desk`（默认关闭）/ `body` / `head` / `eyes` /
`mouth-open` / `mouth-closed` / `arm-down` / `arm-raise`。

> `public/assets/students/student-*.svg` 是用户提供的原始素材留档，
> 产品已不再引用，修改请改 `portraits/` 下的母版。

### 四个必须知道的技术点

**① 不能按 viewBox 缩放。** 实测三张素材的内容包围盒差异极大：

| 角色 | 内容占比（宽×高） |
|---|---|
| naughty | 80.7% × 90.1% |
| geek | 89.8% × 90.1% |
| drift | 60.8% × 67.4% |

直接按 viewBox 画，黄色角色会比另外两个小一截且偏下。必须先扫像素求内容边界，
再按 `CROP` 表裁源（数据是逐像素扫 alpha>8 得到的，见 `students-art.js` 注释）。

**裁切矩形必须取三状态的并集。** 举手时人物会向上向右伸展，
若每个状态各用各的包围盒，切换状态时人物会「跳动」（脸的位置漂移）。
所以同一角色的三种状态共用同一个裁切矩形，切换时只有手臂和嘴巴在动。
测量脚本：`app/scripts/measure-student-bbox.py`（Inkscape 栅格化后逐像素扫描）。

**② 不能用 `img.naturalWidth`。** 只有 `viewBox`、没有 `width/height` 的 SVG，
该值返回 **0**。一旦用它算源矩形，9 参数 `drawImage` 会什么也画不出来 —— 立绘整片消失
（本轮真实踩过，截图可见只剩投影椭圆和名字）。
解法：加载后立刻**烘焙**到离屏 canvas（用显式 viewBox 尺寸 × 2 倍栅格），
绘制端只做 4 参数 `drawImage`。

**③ 离线版必须内联。** `build-standalone.js` 把九张状态 SVG 转成 base64 data URI，
两处都换：注入 `window.JTQ_STUDENT_SRC` + 替换 `students-art.js` 源码里的默认路径
（双重保险）。构建脚本带自检：残留 `assets/students/` 直接抛错。

**④ 生成产物不能写死 width/height。** 母版只有 `viewBox`。
若给状态 SVG 加 `width="240" height="240"`，与 620×800 的 viewBox 比例不符，
Inkscape 栅格化会**信箱化**（内容缩小留白），绘制端裁切坐标全部失真。
`students-art.test.js` 有断言守住这一点。

### 布局调整

立绘放大后原布局放不下，改了四处：
- 黑板压扁上移（0.035~0.22H，原 0.08~0.38H）
- **撤掉讲台与教师圆点** —— 立绘放大后没有它的位置；且这是教师视角，本就看不到自己，改为左下角小字「教师视角」
- 学生位置 0.25 / 0.5 / 0.75，底对齐 0.845H，人物高 0.62H
- 专注度环改成**脚下状态条**（立绘不能被染色）；**举手用真实立绘的 raise 状态**（不是 ✋ 符号）；发言用头顶圆点

### 降级链

`students-art.js` 加载失败 → `get()` 返回 null → `drawClassStudent` 退回原本的简笔小人。
课堂场景不会因素材缺失或加载失败而空掉（截图第三格验证过）。

### 回归

`npm test` 332 → **348/348**（新增 `tests/students-art.test.js` 16 例）：
烘焙尺寸、宽高比收敛、CROP 不越界、加载失败降级、缺图不影响其余、
接线顺序（students-art 必须在 app.js 之前）、4 参数 drawImage（禁止回退 9 参数）、
构建脚本内联与自检。离线版 724.3KB，外部引用 0。

`index.html` 里 `app.js?v=` 从 m5 提到 **m6**（内容改了，其余资源未动不制造无谓失效）。

## 四之八、课堂学生名册与学情数值的防守（2026-10-30）

一份外部建议给了 6 条「上一版的实际问题」+ 局部替换补丁。**补丁本身打不上**：
它假设的 `public/classroom-cast.js`、`classroom-voice.js`、`classroom-sim-2d.js`、
`tests/classroom-cast.test.js` 在本项目中一个都不存在，真实 2D 课堂是
`app/public/app.js` 里的一体化实现（`renderClassStudents` / `drawClassScene` /
`classNextRound` / `resetClass`），也没有 `.sim2d-message`、`dataset.messageId`、
文字待发队列、详情面板这些结构。

逐条核对后的结论：

| 补丁说的问题 | 在本项目 | 说明 |
|---|---|---|
| `META[item.key]` 命中继承属性 | **真实存在** | `CLASS_META[s.key]` 裸查，`constructor` 拿到函数（truthy），卡片渲染出 `undefined` |
| `Number(' ')` 得到 0 | **真实存在** | `attention != null` 判据放过 `'   '`/`[]`，画成 0 分红色告警条 |
| `render()` 重建详情按钮丢焦点 | 不存在 | 没有详情面板，`cs-card` 不是按钮 |
| 人物层与语音层各自监听 DOM 重复排队 | 不存在 | `classNextRound()` 同步调 `speak()`，没有第二套观察者 |
| 最后一条文字发言无法结束 | 不存在 | 没有文字待发队列 |
| 重置只清人物队列，旧朗读继续 | **真实存在** | `resetClass()` 不取消朗读；`stopSpeak()` 只有定义、**零调用点**（死代码） |

另外自查出补丁没提的一条：`classNextRound()` 循环里 `states[last].speaking = false`
写在 `await` 之后，中途任何异常都会让角色永久停在「正在发言」（头顶圆点和卡片高亮常亮）。

### 改了什么

**① 抽出 `public/classroom-roster.js`（零依赖纯函数）**
`CLASS_META` / `KEYS` / `hasKey` / `scoreOf` / `colorOf` / `idleRoster`，
挂 `window.jtqClassRoster`。`app.js` 里原来的 `CLASS_META` 字面量与 `stateColor()`
改为引用它，并保留 15 行内联兜底（仅在脚本未加载时生效，主逻辑以该文件为准）。

- `hasKey()`：只认自有属性，`constructor` / `toString` / `__proto__` 全部拒绝。
- `scoreOf()`：数字或非空数字串 → 0–100 整数（`Math.round` + 夹取）；空白串、数组、对象、布尔、`NaN`、`Infinity` 一律 `null`。
- `colorOf(null)` 返回中性灰 `#94A3B8`，**刻意与「0 分」的红色区分开** —— 缺数据和真垫底在视觉上必须能分辨。

**② 非法角色在入口就过滤**
`classNextRound()` 的 `incoming` 先 `.filter(hasClassKey)`，非法项不占卡片、不占站位、
**不产生气泡也不参与朗读**（不只是渲染层兜底）。`drawClassScene` 的站位改为按实际人数均分
（1 人 0.5；2 人 0.33/0.67；3 人 0.25/0.5/0.75），过滤后剩两人不会挤在左半边。

**③ `resetClass()` 接上 `stopSpeak()`**
`speak()` 是往浏览器全局 TTS 队列里塞，不清就会「新课堂已开局，耳边还在念上一轮台词」。
`stopSpeak()` 之前从未被调用，是死代码，现在接上了。

**④ 发言状态用 `finally` 兜底**
`states.push(card)` 后把 `card.speaking = false` + 重渲染放进 `finally`，中途异常也摘掉高亮。

**⑤ 离开课堂 Tab / 页面隐藏时摘掉「正在发言」**
新增 `clearClassSpeaking()`。只清展示标记，不删对话、不清业务数据，也不把切走当成训练结束。

**⑥ 不采纳的补丁**：气泡 `-webkit-line-clamp` 摘要化。
本项目的气泡**就是**对话记录本身（`classBubble` 直接渲染进 `#classLog`），
不存在「另一个完整记录可回看」。截断学生原话会让老师读不到完整提问，教学场景下不可接受。

### 证据（无头 Edge 真跑真实 index.html + 真实 app.js）

拦截 `/api/classroom/round` 返回 4 条刻意构造的脏数据：
`constructor`（合法分数）、`geek`（`'   '`）、`drift`（`50` / `'60'`）、`toString`（数组分数）。

```json
{ "cardCount": 2, "dataKeys": ["geek","drift"],
  "hasConstructorCard": false, "hasToStringCard": false,
  "blankHasBars": false, "driftBarCount": 2, "driftValues": ["50","60"],
  "hasUndefinedWord": false,
  "chatLines": ["上课了…","小霸 🤓空白分数","小走 😵数组分数"],
  "cancelAfterReset": 1, "keysAfterReset": ["naughty","geek","drift"] }
```

- 4 条里 2 条非法被丢弃：只有 2 张卡片、2 条气泡，`undefined` 零泄漏。
- `'   '` 分数**不渲染分数条**（修复前是 0 分红色条）。
- `'60'` 字符串被规整成数字 60 正常显示。
- 点「重新开课」→ `speechSynthesis.cancel()` 被调用 **1 次**（修复前 0 次），名册回到三人 idle。

### 回归

`npm test` 348 → **359/359**（新增 `tests/classroom-roster.test.js` 11 例）。
除 8 例纯函数断言外，另 3 例是**防回归静态断言**，直接扫 `app.js` 源码：

- 不得出现 `CLASS_META[s.key]` 裸查 / `Object.keys(CLASS_META)`；
- 不得出现 `Number(...attention...) || 0`；
- `stopSpeak()` 命中数必须 ≥ 2（定义 + 至少一处调用），且 `resetClass()` 内必须先于状态重置；
- `classroom-roster.js` 必须在 `app.js` 之前加载。

离线版 731.3KB（+7.0KB），外部引用 0，`classroom-roster.js` 已内联在 `app.js` 之前。
`index.html` 的 `classroom-roster.js` / `app.js` 统一提到 `20261030-roster1`；
`styles.css` 本轮未动，版本号保持 `m5`。

## 四之九、接入 react-bits 与 GSAP（2026-10-30，rbfx2）

用户批准了两条路线：A 继续零依赖搬运 react-bits 组件、B 接 GSAP。
在这之前项目只有 `blurtext.js`（BlurText）和 `countup.js`（CountUp）两个搬运，
GSAP 一个都没接、`design-taste-frontend` 一次都没跑。

### B：GSAP 本地 vendor，不走运行时 CDN

| 文件 | 体积 | 说明 |
|---|---|---|
| `public/vendor/gsap.min.js` | 72.4KB | GSAP 3.13.0 |
| `public/vendor/ScrollTrigger.min.js` | 44.2KB | 同版本 |
| `public/scroll-gsap.js` | 新建 | 只做三件事 |

`scroll-gsap.js` 的定位是**不抢 motion.js 的活**：motion.js 已经用
IntersectionObserver + `.is-in` 管好了入场，两边同时动会打架。所以 GSAP 只做：

1. **顶部阅读进度条**：独立 fixed 元素，`scaleX` 由 ScrollTrigger scrub 驱动，零布局侵入；
2. **区块标题字距收拢**：只动 `letter-spacing` + `opacity`，不碰 transform，
   因此与 `.is-in` 的位移并存不互相覆盖；
3. **锚点平滑滚动**：tween 一个数值对象 + `window.scrollTo`。
   不引 ScrollToPlugin（为一条滚动多 22KB 不划算）。

降级：`if (!gsap || !ScrollTrigger) return;` —— vendor 被拦、旧缓存页面都只是没有动效，
不会抛错白屏。

### A：react-bits 三个效果的原生移植

从 `https://reactbits.dev/r/<PascalCase>-JS-CSS.json` 取上游源码
（registry 是 **PascalCase**，用小写 kebab 会 404）。

| 效果 | 上游组件 | 落地位置 |
|---|---|---|
| 指针聚光 | `SpotlightCard` | `#classStudents` 容器委托 → `.cs-card` |
| 指针磁吸 | `Magnet` | `#analyzeBtn` 主按钮 |
| 悬停光带 | `GlareHover` | `#metricsGrid` 的 `.metric` 卡片 |

**没有逐字搬运，是「保留可见效果、砍掉冗余层」**，文件头写清了差异：
- SpotlightCard 上游还有 grain 噪点、border 双层 mask 描边、ambient 自漂移。
  本项目卡片小、内容密，噪点和描边会脏，砍掉。
- Magnet 上游是弹簧积分（stiffness/damping/mass），这里用指数趋近，手感等价且不会积分发散。
- GlareHover 上游用 33 段 `color-mix` 生成 profile，这里用单条线性渐变。

StarBorder 没有接入：它那套「沿圆角路径跑光」的数学要实现上百行，
在卡片尺寸下换 conic-gradient 更划算，但观感和上游差得远，宁可不做。

### 三个真实踩到的坑

**① `Number(null) === 0`，把所有默认值吃成 0。**
`getAttribute('data-rb-spot-size')` 在属性没写时返回 `null`，
`num(null, 220)` 一路返回 **0**：光斑尺寸 0px、磁吸 `maxOffset` 0 → 指针怎么动都不位移。
修法：`num()` 先挡 `null / undefined / ''` 再 `Number()`。
测试里锁死了这条（`num(null, 220) === 220`）。

**② CSS 类名没挂，变量写了也没人消费。**
`magnet()` 只负责写 `--rb-mx`，`.rb-magnet` 的 `translate` 规则要靠类名触发。
第一版忘了 `classList.add('rb-magnet')`，结果是「JS 全对、计算样式 `translate: none`、画面纹丝不动」。
学生卡更麻烦：卡片是 `innerHTML` 重建的，类名只能在第一次被指针划到时**懒加**。

**③ `mix-blend-mode: soft-light` 在白底上等于没做。**
第一版光斑用 soft-light + 34% 品牌色，截图上**完全看不见**；
换成 `screen` 又会把浅色底洗白。最后放弃 blend-mode，直接用带透明度的品牌色叠加，
深色主题单独一套冷白渐变。

### 证据

无头 Edge 真跑 index.html（拦截无效，直接派发 PointerEvent）：

```json
{ "gsap": "object", "scrollTrigger": "function", "rbFx": "object",
  "progressBar": true, "progressTransform": "matrix(0, 0, 0, 1, 0, 0)",
  "cardRect": "215x125",
  "spotOn": "1", "spotX": "18px", "spotY": "22px", "spotSize": "220px",
  "btnRect": "665x50",
  "magnetX": "0.37px", "magnetY": "0.18px",
  "magnetComputed": "0.37px 0.18px" }
```

（磁吸值只有 0.37px 是因为 `--virtual-time-budget` 下 rAF 只跑了 3 帧，
真实浏览器会收敛到约 2px；`magnetComputed` 证明 CSS `translate` 真的被消费了。）

视觉：`视觉验证截图/rbfx-effects.png` —— 三张卡的对比（有光 / 有光 / 无光）、
磁吸按钮、光带扫到 70% 的指标卡、42% 的渐变进度条。

### 回归

`npm test` 359 → **371/371**（新增 `tests/rb-fx.test.js` 12 例）。
除了 `num` / `clamp` / spotlight / magnet 的行为断言，还包括接线与降级：

- gsap → ScrollTrigger → scroll-gsap 的加载顺序；
- `rb-fx.js` 必须早于 `app.js`（app.js 会调 `refreshGlare()`）；
- vendor 缺失时 `scroll-gsap.js` 必须 return 而不是抛错；
- 三个效果的 `prefers-reduced-motion` 降级都在；
- index.html 不得引 CDN 版 GSAP；
- 构建脚本必须内联 4 个新脚本 + `rb-fx.css`。

**顺带修了一个老测试的脆弱点**：`fx-wiring.test.js` 里 `/fx\.js\?v=/` 没有左边界，
新增 `rb-fx.js` 后先命中了它，导致「fx.css 与 fx.js 版本号不一致」的假失败。已加 `(?:^|["/])` 边界。

离线版 731.3 → **863.2KB**（+131.9KB，gsap 72.4 + ScrollTrigger 44.2 + 其余），外部引用 0。
`index.html` 的 `rb-fx.css` / `rb-fx.js` / `scroll-gsap.js` / 两个 vendor 统一为 `20261030-rbfx2`。

## 四之十、再补两个组件：学生卡 3D 倾斜 + 报告卡分批入场（2026-10-30，tilt1）

| 效果 | 上游 | 挂在哪 |
|---|---|---|
| 指针 3D 倾斜 | `TiltedCard` | 学生卡片（`.cs-card`） |
| 分批入场 | `AnimatedContent` | 报告指标卡（`.metric`） |

`#classStudents` 现在同时挂 `data-rb-spotlight` 与 `data-rb-tilt`，两个效果在同一张卡上叠加。

### 移植时砍掉了什么（都写在文件头注释里）

`TiltedCard` 上游 19.6KB：backContent 翻转、gyroscope 陀螺仪、tooltip、intro 入场、
trackWindow 窗口级跟随、多层 translateZ 视差、独立阴影层、六次平滑 + 弹簧积分。
本项目只保留「指针 → 双轴旋转 + 指数趋近回正」这一层，其余全部砍掉 ——
学生卡只有 100–200px 宽、文字密集，这些层叠上去只会让字发虚。

`AnimatedContent` 上游依赖 gsap + ScrollTrigger。本项目固定为「挂载即播」：
报告卡是点分析后立刻出现，而且面板在隐藏 tab 里时 ScrollTrigger 的 start 算不出有效值，
用滚动触发可能永远不触发。

### 这一轮真正的坑（都不是 API 写错）

**1. `getBoundingClientRect()` 在元素有 transform 时返回的是变换后的轴对齐包围盒。**

旋转之后 rect 的宽高都比 `offsetWidth/offsetHeight` 大，而且**随倾斜角度变化**。
原来的聚光用 `clientX - rect.left` 算坐标，一叠上倾斜就出现「光斑跟着指针自己漂」的自激。
修法：抽 `localPoint()`，中心点用 rect 求（旋转绕中心，中心不变），
半宽半高用 `offsetWidth/offsetHeight`。这样旋转前后归一化坐标完全一致。

**2. 透视距离必须随元素尺寸走，不能写死。**

`perspective(680px)` 放在 215px 宽的卡上，边缘前后只差 10px 对 680px 的透视，**6° 几乎看不见**；
放在 100px 宽的卡上更是完全看不出立体。修法：`--rb-persp` 由 JS 按 `宽度 × 3`
写入并夹在 260–900px（260 是下限，再近会明显畸变）。角度默认也从 8° 提到 **12°**。

**3. `.cs-card` 原本是 `transition: all .3s`。**

JS 每帧都在写 `--rb-rx/--rb-ry`，再叠一层 `.3s` 的 all 过渡就是双重缓动 ——
手感会变成明显的拖尾跟手。修法：`.cs-card.rb-tilt` 里显式只留
`border-color / box-shadow / background-color` 三条过渡，transform 完全交给内部 rAF。

**4. 上游把 `visibility: hidden` 写在 JSX 的 style 里，靠 gsap 再显示回来。**

照抄的话，gsap 一旦没加载（旧缓存、静态资源被拦）整个报告区就是空白。
本项目反过来：**元素默认可见，只有 gsap 可用时才由 JS 设 `opacity: 0`**，
异常分支里 `clearProps` 清干净。测试里有一条专门扫源码禁止出现 `visibility: 'hidden'`。

### 证据（无头 Edge 真跑 index.html + 真实 app.js，派发真实 PointerEvent）

```json
{ "gsap": "object", "rbFx": "object", "hasEnterMetrics": "function",
  "cardRect": "215x125",
  "hasTiltClass": true,  "hasSpotClass": true,
  "spotOn": "1", "spotX": "183px",
  "transformBase":    "matrix3d(1,0,0,0, 0,1,0,0, 0,0,1,-0.00147059, 0,0,0,1)",
  "transformRotated": "matrix3d(0.994522,-0.0109262,0.103956,...,-0.00145452, 0,0,0,1)",
  "transformChanged": true, "offDiagonal": 8,
  "transitionProp": "border-color, box-shadow, background-color",
  "willChange": "transform",
  "enterOpacityAt0": "0", "enterInlineAt0": "0",
  "enterTransformAt0": "translate(0px, 18px)",
  "tweenCount": 1 }
```

`transformRotated` 里 `cos6° = 0.994522`、`sin6° = 0.104528` 都在矩阵中，
`transitionProp` 已不含 `all` / `transform` —— 这两条证明 CSS 真的消费了变量，
不是「只把变量写上去了」。

`spotX = 183px` 对应卡宽 215 × 0.85 = 182.75，证明新的坐标反推算法在倾斜状态下仍准确。

**已知限制**：headless 的 `--virtual-time-budget` 只快进 `setTimeout`，**不推进 rAF**，
所以截图和 dump 拿不到 tilt 的中间帧、也看不到 gsap 播完。
浏览器侧只验证「事件到达处理器（类名被懒加）+ CSS 消费变量 + tween 已建立」，
中间态的数值由 `tests/rb-fx.test.js` 覆盖。

视觉对照：`视觉验证截图/tilt-effects.png`（12°/600px 宽卡、12°/300px 窄卡、未悬停对照）。

### 回归

`npm test` 371 → **389/389**（`tests/rb-fx.test.js` 12 → 30 例）。

新增断言里选几条关键的：

- `localPoint` 在「rect 被撑大 210×130、offset 仍 200×120」时坐标必须不变（锁住第 1 个坑）；
- 默认 12°，`--rb-persp` = 宽度 × 3 且夹在 260–900（锁住第 2 个坑）；
- `.cs-card.rb-tilt` 块内剥掉注释后不得出现 `transition: all`（锁住第 3 个坑）；
- gsap 缺失时 `enter` 返回 null 且**不写任何样式**（锁住第 4 个坑）；
- 源码不得出现 `visibility: 'hidden'`；
- `rb-fx.css` 与 `rb-fx.js` 版本号必须一致。

**顺带修了测试沙箱自身的缺陷**：原来的 `requestAnimationFrame` 是同步执行回调，
于是 `raf = requestAnimationFrame(frame)` 会在 frame 内部把 raf 清 0 之后又被赋值成返回的 id，
**第二帧永远起不来**。真实浏览器是异步的，没这个问题。改成队列 + 手动 `drain()`。

离线版 863.2 → **872.0KB**，外部引用 0。
版本号：`rb-fx.css` / `rb-fx.js` / `app.js` 提到 `20261030-tilt1`；
`vendor/*` 与 `scroll-gsap.js` 内容未动，保持 `rbfx2`（不制造无谓的缓存失效）。

## 四之十一、课堂点名（点谁谁答）+ 版本号指纹锁（2026-10-30，callon1）

### 1. 点名接口 `POST /api/classroom/call-on`

与 `/api/classroom/round` **刻意分开**：round 是「老师讲完一段，三人一起反应」（学生主动发难），
call-on 是「老师主动点一个人」（老师掌握发问权）。两种权力关系下学生的语言完全不同，
所以是两套 prompt、两套降级，也分开计入配额。

请求：`{ key: 'naughty'|'geek'|'drift', topic?, transcript?, callInstruction?, pressure?, history?, profile? }`
响应：`{ key, name, mood, line, answer_quality, attention, comprehension, state_reason, difficulty, pressure_delta, pressure_reason, engine, fallback_reason }`

- `answer_quality` 四档：`good | partial | poor | offtopic`，与 `pressure_delta` 严格对应
  （good −8 / partial +2 / poor +6 / offtopic +9）。前端只在「引擎降级」时提示一句，不伪装成模型结果。
- 非法 `key`（含 `constructor` / `toString` 这类原型链属性）在调用模型**之前**就 400，
  不会白烧一次 token。
- 模型如果回错人（点小走却回了小霸），直接判 `bad json` 降级本地规则 ——
  「张冠李戴」比回空更毁试讲复盘的可信度。

### 2. 前端交互三条约束（改这块时别丢）

1. **只能点当前在座的学生**（`callOnAllowedKey`）：后端只返回 2 人时，第 3 张卡不该能点。
2. **同一时刻只有一次点名**（`classCallBusy`），并且要避开进行中的整轮课堂
   （`classNextBtn.disabled`）——两边都会改 `lastClassStates`，同时跑会互相覆盖。
3. **点名结果必须进 `classMessages`**，否则下一轮模型不知道「老师点过小走」这件事发生过。

点卡片的入口是**事件委托**在 `#classStudents` 上：`renderClassStudents` 每轮
`innerHTML` 重建，逐张卡绑定会随旧节点一起丢掉并越积越多。

画布点击读 `lastClassSlots`（绘制时存下的同一份包围盒），不重新算坐标 ——
两份公式一旦漂移就会出现「看到的是小走，点下去点中小霸」。站位公式现在只有一份：
`classroom-roster.js` 的 `figSize / slotRatios / sceneLayout / hitTest`。

### 3. 静态资源版本号指纹锁（新）

四次同款事故：**文件内容改了、`?v=` 没改，用户拿旧缓存 JS 跑新 HTML，而测试全绿。**

现在 `tests/asset-lock.json` 记录每个被引用资源的 `sha256 + version`：

```bash
node scripts/asset-fingerprint.js            # 看当前指纹
node scripts/asset-fingerprint.js --check    # 校验（CI 用，非 0 退出）
node scripts/asset-fingerprint.js --update   # 改完版本号后刷新锁
```

判定规则：

| 情况 | 结果 |
|---|---|
| 内容变了、版本号没变 | **FATAL** —— 这就是线上故障，并给出建议版本号（tilt1 → tilt2） |
| 内容变了、版本号也变了 | STALE —— 提示跑 `--update` 刷新锁 |
| 版本号变了、内容没变 | STALE —— 无谓的缓存失效 |
| 同一文件在不同页面版本号不一致 | FATAL |
| 引用了不存在的文件 | FATAL（线上 404） |

**发布前必须：** 改完前端 → bump 版本号 → `--update` → `npm test` 全绿 → 再发布。
跳过 `--update` 会让锁记录过期，之后的内容改动就再也抓不到了。

## 四之十二、首屏结构（2026-10-30，hero1）

改自 `docs/设计评审-2026-10-30-tasteskill.md`：评审给 5.9 分，理由不是「难看」，是「没被设计过」——
首屏没有 h1、第一行是「模型: deepseek-chat」、hero 是 100px 扁横幅且右半屏全空。这一节是重做后的约定。

### 1. 首屏必须有的三样东西

1. **一个真 `h1`**，只允许在 `.hero` 里。文字是「上台前，先被三个 AI 学生拆一次台」——
   说的是机制，不是产品名。产品名留给 topbar 的 `.brand-txt b`（用 `<b>`，不要改成 h1，否则一页两个 h1）。
2. **一句话定位**紧跟 h1：`师范生试讲教练` 加粗起头，后面说明给谁用、会发生什么。
3. **一个真实界面片段** `.hero-clip`：三个学生的立绘 + 小皮的抬杠原话 + 压力 87/100。
   这是「软件展示自己的界面」，不是图库照片，也是本页唯一别人抄不走的画面。

### 2. 顶栏：技术状态一律进抽屉

`.badges` 里只放三件东西：登录态、自动演示、`⋯ 更多`。**模型名（`#modelBadge`）、主题、介绍、
Codex、路演全部在 `#topMorePanel` 里**。

为什么是硬约定：手机上 `.badges` 放四个就会出现第二行只挂一个「更多」。手机端还额外隐藏
`#autoDemoBtn` —— 首屏的「看一遍示例」调的是同一个 `startDemoFromWorkspace`，顶栏那份是冗余的。

顶栏的左右内边距不是常数，而是跟内容区对齐：

```css
html .topbar { padding-inline: max(24px, calc((100% - 1120px) / 2 + 32px)); }
```

1120 是 `html .layout` 的 `max-width`，32 是它的 `padding`。改其中任何一个，这行要一起改，
否则页面会被测量成「左 209 / 右 97」——导航比正文更靠外，看着像整块内容被推到左边。

### 3. 首屏立绘：只准通过 srcOf 取地址

`<img>` 的 `src` 在一个 `data-art-key` 容器里由 `hydrateArtImages()` 填：

```html
<span class="clip-stu" data-art-key="naughty" data-art-state="default"><img alt="" data-fill><em>小皮</em></span>
```

**不要在 HTML 里写立绘路径。** `build-standalone.js` 末尾会断言产物里不许再出现立绘目录前缀，
写死路径会直接把构建卡住；而且离线单文件版的路径必须换成 data URI，只有 `jtqStudentArt.srcOf()` 知道这件事。
（同理：连注释里都不要写那个前缀，断言扫的是整个产物字符串。）

三张立绘的内容包围盒不一样（drift 的人物整体偏下约 20%），所以 `object-position` 按角色补偿，
见 `styles.css` 第 9 节。学生卡头像用 `object-view-box` 只取头部，浏览器不支持时退回 `object-fit: cover` 的整身。

### 4. 例外清单（用户 2026-10-30 批 a / c / d，b 保留）

| 编号 | 内容 | 结论 |
|---|---|---|
| A | 学生头像改 SVG 立绘头部裁切，emoji 降级 | 已做 |
| B | 01/02/03 步骤条 | **不动**（用户要求保留步序感知） |
| C | 背景光晕作为唯一渐变例外，.30 → .16 | 已做 |
| D | 真实界面片段顶替图库照片 | 首屏已落 1 处，结果区另 3 处待做 |

## 五、发布参数（直接照抄）

```
directory    : E:\ai网页\jiangtai-qiusheng\app
appName      : 讲台求生 · AI试讲教练
domainPrefix : jiangtai-survival
language     : node
port         : 3000
```

必须在用户**当条消息**里明确说「发布 / 上线 / 同步到线上」，否则会被要求二次确认。

## 六、发布后必须验证

```bash
BASE="https://jiangtai-survival.app.workbuddy.host"
CODE="2WZXYSXJ6D"

# 1. 新页面是否上线（关键）
curl -s -o /dev/null -w "%{http_code}\n" "$BASE/workbench.html?sharecode=$CODE"   # 期望 200，不是 404

# 2. 首页与旧页面
curl -s -o /dev/null -w "%{http_code}\n" "$BASE/?sharecode=$CODE"
curl -s -o /dev/null -w "%{http_code}\n" "$BASE/landing.html?sharecode=$CODE"

# 3. 模型状态
curl -s "$BASE/api/health?sharecode=$CODE"

# 4. 核心接口（不应 500）
curl -s -X POST "$BASE/api/ifias?sharecode=$CODE" -H "Content-Type: application/json" \
  -d '{"subject":"语文","transcript":"同学们，上课。谁来回答这个问题？好，你来。"}'
```

注意：`curl` 在 Bun 测试环境外必须加 `--noproxy '*'`，否则走代理返回 502。

## 七、发布前自测（本地）

```bash
cd E:/ai网页/jiangtai-qiusheng/app
node --test tests/*.test.js        # 期望 348 pass / 0 fail
PORT=3100 node server.js           # 起服务后逐个 curl 页面与接口
```

2026-10-29 已跑过：285 个测试全过（m4 轮新增 41 例）、E2E 降级六场景全过、页面与接口线上实测全 200（线上仍为 m3，m4 待发布）。

## 八、备选方案：迁到 Render

账号找不回来时走这条。仓库内已有 `render.yaml`（`rootDir: app`、`startCommand: node server.js`、`healthCheckPath: /api/health`）。

1. 推到 GitHub 私有仓库
2. Render 新建 Blueprint，选该仓库
3. 面板里手填 `AI_API_KEY`（`render.yaml` 里是 `sync: false`，不写进仓库）
4. 拿到 `xxx.onrender.com`

代价：链接变更、云服务数据在新账号下需重建表（`lesson_reports` / `leaderboard` / `hollow_posts`）。
好处：账号、数据、链接完全自主，不受 WorkBuddy 账号归属影响。

## 九、安全提醒

发布时上传的是 `app/` 整个目录，**包含 `.env`**（内含真实 DeepSeek Key）。
线上 `/api/health` 返回 `hasKey:true` 即为证据。如不接受 Key 存于托管方，
需改为平台环境变量注入（`render.yaml` 已是这种模式），否则线上会一直走规则兜底。
