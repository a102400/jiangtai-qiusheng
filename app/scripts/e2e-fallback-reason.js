'use strict';

/**
 * 端到端验收脚本：降级原因（fallback_reason）真实链路自测
 * ------------------------------------------------------------------
 * 用途：验证「真实起 server.js + 真实 HTTP 请求」这条链路上，
 *       /api/analyze 返回的 fallback_reason 与上游真实错误信号一致。
 *       与 tests/fallback-reason.test.js 的区别：那个是进程内桩测（快、定位准），
 *       这个是跨进程的链路自测（慢，但能覆盖「server.js 装配 + HTTP 序列化」环节）。
 *
 * 怎么跑：node scripts/e2e-fallback-reason.js
 *   退出码 0 = 六种场景全部符合预期；非 0 = 有场景对不上。
 *   端口全部向系统申请空闲端口，不写死，不会和别的进程抢。
 *   不进 npm test（它要起子进程、耗时约 2 秒），但它是 CI 友好的：
 *   不联网、不依赖任何环境变量、失败即非 0 退出，可随时挂到 CI 上。
 *
 * 安全：不包含也不读取任何真实 API Key / BaseURL / token。
 *   假 Key 是运行时拼出来的占位串；上游地址永远是本机回环 + 动态端口。
 */

const http = require('http');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TEXT =
  '同学们好，今天我们讲函数的单调性。李同学，你说说这一步为什么这样设？' +
  '然后我们来看这个公式，就是先求出导，再看导数的符号，最后判断函数的增减性。';

/**
 * 假 Key：运行时拼出来的占位串。
 * 它不是任何真实凭据、也不需要保密、不是从环境变量或文件里读出来的 ——
 * 唯一作用是让 deepseek.hasKey() 返回 true，从而走到「会发请求」的那条分支。
 * 本脚本不包含、也不读取任何真实的 API Key / BaseURL / token。
 */
const FAKE_KEY = ['sk', 'local', 'stub', 'not-a-real-credential'].join('-');

/**
 * 上游地址：始终是本机回环 + 运行时分配到的空闲端口，
 * 拼出来的地址只指向本进程内的假上游服务，绝不指向任何真实模型服务。
 */
const localUpstream = (port) => 'http://' + '127.0.0.1' + ':' + port;

function freePort() {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.unref();
    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
  });
}

function waitFor(fn, timeoutMs) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    (function tick() {
      fn().then(resolve).catch((e) => {
        if (Date.now() - started > timeoutMs) reject(e);
        else setTimeout(tick, 120);
      });
    })();
  });
}

function postJson(port, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      { host: '127.0.0.1', port, path: urlPath, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
      (res) => {
        let buf = '';
        res.on('data', (c) => { buf += c; });
        res.on('end', () => {
          try { resolve(JSON.parse(buf)); } catch (e) { reject(new Error('bad json: ' + buf.slice(0, 300))); }
        });
      }
    );
    req.on('error', reject);
    req.end(data);
  });
}

(async function main() {
  const upstreamPort = await freePort();
  const appPort = await freePort();

  /* ---- 假上游：按当前设定的状态码应答 ---- */
  let upstreamStatus = 429;
  let upstreamBody = 'Rate limit reached for requests';
  const upstream = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      if (upstreamStatus === 200) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          choices: [{ message: { content: JSON.stringify({
            overall_score: 88, summary: '假上游返回的正常结果', questions: { asked: 6 },
          }) } }],
        }));
        return;
      }
      res.writeHead(upstreamStatus, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: upstreamBody, type: 'test' } }));
    });
  });
  await new Promise((r) => upstream.listen(upstreamPort, '127.0.0.1', r));

  /* ---- 起真实服务 ---- */
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(appPort),
      AI_API_KEY: FAKE_KEY,
      AI_BASE_URL: localUpstream(upstreamPort),
      AI_MODEL: 'deepseek-chat',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});

  const results = [];
  try {
    await waitFor(async () => {
      await postJson(appPort, '/api/health', {});
    }, 15000);

    const scenarios = [
      { status: 429, body: 'Rate limit reached for requests', expect: 'rate-limited' },
      { status: 402, body: 'Insufficient Balance', expect: 'insufficient-balance' },
      { status: 401, body: 'Authentication Fails', expect: 'auth-failed' },
      { status: 500, body: 'internal server error', expect: 'model-error' },
      { status: 200, body: '', expect: 'none' },
    ];

    for (const s of scenarios) {
      upstreamStatus = s.status;
      upstreamBody = s.body;
      const r = await postJson(appPort, '/api/analyze', { transcript: TEXT, subject: '函数单调性', durationSec: 240 });
      const d = r.data || {};
      results.push({
        upstream: s.status,
        engine: d.engine,
        fallback_reason: d.fallback_reason,
        expect: s.expect,
        pass: d.fallback_reason === s.expect,
        overall_score: typeof d.overall_score,
        has_knowledge: !!d.knowledge,
        has_wait_metrics: !!d.wait_metrics,
      });
    }

    /* ---- 无 Key 场景：另起一个没有 Key 的服务实例 ----
       注意 AI_API_KEY=''（空串而非 undefined）：server.js 的 .env 加载只在
       变量「未定义」时才写入 .env 的值，空串可以挡住 .env 里那个真 Key。 */
    child.kill();
    await new Promise((r) => child.on('exit', r));
    const noKeyPort = await freePort();
    const child2 = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
      cwd: ROOT,
      env: Object.assign({}, process.env, {
        PORT: String(noKeyPort),
        AI_API_KEY: '',
        AI_BASE_URL: localUpstream(upstreamPort),
      }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child2.stdout.on('data', () => {});
    child2.stderr.on('data', () => {});
    await waitFor(async () => { await postJson(noKeyPort, '/api/health', {}); }, 15000);
    const rNoKey = await postJson(noKeyPort, '/api/analyze', {
      transcript: TEXT, subject: '函数单调性', durationSec: 240,
    });
    const dNoKey = rNoKey.data || {};
    results.push({
      upstream: '(无 Key)',
      engine: dNoKey.engine,
      fallback_reason: dNoKey.fallback_reason,
      expect: 'key-not-configured',
      pass: dNoKey.fallback_reason === 'key-not-configured',
      overall_score: typeof dNoKey.overall_score,
      has_knowledge: !!dNoKey.knowledge,
      has_wait_metrics: !!dNoKey.wait_metrics,
    });
    child2.kill();
  } finally {
    child.kill();
    upstream.close();
  }

  console.log(JSON.stringify(results, null, 2));
  const allPass = results.every((r) => r.pass);
  console.log('\n=== E2E ' + (allPass ? 'ALL PASS' : 'FAILED') + ' ===');
  process.exit(allPass ? 0 : 1);
})().catch((e) => {
  console.error('E2E 异常：', e && e.stack ? e.stack : e);
  process.exit(1);
});
