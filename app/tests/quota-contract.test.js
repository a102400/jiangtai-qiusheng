'use strict';

/**
 * 配额白名单契约测试
 * ------------------------------------------------------------------
 * 守的不变量：「会花钱的路由，必须在 LLM_ENDPOINTS 里」。
 *
 * 为什么要这组测试（真实事故）：
 *   /api/ifias 在 lib/ifias.js:596 调 llmCode() → ai.chat()，是真金白银的模型调用，
 *   但一直没登记进 server.js 的 LLM_ENDPOINTS。后果不是报错，而是**静默漏计**：
 *   任何人反复打这个接口，都不会消耗每日额度，也没有任何日志提示。
 *   server.js 的注释早就写了「新增接口必须加进这个集合」——注释拦不住手滑，测试才行。
 *
 * 这组测试分两类：
 *   A. 现状断言 —— 当前代码必须无缺口、无多计、无幽灵、无重叠；
 *   B. 变异测试 —— 故意篡改白名单，断言审计器能报出来。
 *      B 才是关键：没有 B 的话，一个「永远返回空」的审计器也能让 A 全绿。
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { audit, EXTERNAL_PAID } = require('../scripts/quota-audit');

const ROOT = path.resolve(__dirname, '..');
const serverSrc = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const engineSrc = fs.readFileSync(path.join(ROOT, 'lib/engine.js'), 'utf8');
const libDir = path.join(ROOT, 'lib');

/** 允许「路由块里看不出接线」的端点：纯静态/直写响应的那些 */
const NO_WIRING_OK = new Set(['/api/export', '/api/health', '/api/drill/skills']);

const run = (src) => audit({ serverSrc: src, engineSrc, libDir });
const baseline = run(serverSrc);

test('A1 现状：不存在「花钱却没计额度」的缺口', () => {
  assert.deepStrictEqual(
    baseline.missing, [],
    '以下路由会触发模型调用却不在 LLM_ENDPOINTS，等于开了免额度后门：' + baseline.missing.join(', ')
  );
});

test('A2 现状：不存在「不花钱却被计额度」的多计', () => {
  // 代价是纯计算接口也吃用户额度，等于变相降低可用次数
  assert.deepStrictEqual(
    baseline.extra, [],
    '以下路由不触发模型调用却在 LLM_ENDPOINTS，会让用户白扣额度：' + baseline.extra.join(', ')
  );
});

test('A3 现状：白名单里没有已删除的路由（幽灵项）', () => {
  assert.deepStrictEqual(
    baseline.phantom, [],
    '以下端点在 LLM_ENDPOINTS 里，但 server.js 已无此路由，属于配置残留：' + baseline.phantom.join(', ')
  );
});

test('A4 现状：LLM_ENDPOINTS 与 OPEN_ENDPOINTS 不重叠', () => {
  // 重叠意味着「免 sharecode 的接口」同时被配额豁免，双重放开
  assert.deepStrictEqual(
    baseline.overlap, [],
    '以下端点同时在两个集合里，会被跳过鉴权又被跳过配额：' + baseline.overlap.join(', ')
  );
});

test('A5 现状：每个路由都能解析出一条接线（否则审计器是瞎的）', () => {
  const blind = baseline.rows.filter((r) => r.via === '-' && !NO_WIRING_OK.has(r.url)).map((r) => r.url);
  assert.deepStrictEqual(
    blind, [],
    '这些路由审计器看不出调用了什么，说明写法超出静态解析范围，需要人工确认是否计费：' + blind.join(', ')
  );
});

test('A6 现状：/api/ifias 已计入额度（本次修复的回归锁）', () => {
  const row = baseline.rows.find((r) => r.url === '/api/ifias');
  assert.ok(row, '/api/ifias 路由不存在了？');
  assert.strictEqual(row.paid, true, '/api/ifias 必须被识别为付费端点');
  assert.strictEqual(row.inSet, true, '/api/ifias 必须留在 LLM_ENDPOINTS 里');
});

test('A7 现状：/api/ifias-batch 不计额度（纯本地计算）', () => {
  // 这条防的是审计器退化：ifias 模块里 ifiasAnalyze 调模型、batchTrajectory 不调。
  // 一旦判定粒度退回「模块级」，这里就会误报，进而被人为塞进白名单白扣额度。
  const row = baseline.rows.find((r) => r.url === '/api/ifias-batch');
  assert.ok(row, '/api/ifias-batch 路由不存在了？');
  assert.strictEqual(row.paid, false, 'batchTrajectory 只做 PCA/DBSCAN，不调模型，不应计费');
  assert.strictEqual(row.inSet, false, '既然不花钱，就不该占用用户额度');
});

