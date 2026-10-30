'use strict';

/**
 * 降级原因（fallback_reason）契约测试
 * ------------------------------------------------------------------
 * 背景：模型调用失败时，engine 会**静默**降级到本地规则引擎，
 * 前端只看到 engine='rule'，用户根本不知道到底发生了什么：
 * 是没配 Key？是模型欠费（402）？是被限流（429）？还是模型报错了？
 * 这几种情况用户要做的动作完全不同，必须区分开，不能一律报成限流。
 *
 * 本文件锁死十二条口径：
 *   1. 429 → 'rate-limited'；
 *   2. 402 → 'insufficient-balance'；
 *   3. 401/403 → 'auth-failed'；
 *   4. 普通异常 → 'model-error'（绝不允许把任意失败都报成限流）；
 *   5. 没有 Key → 'key-not-configured'；
 *   6. 模型成功 → 'none'；
 *   7. deepseek.mapUpstreamCode 的状态码映射表；
 *   8. 降级后的报告**仍然是完整的规则引擎报告**，不是只有一句错误信息；
 *   9. 降级**不进入固定演示数据路径**（engine 仍是 'rule'，不是 'offline-demo'）；
 *  10. deepseek.chat 抛出的错误必须带稳定 code / status；
 *  11. 其它会降级的引擎函数也必须带 fallback_reason；
 *  12. 取值表封闭：不得出现表外的值。
 *
 * 全部用桩（stub deepseek.hasKey / deepseek.chat / global.fetch），
 * **不打真实网络**（本机 API Key 余额不足，真实调用会返回 402，测不出别的分支）。
 */

const test = require('node:test');
const assert = require('node:assert');

const ds = require('../lib/deepseek.js');
const engine = require('../lib/engine.js');

/* 真实实现只在这里取一次：桩的还原必须永远回到「真身」，
   否则同一个用例里装两次桩时，after 钩子的执行顺序会让桩泄漏到下一个用例。 */
const REAL_HAS_KEY = ds.hasKey;
const REAL_CHAT = ds.chat;

const TEXT =
  '同学们好，今天我们讲函数的单调性。李同学，你说说这一步为什么这样设？' +
  '然后我们来看这个公式，就是先求出导，再看导数的符号，最后判断函数的增减性。';

/* ------------------------------------------------------------------ */
/* 桩工具                                                              */
/* ------------------------------------------------------------------ */
/**
 * 装上模型桩。
 * @param {object} t node:test 上下文
 * @param {object} opts
 *   opts.hasKey  桩出来的 hasKey()（默认 true）
 *   opts.err     模型要抛的错误（给了就走失败分支）
 *   opts.raw     模型成功时返回的文本
 */
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

/** 造一个「上游返回非 2xx」的 fetch 桩 */
function stubFetchError(t, status, body) {
  const savedFetch = global.fetch;
  global.fetch = async () => ({ ok: false, status: status, text: async () => body });
  t.after(() => { global.fetch = savedFetch; });
}

/** 造一个「上游返回 200 但内容不对」的 fetch 桩 */
function stubFetchOk(t, jsonImpl) {
  const savedFetch = global.fetch;
  global.fetch = async () => ({ ok: true, status: 200, json: jsonImpl });
  t.after(() => { global.fetch = savedFetch; });
}

/* ------------------------------------------------------------------ */
/* 1–4. 四种降级原因                                                   */
/* ------------------------------------------------------------------ */

test('降级原因①：上游 429 → rate-limited', async (t) => {
  stubModel(t, { err: upstreamError(429, 'rate_limit_exceeded', 'AI_HTTP_429: Rate limit reached') });
  const r = await engine.analyze({ transcript: TEXT, subject: '函数单调性', durationSec: 240 });
  assert.strictEqual(r.engine, 'rule', '本测试必须走规则降级分支');
  assert.strictEqual(r.fallback_reason, 'rate-limited', '429 必须报限流，实际：' + r.fallback_reason);
});

