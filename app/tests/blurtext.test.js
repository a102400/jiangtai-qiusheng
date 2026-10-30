'use strict';

/**
 * blurtext.js 契约测试（React Bits BlurText 的 blur 档）
 * ------------------------------------------------------------------
 * 模板给的是：stepDuration 0.35s × 2 段 = 700ms，blur 10px → 5px → 0，
 * y 从 +50px 收到 -5px 再归零，times [0,.5,1]，这一档 fade 用 linear。
 * 中文唯一的改动是「按字拆 + 标点粘前字」，这里把两件事都钉住：
 *   1. 拆完的字序、标点归属不能变（否则句子读起来会断在奇怪的地方）
 *   2. 错峰必须压缩（40 个字按 200ms 排要 8 秒才出现完）
 *   3. 减少动效时不拆（拆了但动画被关掉，等于把文字变成一堆 span 却没收益）
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { makeEl, makeEnv } = require('./_dom.js');

const PUB = path.join(__dirname, '..', 'public');
const SRC = fs.readFileSync(path.join(PUB, 'blurtext.js'), 'utf8');

function boot(opts) {
  const env = makeEnv(opts);
  vm.runInNewContext(SRC, env.sandbox, { filename: 'blurtext.js' });
  return env;
}

function summaryEl(text) {
  const el = makeEl('p');
  el.className = 'score-sum';
  el.textContent = text;
  return el;
}

/* ---------------- 1. 分词 ---------------- */

test('piecesOf：中文按字拆，句读标点粘在前一个字上', () => {
  const env = boot();
  // 跨 vm 边界的数组原型不同，deepStrictEqual 会误判，先落地成宿主数组
  const parts = Array.from(env.win.jtqBlurText.piecesOf('讲解清楚了，但结论下得太快。'));
  assert.deepStrictEqual(parts.slice(0, 6), ['讲', '解', '清', '楚', '了，', '但']);
  assert.strictEqual(parts[parts.length - 1], '快。', '句号必须粘在「快」后面');
  assert.strictEqual(parts.join(''), '讲解清楚了，但结论下得太快。', '拼回去必须与原文一致');
  parts.forEach((p) => assert.ok(p !== '，' && p !== '。', '不能有孤立的标点片'));
});

test('piecesOf：以标点开头的病态输入不会产出孤立标点片', () => {
  const env = boot();
  const parts = Array.from(env.win.jtqBlurText.piecesOf('。这句话开头就是句号'));
  assert.strictEqual(parts.join(''), '。这句话开头就是句号');
  assert.ok(parts[0].length > 1, '首个片段应把句号带进去：' + parts[0]);
});

/* ---------------- 2. 结构 ---------------- */

test('mount：按片段建 span，序号连续，原文另存一份给读屏', () => {
  const env = boot();
  const text = '语速偏快，提问太少。';
  const el = summaryEl(text);

  assert.strictEqual(env.win.jtqBlurText.mount(el), true);

  const pieces = Array.from(el.querySelectorAll('.bt-piece'));
  // 10 个字里有 2 个标点（，。），它们并入前一个字 → 8 片
  assert.strictEqual(pieces.length, 8, '片数 = 字数 - 被并进前字的标点数');
  assert.strictEqual(pieces.map((p) => p.textContent).join(''), text);
  pieces.forEach((p, i) => {
    assert.strictEqual(p.style['--i'], String(i), '序号必须连续，否则错峰会乱序');
    assert.strictEqual(p.getAttribute('aria-hidden'), 'true');
  });

  const sr = el.querySelectorAll('span').filter((s) => s.classList.contains('sr-only'))[0];
  assert.ok(sr, '必须留一份完整的 .sr-only 给读屏');
  assert.strictEqual(sr.textContent, text);
  assert.strictEqual(el.getAttribute('data-bt-text'), text);
  assert.ok(el.classList.contains('is-blurtext'));
});

test('mount：片段多时压缩错峰，总错峰不超过 1 秒', () => {
  const env = boot();
  const long = '这一段结论一共有三十个字所以按二百毫秒排会拖到六秒以后才显示完';
  const el = summaryEl(long);
  env.win.jtqBlurText.mount(el);

  const pieces = el.querySelectorAll('.bt-piece');
  const last = pieces[pieces.length - 1];
  const stagger = parseInt(last.style['--bt-stagger'], 10);
  assert.ok(stagger > 0 && stagger <= 200, '单片错峰必须在 (0, 200] 内：' + stagger);
  assert.ok((pieces.length - 1) * stagger <= 1000,
    '总错峰应被压进 1 秒内，实际 ' + ((pieces.length - 1) * stagger) + 'ms');
});

