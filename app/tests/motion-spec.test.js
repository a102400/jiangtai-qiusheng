'use strict';

/**
 * 参数对照表（motion-spec.html）的防漂移测试
 * ------------------------------------------------------------------
 * 这张表的唯一价值是「数字是对的」。所以不从页面读数字去比页面，
 * 而是从**源码**读真值，再要求页面里出现同样的字符串：
 *   countup.js 的 DURATION / GRID_DURATION / STAGGER / CELL
 *   blurtext.js 的 STEP / DELAY
 *   msg.css 的 --msg-enter-dist / --rb-spring 峰值
 *   fx.js 的 MAX_DEG / 密度分母
 *   material.css 的 --blur
 * 任何一处改了源码忘了改表，这里立刻红。
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PUB = path.join(__dirname, '..', 'public');
const read = (f) => fs.readFileSync(path.join(PUB, f), 'utf8');
const SPEC = read('motion-spec.html');

function grab(src, re, label) {
  const m = src.match(re);
  assert.ok(m, '源码里找不到 ' + label + '（正则 ' + re + '）');
  return m[1];
}

test('对照表：数字滚动的时长与错峰与源码一致', () => {
  const src = read('countup.js');
  const dur = grab(src, /var DURATION = ([\d.]+);/, 'DURATION');
  const grid = grab(src, /var GRID_DURATION = ([\d.]+);/, 'GRID_DURATION');
  const stagger = grab(src, /var STAGGER = ([\d.]+);/, 'STAGGER');
  const cell = grab(src, /var CELL = ([\d.]+);/, 'CELL');

  assert.strictEqual(dur, '2');
  assert.strictEqual(grid, '1.1');
  assert.ok(SPEC.indexOf('机械数字列 · ' + dur + 's') !== -1, '表里总分时长要对得上（' + dur + 's）');
  assert.ok(SPEC.indexOf('文本插值 · ' + grid + 's') !== -1, '表里指标卡时长要对得上（' + grid + 's）');
  assert.ok(SPEC.indexOf(stagger + 's（压进总时长 40%）') !== -1, '表里列错峰要对得上（' + stagger + 's）');
  assert.ok(SPEC.indexOf(cell + 'em / 格') !== -1, '表里数字格尺寸要对得上（' + cell + 'em）');
});

test('对照表：模糊渐入的时长与错峰与源码一致', () => {
  const src = read('blurtext.js');
  const step = Number(grab(src, /var STEP = (\d+);\s*\/\/ ms/, 'STEP'));
  const delay = Number(grab(src, /var DELAY = (\d+);\s*\/\/ ms/, 'DELAY'));
  assert.strictEqual(step, 350);
  assert.strictEqual(delay, 200);
  assert.ok(SPEC.indexOf(step * 2 + 'ms（' + step + 'ms × 2 段）') !== -1,
    '表里单字时长要对得上（' + step * 2 + 'ms）');
  assert.ok(SPEC.indexOf(delay + 'ms，压缩到总错峰 ≤1s') !== -1,
    '表里逐字错峰要对得上（' + delay + 'ms）');
});

test('对照表：消息入场位移与弹簧峰值与源码一致', () => {
  const css = read('msg.css');
  const dist = grab(css, /--msg-enter-dist:\s*(\d+px);/, '--msg-enter-dist');
  assert.strictEqual(dist, '18px');
  assert.ok(SPEC.indexOf(dist + '（模板 28px）') !== -1, '表里位移要对得上（' + dist + '）');
  // 峰值取 --rb-spring 里最大的那个采样点
  const line = css.slice(css.indexOf('--rb-spring'), css.indexOf('--rb-ease-out'));
  const nums = line.match(/[\d.]+/g).map(Number).filter((n) => Number.isFinite(n));
  const peak = Math.max.apply(null, nums);
  assert.ok(peak > 1.05 && peak < 1.1, '弹簧峰值应在 1.05~1.1，实际 ' + peak);
  assert.ok(SPEC.indexOf('峰值 ' + peak.toFixed(4)) !== -1 ||
    SPEC.indexOf('峰值 ' + String(peak)) !== -1,
    '表里弹簧峰值要对得上（' + peak + '）');
});

test('对照表：倾斜上限、粒子密度、毛玻璃半径与源码一致', () => {
  const fx = read('fx.js');
  const deg = grab(fx, /var MAX_DEG = ([\d.]+);/, 'MAX_DEG');
  assert.strictEqual(deg, '6.5');
  assert.ok(SPEC.indexOf(deg + '°（perspective 900px）') !== -1, '表里倾斜上限要对得上');

  const den = grab(fx, /\(w \* h\) \/ (\d+)/, '粒子密度分母');
  assert.strictEqual(den, '13000');
  assert.ok(SPEC.indexOf('面积 ÷ ' + den) !== -1, '表里粒子密度要对得上（÷' + den + '）');

  const blur = grab(read('material.css'), /--blur:\s*(\d+px);/, '--blur');
  assert.ok(SPEC.indexOf('blur ' + blur) !== -1, '表里毛玻璃半径要对得上（' + blur + '）');
});

test('对照表：每一项都有默认值，且十个分区都在', () => {
  const ids = SPEC.match(/\{ id: '[a-z0-9-]+'/g) || [];
  assert.ok(ids.length >= 50, '参数项应覆盖全部动效层，当前只有 ' + ids.length + ' 项');
  const sections = (SPEC.match(/title: '/g) || []).length;
  assert.ok(sections >= 10, '至少十个分区（渐入/标题/材质/粒子/倾斜/数字/模糊/消息/交互/降级），当前 ' + sections);
  // 默认全「要」，用户只点不要的那几项
  assert.ok(SPEC.indexOf("if (!state[r.id]) state[r.id] = 'yes';") !== -1);
});
