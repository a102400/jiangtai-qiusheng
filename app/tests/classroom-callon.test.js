'use strict';

/**
 * 课堂点名（点谁谁答）—— 契约测试
 * ------------------------------------------------------------------
 * 覆盖三层：
 *   1. 入参闸门：非法角色必须在调用模型之前就被挡掉（否则白花一次 token）
 *   2. 本地规则分支：三个人设必须说不同的话，质量档与会话压力必须对得上
 *   3. 端到端接线：路由 / 配额白名单 / 离线演示数据 / 前端降级分支
 *
 * 全部零网络：规则分支直接调 classroomCallOnRule，
 * 非法角色在 ai.hasKey() 之前就抛错，所以哪怕 .env 里配了真 Key 也不会打出去。
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const engine = require('../lib/engine.js');
const { classroomCallOnPrompt, CLASS_STUDENTS } = require('../lib/prompts.js');
const { DEFAULT_PROFILE } = require('../lib/profile.js');

const PUBLIC = path.join(__dirname, '..', 'public');
const ROOT = path.join(__dirname, '..');

function profileWith(patch) {
  const p = JSON.parse(JSON.stringify(DEFAULT_PROFILE));
  Object.assign(p.class, patch || {});
  return p;
}

/* ---------- 1. 入参闸门 ---------- */

test('点名：未知角色在调用模型前就被拒绝', async () => {
  for (const bad of ['', 'constructor', 'toString', '__proto__', 'teacher', null, 123]) {
    await assert.rejects(
      () => engine.classroomCallOn({ key: bad }),
      (e) => e && e.expose === true && e.status === 400,
      '应当抛 400 业务错误：' + String(bad)
    );
  }
});

test('点名：错误文案里带上收到的原始 key，方便排查前端传错', async () => {
  await assert.rejects(
    () => engine.classroomCallOn({ key: 'constructor' }),
    /constructor/
  );
});

/* ---------- 2. 本地规则分支 ---------- */

test('点名规则：三个人设说的话互不相同', () => {
  const lines = ['naughty', 'geek', 'drift'].map(
    (key) => engine.classroomCallOnRule({ key }).line
  );
  assert.strictEqual(new Set(lines).size, 3, '三条话术必须都不一样，否则三个人是同一个人');
  lines.forEach((l) => assert.ok(l.length > 0 && l.length <= 60));
});

test('点名规则：没给提示时的基线质量符合人设', () => {
  assert.strictEqual(engine.classroomCallOnRule({ key: 'geek' }).answer_quality, 'good');
  assert.strictEqual(engine.classroomCallOnRule({ key: 'naughty' }).answer_quality, 'partial');
  assert.strictEqual(engine.classroomCallOnRule({ key: 'drift' }).answer_quality, 'poor');
});

test('点名规则：老师给了提示，质量上调一档', () => {
  const withHint = (key) => engine.classroomCallOnRule({ key, callInstruction: '看分子，先提公因式' });
  assert.strictEqual(withHint('naughty').answer_quality, 'good');
  assert.strictEqual(withHint('drift').answer_quality, 'partial');
});

test('点名规则：小走即使在优秀班 + 提示，也不会直接答满分', () => {
  const r = engine.classroomCallOnRule({
    key: 'drift',
    callInstruction: '看黑板上第二步',
    profile: profileWith({ level: 'excellent' }),
  });
  assert.notStrictEqual(r.answer_quality, 'good', '小走的人设是「一直没跟上」，答成 good 就崩了');
});

test('点名规则：弱档班级里小皮答得更差', () => {
  const weak = engine.classroomCallOnRule({ key: 'naughty', profile: profileWith({ level: 'weak' }) });
  const normal = engine.classroomCallOnRule({ key: 'naughty' });
  assert.strictEqual(normal.answer_quality, 'partial');
  assert.strictEqual(weak.answer_quality, 'poor');
});

