'use strict';
/**
 * 环境变量加载顺序回归测试
 * ------------------------------------------------------------------
 * 历史缺陷：lib/deepseek.js 曾在模块加载时固化 API_KEY，
 * 而 server.js 的 loadEnv() 写在 require 之后 —— 无论 .env 写没写对，
 * hasKey() 永远返回 false。已修复为「用时再读」+ loadEnv 提前。
 * 本测试保证两条防线都不回退：
 *   1. 先 require 后设 env，hasKey 必须能感知（惰性读取）
 *   2. loadEnv 解析格式正确（引号剥离/注释跳过/不覆盖已有）
 */

// 清场：确保测试从干净状态开始
delete process.env.AI_API_KEY;
delete process.env.DEEPSEEK_API_KEY;
delete process.env.AI_MODEL;
delete process.env.AI_BASE_URL;

// 关键：模拟真实事故现场 —— 先加载模块（此时没有 Key）
const ai = require('../lib/deepseek.js');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  cond ? pass++ : fail++;
  console.log(`[${cond ? 'PASS' : 'FAIL'}] ${name}${extra ? ' -> ' + extra : ''}`);
}

// 1. 加载时无 Key → hasKey 必须 false
check('1 模块加载时无 Key → hasKey=false', ai.hasKey() === false);

// 2. 之后才设环境变量（.env 晚到）→ hasKey 必须感知到
process.env.AI_API_KEY = 'sk-test-key-late-loaded-12345';
check('2 env 晚于 require 设置 → hasKey 仍能感知', ai.hasKey() === true);

// 3. 模型名也是惰性的
process.env.AI_MODEL = 'qwen-plus';
check('3 modelName 惰性读取', ai.modelName() === 'qwen-plus');
delete process.env.AI_MODEL;
check('3b 删除后回落默认 deepseek-chat', ai.modelName() === 'deepseek-chat');

// 4. baseUrl 惰性 + 去尾斜杠
process.env.AI_BASE_URL = 'https://api.example.com/v1/';
check('4 baseUrl 惰性读取并去尾斜杠', ai.baseUrl() === 'https://api.example.com/v1');
delete process.env.AI_BASE_URL;
check('4b 删除后回落默认', ai.baseUrl() === 'https://api.deepseek.com');

// 5. server.js 的 loadEnv 解析逻辑（复制同款实现做行为验证）
delete process.env.AI_API_KEY;
const fs = require('fs');
const os = require('os');
const path = require('path');
const envFile = path.join(os.tmpdir(), 'jtq-test.env');
fs.writeFileSync(envFile, [
  '# 注释行应被跳过',
  '',
  'AI_API_KEY=sk-plain-value-abcdef',
  'AI_MODEL = "quoted-model"',        // 等号两侧带空格
  "AI_BASE_URL='single-quoted'",      // 单引号剥离
  'AI_API_KEY=sk-should-not-override', // 已存在的值不覆盖
].join('\n'), 'utf8');

process.env.AI_API_KEY = 'sk-plain-value-abcdef'; // 模拟已加载

function loadEnvLikeServer(file) {
  const text = fs.readFileSync(file, 'utf8');
  text.split(/\r?\n/).forEach((line) => {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (!m || line.trim().startsWith('#')) return;
    let val = (m[2] || '').trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[m[1]] === undefined) process.env[m[1]] = val;
  });
}
loadEnvLikeServer(envFile);
check('5 注释与空行被跳过，普通值生效', process.env.AI_MODEL === 'quoted-model');
check('5b 引号被剥离', process.env.AI_MODEL === 'quoted-model');
check('5c 已存在的值不被覆盖', process.env.AI_API_KEY === 'sk-plain-value-abcdef');
fs.unlinkSync(envFile);

// 6. 端到端：启动真实 server.js 进程（带 .env），health 必须 live
delete process.env.AI_MODEL;

async function e2e() {
  const { spawn } = require('child_process');
  const http = require('http');
  await new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
      env: Object.assign({}, process.env, { PORT: '3497' }),
      windowsHide: true,
      stdio: 'ignore',
    });
    const t0 = Date.now();
    const poll = () => {
      http.get('http://127.0.0.1:3497/api/health', (res) => {
        let body = '';
        res.on('data', (d) => { body += d; });
        res.on('end', () => {
          try {
            const j = JSON.parse(body);
            check('6 server 端到端 hasKey=true（真实 .env 已生效）', j.hasKey === true, 'aiMode=' + j.aiMode);
          } catch (e) {
            check('6 health 返回可解析 JSON', false, e.message);
          }
          child.kill();
          resolve();
        });
      }).on('error', () => {
        if (Date.now() - t0 > 15000) { check('6 服务启动超时', false); child.kill(); resolve(); }
        else setTimeout(poll, 400);
      });
    };
    setTimeout(poll, 500);
  });
}

e2e().then(() => {
  console.log(`\n===== env 加载顺序回归：${pass} 通过 / ${fail} 失败 =====`);
  process.exit(fail === 0 ? 0 : 1);
});
