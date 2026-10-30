'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const net = require('net');
const { spawn } = require('child_process');
const path = require('path');

const SERVER = path.join(__dirname, '..', 'server.js');

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

function req(port, pathname, body, method, timeoutMs) {
  return new Promise((resolve) => {
    const payload = body ? JSON.stringify(body) : null;

    const request = http.request(
      {
        host: '127.0.0.1',
        port,
        path: pathname,
        method: method || 'POST',
        headers: { 'Content-Type': 'application/json' },
      },
      (response) => {
        let text = '';
        response.on('data', (chunk) => { text += chunk; });
        response.on('end', () => {
          let json = null;
          try { json = JSON.parse(text); } catch (_) {}
          resolve({ status: response.statusCode, text, json });
        });
      }
    );

    request.setTimeout(timeoutMs || 20000, () => {
      request.destroy();
      resolve({ status: 'TIMEOUT', text: '请求挂起' });
    });

    request.on('error', (error) => {
      resolve({ status: 0, text: error.message });
    });

    if (payload) request.write(payload);
    request.end();
  });
}

async function waitReady(port, isDead, readLog) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 15000) {
    if (isDead()) {
      throw new Error(
        '服务进程提前退出：\n' + String(readLog() || '').slice(-1200)
      );
    }

    const response = await req(port, '/api/health', null, 'GET', 1500);
    if (response.status === 200) return;

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error('服务启动超时：\n' + String(readLog() || '').slice(-1200));
}

test('提问专项接口可用，评价不可用时不伪造分数', async () => {
  const port = await freePort();

  const child = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env,
      PORT: String(port),
      GLOBAL_CONCURRENCY: '1',
      RATE_MAX_PER_IP: '500',
    },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let log = '';
  let exited = false;

  child.stdout.on('data', (data) => { log += data.toString(); });
  child.stderr.on('data', (data) => { log += data.toString(); });
  child.on('exit', () => { exited = true; });

  try {
    await waitReady(port, () => exited, () => log);

    const student = await req(
      port,
      '/api/question-drill/student',
      {
        topic: '勾股定理',
        quote: '这公式大家能理解吗？',
        misconceptionKey: 'fixed_formula',
        messages: [],
      }
    );

    assert.strictEqual(student.status, 200, student.text);
    assert.strictEqual(student.json && student.json.ok, true);
    assert.ok(student.json.data.reply);
    assert.ok(['llm', 'rule'].includes(student.json.data.engine));
    assert.strictEqual(
      student.json.data.rubric_version,
      'question-drill-v1'
    );

    const evaluation = await req(
      port,
      '/api/question-drill/evaluate',
      {
        goal: '让提问引发学生表达思路',
        quote: '这公式大家能理解吗？',
        messages: [
          { role: 'student', content: '我觉得这个公式什么情况都能用。' },
          { role: 'teacher', content: '你能说说你这样想的理由吗？' },
          { role: 'student', content: '因为书上就是这么写的。' },
          { role: 'teacher', content: '如果不是直角三角形，你觉得还成立吗？为什么？' },
        ],
      }
    );

    assert.strictEqual(evaluation.status, 200, evaluation.text);
    assert.strictEqual(evaluation.json && evaluation.json.ok, true);

    const result = evaluation.json.data;
    assert.ok(
      result.status === 'complete' || result.status === 'unavailable'
    );
    assert.match(
      result.boundary_note,
      /不代表已经测得学生的真实理解/
    );

    if (result.status === 'complete') {
      assert.deepStrictEqual(
        result.dimensions.map((item) => item.key),
        [
          'clear_question_task',
          'expression_space',
          'follow_up_adaptation',
        ]
      );

      result.dimensions.forEach((item) => {
        assert.ok(Number.isInteger(item.score));
        assert.ok(item.score >= 0 && item.score <= 2);
      });
    } else {
      assert.deepStrictEqual(result.dimensions, []);
    }

    const invalid = await req(
      port,
      '/api/question-drill/evaluate',
      { goal: '提问训练', quote: '示例原句', messages: [] }
    );

    assert.strictEqual(invalid.status, 200, invalid.text);
    assert.strictEqual(invalid.json.data.status, 'unavailable');
    assert.deepStrictEqual(invalid.json.data.dimensions, []);
  } finally {
    child.kill();
  }
});