test('点名规则：压力变化与答题质量方向一致', () => {
  const cases = [
    ['geek', -8],       // 答得好 → 课堂稳下来
    ['naughty', 2],     // 答一半 → 略微上升
    ['drift', 6],       // 卡住 → 上升
  ];
  for (const [key, delta] of cases) {
    const r = engine.classroomCallOnRule({ key });
    assert.strictEqual(r.pressure_delta, delta, key + ' 的压力变化不对');
    assert.ok(r.pressure_reason.length > 0);
  }
});

test('点名规则：分数永远是 0-100 的整数', () => {
  for (const key of ['naughty', 'geek', 'drift']) {
    for (const pressure of [0, 50, 100, '80', null, undefined, NaN]) {
      const r = engine.classroomCallOnRule({ key, pressure });
      for (const f of ['attention', 'comprehension']) {
        assert.ok(Number.isInteger(r[f]), key + '.' + f + ' 必须是整数，实际 ' + r[f]);
        assert.ok(r[f] >= 0 && r[f] <= 100, key + '.' + f + ' 超出 0-100：' + r[f]);
      }
    }
  }
});

test('点名规则：difficulty 只能是三档之一', () => {
  for (const key of ['naughty', 'geek', 'drift']) {
    for (const level of ['weak', 'good', 'excellent']) {
      const r = engine.classroomCallOnRule({ key, profile: profileWith({ level }) });
      assert.ok(['basic', 'core', 'advanced'].indexOf(r.difficulty) !== -1, '非法难度：' + r.difficulty);
    }
  }
});

test('点名规则：带学情时 state_reason 标明学情来源', () => {
  const r = engine.classroomCallOnRule({ key: 'geek', profile: profileWith({ level: 'weak' }) });
  assert.ok(r.state_reason.indexOf('学情') !== -1, '应带学情后缀，实际：' + r.state_reason);
  assert.ok(r.state_reason.length <= 40);
});

test('点名规则：不带学情时行为与改造前一致（difficulty=core、无后缀）', () => {
  const r = engine.classroomCallOnRule({ key: 'geek' });
  assert.strictEqual(r.difficulty, 'core');
  assert.strictEqual(r.state_reason.indexOf('学情'), -1);
});

test('点名规则：降级原因透传，不编造', () => {
  const r = engine.classroomCallOnRule({ key: 'geek' }, 'rate-limited');
  assert.strictEqual(r.engine, 'rule');
  assert.strictEqual(r.fallback_reason, 'rate-limited');
});

test('点名规则：返回结构含前端所需的全部字段', () => {
  const r = engine.classroomCallOnRule({ key: 'naughty' });
  for (const f of ['key', 'name', 'mood', 'line', 'answer_quality', 'attention',
    'comprehension', 'state_reason', 'difficulty', 'pressure_delta', 'pressure_reason', 'engine']) {
    assert.ok(f in r, '缺少字段 ' + f);
  }
  assert.strictEqual(r.key, 'naughty');
  assert.strictEqual(r.name, '小皮');
  assert.strictEqual(r.engine, 'rule');
});

/* ---------- 3. 提示词 ---------- */

test('点名提示词：只描述被点的那个人，不泄漏另外两人的模板', () => {
  const p = classroomCallOnPrompt({ key: 'drift', topic: '勾股定理' });
  assert.ok(p.indexOf('小走') !== -1);
  assert.strictEqual(p.indexOf('"key": "geek"'), -1, '提示词里不该出现别人的 JSON 模板');
  assert.strictEqual(p.indexOf('"key": "naughty"'), -1);
});

test('点名提示词：老师的提示语被原样带进上下文', () => {
  const p = classroomCallOnPrompt({ key: 'naughty', callInstruction: '先看分子能不能约掉' });
  assert.ok(p.indexOf('先看分子能不能约掉') !== -1);
});

test('点名提示词：没有提示语时明确告诉模型「只是叫了名字」', () => {
  const p = classroomCallOnPrompt({ key: 'geek' });
  assert.ok(p.indexOf('没有给任何提示') !== -1);
});

