'use strict';

/**
 * 配额白名单静态审计器
 * ------------------------------------------------------------------
 * 要守住的不变量只有一条：
 *   「凡是会发起付费调用的路由，必须在 server.js 的 LLM_ENDPOINTS 里」
 *
 * 为什么需要它：server.js 的注释要求新增调模型的接口必须登记，但注释管不住人。
 * 2026-10-30 审计发现 /api/ifias 在 lib/ifias.js:596 调 llmCode() → ai.chat()，
 * 却一直没进白名单 —— 任何人反复请求该接口都能绕过每日额度而不计数。
 *
 * 做法：不跑服务、不发请求，纯静态解析调用链
 *   路由(server.js 的 pathname === '...')
 *     → engine 方法（engine.xxx）
 *     → lib 模块函数（解构 require 的符号）
 *     → 是否出现 ai.chat() / 已知付费的外部 API
 * 函数级传播（而不是模块级）：lib/ifias.js 里 ifiasAnalyze 调模型、batchTrajectory 不调，
 * 模块级判断会把 /api/ifias-batch 误判成付费端点，所以必须细到函数。
 *
 * 已知局限（写在这里，免得后人把它当万能）：
 *   1. 只认 `pathname === '/api/...'` 这种直白写法，改成正则或路由表就抓不到；
 *   2. 只认解构/直接 require 的符号，动态 require 或经变量中转会漏；
 *   3. 只认 ai.chat / ai.stream 与 EXTERNAL_PAID 里显式登记的调用，
 *      新增一类付费方式（比如换成另一家 SDK）需要同步补登记。
 * 因此它防的是「手滑忘登记」，不是形式化证明。
 */

const fs = require('fs');
const path = require('path');

/** 不经 ai.chat、但照样产生费用的模块。符号名必须显式写，不整体猜。 */
const EXTERNAL_PAID = {
  transcribe: {
    symbols: ['transcribe'],
    why: '调 Whisper 转写 API，按音频时长计费（本地 whisper 分支不花钱，但同一出口无法静态区分）',
  },
};

