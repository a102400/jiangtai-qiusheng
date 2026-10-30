'use strict';

/**
 * server.js 启动与并发闸门回归测试
 * ------------------------------------------------------------------
 * 背景：server.js 曾因 try/catch/finally 嵌套写坏（finally 挂到 catch 之后、
 * 外层 try 未闭合）导致 `node --check` 失败、服务完全起不来。
 * 本测试把「能启动」和「闸门不漏释放」锁死，避免同类回归。
 *
 * 验证点：
 *   1. node --check server.js 必须通过（语法层）
 *   2. 服务必须能真实启动并响应 /api/health（运行层）
 *   3. GLOBAL_CONCURRENCY=1 时，连续走遍所有返回路径都不许挂起
 *      —— 闸门漏一次 releaseHeavy，第 2 个请求就会永久等待
 *   4. 既有老接口在闸门介入后仍能正常返回
 */

const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const net = require('net');
const { spawn, execFileSync } = require('child_process');
const path = require('path');

const SERVER = path.join(__dirname, '..', 'server.js');

/* 端口不能再写死：
   固定端口会让「另一个进程/另一次测试占着这个端口」变成难查的偶发失败
   （本文件历史上出现过 ECONNRESET，就是子服务没起来、请求打到了别的服务）。
   这里向系统要一个当前空闲端口，避开端口竞争。
   注意：这里只解决「端口被占」，不给断言加重试 ——
   服务真挂了就必须让测试红，重试只会把真实回归藏起来。 */
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
  });
}

/* 一个最小请求封装：带超时，timeout 即视为「挂起」 */
function req(port, pathname, body, method, timeoutMs) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request(
      {
        host: '127.0.0.1',
        port,
        path: pathname,
        method: method || 'POST',
        headers: { 'Content-Type': 'application/json' },
      },
      (resp) => {
        let b = '';
        resp.on('data', (d) => { b += d; });
        resp.on('end', () => resolve({ status: resp.statusCode, body: b }));
      }
    );
    r.setTimeout(timeoutMs || 20000, () => {
      r.destroy();
      resolve({ status: 'TIMEOUT', body: '请求挂起' });
    });
    r.on('error', (e) => resolve({ status: 0, body: e.message }));
    if (data) r.write(data);
    r.end();
  });
}

function waitReady(port, timeoutMs, isDead, readLog) {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const poll = async () => {
      // 子进程已经死了就别再等了：直接报它的输出，
      // 否则只会得到一个「服务启动超时」，看不出真实原因。
      if (isDead && isDead()) {
        const log = readLog ? readLog() : '';
        return reject(
          new Error(
            '服务进程提前退出' +
              (log ? `，输出如下：\n${log.slice(-800)}` : '')
          )
        );
      }
      if (Date.now() - t0 > timeoutMs) return reject(new Error('服务启动超时'));
      const r = await req(port, '/api/health', null, 'GET', 2000);
      if (r.status === 200) return resolve();
      setTimeout(poll, 300);
    };
    poll();
  });
}

const TRANSCRIPT = '同学们好，今天我们学习勾股定理。刚才那个问题大家能理解吗？然后我们来看这个公式，就是 a 平方加 b 平方等于 c 平方。';

test('server.js 语法检查通过（node --check）', () => {
  const out = execFileSync(process.execPath, ['--check', SERVER], { encoding: 'utf8' });
  assert.strictEqual(out.trim(), '');
});

test('服务能启动、闸门不漏释放、老接口不受影响', async (t) => {
  // 动态端口：避开「别的进程占着固定端口」这类偶发失败
  const PORT = await freePort();

  // GLOBAL_CONCURRENCY=1：闸门一旦漏释放，第二个请求就会永久挂起 —— 最灵敏的探针
  const child = spawn(process.execPath, [SERVER], {
    env: Object.assign({}, process.env, {
      PORT: String(PORT),
      GLOBAL_CONCURRENCY: '1',
      RATE_MAX_PER_IP: '500', // 避免限流干扰本测试
    }),
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // 子进程提前退出（例如端口被占、启动抛错）时立刻报错，
  // 而不是让 waitReady 去连一个「看起来在监听、其实是别人」的服务。
  let childLog = '';
  let childExited = null;
  child.stdout.on('data', (d) => { childLog += d.toString(); });
  child.stderr.on('data', (d) => { childLog += d.toString(); });
  child.on('exit', (code, signal) => { childExited = { code, signal }; });

  try {
    await waitReady(PORT, 15000, () => childExited, () => childLog);

    // 依次走遍「能走到的所有返回路径」：正常 200、参数 400、未知 404、方法 405
    const cases = [
      ['drill 正常', '/api/drill', { skill: 'pace_filler', transcript: TRANSCRIPT, durationSec: 100 }, 'POST'],
      ['drill 未知 skill', '/api/drill', { skill: 'nope-not-a-skill', transcript: TRANSCRIPT }, 'POST'],
      ['drill 内容过短', '/api/drill', { skill: 'pace_filler', transcript: '短' }, 'POST'],
      ['drill 缺 skill', '/api/drill', { transcript: TRANSCRIPT }, 'POST'],
      ['drill/skills GET', '/api/drill/skills', null, 'GET'],
      ['drill/skills POST', '/api/drill/skills', {}, 'POST'],
      ['不存在路由', '/api/definitely-not-exist', {}, 'POST'],
      ['老接口 analyze', '/api/analyze', { transcript: TRANSCRIPT, subject: '数学', durationSec: 100 }, 'POST'],
      ['老接口 student/chat', '/api/student/chat', { messages: [], persona: 'naughty' }, 'POST'],
      ['老接口 classroom/round', '/api/classroom/round', { topic: '勾股', transcript: TRANSCRIPT }, 'POST'],
      ['health', '/api/health', null, 'GET'],
    ];

    // 走两轮：单轮全绿不足以排除「第 1 个请求漏释放」
    for (let round = 1; round <= 2; round++) {
      for (const [name, pathname, body, method] of cases) {
        const r = await req(PORT, pathname, body, method);
        assert.notStrictEqual(r.status, 'TIMEOUT', `第 ${round} 轮「${name}」挂起：并发闸门漏了 releaseHeavy`);
        assert.notStrictEqual(
          r.status,
          0,
          `第 ${round} 轮「${name}」连接失败：${r.body}` +
            (childLog ? `\n--- 子进程输出 ---\n${childLog.slice(-800)}` : '')
        );
      }
    }
  } finally {
    child.kill();
  }
});