test('降级原因②：上游 402（余额不足）→ insufficient-balance', async (t) => {
  stubModel(t, { err: upstreamError(402, 'insufficient_balance', 'AI_HTTP_402: Insufficient Balance') });
  const r = await engine.analyze({ transcript: TEXT, subject: '函数单调性', durationSec: 240 });
  assert.strictEqual(r.engine, 'rule');
  assert.strictEqual(
    r.fallback_reason,
    'insufficient-balance',
    '402 必须报余额不足（上一批线上实测就是这个状态码），实际：' + r.fallback_reason
  );
});

test('降级原因③：上游 401 → auth-failed；403 同样 → auth-failed', async (t) => {
  stubModel(t, { err: upstreamError(401, null, 'AI_HTTP_401: invalid api key') });
  const r401 = await engine.analyze({ transcript: TEXT, subject: '函数单调性', durationSec: 240 });
  assert.strictEqual(r401.fallback_reason, 'auth-failed', '401 必须报鉴权失败，实际：' + r401.fallback_reason);

  stubModel(t, { err: upstreamError(403, 'auth_failed', 'AI_HTTP_403: forbidden') });
  const r403 = await engine.analyze({ transcript: TEXT, subject: '函数单调性', durationSec: 240 });
  assert.strictEqual(r403.fallback_reason, 'auth-failed', '403 必须报鉴权失败，实际：' + r403.fallback_reason);
});

test('降级原因④：普通异常 → model-error（绝不允许谎报成限流）', async (t) => {
  stubModel(t, { err: new Error('boom') });
  const r = await engine.analyze({ transcript: TEXT, subject: '函数单调性', durationSec: 240 });
  assert.strictEqual(r.engine, 'rule');
  assert.strictEqual(
    r.fallback_reason,
    'model-error',
    '普通失败只能报 model-error，不能报限流，实际：' + r.fallback_reason
  );

  // 再锁一条：没有 status / code 的错误，message 里也没有限流关键词
  stubModel(t, { err: new Error('模型未返回合法 JSON') });
  const r2 = await engine.analyze({ transcript: TEXT, subject: '函数单调性', durationSec: 240 });
  assert.strictEqual(r2.fallback_reason, 'model-error');
});

test('降级原因判定：只有结构化信号可信 —— 402 的 body 即使写着 rate limit 也必须是余额不足', async (t) => {
  // 上游状态码是权威信号：402 = 欠费，不能因为 body 文案里有 "rate limit" 就报限流
  stubModel(t, {
    err: upstreamError(402, 'insufficient_balance', 'AI_HTTP_402: rate limit reached, buy credits'),
  });
  const r = await engine.analyze({ transcript: TEXT, subject: '函数单调性', durationSec: 240 });
  assert.strictEqual(r.fallback_reason, 'insufficient-balance');
});

/* ------------------------------------------------------------------ */
/* 5. 没有 Key                                                         */
/* ------------------------------------------------------------------ */

test('降级原因⑤：没有配置 API Key → key-not-configured（且从未调用模型）', async (t) => {
  let chatCalled = false;
  stubModel(t, {
    hasKey: false,
    raw: '{}',
  });
  const realChat = ds.chat;
  ds.chat = async () => { chatCalled = true; return '{}'; };
  t.after(() => { ds.chat = realChat; });

  const r = await engine.analyze({ transcript: TEXT, subject: '函数单调性', durationSec: 240 });
  assert.strictEqual(r.engine, 'rule');
  assert.strictEqual(
    r.fallback_reason,
    'key-not-configured',
    '没 Key 必须报 key-not-configured，实际：' + r.fallback_reason
  );
  assert.strictEqual(chatCalled, false, '没有 Key 时不得调用模型');
});

/* ------------------------------------------------------------------ */
/* 6. 模型成功                                                         */
/* ------------------------------------------------------------------ */

test('降级原因⑥：模型成功 → none', async (t) => {
  stubModel(t, {
    raw: JSON.stringify({
      overall_score: 80,
      summary: '桩返回',
      questions: { asked: 9, avg_wait_sec: 4.2 },
      // 故意让模型自己伪造降级原因，后端必须覆盖掉它
      fallback_reason: 'rate-limited',
    }),
  });
  const r = await engine.analyze({ transcript: TEXT, subject: '函数单调性', durationSec: 240 });
  assert.strictEqual(r.engine, 'llm', '本测试必须走 LLM 分支');
  assert.strictEqual(
    r.fallback_reason,
    'none',
    '模型成功时 fallback_reason 必须是 none；模型自曝的值不得生效，实际：' + r.fallback_reason
  );
});

