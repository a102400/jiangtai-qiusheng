'use strict';

/**
 * countup.js 契约测试（React Bits CountUp 的原式搬运）
 * ------------------------------------------------------------------
 * 「搬了模板」这句话必须能被数字验证，所以这里不测样式，只测模板里
 * 那几个决定观感的数值行为：
 *   1. roll 模式的行进量 delta = mod10(to-from) + 10 * turns，
 *      turns = min(floor(|to-from| / 10^(place+1)), max(0, 3-rank))
 *   2. easeOut 就是 cubicBezier(0.33, 1, 0.68, 1)：0→1，且前段快
 *   3. spring 补偿项 residual*t³ 保证 t=1 收敛到 1（否则末位会抖）
 *   4. count 模式只写第一个数字文本节点，`<u>%</u>` 一个字都不能坏
 *   5. 隐藏 / 未提供 / 无法测量 一律不动；同值不重播（否则 MO 自激）
 *   6. reduced-motion 直接落终值
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { makeEl, makeEnv } = require('./_dom.js');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'countup.js'), 'utf8');

function boot(opts) {
  const env = makeEnv(opts);
  vm.runInNewContext(SRC, env.sandbox, { filename: 'countup.js' });
  return env;
}

function api(env) {
  return env.win.jtqCount;
}

function metricCard(parent, value, unit) {
  const card = makeEl('div');
  card.className = 'metric ok';
  const val = makeEl('div');
  val.className = 'val';
  val.textContent = String(value);
  if (unit !== undefined) {
    const u = makeEl('u');
    u.textContent = unit;
    val.appendChild(u);
  }
  card.appendChild(val);
  parent.appendChild(card);
  return val;
}

/* ---------------- 1. 行进量：纯函数 ---------------- */

test('buildRoll：0→87 时个位多转、十位少转（模板的 rank 规则）', () => {
  const env = boot();
  const m = api(env).debug.buildRoll(0, 87, false);
  assert.strictEqual(m.columns.length, 2, '87 是两位数，应有 2 个数字列');
  const tens = m.columns[0];
  const units = m.columns[1];
  assert.strictEqual(tens.place, 1);
  assert.strictEqual(units.place, 0);
  // 十位：floor(87 / 10^2) = 0 圈，只走 0→8 的差值 8 格
  assert.strictEqual(tens.delta, 8, '十位不该空转');
  // 个位：rank = 右边还有几列 = 0 → 上限 max(0, 3-0) = 3 圈；
  // floor(87 / 10^1) = 8 圈被夹到 3 圈 → 7 + 30 = 37 格
  assert.strictEqual(units.delta, 37, '个位应走 7 格 + 3 整圈 = 37');
});

test('buildRoll：0→100 时百位入场、个位十位归零', () => {
  const env = boot();
  const m = api(env).debug.buildRoll(0, 100, false);
  assert.strictEqual(m.columns.length, 3);
  assert.strictEqual(m.columns[2].to, 0, '个位终值 0');
  assert.strictEqual(m.columns[1].to, 0, '十位终值 0');
  assert.strictEqual(m.columns[0].to, 1, '百位终值 1');
  // 100 的个位：floor(100/10)=10 圈 → 夹到 max(0, 3-0)=3 圈 → 0 + 30
  assert.strictEqual(m.columns[2].delta, 30);
  // 百位最左、rank=2 → 上限 1 圈；floor(100/1000)=0 → 只走 0→1 的 1 格
  assert.strictEqual(m.columns[0].delta, 1);
});

test('buildRoll：同值不转（delta 全 0），小数位按位数补齐', () => {
  const env = boot();
  const same = api(env).debug.buildRoll(75, 75, false);
  same.columns.forEach((c) => assert.strictEqual(c.delta, 0, '同值必须零位移'));

  const dec = api(env).debug.buildRoll(0, 1.15, false, { digits: 2 });
  assert.strictEqual(dec.columns.length, 3, '1.15 应拆成 3 个数字列');
  assert.ok(dec.slots.some((s) => s.char === '.'), '小数点必须是字符槽，不能当数字列');
});

test('buildRoll：下降时反向转（base 取负）', () => {
  const env = boot();
  const m = api(env).debug.buildRoll(87, 60, false);
  assert.ok(m.columns.every((c) => c.delta <= 0), '回退时必须往回滚：' + m.columns.map((c) => c.delta));
});

