'use strict';

/**
 * 静态资源版本号指纹锁 —— 测试
 * ------------------------------------------------------------------
 * 这条测试要堵的是一个**一直没堵住**的漏洞：
 *   旧测试只断言「fx.css 与 fx.js 的 ?v= 相同」。可是如果开发者改了文件内容、
 *   两个版本号一起不动，旧测试照样绿 —— 线上用户拿着旧缓存 JS 跑新 HTML，
 *   症状五花八门，而 CI 全绿。这就是本项目已经踩过 4 次的坑。
 *
 * 现在改成：文件内容的 sha256 也记进锁里。内容一变、版本号没变 → 直接失败。
 *
 * 前 7 条用假数据测判定逻辑（不依赖真实文件，改生产文件也不会影响它们），
 * 后 4 条测真实仓库状态。
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const fp = require('../scripts/asset-fingerprint.js');

function asset(sha, version, pages, versions) {
  return {
    sha256: sha,
    version: version,
    pages: pages || ['index.html'],
    versions: versions || [version],
    missing: false,
  };
}

function lockedOf(sha, version) {
  return { sha256: sha, version: version, bytes: 100 };
}

/* ---------- 1. 判定逻辑（假数据） ---------- */

test('指纹锁：内容变了但版本号没变 → 必须失败', () => {
  const now = { 'app.js': asset('newhash0000', '20261030-m5') };
  const r = fp.diffAssets(now, { 'app.js': lockedOf('oldhash0000', '20261030-m5') });
  assert.strictEqual(r.fatal.length, 1, '这正是「两边一起不动照样绿」的漏洞，必须被抓到');
  assert.ok(r.fatal[0].indexOf('app.js') !== -1);
  assert.ok(/内容已变更/.test(r.fatal[0]));
});

test('指纹锁：失败信息里要给出建议版本号，不能只说「错了」', () => {
  const now = { 'app.js': asset('newhash', '20261030-tilt1') };
  const r = fp.diffAssets(now, { 'app.js': lockedOf('oldhash', '20261030-tilt1') });
  assert.ok(/20261030-tilt2/.test(r.fatal[0]), '应当建议 tilt1 → tilt2，实际：' + r.fatal[0]);
});

test('指纹锁：建议版本号对没有尾数字的版本也能处理', () => {
  // 纯日期版本（20261030）按日递增；带后缀的按尾数递增
  assert.strictEqual(fp.suggestVersion('20261030'), '20261031');
  assert.strictEqual(fp.suggestVersion('20261030-tilt9'), '20261030-tilt10');
  assert.strictEqual(fp.suggestVersion(''), '2');
});

test('指纹锁：内容变了版本号也变了 → 只提示刷新锁，不算致命', () => {
  const now = { 'app.js': asset('newhash', '20261030-tilt2') };
  const r = fp.diffAssets(now, { 'app.js': lockedOf('oldhash', '20261030-tilt1') });
  assert.strictEqual(r.fatal.length, 0);
  assert.strictEqual(r.stale.length, 1);
  assert.ok(/--update/.test(r.stale[0]));
});

test('指纹锁：内容没变但版本号变了 → 提示无谓的缓存失效', () => {
  const now = { 'app.js': asset('samehash', '20261030-tilt2') };
  const r = fp.diffAssets(now, { 'app.js': lockedOf('samehash', '20261030-tilt1') });
  assert.strictEqual(r.fatal.length, 0);
  assert.strictEqual(r.stale.length, 1);
  assert.ok(/缓存失效/.test(r.stale[0]));
});

test('指纹锁：两边都没动 → 静默通过', () => {
  const now = { 'app.js': asset('h', 'v1') };
  const r = fp.diffAssets(now, { 'app.js': lockedOf('h', 'v1') });
  assert.deepStrictEqual(r.fatal, []);
  assert.deepStrictEqual(r.stale, []);
  assert.deepStrictEqual(r.missing, []);
});

test('指纹锁：同一文件在不同页面版本号不一致 → 致命', () => {
  const now = { 'app.js': asset('h', 'v1', ['index.html', 'workbench.html'], ['v1', 'v2']) };
  const r = fp.diffAssets(now, { 'app.js': lockedOf('h', 'v1') });
  assert.strictEqual(r.fatal.length, 1);
  assert.ok(/版本号不一致/.test(r.fatal[0]));
});

test('指纹锁：引用了不存在的文件 → 致命（线上会 404）', () => {
  const now = { 'ghost.js': { sha256: '', version: 'v1', pages: ['index.html'], versions: ['v1'], missing: true } };
  const r = fp.diffAssets(now, {});
  assert.strictEqual(r.fatal.length, 1);
  assert.ok(/404/.test(r.fatal[0]));
});

test('指纹锁：新资源没登记 → 提醒，不判死', () => {
  const now = { 'fresh.js': asset('h', 'v1') };
  const r = fp.diffAssets(now, {});
  assert.strictEqual(r.fatal.length, 0);
  assert.deepStrictEqual(r.missing, ['fresh.js']);
});

test('指纹锁：锁里有但页面已不引用 → 致命（提示清理）', () => {
  const r = fp.diffAssets({}, { 'gone.js': lockedOf('h', 'v1') });
  assert.strictEqual(r.fatal.length, 1);
  assert.ok(/不再引用/.test(r.fatal[0]));
});

/* ---------- 2. 真实仓库状态 ---------- */

test('指纹锁：锁文件必须存在', () => {
  assert.ok(fs.existsSync(fp.LOCK_PATH),
    '缺少 tests/asset-lock.json，请运行 node scripts/asset-fingerprint.js --update');
});

test('指纹锁：当前仓库必须通过校验', () => {
  const r = fp.check();
  const lines = []
    .concat(r.fatal.map((x) => '[FATAL] ' + x))
    .concat(r.stale.map((x) => '[STALE] ' + x))
    .concat(r.missing.map((x) => '[NEW]   ' + x + ' 未登记'));
  assert.deepStrictEqual(lines, [], '静态资源版本锁未通过：\n' + lines.join('\n'));
});

test('指纹锁：扫描到的资源数量与锁记录一致（防止扫描规则悄悄失效）', () => {
  const now = fp.scanReferences();
  const lock = fp.readLock();
  const n = Object.keys(now).length;
  assert.ok(n >= 20, '只扫到 ' + n + ' 个资源，扫描正则可能坏了');
  assert.strictEqual(n, Object.keys(lock.assets || {}).length);
});

test('指纹锁：每个资源都真的存在且非空', () => {
  const now = fp.scanReferences();
  for (const rel of Object.keys(now)) {
    const abs = path.join(fp.PUBLIC, rel);
    assert.ok(fs.existsSync(abs), rel + ' 不存在');
    assert.ok(fs.statSync(abs).size > 0, rel + ' 是空文件');
  }
});

test('指纹锁：vendor 下的库也要纳入（它们同样会被缓存）', () => {
  const now = fp.scanReferences();
  assert.ok(Object.keys(now).some((r) => r.indexOf('vendor/') === 0),
    'gsap / ScrollTrigger 没被扫到，说明只扫了一级目录');
});
