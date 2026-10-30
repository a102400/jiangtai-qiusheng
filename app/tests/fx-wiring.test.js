/* 特效层「接线」契约测试
 *
 * 背景：fx.js 曾经「上线了但用户看不见」，原因不是脚本没跑，而是三处接线断点：
 *   1. styles.css 的 ?v= 版本号从 10-22 起就没变过 → 浏览器一直用缓存里的旧 CSS，
 *      新加的 #fxCanvas / #fxAurora 定位规则根本没生效；
 *   2. landing.html 有 `html, body {background:...!important}`，html 一旦自带背景，
 *      body 背景就不再传播给 canvas，body 自己画一层不透明底色，把 z-index:-1 的
 *      图层整层遮住；
 *   3. landing.html / workbench.html 压根没引 fx.js 和样式，页面里一点特效都没有。
 *
 * 这组测试锁的就是「接线」，不是视觉——视觉靠人眼，接线必须靠断言。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PUB = path.join(__dirname, '..', 'public');
const read = (f) => fs.readFileSync(path.join(PUB, f), 'utf8');

/* ---------------- fx.css 必须存在且自带背景让位规则 ---------------- */

test('fx.css 存在，并声明了极光/画布/红闪三个图层', () => {
  const css = read('fx.css');
  assert.ok(css.includes('#fxAurora'), '缺极光层样式');
  assert.ok(css.includes('#fxCanvas'), '缺粒子画布样式');
  assert.ok(css.includes('#fxFlash'), '缺拆台红闪样式');
});

test('fx.css 让出 html 背景（否则负层级图层会被 body 底色遮住）', () => {
  const css = read('fx.css');
  // 必须带 !important：页面内联样式里那条 `html, body{background:...!important}` 是同一特异性
  assert.match(
    css,
    /html\s*\{[^}]*background-color\s*:\s*transparent\s*!important/,
    'fx.css 必须以 !important 把 html 背景设为 transparent，否则 body 背景不传播，特效被遮'
  );
});

test('fx.css 对 reduced-motion 与打印都有屏蔽', () => {
  const css = read('fx.css');
  const rm = css.indexOf('prefers-reduced-motion: reduce');
  assert.ok(rm !== -1, '缺少 reduced-motion 屏蔽');
  assert.ok(css.indexOf('@media print') !== -1, '缺少打印屏蔽');
});

/* ---------------- 三个页面都真的接上了 ---------------- */

const PAGES = ['index.html', 'landing.html', 'workbench.html'];

for (const page of PAGES) {
  test(page + '：同时引入 fx.css 与 fx.js', () => {
    const html = read(page);
    assert.ok(/href="fx\.css\?v=/.test(html), page + ' 没有引入 fx.css');
    assert.ok(/src="fx\.js\?v=/.test(html), page + ' 没有引入 fx.js');
  });

  test(page + '：fx.css 排在 <head> 内联 <style> 之后（否则 !important 会输）', () => {
    const html = read(page);
    /* 只看 <head>：body 里可以有各模块自带的 scoped <style>（如 workbench 的 #codex），
       它们不碰根元素背景，排在 fx.css 之后也遮不住特效层。
       早先用 lastIndexOf('</style>') 扫全文，被这类块误判成失败 —— 是测试写错了，不是页面错。 */
    const headEnd = html.indexOf('</head>');
    const head = headEnd === -1 ? html : html.slice(0, headEnd);
    const lastStyleClose = head.lastIndexOf('</style>');
    const linkAt = head.indexOf('fx.css');
    assert.ok(linkAt !== -1, page + ' 的 <head> 里没有 fx.css');
    if (lastStyleClose !== -1) {
      assert.ok(
        linkAt > lastStyleClose,
        page + ' 的 fx.css 在 <head> 内联 <style> 之前，html 背景那条 !important 会赢，特效被遮'
      );
    }
  });

  test(page + '：<body> 内的 scoped <style> 不得重设 html/body 背景', () => {
    const html = read(page);
    const headEnd = html.indexOf('</head>');
    const body = headEnd === -1 ? '' : html.slice(headEnd);
    const blocks = body.match(/<style[^>]*>[\s\S]*?<\/style>/gi) || [];

    for (const block of blocks) {
      const stripped = block.replace(/\/\*[\s\S]*?\*\//g, '');
      /* 真正危险的写法只有一种：body 里的 style 以 html/body 为选择器设背景。
         它排在 fx.css 之后，两个 !important 相撞时后者赢，负层级特效会被整层盖住
         （landing.html 历史上就踩过）。#codex 这类 scoped 块不匹配，不会误报。 */
      assert.ok(
        !/[\s,{](?:html|body)\s*(?:,[^{]*)?\{[^}]*background/i.test(stripped),
        page + ' 的 <body> 内联 <style> 给 html/body 设了背景，会盖住 fx 负层级'
      );
    }
  });
}

/* ---------------- 缓存版本号必须成对出现 ---------------- */

test('fx.css 与 fx.js 的版本号一致（避免只刷了一个）', () => {
  for (const page of PAGES) {
    const html = read(page);
    // 前面的边界不能省：项目里还有 rb-fx.css / rb-fx.js，
    // 裸写 /fx\.js\?v=/ 会先命中 rb-fx.js，于是拿两个不同文件的版本号互比。
    const cssV = (html.match(/(?:^|["/])fx\.css\?v=([^"]+)"/) || [])[1];
    const jsV = (html.match(/(?:^|["/])fx\.js\?v=([^"]+)"/) || [])[1];
    assert.ok(cssV, page + ' 的 fx.css 缺版本号');
    assert.ok(jsV, page + ' 的 fx.js 缺版本号');
    assert.strictEqual(cssV, jsV, page + ' 的 fx.css / fx.js 版本号不一致：' + cssV + ' vs ' + jsV);
  }
});

test('styles.css 里不再重复定义特效图层（避免两处口径分裂）', () => {
  const css = read('styles.css');
  assert.ok(!css.includes('#fxAurora'), 'styles.css 仍在定义 #fxAurora，应与 fx.css 二选一');
  assert.ok(!css.includes('#fxCanvas'), 'styles.css 仍在定义 #fxCanvas，应与 fx.css 二选一');
});

/* ---------------- 粒子密度护栏：够亮但不能变成下雪 ---------------- */

test('粒子数量夹在 40~110（太稀看不见，太密像下雪）', () => {
  const src = read('fx.js');
  const m = src.match(/Math\.max\((\d+),\s*Math\.min\((\d+),\s*n\)\)/);
  assert.ok(m, '没找到粒子数量夹逼表达式');
  const lo = Number(m[1]);
  const hi = Number(m[2]);
  assert.strictEqual(lo, 40, '下限应为 40，实际 ' + lo);
  assert.strictEqual(hi, 110, '上限应为 110，实际 ' + hi);
});