/* ------------------------------------------------------------------ */
/* 7. mapUpstreamCode 映射表                                          */
/* ------------------------------------------------------------------ */

test('降级原因⑦：deepseek.mapUpstreamCode 状态码映射表', () => {
  assert.strictEqual(ds.mapUpstreamCode(429), 'rate_limit_exceeded');
  assert.strictEqual(ds.mapUpstreamCode(402), 'insufficient_balance');
  assert.strictEqual(ds.mapUpstreamCode(401), 'auth_failed');
  assert.strictEqual(ds.mapUpstreamCode(403), 'auth_failed');
  assert.strictEqual(ds.mapUpstreamCode(404), 'model_not_found');
  assert.strictEqual(ds.mapUpstreamCode(500), 'upstream_error');
  assert.strictEqual(ds.mapUpstreamCode(502), 'upstream_error');
  assert.strictEqual(ds.mapUpstreamCode(503), 'upstream_error');
  // 其它（未列举的 4xx）→ upstream_http_error
  assert.strictEqual(ds.mapUpstreamCode(400), 'upstream_http_error');
  assert.strictEqual(ds.mapUpstreamCode(418), 'upstream_http_error');
  assert.strictEqual(ds.mapUpstreamCode(422), 'upstream_http_error');
});

/* ------------------------------------------------------------------ */
/* 8. 降级后的报告仍然是完整的规则引擎报告                              */
/* ------------------------------------------------------------------ */

test('降级原因⑧：降级后的报告仍然是完整的规则引擎报告（不是只有一句错误信息）', async (t) => {
  stubModel(t, { err: upstreamError(429, 'rate_limit_exceeded', 'AI_HTTP_429: Rate limit reached') });
  const r = await engine.analyze({ transcript: TEXT, subject: '函数单调性', durationSec: 240 });

  assert.strictEqual(r.engine, 'rule');
  assert.strictEqual(typeof r.overall_score, 'number', 'overall_score 必须是数字，实际：' + typeof r.overall_score);
  assert.ok(typeof r.summary === 'string' && r.summary.length > 0, '必须有 summary');
  assert.ok(r.knowledge, '必须有 knowledge');
  assert.ok(Array.isArray(r.knowledge.covered), 'knowledge.covered 必须是数组');
  assert.ok(Array.isArray(r.knowledge.missing), 'knowledge.missing 必须是数组');
  assert.strictEqual(typeof r.knowledge.cover_percent, 'number');
  assert.strictEqual(r.knowledge.scheme, 'generic-seven-phase-cues-v1');
  assert.ok(r.wait_metrics, '必须有 wait_metrics');
  assert.ok(Array.isArray(r.wait_metrics.moments), 'wait_metrics.moments 必须是数组');
  assert.strictEqual(r.wait_metrics.source, 'text-heuristic');
  assert.ok(r.questions, '必须有 questions');
  assert.ok(Array.isArray(r.suggestions), 'suggestions 必须是数组');
  assert.ok(r.speech_rate && typeof r.speech_rate.chars_per_min === 'number');
  assert.ok(r.pauses && typeof r.pauses.count_gt_2s === 'number');
});

/* ------------------------------------------------------------------ */
/* 9. 降级不进入固定演示数据路径                                        */
/* ------------------------------------------------------------------ */

test('降级原因⑨：429 降级后 engine 仍是 rule，不得变成 offline-demo', async (t) => {
  stubModel(t, { err: upstreamError(429, 'rate_limit_exceeded', 'AI_HTTP_429: Rate limit reached') });
  const r = await engine.analyze({ transcript: TEXT, subject: '函数单调性', durationSec: 240 });
  assert.strictEqual(r.engine, 'rule', '降级只能落到规则引擎');
  assert.notStrictEqual(
    r.engine,
    'offline-demo',
    "offline-demo 只应由前端 ?jtq-demo=1 生成，后端不得产出该标记"
  );
  assert.ok(!('offline-demo' in r), '响应里不得出现 offline-demo 标记');
});

/* ------------------------------------------------------------------ */
/* 10. deepseek.chat 抛出的错误必须带稳定 code                          */
/* ------------------------------------------------------------------ */

