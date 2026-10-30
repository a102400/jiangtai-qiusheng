# 讲台求生 · 美术资产交接包

三学生立绘（哑光纸感）+ 2D 教室图层。全部是**矢量 SVG**，可在 Figma / Inkscape 中继续迭代。

- 生成时间：2026-10-30
- 源目录：`app/public/assets/`
- 重新打包：`cd app && node scripts/build-art-handoff.js`

---

## 1. 目录结构

```
美术资产包/
├── README.md            ← 本文件（设计说明与协作约定）
├── tokens.json          ← 配色 token
├── preview.html         ← 打开即看的预览页（所有状态 + 教室图层）
├── masters/             ← 三张母版：唯一数据源，人工编辑的就是它们
│   ├── geek.svg         小霸 · 戴眼镜男学生   viewBox 620×800
│   ├── naughty.svg      小皮 · 偏分短发女生   viewBox 600×760
│   └── drift.svg        小走 · 黄色校服角色   viewBox 600×740
├── classroom/           ← 教室美术层：手绘源文件（背景 + 课桌）
│   ├── backdrop.svg     前墙 / 黑板 / 地板     viewBox 2400×800
│   └── desks.svg        课桌前沿               viewBox 2400×800
├── states/              ← 15 张状态图（3 角色 × 5 状态），由脚本生成，勿手改
└── preview/             ← PNG 预览（含 states/ 与 classroom/）
```

---

## 2. 美术语言（改之前先对齐）

- **哑光纸感**：低饱和、几乎无高光，靠色阶与柔光分层，不做镜面反射。
- **克制**：主色不超过三档，其余全是同色系微差；不用纯黑纯白。
- **有材质但不做作**：纸颗粒、柔光、干刷笔触点到为止，不喧宾夺主。
- **保色**：角色的固有色（男生的浅褐、女生的灰绿针织、角色的黄）不能被整体色调覆盖。

---

## 3. 立绘：功能分组（改图时务必保留这些 id）

每张母版里都有下面这些 `<g id="...">`，状态图就是靠切换它们的 `display` 生成的：

| 分组 | 含义 |
|---|---|
| `desk` | 课桌层。**默认关闭** —— 教室场景自带地面与课桌，画上会把包围盒撑到整幅画布。 |
| `body` | 躯干、衣服、脖子 |
| `head` | 头（含耳朵、脸、头发）。走神态会给这一组加 `transform` 做下倾。 |
| `eyes` | 正常睁眼 |
| `eyes-down` | 半垂眼（走神态用）。上眼皮压下、虹膜只露窄缝 —— 比闭眼更像走神而不是睡着。 |
| `mouth-open` | 张嘴 |
| `mouth-closed` | 闭嘴 |
| `arm-down` | 手臂放下 |
| `arm-raise` | 举起手 |

> 这些 id 是**产品契约**：脚本、测试、加载器都按 id 取分组。删 id = 改坏状态机制。

---

## 4. 五种状态

| 状态 | 嘴 | 手臂 | 头 | 眼 |
|---|---|---|---|---|
| `default` | 张嘴 | 放下 | 正常 | 正常 |
| `closed` | 闭嘴 | 放下 | 正常 | 正常 |
| `raise` | 闭嘴 | 举起 | 正常 | 正常 |
| `speak-raise` | 张嘴 | 举起 | 正常 | 正常 |
| `idle-down` | 闭嘴 | 放下 | 下倾 | 半垂 |

产品里的选择顺序（`classroom-roster.js` 的 `portraitStateOf`，卡片与画布共用这一份）：

```
举手且发言 → speak-raise
只举手     → raise
只发言     → default
专注度 < 45 → idle-down
其余       → closed
```

> 分数缺失（null）一律不判走神 —— 缺失不伪装成结论。

---

## 5. 尺寸与裁切（最容易踩的坑）

- 状态图**只写 viewBox，不写 width/height**。
  写死后若与 viewBox 比例不符，栅格化时会「信箱化」（内容缩小留白），裁切坐标全部失真。
- 同一角色的五个状态**必须共用同一个裁切矩形**（五个状态包围盒的并集）。
  各用各的，切换状态时人物会「跳动」——脸的位置会漂。
  当前数值见 `app/public/students-art.js` 的 `CROP` 表。