test('点名提示词：人设描述与 CLASS_STUDENTS 一致', () => {
  for (const st of CLASS_STUDENTS) {
    const p = classroomCallOnPrompt({ key: st.key });
    assert.ok(p.indexOf(st.name) !== -1, st.key + ' 的名字没出现在提示词里');
  }
});

test('点名提示词：要求 answer_quality 与台词一致（防「说不会却标 good」）', () => {
  const p = classroomCallOnPrompt({ key: 'drift' });
  assert.ok(p.indexOf('answer_quality') !== -1);
  assert.ok(/必须和 line 的实际内容一致/.test(p));
});

/* ---------- 4. 端到端接线 ---------- */

test('服务端：/api/classroom/call-on 路由存在且校验 key', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert.ok(src.indexOf("'/api/classroom/call-on'") !== -1, '路由没接上');
  assert.ok(/缺少 key 字段/.test(src), '缺少 key 时应当直接 400，而不是透传给模型');
});

test('服务端：点名接口必须在 LLM 配额白名单里', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const block = src.slice(src.indexOf('const LLM_ENDPOINTS'), src.indexOf('];', src.indexOf('const LLM_ENDPOINTS')));
  assert.ok(block.indexOf('/api/classroom/call-on') !== -1,
    '会调 ai.chat() 的接口不进白名单 = 绕过每日配额');
});

test('前端：离线演示按 key 分流，不返回同一份模板', () => {
  const demo = require('../public/demo-data.js');
  const all = demo.DEMO_CLASS_CALLON;
  assert.ok(all, '缺少 DEMO_CLASS_CALLON');
  for (const key of ['naughty', 'geek', 'drift']) {
    assert.ok(all[key], '演示数据缺少 ' + key);
    assert.strictEqual(all[key].key, key, '点 ' + key + ' 却回了 ' + all[key].key);
  }
  const lines = ['naughty', 'geek', 'drift'].map((k) => all[k].line);
  assert.strictEqual(new Set(lines).size, 3, '演示台词不能三个人一样');
});

test('前端：offlineFallback 接上了点名接口', () => {
  const src = fs.readFileSync(path.join(PUBLIC, 'app.js'), 'utf8');
  assert.ok(src.indexOf("url === '/api/classroom/call-on'") !== -1, '离线兜底分支没加');
  assert.ok(src.indexOf('D.DEMO_CLASS_CALLON') !== -1);
});

test('前端：点名的三个约束都在（可点白名单 / 互斥 / 进历史）', () => {
  const src = fs.readFileSync(path.join(PUBLIC, 'app.js'), 'utf8');
  assert.ok(/function callOnAllowedKey/.test(src), '缺少「只能点当前在座学生」的判定');
  assert.ok(/if \(classCallBusy\) return;/.test(src), '缺少并发互斥');
  assert.ok(/if \(classNextBtn && classNextBtn\.disabled\) return false;/.test(src),
    '点名必须避开进行中的整轮课堂');
  assert.ok(/classMessages\.push\(\{ role: 'student', name: meta\.name, content: line \}\)/.test(src),
    '点名结果必须进对话历史，否则下一轮模型不知道发生过');
});

test('前端：非法角色的卡片不可点（没有 role/tabindex）', () => {
  const src = fs.readFileSync(path.join(PUBLIC, 'app.js'), 'utf8');
  // 2026-10-30 卡片模板抽成 studentCardHtml(s, opts) 后，单人与课堂共用一份：
  // 可点条件变成「key 合法 且 调用方没显式关掉」，语义与原来一致。
  assert.ok(/const clickable = \(key && o\.clickable !== false\)\s*\n?\s*\? ' role="button"/.test(src),
    '可点属性必须只在 key 合法时才拼进 HTML');
});

test('前端：画布命中读的是绘制时存下的同一份坐标', () => {
  const src = fs.readFileSync(path.join(PUBLIC, 'app.js'), 'utf8');
  assert.ok(/lastClassSlots = slots;/.test(src), '绘制后没有保存站位');
  assert.ok(/sceneHitTest\(lastClassSlots/.test(src), '点击没用同一份站位');
});