/**
 * 临时放一个假 Key（只影响 hasKey()，fetch 全部被桩掉）。
 * 运行时拼出来的占位串，不是任何真实凭据。
 */
const FAKE_KEY = ['sk', 'local', 'stub', 'not-a-real-credential'].join('-');

function withFakeKey(t) {
  const savedKey = process.env.AI_API_KEY;
  process.env.AI_API_KEY = FAKE_KEY;
  t.after(() => {
    if (savedKey === undefined) delete process.env.AI_API_KEY;
    else process.env.AI_API_KEY = savedKey;
  });
}

test('deepseek.chat：无 Key → code=no_api_key', async () => {
  const savedKey = process.env.AI_API_KEY;
  const savedDs = process.env.DEEPSEEK_API_KEY;
  delete process.env.AI_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  try {
    await assert.rejects(
      () => REAL_CHAT([{ role: 'user', content: 'hi' }]),
      (err) => {
        assert.strictEqual(err.code, 'no_api_key', '实际：' + err.code);
        assert.strictEqual(err.message, 'NO_API_KEY', 'message 文案保持不变');
        return true;
      }
    );
  } finally {
    if (savedKey === undefined) delete process.env.AI_API_KEY;
    else process.env.AI_API_KEY = savedKey;
    if (savedDs === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = savedDs;
  }
});

test('deepseek.chat：HTTP 非 2xx → error.status + 稳定 error.code', async (t) => {
  withFakeKey(t);
  const cases = [
    { status: 429, code: 'rate_limit_exceeded', body: 'Rate limit reached for requests' },
    { status: 402, code: 'insufficient_balance', body: 'Insufficient Balance' },
    { status: 401, code: 'auth_failed', body: 'Authentication Fails' },
    { status: 500, code: 'upstream_error', body: 'internal server error' },
    { status: 400, code: 'upstream_http_error', body: 'bad request' },
  ];

  for (const c of cases) {
    stubFetchError(t, c.status, c.body);
    await assert.rejects(
      () => REAL_CHAT([{ role: 'user', content: 'hi' }]),
      (err) => {
        assert.strictEqual(err.status, c.status, '必须带上上游状态码');
        assert.strictEqual(err.code, c.code, '状态码 ' + c.status + ' 的错误码不对');
        assert.ok(
          err.message.indexOf('AI_HTTP_' + c.status) === 0,
          'message 必须保留 AI_HTTP_<status> 前缀，实际：' + err.message
        );
        assert.ok(typeof err.upstreamBody === 'string' && err.upstreamBody.length > 0);
        return true;
      }
    );
  }
});

test('deepseek.chat：空回复 → code=empty_response；非 JSON → code=invalid_response', async (t) => {
  withFakeKey(t);

  stubFetchOk(t, async () => ({ choices: [{ message: { content: '' } }] }));
  await assert.rejects(
    () => REAL_CHAT([{ role: 'user', content: 'hi' }]),
    (err) => {
      assert.strictEqual(err.code, 'empty_response', '实际：' + err.code);
      assert.strictEqual(err.message, 'AI_EMPTY_RESPONSE');
      return true;
    }
  );

  stubFetchOk(t, async () => { throw new SyntaxError('Unexpected token < in JSON'); });
  await assert.rejects(
    () => REAL_CHAT([{ role: 'user', content: 'hi' }]),
    (err) => {
      assert.strictEqual(err.code, 'invalid_response', '实际：' + err.code);
      return true;
    }
  );
});

test('deepseek.chat：网络异常 → code=network_error；中断 → code=timeout（错误不被吞掉）', async (t) => {
  withFakeKey(t);
  const savedFetch = global.fetch;
  t.after(() => { global.fetch = savedFetch; });

  global.fetch = async () => { throw new TypeError('fetch failed'); };
  await assert.rejects(
    () => REAL_CHAT([{ role: 'user', content: 'hi' }]),
    (err) => {
      assert.strictEqual(err.code, 'network_error', '实际：' + err.code);
      assert.ok(err instanceof Error, '必须仍然是 Error');
      assert.strictEqual(err.message, 'fetch failed', '原始 message 不能丢');
      return true;
    }
  );

  const abort = new Error('The operation was aborted');
  abort.name = 'AbortError';
  global.fetch = async () => { throw abort; };
  await assert.rejects(
    () => REAL_CHAT([{ role: 'user', content: 'hi' }]),
    (err) => {
      assert.strictEqual(err.code, 'timeout', '实际：' + err.code);
      return true;
    }
  );
});

/* ------------------------------------------------------------------ */
/* 11. 其它会降级的引擎函数也必须带 fallback_reason                      */
/* ------------------------------------------------------------------ */

test('降级原因：其它会降级的引擎函数也必须带 fallback_reason', async (t) => {
  stubModel(t, { err: upstreamError(402, 'insufficient_balance', 'AI_HTTP_402: Insufficient Balance') });

  const improve = await engine.improve({ transcript: TEXT, subject: '函数单调性' });
  assert.strictEqual(improve.engine, 'rule');
  assert.strictEqual(improve.fallback_reason, 'insufficient-balance');
  assert.ok(typeof improve.improved_script === 'string' && improve.improved_script.length > 0);

  const danger = await engine.dangerMoments({ transcript: TEXT, analysis: null });
  assert.strictEqual(danger.engine, 'rule');
  assert.strictEqual(danger.fallback_reason, 'insufficient-balance');
  assert.ok(Array.isArray(danger.moments));

  const student = await engine.studentChat({ messages: [], persona: 'naughty', topic: '函数单调性' });
  assert.strictEqual(student.engine, 'rule');
  assert.strictEqual(student.fallback_reason, 'insufficient-balance');
  assert.ok(typeof student.reply === 'string' && student.reply.length > 0);

  const respond = await engine.crisisRespond({ eventId: 'c1', response: '老师先冷静，请坐下。' });
  assert.strictEqual(respond.engine, 'rule');
  assert.strictEqual(respond.fallback_reason, 'insufficient-balance');

  const cmp = await engine.compare({ transcriptA: TEXT, transcriptB: TEXT, subject: '函数单调性' });
  assert.strictEqual(cmp.engine, 'rule');
  assert.strictEqual(cmp.fallback_reason, 'insufficient-balance');

  const round = await engine.classroomRound({ topic: '函数单调性', history: [] });
  assert.strictEqual(round.engine, 'rule');
  assert.strictEqual(round.fallback_reason, 'insufficient-balance');

  const drill = await engine.drill({ skill: 'question_wait', transcript: TEXT });
  assert.strictEqual(drill.engine, 'rule');
  assert.strictEqual(drill.fallback_reason, 'insufficient-balance');
  assert.ok(typeof drill.score === 'number');
});

test('降级原因：无 Key 时其它引擎函数的 fallback_reason 也是 key-not-configured', async (t) => {
  stubModel(t, { hasKey: false, raw: '{}' });

  const danger = await engine.dangerMoments({ transcript: TEXT });
  assert.strictEqual(danger.fallback_reason, 'key-not-configured');

  const student = await engine.studentChat({ messages: [], persona: 'naughty' });
  assert.strictEqual(student.fallback_reason, 'key-not-configured');

  const drill = await engine.drill({ skill: 'question_wait', transcript: TEXT });
  assert.strictEqual(drill.fallback_reason, 'key-not-configured');
});

/* ------------------------------------------------------------------ */
/* 12. 取值表封闭：不得出现表外的值                                     */
/* ------------------------------------------------------------------ */

test('降级原因：取值表封闭 —— 只能出现约定的 6 个值', async (t) => {
  const ALLOWED = [
    'none',
    'key-not-configured',
    'rate-limited',
    'insufficient-balance',
    'auth-failed',
    'model-error',
  ];
  const errors = [
    upstreamError(429, 'rate_limit_exceeded', 'x'),
    upstreamError(402, 'insufficient_balance', 'x'),
    upstreamError(401, null, 'x'),
    new Error('boom'),
  ];
  for (const e of errors) {
    stubModel(t, { err: e });
    const r = await engine.analyze({ transcript: TEXT, subject: '函数单调性', durationSec: 240 });
    assert.ok(
      ALLOWED.indexOf(r.fallback_reason) !== -1,
      '出现表外取值：' + r.fallback_reason
    );
  }
});