/* ---------------- 2. 曲线 ---------------- */

test('easeOut 就是 cubicBezier(0.33,1,0.68,1)：两端收敛、前段快', () => {
  const env = boot();
  const e = api(env).debug.easings.easeOut;
  assert.strictEqual(e(0), 0);
  assert.strictEqual(e(1), 1);
  assert.ok(e(0.15) > 0.35, '0.15 处应已跑到 38% 左右（实测 0.3866）');
  let prev = 0;
  for (let i = 1; i <= 20; i++) {
    const v = e(i / 20);
    assert.ok(v >= prev - 1e-9, '必须单调递增 @' + (i / 20));
    prev = v;
  }
  assert.ok(Math.abs(e(0.5) - 0.8722) < 0.02, '中点应为 0.8722（这条曲线前段极快、后半段收得很慢）');
});

test('spring(0.06)：有轻微过冲，但 t=1 严格收敛到 1', () => {
  const env = boot();
  const s = api(env).debug.makeSpring(0.06);
  assert.strictEqual(s(1), 1, 'residual 补偿必须让终点精确落在 1');
  let peak = 0;
  for (let i = 0; i <= 100; i++) peak = Math.max(peak, s(i / 100));
  assert.ok(peak > 1, '应有过冲（否则不叫 spring）');
  assert.ok(peak < 1.15, '过冲应 <15%，否则数字会明显冲出再回来（实际 ' + peak.toFixed(4) + '）');
});

/* ---------------- 3. 格式化 ---------------- */

test('formatValue：小数位、千分位、负号都在该在的位置', () => {
  const env = boot();
  const f = api(env).formatValue;
  assert.strictEqual(f(87, 0), '87');
  assert.strictEqual(f(1.15, 2), '1.15');
  assert.strictEqual(f(1234, 0, ','), '1,234');
  assert.strictEqual(f(-7, 0), '-7');
  assert.strictEqual(f(2.5, 1, '', '', '%'), '2.5%');
});

/* ---------------- 4. count 模式：只动数字文本节点 ---------------- */

test('count：动画只改数字，`<u>%</u>` 单位节点不动', () => {
  const env = boot();
  const val = metricCard(env.body, 87, '%');
  const count = api(env).count;
  count(val, 0, 87, { duration: 1 });
  env.frames(50);

  assert.strictEqual(val.childNodes[0].nodeValue, '87', '数字应落到终值');
  assert.strictEqual(val.childNodes[1].tagName, 'U', '单位节点不能被替换掉');
  assert.strictEqual(val.childNodes[1].textContent, '%');
  assert.strictEqual(val.textContent, '87%', '整体文本必须可复制、可被读屏');
});

test('count：小数按位数补齐（0→1.15 期间不会突然变成整数）', () => {
  const env = boot();
  const val = metricCard(env.body, 1.15);
  api(env).count(val, 0, 1.15, { duration: 0.2 });
  // 只跑第一帧，看中间值
  env.t = 0;
  env.frames(50, 1);
  assert.ok(/^\d\.\d\d$/.test(val.childNodes[0].nodeValue),
    '中间态必须保持两位小数：' + val.childNodes[0].nodeValue);
  env.frames(50);
  assert.strictEqual(val.childNodes[0].nodeValue, '1.15');
});

/* ---------------- 5. 扫描：跳过、去重、隐藏不跑 ---------------- */

test('scan：只挑数字，未提供 / 无法测量 / — 一律不动', () => {
  const env = boot();
  const ok = metricCard(env.body, 32, '%');
  const dash = metricCard(env.body, '—');
  const none = metricCard(env.body, '未提供');

  const n = api(env).scan();
  assert.strictEqual(n, 1, '只有一个是数字，其余应跳过');
  assert.ok(ok.hasAttribute('data-count-to'));
  assert.strictEqual(dash.getAttribute('data-count-to'), null, '「—」不能被当成 0');
  assert.strictEqual(none.getAttribute('data-count-to'), null, '「未提供」不能变成 0');
});

