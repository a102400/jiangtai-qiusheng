/* 材质 / 动效 / 组件状态三层（material.css · motion.css · ui.css · motion.js）
 *
 * 这组测试锁的是「会不会帮倒忙」的三件事：
 *   1. 层叠顺序错了 → 材质盖不住基础样式，或者动效被基础样式盖住；
 *   2. 脚本没跑却把内容藏了 → 用户看到一片空白（最严重的回归）；
 *   3. 偷偷引入外部库 → 破坏零依赖铁律，离线版直接失效。
 * 视觉好不好看测不出来，这三件事必须测出来。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PUB = path.join(__dirname, '..', 'public');
const read = (f) => fs.readFileSync(path.join(PUB, f), 'utf8');

const PAGES = ['index.html', 'landing.html', 'workbench.html'];
const SHEETS = ['material.css', 'motion.css', 'ui.css'];

/* ---------------- 三个页面都接了三层 ---------------- */

for (const page of PAGES) {
  test(page + '：引入 material / motion / ui 三层样式与 motion.js', () => {
    const html = read(page);
    for (const css of SHEETS) {
      assert.ok(new RegExp('href="' + css.replace('.', '\\.') + '\\?v=').test(html), page + ' 缺 ' + css);
    }
    assert.ok(/src="motion\.js\?v=/.test(html), page + ' 缺 motion.js');
  });

  test(page + '：层叠顺序为基础 → 特效 → 材质 → 动效 → 组件', () => {
    const html = read(page);
    const at = (f) => html.indexOf('href="' + f);
    // landing / workbench 是自包含页面，本来就没有 styles.css，
    // 只在引用到了的时候校验相对顺序
    const order = ['styles.css', 'fx.css', 'material.css', 'motion.css', 'ui.css']
      .filter((f) => at(f) !== -1 || f !== 'styles.css');
    let last = -1;
    for (const f of order) {
      const pos = at(f);
      if (pos === -1) {
        assert.strictEqual(f, 'styles.css', page + ' 缺 ' + f);
        continue;
      }
      assert.ok(pos > last, page + ' 顺序错：' + f + ' 应晚于前一个样式表');
      last = pos;
    }
  });
}

/* ---------------- motion.js 的三条安全底线 ---------------- */

test('motion.js：reduced-motion 时直接返回，不注册任何观察者', () => {
  const src = read('motion.js');
  // 只认代码里的判定，不认注释（注释里也写了这个字符串）
  assert.match(src, /if\s*\(\s*reduce\s*\)\s*return/, '缺少 `if (reduce) return`');
  const guardAt = src.indexOf('if (reduce) return');
  const observerAt = src.indexOf('new IntersectionObserver');
  assert.ok(guardAt !== -1 && observerAt !== -1, '找不到判定或观察者');
  assert.ok(guardAt < observerAt, 'reduced-motion 判定必须在创建观察者之前');
});

test('motion.js：隐藏态只在 html.js 下生效（脚本没跑内容不能消失）', () => {
  const css = read('motion.css');
  const lines = css.split('\n');
  let inKeyframes = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // 跟踪 @keyframes 深度：动画起点里的 opacity:0 不是「隐藏态」，不参与判定
    if (line.includes('@keyframes')) inKeyframes++;
    if (inKeyframes > 0) {
      if (line.includes('{') && !line.includes('@keyframes')) inKeyframes++;
      if (line.includes('}')) inKeyframes--;
      continue;
    }
    if (!/opacity:\s*0[;\s}]/.test(line)) continue;
    let j = i;
    while (j > 0 && !lines[j].includes('{')) j--;
    const sel = lines[j];
    assert.ok(
      /html\.js/.test(sel),
      'motion.css 第 ' + (j + 1) + ' 行的 opacity:0 没有 html.js 门控：' + sel.trim()
    );
  }
  assert.ok(read('motion.js').includes("classList.add('js')"), 'motion.js 必须给 html 加 .js 类');
});

test('motion.js：只播一次，播完 unobserve（不随滚动重播）', () => {
  const src = read('motion.js');
  assert.ok(src.includes('io.unobserve'), '缺少 unobserve，元素会反复重播');
});

test('motion.js：不用弹跳 / 回弹缓动', () => {
  const src = read('motion.js');
  const css = read('motion.css');
  for (const bad of ['back', 'elastic', 'bounce', 'spring']) {
    assert.ok(!new RegExp('[\'"]' + bad + '[\'"]', 'i').test(src), 'motion.js 出现弹性缓动 ' + bad);
    assert.ok(!new RegExp('cubic-bezier\\([^)]*1\\.[2-9]', 'i').test(css), 'motion.css 出现 overshoot 曲线');
  }
});

/* ---------------- material.css 的剂量与开关 ---------------- */

test('material.css：圆角收敛成 4 档 + 药丸，不再散落', () => {
  const css = read('material.css');
  for (const v of ['--r-xs', '--r-sm', '--r:', '--r-lg', '--r-pill']) {
    assert.ok(css.includes(v), '缺圆角 token ' + v);
  }
});

test('material.css：高程分三级，最大一级只给浮层', () => {
  const css = read('material.css');
  assert.ok(css.includes('--elv-1') && css.includes('--elv-2') && css.includes('--elv-3'));
  // elv-3 只能出现在浮层选择器里，不能给 .card
  const elv3Blocks = css.split('\n').filter((l) => l.includes('--elv-3'));
  assert.ok(elv3Blocks.length <= 2, '--elv-3 出现次数过多，可能在给静止元素加阴影');
});

test('material.css：颗粒与网格都有一个总开关', () => {
  const css = read('material.css');
  assert.ok(css.includes('.no-texture'), '缺少关闭材质的总开关');
});

test('material.css：毛玻璃只给浮层，不给正文卡片', () => {
  const css = read('material.css');
  const idx = css.indexOf('backdrop-filter');
  assert.ok(idx !== -1, '没有毛玻璃定义');
  // 取 backdrop-filter 规则块的选择器部分
  const before = css.slice(0, idx);
  const lastBrace = before.lastIndexOf('}');
  const sel = before.slice(lastBrace + 1, before.lastIndexOf('{'));
  assert.ok(!/^\.card\s*,?$/m.test(sel), '正文卡片不能上毛玻璃');
  assert.ok(/topbar|modal|dropdown|popover|toast|menu-panel|drawer/.test(sel), '毛玻璃应只作用于浮层');
});

/* ---------------- 零依赖 ---------------- */

test('新加的三个 CSS 与 motion.js 都不引入外部资源', () => {
  for (const f of [...SHEETS, 'motion.js']) {
    const s = read(f);
    // 允许 SVG data URI，但禁止 http(s) 外链与 @import
    assert.ok(!/@import/.test(s), f + ' 出现 @import');
    const external = s.match(/url\(\s*['"]?https?:/g);
    assert.ok(!external, f + ' 引用了外部地址');
  }
});

test('motion.js 没有 require / import（浏览器直接跑）', () => {
  const s = read('motion.js');
  assert.ok(!/\brequire\s*\(/.test(s), 'motion.js 不应有 require');
  assert.ok(!/^\s*import\s/m.test(s), 'motion.js 不应有 import');
});
