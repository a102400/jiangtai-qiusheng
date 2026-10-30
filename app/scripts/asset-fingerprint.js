'use strict';

/**
 * 静态资源版本指纹（零依赖）
 * ------------------------------------------------------------------
 * 解决一个已经踩过 4 次的坑：
 *   「app.js 内容改了，但 index.html 里 ?v= 没改 → 用户拿到旧的缓存 JS，
 *     报错现象千奇百怪，而所有测试全绿。」
 *
 * 做法：把「文件内容的 sha256」和「页面里写的 ?v=」一起记进 tests/asset-lock.json。
 * 测试会核对三件事：
 *   1. 内容变了但版本号没变  → 直接失败（这就是上面的线上故障）
 *   2. 版本号变了但锁没刷新  → 失败，提示运行 --update
 *   3. 同一文件在不同页面版本号不一致 → 失败（会让同一次发布出现两种缓存状态）
 *
 * 用法：
 *   node scripts/asset-fingerprint.js           # 打印当前指纹（不改文件）
 *   node scripts/asset-fingerprint.js --update  # 重新生成 tests/asset-lock.json
 *   node scripts/asset-fingerprint.js --check   # 只校验，退出码非 0 表示不合规
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const LOCK_PATH = path.join(ROOT, 'tests', 'asset-lock.json');

/** 页面里 `src="x?v=1"` / `href="x?v=1"` 的引用；只认本地相对路径 */
const REF_RE = /(?:src|href)="([^"?]+)\?v=([^"&]+)"/g;

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/** 扫描 public 下所有 HTML，返回 { 文件名: { version, pages: [], missing: [] } } */
function scanReferences() {
  const htmlFiles = fs.readdirSync(PUBLIC).filter((f) => /\.html$/i.test(f)).sort();
  const map = new Map();

  for (const page of htmlFiles) {
    const html = fs.readFileSync(path.join(PUBLIC, page), 'utf8');
    REF_RE.lastIndex = 0;
    let m;
    while ((m = REF_RE.exec(html)) !== null) {
      const raw = m[1].trim();
      const version = m[2].trim();
      // 外链与接口不算静态资源
      if (/^(https?:)?\/\//.test(raw) || raw.startsWith('/api/') || raw.startsWith('data:')) continue;
      const rel = decodeURIComponent(raw.replace(/^\.\//, '').split('?')[0]);
      if (!map.has(rel)) map.set(rel, { version: '', pages: [], versions: new Set(), missing: false });
      const entry = map.get(rel);
      entry.pages.push(page);
      entry.versions.add(version);
      if (!entry.version) entry.version = version;
      const abs = path.join(PUBLIC, rel);
      if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) entry.missing = true;
    }
  }

  const out = {};
  for (const rel of [...map.keys()].sort()) {
    const e = map.get(rel);
    out[rel] = {
      version: e.version,
      versions: [...e.versions].sort(),
      pages: [...new Set(e.pages)].sort(),
      missing: e.missing,
      sha256: e.missing ? '' : sha256(path.join(PUBLIC, rel)),
      bytes: e.missing ? 0 : fs.statSync(path.join(PUBLIC, rel)).size,
    };
  }
  return out;
}

function readLock() {
  if (!fs.existsSync(LOCK_PATH)) return { generatedAt: '', assets: {} };
  try {
    return JSON.parse(fs.readFileSync(LOCK_PATH, 'utf8'));
  } catch (e) {
    return { generatedAt: '', assets: {} };
  }
}

/**
 * 纯比对逻辑（抽出来是为了能用假数据测「内容变了但版本号没变」这条路径，
 * 而不是靠真的去改一个生产文件来触发）。
 * @param {object} now    scanReferences() 的结果
 * @param {object} locked 锁文件里的 assets
 */
function diffAssets(now, locked) {
  const fatal = [];
  const stale = [];
  const missing = [];

  for (const rel of Object.keys(now || {})) {
    const cur = now[rel];
    if (cur.missing) {
      fatal.push(`${rel}：页面引用了但文件不存在（会 404）`);
      continue;
    }
    if (cur.versions && cur.versions.length > 1) {
      fatal.push(`${rel}：不同页面版本号不一致 ${cur.versions.join(' / ')}（pages: ${cur.pages.join(', ')}）`);
    }
    const old = locked[rel];
    if (!old) {
      missing.push(rel);
      continue;
    }
    const contentChanged = old.sha256 !== cur.sha256;
    const versionChanged = old.version !== cur.version;
    if (contentChanged && !versionChanged) {
      fatal.push(
        `${rel}：内容已变更（${old.sha256.slice(0, 8)} → ${cur.sha256.slice(0, 8)}），` +
        `但页面仍是 ?v=${cur.version}。请先改版本号（建议 ${suggestVersion(cur.version)}），再跑 --update。`
      );
    } else if (contentChanged && versionChanged) {
      stale.push(`${rel}：版本号已更新到 ${cur.version}，锁记录仍是 ${old.version}（运行 --update 刷新）`);
    } else if (!contentChanged && versionChanged) {
      stale.push(`${rel}：版本号从 ${old.version} 改成了 ${cur.version}，但文件内容没变（无谓的缓存失效，运行 --update 或改回去）`);
    }
  }

  for (const rel of Object.keys(locked || {})) {
    if (!now || !now[rel]) fatal.push(`${rel}：锁里有记录，但页面已不再引用（运行 --update 清理）`);
  }

  return { fatal, stale, missing };
}

/** 校验。返回 { fatal: [], stale: [], missing: [] } */
function check() {
  const now = scanReferences();
  const lock = readLock();
  return Object.assign({ now }, diffAssets(now, lock.assets || {}));
}

/** 在旧版本号末尾把 trailing 数字 +1：20261030-tilt1 → 20261030-tilt2 */
function suggestVersion(version) {
  const m = /^(.*?)(\d+)$/.exec(String(version || ''));
  if (!m) return String(version || '') + '2';
  return m[1] + (Number(m[2]) + 1);
}

function writeLock() {
  const now = scanReferences();
  const assets = {};
  for (const rel of Object.keys(now)) {
    const e = now[rel];
    assets[rel] = { version: e.version, sha256: e.sha256, bytes: e.bytes };
  }
  const payload = {
    _note: '静态资源版本指纹锁，由 scripts/asset-fingerprint.js --update 生成，请勿手改。',
    generatedAt: new Date().toISOString(),
    assets,
  };
  fs.writeFileSync(LOCK_PATH, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  return assets;
}

module.exports = { scanReferences, check, diffAssets, writeLock, suggestVersion, readLock, LOCK_PATH, PUBLIC };

if (require.main === module) {
  const arg = process.argv[2] || '';
  if (arg === '--update') {
    const assets = writeLock();
    const n = Object.keys(assets).length;
    console.log(`已写入 ${path.relative(ROOT, LOCK_PATH)}，共 ${n} 个资源。`);
    for (const rel of Object.keys(assets)) {
      console.log(`  ${rel.padEnd(32)} v=${assets[rel].version}  ${assets[rel].sha256.slice(0, 12)}  ${assets[rel].bytes}B`);
    }
  } else if (arg === '--check') {
    const r = check();
    const bad = r.fatal.length + r.stale.length + r.missing.length;
    r.fatal.forEach((x) => console.log('[FATAL] ' + x));
    r.stale.forEach((x) => console.log('[STALE] ' + x));
    r.missing.forEach((x) => console.log('[NEW]   ' + x + ' 未登记'));
    console.log(bad ? `校验失败：${bad} 项` : `校验通过：${Object.keys(r.now).length} 个资源`);
    process.exit(bad ? 1 : 0);
  } else {
    const now = scanReferences();
    for (const rel of Object.keys(now)) {
      console.log(`${rel.padEnd(32)} v=${now[rel].version}  ${now[rel].sha256.slice(0, 12)}  ${now[rel].pages.join(',')}`);
    }
  }
}