test('scan：同一个值只播一次（否则 MO 每触发一次就重播一遍）', () => {
  const env = boot();
  metricCard(env.body, 87, '%');
  assert.strictEqual(api(env).scan(), 1);
  assert.strictEqual(api(env).scan(), 0, '第二遍应全部跳过');
});

test('scan：隐藏（display:none）时不跑，等可见后再补', () => {
  const env = boot();
  const val = metricCard(env.body, 87, '%');
  val._hidden = true;                       // 相当于报告区还是 hidden
  assert.strictEqual(api(env).scan(), 0, '隐藏状态下不能提前跑');
  assert.strictEqual(val.getAttribute('data-count-to'), null);

  val._hidden = false;
  assert.strictEqual(api(env).scan(), 1, '变可见后要能补上');
});

test('reduced-motion：不做动画，直接落终值', () => {
  const env = boot({ reduce: true });
  const val = metricCard(env.body, 87, '%');
  assert.strictEqual(api(env).scan(), 0, 'reduce 时整个扫描不启动');

  // 显式调用也必须立刻到位，不能留中间态
  api(env).count(val, 0, 87, { duration: 2 });
  assert.strictEqual(val.childNodes[0].nodeValue, '87');
});

/* ---------------- 6. 报告总分：数字列 + 分数环同步 ---------------- */

test('score：总分以数字列滚到终值，class 标 settled', () => {
  const env = boot();
  const ring = makeEl('div');
  ring.className = 'ring';
  const num = makeEl('span');
  num.textContent = '--';
  ring.appendChild(num);
  env.doc._ids.scoreRing = ring;
  env.doc._ids.scoreNum = num;

  api(env).score(87);
  env.frames(100);

  assert.strictEqual(num.textContent, '87', '最终必须能读到纯净的 87');
  assert.ok(num.classList.contains('is-settled'), '落位后应标 is-settled 以便清掉 will-change');
  assert.ok(ring.style.background.indexOf('87.00%') !== -1,
    '分数环要停在与分数一致的位置：' + ring.style.background);
  assert.strictEqual(ring.style.transition, '', '动画结束要把 transition 交还给 CSS');
});

test('score：第二遍从当前值接着走，不从 0 重来', () => {
  const env = boot();
  const ring = makeEl('div');
  const num = makeEl('span');
  num.textContent = '--';
  ring.appendChild(num);
  env.doc._ids.scoreRing = ring;
  env.doc._ids.scoreNum = num;

  api(env).score(80);
  env.frames(100);
  assert.strictEqual(num.textContent, '80');

  api(env).score(60);
  assert.strictEqual(num.getAttribute('data-cu-start'), '80',
    '第二次滚动必须从当前值 80 起跑，不能从 0 重来（否则画面先掉回 0 再冲）');
  env.frames(100);
  assert.strictEqual(num.textContent, '60', '落位仍是纯文本');
});

test('score：越界分数被夹到 0–100', () => {
  const env = boot();
  const num = makeEl('span');
  num.textContent = '--';
  env.doc._ids.scoreNum = num;
  api(env).score(230);
  env.frames(100);
  assert.strictEqual(num.textContent, '100');
});

/* ---------------- 7. 接线：页面必须真的引用了它 ---------------- */

test('接线：index.html 引了 countup.js，构建脚本也内联了它', () => {
  const pub = path.join(__dirname, '..', 'public');
  const html = fs.readFileSync(path.join(pub, 'index.html'), 'utf8');
  assert.ok(/<script src="countup\.js\?v=[^"]+"><\/script>/.test(html), 'index.html 必须引用 countup.js');
  assert.ok(html.indexOf('countup.js') < html.indexOf('app.js'),
    'countup.js 要在 app.js 之前就位，否则首次渲染时 window.jtqCount 还不存在');

  const build = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'build-standalone.js'), 'utf8');
  assert.ok(build.indexOf("'countup.js'") !== -1, '离线单文件版必须内联 countup.js');
});

test('接线：app.js 走 countup，且保留无 countup 时的静态兜底', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  assert.ok(app.indexOf('window.jtqCount.score(score)') !== -1, 'app.js 必须调用 jtqCount.score');
  assert.ok(app.indexOf("'conic-gradient(var(--brand) 0 ' + score") !== -1,
    '没有 countup 时必须还有直接画环的兜底，不能出现空白分数');
});
