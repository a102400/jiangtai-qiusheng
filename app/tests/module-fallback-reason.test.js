'use strict';

/**
 * 七模块降级原因契约测试（模块级 fallback_reason）
 * ------------------------------------------------------------------
 * 背景：项目里有 7 个接口各自独立调用模型、各自 catch 错误后降级到本地规则：
 *   /api/heatmap      → lib/heatmap.js        classroomMetrics
 *   /api/lesson-plan  → lib/lessonplan.js     lessonPlanCoverage
 *   /api/ifias        → lib/ifias.js          ifiasAnalyze
 *   /api/hollow       → lib/hollow.js         hollowComfort
 *   /api/curriculum   → lib/curriculum.js     curriculumCheck
 *   /api/panorama     → lib/panorama.js       panorama
 *   /api/blackboard   → lib/blackboard.js     scoreBlackboard
 *
 * 在本次修复前，这 7 个模块只返回 engine='rule'/'llm'，**不返回 fallback_reason**，
 * 于是同一份讲稿：/api/analyze 会告诉用户「模型余额不足」，
 * /api/heatmap 却什么原因都不说 —— 前端那 3 个已经接好的提示钩子
 * （app.js 的 iFIAS / 教案覆盖 / 课标对照）永远拿到空串。
 *
 * 本文件锁死五条口径：
 *   1. 没配 Key          → 七个模块全部 'key-not-configured'（不是「调用失败」）；
 *   2. 上游 429          → 七个模块全部 'rate-limited'；
 *   3. 上游 402          → 七个模块全部 'insufficient-balance'；
 *   4. 上游 401          → 七个模块全部 'auth-failed'，普通异常 → 'model-error'
 *      （绝不允许把任意失败都笼统报成限流）；
 *   5. 模型成功 → 'none'，且**上游 JSON 里混进来的 fallback_reason 不许生效**
 *      —— 降级原因只能由本地判定，不许由模型自曝。
 * 另外锁定：取值表封闭（恰好六个值）、engine 薄壳层原样透传。
 *
 * 全部用桩（stub deepseek.hasKey / deepseek.chat），不打真实网络。
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ds = require('../lib/deepseek.js');
const fb = require('../lib/fallback-reason.js');

const heatmap = require('../lib/heatmap.js');
const lessonplan = require('../lib/lessonplan.js');
const ifias = require('../lib/ifias.js');
const hollow = require('../lib/hollow.js');
const curriculum = require('../lib/curriculum.js');
const panorama = require('../lib/panorama.js');
const blackboard = require('../lib/blackboard.js');
const engine = require('../lib/engine.js');

/* 真实实现只取一次：桩的还原必须永远回到真身，否则桩会泄漏到下一个用例。 */
const REAL_HAS_KEY = ds.hasKey;
const REAL_CHAT = ds.chat;

/* 讲稿要有 ≥6 个句末标点：ifias 要求可编码话语单元 ≥4 个，
   否则它会先抛「单元太少」而测不到降级分支。 */
const TEXT =
  '同学们好，今天我们讲函数的单调性。请大家先看这个函数图像。' +
  '李同学，你说说这一步为什么这样设？然后我们来看这个公式。' +
  '就是先求出导数，再看导数的符号。最后判断函数的增减性，这就是基本步骤。';

const PLAN =
  '教学目标：1. 理解函数单调性的定义 2. 掌握用导数判断单调性的方法 3. 能解决简单问题';

const HOLLOW_TEXT = '今天试讲忘词了，站在讲台上大脑一片空白，感觉自己不适合当老师。';

/* 板书评分会真的读文件；临时文件落项目目录（Windows 下 /tmp 与 Node 看到的路径不一致）。 */
const TMP_IMG = path.join(__dirname, '.tmp-blackboard-fixture.bin');

/* ------------------------------------------------------------------ */
/* 桩工具                                                              */
/* ------------------------------------------------------------------ */
function stubModel(t, opts) {
  const o = opts || {};
  ds.hasKey = () => o.hasKey !== false;
  ds.chat = o.err ? async () => { throw o.err; } : async () => o.raw;
  t.after(() => {
    ds.hasKey = REAL_HAS_KEY;
    ds.chat = REAL_CHAT;
  });
}

/** 造一个带结构化字段的上游错误（模拟 deepseek.chat 抛出的形态） */
function upstreamError(status, code, message) {
  const e = new Error(message || 'AI_HTTP_' + status + ': upstream body');
  e.status = status;
  if (code) e.code = code;
  return e;
}

/** 强制关掉视觉模型分支：否则本机若配了 AI_VISION_*，会去打真实网络。 */
function withoutVision(t) {
  const savedKey = process.env.AI_VISION_KEY;
  const savedBase = process.env.AI_VISION_BASE_URL;
  delete process.env.AI_VISION_KEY;
  delete process.env.AI_VISION_BASE_URL;
  t.after(() => {
    if (savedKey !== undefined) process.env.AI_VISION_KEY = savedKey;
    if (savedBase !== undefined) process.env.AI_VISION_BASE_URL = savedBase;
  });
}

