#!/usr/bin/env node
'use strict';

/**
 * 事实快照生成器
 * ------------------------------------------------------------------
 * 目的：让「代码规模 / 接口数量 / 文件指纹」这三个数字可以被他人在任意机器上复现，
 *      而不是只能引用某份文档里的一句话。
 *
 * 用法：
 *   node scripts/snapshot-facts.js            # 打印到终端（Markdown）
 *   node scripts/snapshot-facts.js --json     # 打印 JSON（便于二次处理）
 *   node scripts/snapshot-facts.js --write    # 写入 docs/事实快照-<日期>.md
 *
 * 标准：零依赖（只用 Node 内置 fs / path / crypto），与项目整体风格一致。
 * 注意：本脚本不做测试执行，测试结果由 `npm test` 单独产出，两者拼起来才是完整证据。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const APP_DIR = path.join(__dirname, '..');
const PKG = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'package.json'), 'utf8'));

/* ---------- 工具 ---------- */

function read(rel) {
  return fs.readFileSync(path.join(APP_DIR, rel), 'utf8');
}

function lines(rel) {
  const t = read(rel);
  if (!t.length) return 0;
  return t.split('\n').length - (t.endsWith('\n') ? 1 : 0);
}

function sha(rel) {
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(APP_DIR, rel))).digest('hex');
}

function exists(rel) {
  try { return fs.statSync(path.join(APP_DIR, rel)).isFile(); } catch (e) { return false; }
}

/* ---------- 分层代码规模 ---------- */

function expand(pattern) {
  const dir = path.join(APP_DIR, path.dirname(pattern));
  const base = path.basename(pattern);
  if (!fs.existsSync(dir)) return [];
  let re;
  if (base.startsWith('*.')) {
    re = new RegExp('\\.' + base.slice(2).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$');
    return fs.readdirSync(dir)
      .filter((f) => re.test(f))
      .map((f) => path.posix.join(path.dirname(pattern), f));
  }
  return exists(pattern) ? [pattern] : [];
}

function sumLines(files) {
  return files.reduce((s, f) => s + lines(f), 0);
}

const backendFiles = ['server.js'].concat(expand('lib/*.js'));
const frontendFiles = expand('public/*.js')
  .concat(expand('public/*.css'))
  .concat(expand('public/*.html'))
  .filter((f) => f.indexOf('offline.html') === -1);
const testFiles = expand('tests/*.js').concat(expand('tests/*.cjs'));
const suiteFiles = testFiles.filter((f) => /\.test\.js$/.test(f));
const scriptFiles = expand('scripts/*.js').filter((f) => f.indexOf('snapshot-facts.js') === -1);

const layers = {
  后端运行时: { files: backendFiles, lines: sumLines(backendFiles) },
  前端运行时: { files: frontendFiles, lines: sumLines(frontendFiles) },
  测试代码: { files: testFiles, lines: sumLines(testFiles) },
  构建与校验脚本: { files: scriptFiles, lines: sumLines(scriptFiles) },
};

/* ---------- 接口清单 ---------- */

function endpoints() {
  const src = read('server.js');
  const set = new Set();
  // 形如 pathname === '/api/xxx'
  const re = /pathname\s*===\s*'(\/api\/[^']+)'/g;
  let m;
  while ((m = re.exec(src)) !== null) set.add(m[1]);
  // 统一前缀写法可能漏掉，兜底扫一遍字符串字面量
  const re2 = /'(\/api\/[a-z0-9\/-]+)'/gi;
  while ((m = re2.exec(src)) !== null) set.add(m[1]);
  return Array.from(set).sort();
}

/* LLM_ENDPOINTS 集合是「会花钱」的权威口径，单独抠出来 */
function llmEndpoints() {
  const src = read('server.js');
  const block = src.match(/const LLM_ENDPOINTS = new Set\(\[([\s\S]*?)\]\);/);
  if (!block) return [];
  const out = [];
  const re = /'(\/api\/[^']+)'/g;
  let m;
  while ((m = re.exec(block[1])) !== null) out.push(m[1]);
  return out.sort();
}

/* ---------- 前端主界面 ---------- */

function tabs() {
  if (!exists('public/index.html')) return [];
  const html = read('public/index.html');
  const set = new Set();
  const re = /data-tab="([^"]+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) set.add(m[1]);
  return Array.from(set).sort();
}

/* ---------- 汇总 ---------- */

const runs = endpoints();
const llm = llmEndpoints();

const snapshot = {
  生成时间: new Date().toISOString(),
  node: process.version,
  平台: process.platform,
  项目版本: PKG.version,
  依赖数: Object.keys(PKG.dependencies || {}).length,
  分层: {},
  接口总数: runs.length,
  其中调用大模型: llm.length,
  纯计算接口: runs.length - llm.length,
  接口清单: runs,
  前端主界面: tabs(),
  测试文件: (() => {
    // 三类要分清：node:test 套件 / 打印式自校验脚本 / 供测试复用的辅助模块
    const helpers = testFiles.filter((f) => /(_dom|_drill_smoke)\.(js|cjs)$/.test(f));
    const suites = testFiles.filter((f) => /\.test\.js$/.test(f));
    return {
      总数: testFiles.length,
      套件: suites.length,
      脚本式: testFiles.filter((f) => suites.indexOf(f) === -1 && helpers.indexOf(f) === -1).length,
      辅助模块: helpers.length,
    };
  })(),
};