- 测量方法：`cd app && python scripts/measure-student-bbox.py`（Inkscape 栅格化 + 逐像素扫 alpha）。

---

## 6. 教室图层

- 两个图层都是 `viewBox 0 0 2400 800`，`preserveAspectRatio="none"`。
- **地板线在 y = 676（= 0.845 × 800）**，与立绘脚底（baseY = 0.845H）严格对齐。
  改尺寸时这条线必须跟着一起挪，否则人物会浮在地面上方或陷进地里。
- 画布是超宽的（窄屏约 2.7:1，宽屏约 4.5:1），所以视图框特意做成 3:1，
  拉伸时横向纵向的形变都很小。**不要改回 16:9**，黑板和粉笔会被压扁。
- 绘制顺序：**背景 → 人物 → 课桌 → 名牌**。
  课桌在人物之后 → 立绘底部被桌沿遮住，半身立绘才像「坐在桌后」；
  名牌在课桌之后 → 纸片名牌压在桌面上。顺序反了立刻露馅。

---

## 7. Figma 导入

1. 新建文件，按角色建 Frame，尺寸用 `viewBox` 的比例（角色 620:800 / 600:760 / 600:740）。
2. 把 `masters/*.svg` 拖进 Figma → 会变成矢量图层（路径 + 渐变 + 滤镜）。
3. **两个已知差异**：
   - `feTurbulence` 纸颗粒滤镜 Figma 不支持，导入后会丢失。
     替代做法：叠一层噪点纹理（Noise）图层，混合模式用 Multiply、不透明度 4%~8%。
   - `preserveAspectRatio="none"` 在 Figma 里不生效，教室层要**手动**把图层拉伸到 Frame 尺寸，
     并保证地板线仍然落在画面高度的 84.5% 处。
4. 分组 id 在 Figma 里会变成图层名（`head`、`arm-raise` 等），导出时保留名字即可对上。

---

## 8. 回导流程（改完怎么回到产品里）

```bash
cd app
# 1) 改 masters/ 或 classroom/ 里的源文件（或从 Figma 导出的 SVG 覆盖进去）
node scripts/build-student-assets.js   # 重新生成 15 张状态图
npm run assets:optimize                 # SVGO 压缩 + 契约校验
npm run assets:students                 # 上面两步的快捷方式
npm test                                # 契约测试必须全绿
node scripts/build-art-handoff.js       # 重新打包本交接包
```

**回导时必须遵守**：

- 状态图不要手改（会被下一次生成覆盖），要改就改母版。
- 母版改完要重测包围盒（`measure-student-bbox.py`），
  如果并集变了，`students-art.js` 的 `CROP` 表要同步更新，否则人物比例会漂。
- 教室图层**不要用 SVGO 覆盖** —— 它是手绘源文件，压完就没了注释和分组。
- 状态图**可以压**，但必须用 `scripts/svgo-students.config.cjs`：
  它关掉了 `removeHiddenElems` / `cleanupIds` / `collapseGroups`，
  因为状态显隐就靠 `display:none|inline` 实现，SVGO 默认行为会把机制删掉。
- SVG 注释里不能出现连续的 `--`（会被解析成注释结束）。

---

## 9. 配色 token

见同目录 `tokens.json`。主要几组：

| 用途 | 值 |
|---|---|
| 墙面（暖纸白） | `#f5f0e6` → `#e4dccb` |
| 黑板（哑光深绿） | `#396055` → `#27433b` |
| 木框 / 粉笔槽 | `#cdb491` → `#a98b66` |
| 地板 | `#ddd3bf` → `#cdbfa4` |
| 课桌台面 | `#d9c3a1` → `#b99c72` |
| 名牌纸片 | `rgba(250,246,237,.95)`，描边 `rgba(150,130,96,.5)` |
| 女生针织 / 领口 | `#6f7e70` 系列 / `#e9e5d6` |
| 男生浅褐皮肤 | `#e0bea1` → `#8f604b` |
| 角色黄 | `#fff6ab` → `#a6741f` |