/** 板书评分：临时造一个小文件，读完即删 */
async function callBlackboard() {
  fs.writeFileSync(TMP_IMG, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  try {
    return await blackboard.scoreBlackboard(TMP_IMG, { subject: '数学', grade: '高一' });
  } finally {
    try { fs.unlinkSync(TMP_IMG); } catch (_) { /* 已删或不存在都无所谓 */ }
  }
}

/* ------------------------------------------------------------------ */
/* 七个模块的调用入口                                                  */
/* ------------------------------------------------------------------ */
/* raw：模型成功时该模块能接受的返回值（用于验证 engine==='llm' → 'none'） */
const HOLLOW_REPLY =
  '我听见了。忘词的那一刻，全世界的目光都压在你身上，很难受，也很孤独。' +
  '但这不代表你不适合当老师，只代表你还在练习。';

const MODULES = [
  {
    name: '/api/heatmap',
    call: () => heatmap.classroomMetrics({ transcript: TEXT, subject: '函数单调性' }),
    raw:
      '{"wait_moments":[{"quote":"李同学，你说说这一步为什么这样设？","wait_sec":2.5,"reaction":"留白"}],' +
      '"time_allocation":{"teacher":30,"student":5,"interaction":4,"transition":1},' +
      '"segments":[{"phase":"导入","script":"a"},{"phase":"新授","script":"b"},' +
      '{"phase":"互动","script":"c"},{"phase":"小结","script":"d"}]}',
  },
  {
    name: '/api/lesson-plan',
    call: () => lessonplan.lessonPlanCoverage({ plan: PLAN, transcript: TEXT, subject: '数学' }),
    raw:
      '{"coverage":[{"point":"函数单调性定义","status":"讲透了","evidence":"讲函数的单调性"}],' +
      '"missing":[],"verdict":"覆盖良好","suggestions":["补充例题"]}',
  },
  {
    name: '/api/ifias',
    call: () => ifias.ifiasAnalyze({ transcript: TEXT, subject: '数学' }),
    raw: '{"codes":[{"i":1,"code":"5","reason":"讲授"}]}',
  },
  {
    name: '/api/hollow',
    call: () => hollow.hollowComfort({ text: HOLLOW_TEXT }),
    raw: HOLLOW_REPLY,
  },
  {
    name: '/api/curriculum',
    call: () => curriculum.curriculumCheck({ transcript: TEXT, subject: '数学' }),
    raw: '{"standards":[{"code":"X","achieved":"达成","evidence":"证据"}],"summary":"总体达成"}',
  },
  {
    name: '/api/panorama',
    call: () => panorama.panorama({ transcript: TEXT, subject: '数学' }),
    raw: '{"score":78,"comment":"结构清晰","advice":"增加互动"}',
  },
  {
    name: '/api/blackboard',
    call: () => callBlackboard(),
    raw: '{"checklist":["主板书写课题与主问题"]}',
  },
];

/* ------------------------------------------------------------------ */
/* 1. 取值表封闭                                                       */
/* ------------------------------------------------------------------ */
test('降级原因取值表封闭：恰好六个值，不得自由扩展', () => {
  const values = Object.keys(fb.FALLBACK_REASON).map((k) => fb.FALLBACK_REASON[k]).sort();
  assert.deepStrictEqual(
    values,
    ['auth-failed', 'insufficient-balance', 'key-not-configured', 'model-error', 'none', 'rate-limited'],
    '取值表被改动了，实际：' + values.join(' / ')
  );
  assert.ok(Object.isFrozen(fb.FALLBACK_REASON), 'FALLBACK_REASON 必须是冻结对象（契约不许被改写）');
});

/* ------------------------------------------------------------------ */
/* 2. 五种情形 × 七个模块                                              */
/* ------------------------------------------------------------------ */
const SCENARIOS = [
  { title: '无 Key', opts: { hasKey: false }, expect: 'key-not-configured' },
  { title: '上游 429（限流）', opts: { err: upstreamError(429, 'rate_limit_exceeded', 'AI_HTTP_429') }, expect: 'rate-limited' },
  { title: '上游 402（余额不足）', opts: { err: upstreamError(402, 'insufficient_balance', 'AI_HTTP_402') }, expect: 'insufficient-balance' },
  { title: '上游 401（鉴权失败）', opts: { err: upstreamError(401, 'auth_failed', 'AI_HTTP_401') }, expect: 'auth-failed' },
  { title: '上游 500 / 普通异常', opts: { err: upstreamError(500, null, 'AI_HTTP_500') }, expect: 'model-error' },
];

SCENARIOS.forEach((sc) => {
  MODULES.forEach((m) => {
    test(`${m.name}：${sc.title} → ${sc.expect}`, async (t) => {
      stubModel(t, sc.opts);
      withoutVision(t);

      const r = await m.call();
      assert.ok(r && typeof r === 'object', `${m.name} 必须返回对象`);
      assert.notStrictEqual(
        r.engine,
        'offline-demo',
        `${m.name} 降级后 engine 必须是 rule/vision，不许掉进固定演示数据路径`
      );
      assert.strictEqual(
        r.fallback_reason,
        sc.expect,
        `${m.name} 在「${sc.title}」下必须报 ${sc.expect}，实际：${r.fallback_reason}`
      );
    });
  });
});

/* ------------------------------------------------------------------ */
/* 3. 模型成功 → 'none'                                                */
/* ------------------------------------------------------------------ */
MODULES.forEach((m) => {
  test(`${m.name}：模型成功 → 'none'（不是降级）`, async (t) => {
    stubModel(t, { raw: m.raw });
    withoutVision(t);

    const r = await m.call();
    assert.strictEqual(r.fallback_reason, 'none', `${m.name} 模型成功时必须是 none，实际：${r.fallback_reason}`);
  });
});

/* ------------------------------------------------------------------ */
/* 4. 上游 JSON 混进的 fallback_reason 不许生效                        */
/* ------------------------------------------------------------------ */
test('模型自曝的 fallback_reason 必须被冲掉（降级原因只能本地判定）', async (t) => {
  stubModel(t, {
    raw:
      '{"fallback_reason":"rate-limited","wait_moments":[{"quote":"李同学，你说说这一步为什么这样设？","wait_sec":2.5}],' +
      '"time_allocation":{"teacher":30,"student":5,"interaction":4,"transition":1},' +
      '"segments":[{"phase":"导入","script":"a"},{"phase":"新授","script":"b"},' +
      '{"phase":"互动","script":"c"},{"phase":"小结","script":"d"}]}',
  });
  withoutVision(t);

  const r = await heatmap.classroomMetrics({ transcript: TEXT, subject: '函数单调性' });
  assert.strictEqual(r.engine, 'llm', '本用例必须走模型分支');
  assert.strictEqual(
    r.fallback_reason,
    'none',
    '模型成功时不许采信上游 JSON 里混进来的降级原因，实际：' + r.fallback_reason
  );
});

/* ------------------------------------------------------------------ */
/* 5. 六视角全景：逐视角 + 汇总都要带原因                              */
/* ------------------------------------------------------------------ */
test('/api/panorama：六个视角逐个都带降级原因', async (t) => {
  stubModel(t, { err: upstreamError(429, 'rate_limit_exceeded', 'AI_HTTP_429') });
  withoutVision(t);

  const r = await panorama.panorama({ transcript: TEXT, subject: '数学' });
  assert.ok(Array.isArray(r.views) && r.views.length === 6, '六视角必须返回 6 条，实际：' + (r.views || []).length);
  r.views.forEach((v, i) => {
    assert.strictEqual(v.fallback_reason, 'rate-limited', `第 ${i + 1} 个视角应报 rate-limited，实际：${v.fallback_reason}`);
  });
  assert.strictEqual(r.fallback_reason, 'rate-limited', '汇总层也要带同一个原因，实际：' + r.fallback_reason);
});

/* ------------------------------------------------------------------ */
/* 6. engine 薄壳层原样透传                                            */
/* ------------------------------------------------------------------ */
test('engine 薄壳层透传：classroomMetricsView / ifias / lessonPlan / curriculum / hollow 都带 fallback_reason', async (t) => {
  stubModel(t, { err: upstreamError(402, 'insufficient_balance', 'AI_HTTP_402') });
  withoutVision(t);

  const calls = [
    ['classroomMetricsView', () => engine.classroomMetricsView({ transcript: TEXT, subject: '函数单调性' })],
    ['ifias', () => engine.ifias({ transcript: TEXT, subject: '数学' })],
    ['lessonPlan', () => engine.lessonPlan({ plan: PLAN, transcript: TEXT, subject: '数学' })],
    ['curriculum', () => engine.curriculum({ transcript: TEXT, subject: '数学' })],
    ['hollow', () => engine.hollow({ text: HOLLOW_TEXT })],
  ];

  for (const [name, call] of calls) {
    const r = await call();
    assert.strictEqual(
      r.fallback_reason,
      'insufficient-balance',
      `engine.${name} 必须透传 fallback_reason，实际：${r.fallback_reason}`
    );
  }
});

/* ------------------------------------------------------------------ */
/* 7. 与主分析口径一致（同一份讲稿不许报出两个互相矛盾的原因）          */
/* ------------------------------------------------------------------ */
test('同一份讲稿：/api/analyze 与 /api/heatmap 报同一个降级原因', async (t) => {
  stubModel(t, { err: upstreamError(429, 'rate_limit_exceeded', 'AI_HTTP_429') });
  withoutVision(t);

  const report = await engine.analyze({ transcript: TEXT, subject: '函数单调性', durationSec: 240 });
  const view = await engine.classroomMetricsView({ transcript: TEXT, subject: '函数单调性' });

  assert.strictEqual(report.engine, 'rule');
  assert.strictEqual(view.engine, 'rule');
  assert.strictEqual(
    report.fallback_reason,
    view.fallback_reason,
    '两个接口对同一份讲稿必须报同一个降级原因，否则前端会弹出互相矛盾的提示：' +
      report.fallback_reason + ' vs ' + view.fallback_reason
  );
});