Object.keys(layers).forEach((k) => {
  snapshot.分层[k] = { 文件数: layers[k].files.length, 行数: layers[k].lines };
});

/* 关键文件指纹：用于判断「这份文档描述的还是不是当前代码」 */
const fingerprintTargets = ['server.js', 'lib/ifias.js', 'lib/engine.js', 'lib/prompts.js',
  'public/index.html', 'public/app.js'].filter(exists);
snapshot.指纹 = {};
fingerprintTargets.forEach((f) => { snapshot.指纹[f] = sha(f).slice(0, 16); });

/* 全量合并指纹：目录里任何运行时文件变了，这个值就会变 */
const allRuntime = backendFiles.concat(frontendFiles).sort();
const combined = crypto.createHash('sha256')
  .update(allRuntime.map((f) => f + ':' + sha(f)).join('\n'))
  .digest('hex');
snapshot.合并指纹 = combined.slice(0, 16);

/* ---------- 输出 ---------- */

if (process.argv.includes('--json')) {
  process.stdout.write(JSON.stringify(snapshot, null, 2) + '\n');
  process.exit(0);
}

const md = [];
md.push('# 事实快照 · ' + snapshot.生成时间.slice(0, 10));
md.push('');
md.push('> 由 `node scripts/snapshot-facts.js` 自动生成。凡引用本文件的数字，都可用同一条命令在本机复现。');
md.push('> 本文件只覆盖「代码事实」，不含教学效果数据。');
md.push('');
md.push('## 一、环境与版本');
md.push('');
md.push('| 项 | 值 |');
md.push('| :--- | :--- |');
md.push('| 生成时间（UTC） | ' + snapshot.生成时间 + ' |');
md.push('| Node | ' + snapshot.node + '（package.json 要求 >=18） |');
md.push('| 平台 | ' + snapshot.平台 + ' |');
md.push('| 第三方依赖 | ' + snapshot.依赖数 + ' 个 |');
md.push('| 合并指纹 | `' + snapshot.合并指纹 + '` |');
md.push('');
md.push('## 二、分层规模');
md.push('');
md.push('| 层 | 文件数 | 行数 |');
md.push('| :--- | --: | --: |');
Object.keys(snapshot.分层).forEach((k) => {
  md.push('| ' + k + ' | ' + snapshot.分层[k].文件数 + ' | ' + snapshot.分层[k].行数.toLocaleString('en-US') + ' |');
});
md.push('');
md.push('## 三、接口');
md.push('');
md.push('共 **' + snapshot.接口总数 + '** 条：调用大模型 ' + snapshot.其中调用大模型 + ' 条，纯计算 ' + snapshot.纯计算接口 + ' 条。');
md.push('');
md.push('| 接口 | 类型 |');
md.push('| :--- | :--- |');
snapshot.接口清单.forEach((p) => {
  md.push('| `' + p + '` | ' + (llm.indexOf(p) !== -1 ? '调用大模型（计配额）' : '纯计算（不计配额）') + ' |');
});
md.push('');
md.push('## 四、前端主界面');
md.push('');
md.push(snapshot.前端主界面.length + ' 个 Tab：' + snapshot.前端主界面.map((t) => '`' + t + '`').join('、'));
md.push('');
md.push('## 五、测试文件');
md.push('');
md.push('| 总数 | node:test 套件 | 脚本式自校验 | 辅助模块 |');
md.push('| --: | --: | --: | --: |');
md.push('| ' + snapshot.测试文件.总数 + ' | ' + snapshot.测试文件.套件 + ' | ' + snapshot.测试文件.脚本式 + ' | ' + snapshot.测试文件.辅助模块 + ' |');
md.push('');
md.push('> 测试通过数需另跑 `npm test`，本脚本不执行测试，避免把「文件存在」当成「测试通过」。');
md.push('');
md.push('## 六、关键文件指纹（SHA-256 前 16 位）');
md.push('');
md.push('| 文件 | 指纹 |');
md.push('| :--- | :--- |');
Object.keys(snapshot.指纹).forEach((f) => { md.push('| `' + f + '` | `' + snapshot.指纹[f] + '` |'); });
md.push('');
md.push('核对方法：若某文件的指纹与本表不一致，说明代码已变动，本文档的数字需要重新生成。');
md.push('');

const out = md.join('\n');

if (process.argv.includes('--write')) {
  const dir = path.join(APP_DIR, 'docs');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, '事实快照-' + snapshot.生成时间.slice(0, 10) + '.md');
  fs.writeFileSync(file, out, 'utf8');
  process.stdout.write('已写入 ' + file + '\n');
} else {
  process.stdout.write(out);
}
