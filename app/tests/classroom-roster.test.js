'use strict';

/**
 * classroom-roster.js 契约测试
 * ----------------------------------------------------------------
 * 这份测试锁住四件事，每一条都对应一次真实故障：
 *
 *   1. 角色白名单只认自有属性。
 *      旧写法 `CLASS_META[key] || CLASS_META.naughty` 会命中原型链：
 *      key='constructor' 拿到构造函数（truthy），随后 m.avatar 为 undefined，
 *      学生卡片上直接渲染出字符串 "undefined"。
 *
 *   2. 学情数值非法值必须返回 null，不能变成 0。
 *      旧写法 `Number(v) || 0` 让 '   ' / [] / {} 全都通过，
 *      于是「后端没给数据」被画成「专注度 0 分」的红色告警条 ——
 *      把缺失伪装成结论，比不显示更糟。
 *
 *   3. 未提供分数的颜色必须与「0 分」区分开，否则用户看图也无法分辨。
 *
 *   4. app.js 不得退回上述旧写法，且 stopSpeak() 必须真有调用点
 *      （它曾经只有定义、从未被调用，重新开课时旧朗读会继续念）。
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const SRC_FILE = path.join(ROOT, 'public', 'classroom-roster.js');
const APP_FILE = path.join(ROOT, 'public', 'app.js');
const INDEX_FILE = path.join(ROOT, 'public', 'index.html');

/** 在最小 sandbox 里按浏览器方式加载，验证 window.jtqClassRoster 挂载 */
function loadRoster() {
  const sandbox = { window: {}, console };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(
    fs.readFileSync(SRC_FILE, 'utf8'),
    sandbox,
    { filename: 'classroom-roster.js' }
  );
  return sandbox.window.jtqClassRoster;
}

test('加载后挂到 window.jtqClassRoster，导出面完整', () => {
  const R = loadRoster();
  assert.ok(R, 'window.jtqClassRoster 未挂载，app.js 会退回内联兜底');
  ['CLASS_META', 'KEYS', 'UNKNOWN_COLOR'].forEach((k) => assert.ok(R[k], '缺少 ' + k));
  ['hasKey', 'scoreOf', 'colorOf', 'idleRoster'].forEach((fn) => {
    assert.equal(typeof R[fn], 'function', '缺少函数 ' + fn);
  });
});

test('hasKey 只认自有属性：constructor / toString / __proto__ 一律拒绝', () => {
  const R = loadRoster();

  ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf'].forEach((k) => {
    assert.equal(R.hasKey(k), false, '原型链属性被当成合法角色：' + k);
  });

  ['', ' ', 'naughty2', 'Naughty'].forEach((k) => {
    assert.equal(R.hasKey(k), false, '非法 key 被接受：' + JSON.stringify(k));
  });

  [null, undefined, 0, 1, true, {}, [], () => {}].forEach((v) => {
    assert.equal(R.hasKey(v), false, '非字符串被接受：' + String(v));
  });

  ['naughty', 'geek', 'drift'].forEach((k) => {
    assert.equal(R.hasKey(k), true, '合法角色被拒绝：' + k);
  });
});

test('scoreOf：空白、数组、对象、布尔、非数一律是「未提供」', () => {
  const R = loadRoster();

  const unknown = [
    '', '   ', '\n\t', 'abc', '6a',
    [], [0], [62], [62, 70],
    {}, { value: 62 },
    true, false,
    NaN, Infinity, -Infinity,
    null, undefined,
  ];

  unknown.forEach((v) => {
    const label = JSON.stringify(v) === undefined ? String(v) : JSON.stringify(v);
    assert.equal(R.scoreOf(v), null, '非法值未返回 null：' + label);
  });
});

test('scoreOf：合法数字规整成 0–100 的整数', () => {
  const R = loadRoster();

  assert.equal(R.scoreOf(0), 0);
  assert.equal(R.scoreOf('0'), 0);
  assert.equal(R.scoreOf(' 62 '), 62);
  assert.equal(R.scoreOf('62'), 62);
  assert.equal(R.scoreOf(62.4), 62);
  assert.equal(R.scoreOf(62.5), 63);
  assert.equal(R.scoreOf(100), 100);

  // 越界要夹住，不能把 150 的宽度画到卡片外面
  assert.equal(R.scoreOf(150), 100);
  assert.equal(R.scoreOf('150'), 100);
  assert.equal(R.scoreOf(-20), 0);
});