const PAID_CALL = /\bai\.(?:chat|stream)\s*\(/;

const stripLineComments = (s) => s.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

/** 读 `const NAME = new Set([...])` 里的字符串成员 */
function readSet(src, name) {
  const m = src.match(new RegExp('const ' + name + ' = new Set\\(\\[([\\s\\S]*?)\\]\\)'));
  if (!m) throw new Error('未在 server.js 找到 ' + name);
  return new Set([...stripLineComments(m[1]).matchAll(/'([^']+)'/g)].map((x) => x[1]));
}

/** 顶层具名函数：行首（可带 async）function name( */
function topLevelFunctions(src) {
  const hits = [...src.matchAll(/^(?:async )?function ([A-Za-z0-9_]+)\s*\(/gm)].map((m) => ({ name: m[1], at: m.index }));
  const out = new Map();
  hits.forEach((h, i) => {
    const end = i + 1 < hits.length ? hits[i + 1].at : src.length;
    out.set(h.name, src.slice(h.at, end));
  });
  return out;
}

/** 调用某符号的正则：排除 obj.name( 与长名后缀（name2( 不算调用 name） */
const callsRe = (sym) => new RegExp('(^|[^A-Za-z0-9_.])' + sym + '\\s*\\(');

/** 单个 lib 模块内：每个函数是否（直接或经同文件调用）触达付费 */
function analyzeLibModule(name, src) {
  const fns = topLevelFunctions(src);
  const paid = new Map();
  for (const [fn, body] of fns) {
    let hit = PAID_CALL.test(body);
    if (!hit && name === 'ifias' && /\bllmCode\s*\(/.test(body)) hit = true;
    if (!hit && EXTERNAL_PAID[name] && EXTERNAL_PAID[name].symbols.includes(fn)) hit = true;
    paid.set(fn, hit);
  }
  // 同文件内传播到不动点：ifiasAnalyze → llmCode
  let changed = true;
  while (changed) {
    changed = false;
    for (const [fn, body] of fns) {
      if (paid.get(fn)) continue;
      for (const [callee, isPaid] of paid) {
        if (!isPaid || callee === fn) continue;
        if (callsRe(callee).test(body)) { paid.set(fn, true); changed = true; break; }
      }
    }
  }
  return { fns, paid };
}

/** require 符号 → 模块名。server.js 用 './lib/x'，engine.js 用 './x'，统一成 'x' */
function readRequireMap(srcs) {
  const map = new Map();
  srcs.forEach((src) => {
    [...src.matchAll(/const\s+(\{[^}]+\}|[A-Za-z0-9_]+)\s*=\s*require\('\.\/(?:lib\/)?([^']+)'\)/g)].forEach((m) => {
      const mod = m[2].replace(/\.js$/, '');
      const decl = m[1];
      if (decl.startsWith('{')) {
        decl.replace(/[{}]/g, '').split(',').forEach((p) => {
          const sym = p.split(':').pop().trim();
          if (sym) map.set(sym, mod);
        });
      } else {
        map.set(decl.trim(), mod);
      }
    });
  });
  return map;
}

/**
 * 审计入口。源码可注入，便于变异测试（故意篡改白名单，验证审计器能报缺口）。
 * @returns {{rows: Array, missing: string[], extra: string[], phantom: string[], overlap: string[]}}
 */
function audit({ serverSrc, engineSrc, libDir }) {
  const libFiles = fs.readdirSync(libDir)
    .filter((f) => f.endsWith('.js') && !['engine.js', 'deepseek.js', 'prompts.js'].includes(f));

  // 付费符号集合，key 形如 'ifias.ifiasAnalyze'
  const paidSymbols = new Set();
  libFiles.forEach((f) => {
    const mod = f.replace(/\.js$/, '');
    const { paid } = analyzeLibModule(mod, fs.readFileSync(path.join(libDir, f), 'utf8'));
    for (const [sym, isPaid] of paid) if (isPaid) paidSymbols.add(mod + '.' + sym);
  });

  const symbolToModule = readRequireMap([engineSrc, serverSrc]);
  const LLM_ENDPOINTS = readSet(serverSrc, 'LLM_ENDPOINTS');
  const OPEN_ENDPOINTS = readSet(serverSrc, 'OPEN_ENDPOINTS');

  const engineFns = topLevelFunctions(engineSrc);
  const enginePaid = new Map();
  for (const [fn, body] of engineFns) {
    let hit = PAID_CALL.test(body);
    if (!hit) {
      for (const [sym, mod] of symbolToModule) {
        if (paidSymbols.has(mod + '.' + sym) && callsRe(sym).test(body)) { hit = true; break; }
      }
    }
    enginePaid.set(fn, hit);
  }
  // engine 内部互调传播（如 questionDrillEvaluate 调 validateDrillEvaluation 之外的情形）
  let changed = true;
  while (changed) {
    changed = false;
    for (const [fn, body] of engineFns) {
      if (enginePaid.get(fn)) continue;
      for (const [callee, isPaid] of enginePaid) {
        if (!isPaid || callee === fn) continue;
        if (callsRe(callee).test(body)) { enginePaid.set(fn, true); changed = true; break; }
      }
    }
  }

  // engine 里没有自己的函数体、直接转发导出 lib 的情况（如 panorama）
  const isPaidMethod = (name) => {
    if (enginePaid.get(name)) return true;
    if (engineFns.has(name)) return false;
    const mod = symbolToModule.get(name);
    return !!(mod && paidSymbols.has(mod + '.' + name));
  };

  const serverFns = topLevelFunctions(serverSrc);
  const hits = [...serverSrc.matchAll(/pathname === '(\/api\/[^']+)'/g)].map((m) => ({ url: m[1], at: m.index }));

  const rows = hits.map((h, i) => {
    const end = i + 1 < hits.length ? hits[i + 1].at : serverSrc.length;
    const chunk = serverSrc.slice(h.at, end);
    const engineCalls = [...new Set([...chunk.matchAll(/engine\.([A-Za-z0-9_]+)\s*\(/g)].map((m) => m[1]))];
    const handleCalls = [...new Set([...chunk.matchAll(/\b(handle[A-Z][A-Za-z0-9_]*)\s*\(/g)].map((m) => m[1]))];

    let paid = engineCalls.some(isPaidMethod);
    const via = [...engineCalls];
    for (const hname of handleCalls) {
      const body = serverFns.get(hname) || '';
      const innerEngineCalls = [...body.matchAll(/engine\.([A-Za-z0-9_]+)\s*\(/g)].map((m) => m[1]);
      const innerPaid = innerEngineCalls.some(isPaidMethod) || PAID_CALL.test(body) ||
        [...symbolToModule].some(([sym, mod]) =>
          paidSymbols.has(mod + '.' + sym) && new RegExp('(^|[^A-Za-z0-9_.])' + sym + '[.\\s(]').test(body));
      via.push(hname + (innerPaid ? '(付费)' : ''));
      if (innerPaid) paid = true;
    }

    return {
      url: h.url,
      via: via.join('+') || '-',
      paid,
      inSet: LLM_ENDPOINTS.has(h.url),
      open: OPEN_ENDPOINTS.has(h.url),
    };
  });

  return {
    rows,
    missing: rows.filter((r) => r.paid && !r.inSet).map((r) => r.url),
    extra: rows.filter((r) => !r.paid && r.inSet).map((r) => r.url),
    phantom: [...LLM_ENDPOINTS].filter((u) => !hits.some((h) => h.url === u)),
    overlap: [...LLM_ENDPOINTS].filter((u) => OPEN_ENDPOINTS.has(u)),
  };
}

module.exports = { audit, EXTERNAL_PAID, PAID_CALL };

// 命令行用法：node scripts/quota-audit.js —— 打印逐路由的计费判定，便于人工复核
if (require.main === module) {
  const ROOT = path.resolve(__dirname, '..');
  const r = audit({
    serverSrc: fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8'),
    engineSrc: fs.readFileSync(path.join(ROOT, 'lib/engine.js'), 'utf8'),
    libDir: path.join(ROOT, 'lib'),
  });
  console.log('路由'.padEnd(30) + '接线'.padEnd(30) + '付费   白名单');
  r.rows.forEach((row) => {
    const flag = row.paid && !row.inSet ? '  <<< 缺口' : (!row.paid && row.inSet ? '  <<< 多计' : '');
    console.log(row.url.padEnd(30) + row.via.padEnd(30) + String(row.paid).padEnd(7) + String(row.inSet).padEnd(7) + flag);
  });
  console.log('\n缺口:', r.missing.length ? r.missing.join(', ') : '无');
  console.log('多计:', r.extra.length ? r.extra.join(', ') : '无');
  console.log('幽灵白名单:', r.phantom.length ? r.phantom.join(', ') : '无');
  console.log('与 OPEN 重叠:', r.overlap.length ? r.overlap.join(', ') : '无');
}