test('A8 外部计费声明不过期：登记的符号必须真实存在', () => {
  Object.entries(EXTERNAL_PAID).forEach(([mod, cfg]) => {
    const file = path.join(libDir, mod + '.js');
    assert.ok(fs.existsSync(file), 'EXTERNAL_PAID 登记了不存在的模块：' + mod);
    const src = fs.readFileSync(file, 'utf8');
    cfg.symbols.forEach((sym) => {
      assert.ok(
        new RegExp('^(?:async )?function ' + sym + '\\s*\\(', 'm').test(src),
        'EXTERNAL_PAID 登记了 ' + mod + '.' + sym + '，但该函数在模块里找不到（已改名？）'
      );
    });
  });
});

test('B1 变异：删掉 /api/ifias 的白名单登记，审计器必须报缺口', () => {
  const mutated = serverSrc.replace(/\n\s*'\/api\/ifias',/, '');
  assert.notStrictEqual(mutated, serverSrc, '变异没生效：没找到要删的那一行，测试本身就是假的');
  const r = run(mutated);
  assert.ok(r.missing.includes('/api/ifias'), '把白名单删了却报不出缺口，说明审计器形同虚设');
});

test('B2 变异：把纯计算接口塞进白名单，审计器必须报多计', () => {
  const mutated = serverSrc.replace(
    'const LLM_ENDPOINTS = new Set([',
    "const LLM_ENDPOINTS = new Set([\n  '/api/ifias-batch',"
  );
  assert.notStrictEqual(mutated, serverSrc, '变异没生效');
  const r = run(mutated);
  assert.ok(r.extra.includes('/api/ifias-batch'), '给不花钱的接口计额度却没被拦下');
});

test('B3 变异：白名单写入不存在的路由，审计器必须报幽灵项', () => {
  const mutated = serverSrc.replace(
    'const LLM_ENDPOINTS = new Set([',
    "const LLM_ENDPOINTS = new Set([\n  '/api/typo-endpoint',"
  );
  assert.notStrictEqual(mutated, serverSrc, '变异没生效');
  const r = run(mutated);
  assert.ok(r.phantom.includes('/api/typo-endpoint'), '白名单残留没人管');
});

test('B4 变异：把一个免费接口也放进白名单，审计器必须报多计', () => {
  const mutated = serverSrc.replace(
    'const LLM_ENDPOINTS = new Set([',
    "const LLM_ENDPOINTS = new Set([\n  '/api/health',"
  );
  assert.notStrictEqual(mutated, serverSrc, '变异没生效');
  const r = run(mutated);
  assert.ok(r.extra.includes('/api/health'), '健康检查被计费也没被拦下');
  assert.ok(r.overlap.includes('/api/health'), '/api/health 同时在 OPEN 集合里，应报重叠');
});

test('B5 变异：新增一个调模型的路由但不登记，审计器必须报缺口', () => {
  // 模拟「给 engine 加了一个方法，server 加了路由，忘了加白名单」这个最真实的手滑场景
  const mutatedEngine = engineSrc.replace(
    'function drillSkills() {',
    "async function freeTrial(input = {}) {\n  return ai.chat([{ role: 'user', content: 'x' }]);\n}\nfunction drillSkills() {"
  );
  const mutatedServer = serverSrc.replace(
    "    if (pathname === '/api/export') {",
    "    if (pathname === '/api/free-trial') {\n      const data = await engine.freeTrial({});\n      return sendJson(res, 200, { ok: true, data });\n    }\n\n    if (pathname === '/api/export') {"
  );
  assert.notStrictEqual(mutatedEngine, engineSrc, 'engine 变异没生效');
  assert.notStrictEqual(mutatedServer, serverSrc, 'server 变异没生效');
  const r = audit({ serverSrc: mutatedServer, engineSrc: mutatedEngine, libDir });
  assert.ok(
    r.missing.includes('/api/free-trial'),
    '新接口调 ai.chat 却没登记白名单，审计器没抓到——这正是 /api/ifias 当初的翻版'
  );
});