test('colorOf：三档语义色，未提供用中性灰且不能撞「0 分」红', () => {
  const R = loadRoster();

  assert.equal(R.colorOf(70), '#16a34a');
  assert.equal(R.colorOf(100), '#16a34a');
  assert.equal(R.colorOf(69), '#f59e0b');
  assert.equal(R.colorOf(45), '#f59e0b');
  assert.equal(R.colorOf(44), '#dc2626');
  assert.equal(R.colorOf(0), '#dc2626');

  assert.equal(R.colorOf('   '), R.UNKNOWN_COLOR);
  assert.equal(R.colorOf(null), R.UNKNOWN_COLOR);
  assert.equal(R.colorOf([]), R.UNKNOWN_COLOR);

  assert.notEqual(
    R.UNKNOWN_COLOR,
    '#dc2626',
    '「未提供」和「0 分」同色，用户看图分不出缺数据还是真垫底'
  );
});

test('idleRoster：三人齐、分数为 null、每次返回新数组', () => {
  const R = loadRoster();

  const first = R.idleRoster();
  assert.deepEqual(first.map((s) => s.key), ['naughty', 'geek', 'drift']);

  first.forEach((s) => {
    assert.equal(s.attention, null, s.key + ' 的默认专注度应为 null');
    assert.equal(s.comprehension, null, s.key + ' 的默认理解度应为 null');
    assert.equal(s.speaking, false);
    assert.ok(s.name, s.key + ' 缺少显示名');
  });

  first[0].name = '被外部改坏';
  assert.notEqual(R.idleRoster()[0].name, '被外部改坏', 'idleRoster 返回了共享引用');
});

test('CLASS_META 与 KEYS 一一对应，没有多余角色', () => {
  const R = loadRoster();
  assert.deepEqual(
    Object.keys(R.CLASS_META).sort(),
    R.KEYS.slice().sort(),
    'KEYS 与 CLASS_META 不一致'
  );
  R.KEYS.forEach((k) => assert.ok(R.CLASS_META[k].name, k + ' 缺少 name'));
});

/* ---------------- 防回归：app.js 不得退回旧写法 ---------------- */

test('app.js 不得裸查 CLASS_META[s.key]', () => {
  const app = fs.readFileSync(APP_FILE, 'utf8');
  assert.equal(
    /CLASS_META\[\s*s\s*\.\s*key\s*\]/.test(app),
    false,
    'app.js 出现 CLASS_META[s.key] 裸查：constructor / toString 会被当成有效角色，渲染出 undefined'
  );
  assert.equal(
    /Object\.keys\(\s*CLASS_META\s*\)/.test(app),
    false,
    '取角色列表请用 CLASS_KEYS / idleRoster()，不要现算 Object.keys(CLASS_META)'
  );
});

test('app.js 不得用 Number(x) || 0 兜底学情分数', () => {
  const app = fs.readFileSync(APP_FILE, 'utf8');
  assert.equal(
    /Number\([^)]*(attention|comprehension)[^)]*\)\s*\|\|\s*0/.test(app),
    false,
    'app.js 出现 Number(attention) || 0：空白串会被算成 0 分红色告警'
  );
});

test('stopSpeak() 必须真有调用点', () => {
  const app = fs.readFileSync(APP_FILE, 'utf8');
  const hits = app.match(/stopSpeak\(\)/g) || [];
  // 1 处是 function stopSpeak() 定义本身，至少还要 1 处真实调用
  assert.ok(
    hits.length >= 2,
    'stopSpeak() 只有定义没有调用（实际命中 ' + hits.length + ' 处）：重新开课时上一节课的朗读会继续念'
  );
  assert.ok(
    /function resetClass\(\)\s*{[^}]*stopSpeak\(\)/.test(app),
    'resetClass() 里必须先 stopSpeak() 再重置课堂状态'
  );
});

test('app.js 必须引用 classroom-roster.js，且它先于 app.js 加载', () => {
  const app = fs.readFileSync(APP_FILE, 'utf8');
  assert.ok(app.includes('jtqClassRoster'), 'app.js 未引用 window.jtqClassRoster');

  const html = fs.readFileSync(INDEX_FILE, 'utf8');
  const rosterAt = html.indexOf('classroom-roster.js');
  const appAt = html.indexOf('src="app.js');

  assert.ok(rosterAt > -1, 'index.html 未引入 classroom-roster.js');
  assert.ok(appAt > -1, 'index.html 未引入 app.js');
  assert.ok(
    rosterAt < appAt,
    'classroom-roster.js 必须在 app.js 之前加载，否则 app.js 只能走内联兜底'
  );
});