test('mount：同一段文字不重播（切 tab / 重渲染历史时不该反复糊屏）', () => {
  const env = boot();
  const el = summaryEl('分数还行，但节奏太赶。');
  assert.strictEqual(env.win.jtqBlurText.mount(el), true);
  assert.strictEqual(env.win.jtqBlurText.mount(el), false, '同文本第二次必须不做事');
  assert.strictEqual(el.querySelectorAll('.bt-piece').length, 9,
    '11 个字 2 个标点 → 9 片，不能重复拆一层');
});

test('mount：文字换了要重新拆（第二次分析的结论是新的）', () => {
  const env = boot();
  const el = summaryEl('第一版结论。');
  env.win.jtqBlurText.mount(el);
  el.textContent = '第二版结论，更长一些。';
  assert.strictEqual(env.win.jtqBlurText.mount(el), true);
  assert.strictEqual(
    el.querySelectorAll('.bt-piece').map((p) => p.textContent).join(''),
    '第二版结论，更长一些。'
  );
});

test('mount：空文本 / 单片 / 减少动效 一律不拆', () => {
  const empty = summaryEl('');
  const env = boot();
  assert.strictEqual(env.win.jtqBlurText.mount(empty), false, '空文本不拆');

  const one = summaryEl('好');
  assert.strictEqual(env.win.jtqBlurText.mount(one), false, '只有一个字没有「渐入」可言');

  const reduceEnv = boot({ reduce: true });
  const el = summaryEl('减少动效时这段文字要原样可读。');
  assert.strictEqual(reduceEnv.win.jtqBlurText.mount(el), false);
  assert.strictEqual(el.querySelectorAll('.bt-piece').length, 0, 'reduce 时不能拆成 span');
  assert.strictEqual(el.textContent, '减少动效时这段文字要原样可读。');
});

test('mount：动画结束会标 is-bt-settled（用于清掉 will-change）', () => {
  const env = boot();
  const el = summaryEl('动画结束后要收尾。');
  env.win.jtqBlurText.mount(el);
  const pieces = el.querySelectorAll('.bt-piece');
  pieces[pieces.length - 1].dispatch('animationend');
  assert.ok(el.classList.contains('is-bt-settled'));
});

/* ---------------- 3. 样式与接线 ---------------- */

test('motion.css：关键帧就是模板 blur 档的三帧（10px/5px/0，+50px/-5px/0）', () => {
  const css = fs.readFileSync(path.join(PUB, 'motion.css'), 'utf8');
  const kf = css.slice(css.indexOf('@keyframes bt-in'));
  const body = kf.slice(0, kf.indexOf('}', kf.indexOf('100%')));
  assert.ok(body.indexOf('blur(10px)') !== -1, '起始模糊 10px');
  assert.ok(body.indexOf('blur(5px)') !== -1, '中点模糊 5px');
  assert.ok(body.indexOf('translate3d(0,50px,0)') !== -1, '起始下移 50px');
  assert.ok(body.indexOf('translate3d(0,-5px,0)') !== -1, '中点回弹到 -5px');
  assert.ok(css.indexOf('animation:bt-in 700ms linear both') !== -1,
    '时长 700ms（模板 stepDuration 0.35 × 2 段）、这一档模板用 linear');
});

test('接线：index.html 在 app.js 之前引 blurtext.js，构建脚本也内联了它', () => {
  const html = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
  assert.ok(/<script src="blurtext\.js\?v=[^"]+"><\/script>/.test(html));
  assert.ok(html.indexOf('blurtext.js') < html.indexOf('app.js'));

  const build = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'build-standalone.js'), 'utf8');
  assert.ok(build.indexOf("'blurtext.js'") !== -1, '离线版必须内联 blurtext.js');

  const app = fs.readFileSync(path.join(PUB, 'app.js'), 'utf8');
  assert.ok(app.indexOf('window.jtqBlurText.mount(scoreSummary)') !== -1,
    '结论句必须真的接上 blurtext');
});

test('piecesOf：英文单词间的空格换成不换行空格（否则宽度被折叠、单词会粘一起）', () => {
  const env = boot();
  const parts = Array.from(env.win.jtqBlurText.piecesOf('AI 试讲教练，先练胆。'));
  const space = parts.filter((p) => p === '\u00A0');
  assert.strictEqual(space.length, 1, '两个单词之间应恰好保留一个不换行空格片');
  assert.strictEqual(
    parts.join('').replace(/\u00A0/g, ' '),
    'AI 试讲教练，先练胆。',
    '还原成普通空格后必须与原文一致'
  );
});
