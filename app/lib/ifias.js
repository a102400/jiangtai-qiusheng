'use strict';

/**
 * iFIAS 课堂互动量化分析（改进型弗兰德斯互动分析系统）
 * ------------------------------------------------------------------
 * 编码体系（14 类 / 16 个可编码值，含 4.1 4.2 与 9.1 9.2 子码）：
 *   教师语言：1 接受情感 | 2 表扬鼓励 | 3 采纳观点 | 4 提问(4.1 开放/4.2 封闭)
 *             5 讲授 | 6 指令 | 7 批评或维护权威
 *   学生语言：8 被动应答 | 9 主动说话(9.1 主动应答/9.2 主动提问) | 10 同伴讨论
 *   沉寂：    11 无助于教学的混乱 | 12 有益于教学的沉寂
 *   技术：    13 教师操纵技术 | 14 学生操纵技术
 *
 * 分析链路：
 *   逐字稿 → 切分话语单元 → LLM/规则编码 → 12×12 互动矩阵 + 比率指标
 *          → 滑窗片段特征(7 维) → DBSCAN 聚类（识别讲授段/互动段/异常片段）
 *          → PCA 降到 2 维（可视化互动结构）
 *
 * 双引擎：有 Key 走大模型逐句编码；无 Key 走关键词 + 标点规则兜底。
 */

const ai = require('./deepseek');

/* ---------------- 编码表 ---------------- */
const CODE_TABLE = [
  { code: '1', label: '教师接受情感', group: 'teacher', indirect: true },
  { code: '2', label: '教师表扬或鼓励', group: 'teacher', indirect: true },
  { code: '3', label: '教师采纳学生观点', group: 'teacher', indirect: true },
  { code: '4.1', label: '提问开放性问题', group: 'teacher', indirect: true },
  { code: '4.2', label: '提问封闭性问题', group: 'teacher', indirect: true },
  { code: '5', label: '教师讲授', group: 'teacher', indirect: false },
  { code: '6', label: '教师指令', group: 'teacher', indirect: false },
  { code: '7', label: '教师批评或维护权威', group: 'teacher', indirect: false },
  { code: '8', label: '学生被动应答', group: 'student', indirect: false },
  { code: '9.1', label: '学生主动应答', group: 'student', indirect: false },
  { code: '9.2', label: '学生主动提问', group: 'student', indirect: false },
  { code: '10', label: '学生与同伴讨论', group: 'student', indirect: false },
  { code: '11', label: '无助于教学的混乱', group: 'silence', indirect: false },
  { code: '12', label: '有益于教学的沉寂', group: 'silence', indirect: false },
  { code: '13', label: '教师操纵技术', group: 'tech', indirect: false },
  { code: '14', label: '学生操纵技术', group: 'tech', indirect: false },
];
const CODE_MAP = {};
CODE_TABLE.forEach((c) => { CODE_MAP[c.code] = c; });

/* 矩阵聚合口径（12 类，便于阅读矩阵） */
const GROUPS = [
  { key: 'g1', label: '接受情感', codes: ['1'] },
  { key: 'g2', label: '表扬鼓励', codes: ['2'] },
  { key: 'g3', label: '采纳观点', codes: ['3'] },
  { key: 'g4', label: '教师提问', codes: ['4.1', '4.2'] },
  { key: 'g5', label: '教师讲授', codes: ['5'] },
  { key: 'g6', label: '教师指令', codes: ['6'] },
  { key: 'g7', label: '批评权威', codes: ['7'] },
  { key: 'g8', label: '学生应答', codes: ['8', '9.1'] },
  { key: 'g9', label: '学生提问', codes: ['9.2'] },
  { key: 'g10', label: '同伴讨论', codes: ['10'] },
  { key: 'g11', label: '沉寂混乱', codes: ['11', '12'] },
  { key: 'g12', label: '技术操作', codes: ['13', '14'] },
];
const GROUP_OF = {};
GROUPS.forEach((g, i) => g.codes.forEach((c) => { GROUP_OF[c] = i; }));

/* ---------------- 1. 切分话语单元 ---------------- */
function splitUnits(transcript) {
  const raw = String(transcript || '')
    .replace(/\r/g, '')
    .split(/(?<=[。！？；!?;])|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2);
  const units = [];
  raw.forEach((s) => {
    if (s.length <= 70) {
      units.push(s);
    } else {
      // 过长句子按逗号再切，避免单句编码失真
      s.split(/[，,]/).forEach((piece) => {
        const t = piece.trim();
        if (t.length >= 2) units.push(t);
      });
    }
  });
  return units.slice(0, 80);
}

/* ---------------- 2. LLM 编码 ---------------- */
function codePrompt(units) {
  const table = CODE_TABLE.map((c) => c.code + ' ' + c.label).join('\n');
  const list = units.map((u, i) => (i + 1) + '. ' + u).join('\n');
  return `你是改进型弗兰德斯互动分析系统（iFIAS）的编码员。请给下面每一句课堂话语打一个编码。

【编码表】
${table}

【判定规则】
- 4.1 开放性提问：答案不唯一（为什么/怎么样/你觉得/说说看/还能怎么想）
- 4.2 封闭性提问：答案唯一（对不对/是不是/等于几/选A还是B）
- 8 学生被动应答：被点名或全班齐答；9.1 学生主动应答：学生抢答、主动补充；9.2 学生主动提问：学生提出疑问
- 12 有益于教学的沉寂：学生思考/做题/板演时的安静；11 混乱：吵闹、起哄、无关噪音
- 13/14 技术：涉及 PPT、投影、平板、实验设备、视频的操作
- 若一句话里既有讲授又有提问，按**最主导**的行为编码

【待编码话语】
${list}

只输出 JSON，不要解释：
{"codes":[{"i":<序号，从1开始>,"code":"<1|2|3|4.1|4.2|5|6|7|8|9.1|9.2|10|11|12|13|14>","reason":"<≤12字依据>"}]}`;
}

async function llmCode(units) {
  const raw = await ai.chat([{ role: 'user', content: codePrompt(units) }], {
    temperature: 0.2,
    maxTokens: 2200,
  });
  const json = ai.extractJson(raw);
  if (!json || !Array.isArray(json.codes)) throw new Error('模型未返回 codes');
  const byIdx = {};
  json.codes.forEach((c) => {
    const i = Number(c.i);
    const code = String(c.code || '').trim();
    if (i >= 1 && i <= units.length && CODE_MAP[code]) {
      byIdx[i] = { code: code, reason: String(c.reason || '').slice(0, 24) };
    }
  });
  return units.map((u, i) => {
    const hit = byIdx[i + 1];
    return {
      i: i + 1,
      text: u,
      code: hit ? hit.code : ruleCodeOne(u).code,
      label: CODE_MAP[hit ? hit.code : ruleCodeOne(u).code].label,
      reason: hit ? hit.reason : '规则兜底',
    };
  });
}

/* ---------------- 3. 规则兜底编码 ---------------- */
function ruleCodeOne(text) {
  const t = String(text || '');
  const has = (arr) => arr.some((k) => t.indexOf(k) !== -1);

  if (has(['学生说', '生：', '学生答', '学生齐', '全班答', '学生读'])) {
    if (has(['问', '为什么', '是不是'])) return { code: '9.2', reason: '学生提问' };
    return { code: '8', reason: '学生应答' };
  }
  if (has(['小组', '同桌', '讨论一下', '交流一下', '合作'])) return { code: '10', reason: '同伴讨论' };
  if (/[?？]/.test(t) || has(['谁知道', '谁来', '想一想', '说说', '为什么', '怎么样', '你觉得',
    '你来说', '你来讲', '来回答', '说说看', '答一下'])) {
    if (has(['为什么', '怎么样', '说说看', '你觉得', '还能', '想一想', '有什么发现']))
      return { code: '4.1', reason: '开放性提问' };
    return { code: '4.2', reason: '封闭性提问' };
  }
  if (has(['很好', '非常好', '不错', '太棒', '正确', '请坐', '厉害', '有进步']))
    return { code: '2', reason: '表扬鼓励' };
  if (has(['对，就像', '正如刚才', '这位同学说的', '按他说的'])) return { code: '3', reason: '采纳观点' };
  if (has(['别急', '没关系', '我理解', '不要紧张', '慢慢来'])) return { code: '1', reason: '接受情感' };
  if (has(['不许', '怎么又', '安静点', '再说话', '站好', '罚'])) return { code: '7', reason: '批评权威' };
  if (has(['PPT', '投影', '屏幕', '平板', '视频', '看课件', '实验器材']))
    return { code: '13', reason: '技术操作' };
  if (has(['请', '大家', '翻开', '拿出', '一起来', '看黑板', '注意看', '坐好']))
    return { code: '6', reason: '教师指令' };
  if (has(['安静', '停顿', '思考一下', '做练习', '写一写'])) return { code: '12', reason: '教学沉寂' };
  return { code: '5', reason: '教师讲授' };
}

function ruleCode(units) {
  return units.map((u, i) => {
    const r = ruleCodeOne(u);
    return { i: i + 1, text: u, code: r.code, label: CODE_MAP[r.code].label, reason: r.reason };
  });
}

/* ---------------- 4. 互动矩阵 ---------------- */
function buildMatrix(codes) {
  const n = GROUPS.length;
  const m = [];
  for (let i = 0; i < n; i++) m.push(new Array(n).fill(0));
  const idx = codes.map((c) => GROUP_OF[c.code]).filter((v) => v != null);
  for (let i = 0; i + 1 < idx.length; i++) m[idx[i]][idx[i + 1]] += 1;
  return { labels: GROUPS.map((g) => g.label), data: m };
}


/* ---------------- 4b. 原始 16 码矩阵（不聚合，贴近论文口径） ---------------- */
const RAW_CODES = CODE_TABLE.map((c) => c.code);
const RAW_LABEL = { '4.1': '4.1', '4.2': '4.2', '9.1': '9.1', '9.2': '9.2' };

function buildMatrixRaw(codes) {
  const n = RAW_CODES.length;
  const idx = {};
  RAW_CODES.forEach((c, i) => { idx[c] = i; });
  const m = [];
  for (let i = 0; i < n; i++) m.push(new Array(n).fill(0));
  const seq = codes.map((c) => idx[c.code]).filter((v) => v != null);
  for (let i = 0; i + 1 < seq.length; i++) m[seq[i]][seq[i + 1]] += 1;
  return { labels: RAW_CODES.map((c) => RAW_LABEL[c] || c), data: m, size: n };
}

/* 稳态格：对角线单元格（同一行为连续出现 ≥2 次），反映课堂里「停得住」的稳定行为 */
function steadyState(rawMatrix, minCount) {
  const min = minCount || 3;
  const out = [];
  const m = rawMatrix.data;
  const labels = rawMatrix.labels;
  for (let i = 0; i < m.length; i++) {
    if (m[i][i] >= min) {
      out.push({ code: labels[i], label: (CODE_MAP[labels[i]] || {}).label || labels[i], count: m[i][i] });
    }
  }
  out.sort((a, b) => b.count - a.count);
  return out;
}

/* 内容十字区：4.x（提问）与 5（讲授）之间的转移占比，反映「围绕内容的教学」浓度 */
function contentCross(rawMatrix) {
  const labels = rawMatrix.labels;
  const idxs = [];
  labels.forEach((l, i) => { if (l === '5' || l === '4.1' || l === '4.2') idxs.push(i); });
  let inside = 0, total = 0;
  const m = rawMatrix.data;
  for (let i = 0; i < m.length; i++) {
    for (let j = 0; j < m.length; j++) {
      total += m[i][j];
      if (idxs.indexOf(i) !== -1 && idxs.indexOf(j) !== -1) inside += m[i][j];
    }
  }
  return total > 0 ? Math.round((inside / total) * 1000) / 10 : 0;
}

/* 单节课 7 维向量（用于多节课 PCA 轨迹） */
function sessionVector(codes) {
  if (!codes || codes.length < 2) return new Array(7).fill(0);
  return episodeFeatures(codes).map((v) => Math.round(v * 1000) / 1000);
}

/* ---------------- 4c. 多节课 PCA 轨迹 + 跨课聚类 ---------------- */
function batchTrajectory(sessions) {
  const list = (sessions || []).filter((s) => Array.isArray(s.vector) && s.vector.length === 7);
  if (list.length < 2) {
    return { points: [], clusters: [], explained: [0, 0], note: '至少需要 2 次带互动编码的复盘才能画轨迹' };
  }
  const feats = list.map((s) => s.vector);
  const { points, explained } = pca2d(feats);
  const MIN_PTS = 2;
  const eps = autoEps(feats, MIN_PTS);
  let labels;
  if (list.length <= 2) {
    labels = list.map(() => 0); // 样本太少时不谈噪声
  } else {
    labels = dbscan(feats, eps, MIN_PTS);
  }
  const out = list.map((s, i) => ({
    label: String(s.label || '第' + (i + 1) + '次'),
    at: s.at || '',
    x: Math.round(points[i][0] * 1000) / 1000,
    y: Math.round(points[i][1] * 1000) / 1000,
    cluster: labels[i] < 0 ? -1 : labels[i],
    order: i,
  }));
  return {
    points: out,
    clusters: [],
    explained: explained,
    eps: Math.round(eps * 1000) / 1000,
    min_pts: MIN_PTS,
    note: list.length <= 2 ? '样本只有 ' + list.length + ' 次，仅供观察方向，尚不足以聚类' : '',
  };
}

/* ---------------- 5. 比率指标 ---------------- */
function pct(a, b) { return b > 0 ? Math.round((a / b) * 1000) / 10 : 0; }

function computeRatios(codes) {
  const total = codes.length || 1;
  const count = (pred) => codes.filter(pred).length;
  const cnt = {};
  CODE_TABLE.forEach((c) => { cnt[c.code] = count((x) => x.code === c.code); });

  const teacher = count((x) => CODE_MAP[x.code].group === 'teacher');
  const student = count((x) => CODE_MAP[x.code].group === 'student');
  const silence = count((x) => CODE_MAP[x.code].group === 'silence');
  const tech = count((x) => CODE_MAP[x.code].group === 'tech');
  const indirect = count((x) => CODE_MAP[x.code].indirect);
  const direct = teacher - indirect;
  const positive = cnt['1'] + cnt['2'] + cnt['3'];
  const negative = cnt['6'] + cnt['7'];
  const openQ = cnt['4.1'];
  const closeQ = cnt['4.2'];
  const active = cnt['9.1'] + cnt['9.2'] + cnt['10'];
  const passive = cnt['8'];

  return {
    total: codes.length,
    teacher_pct: pct(teacher, total),
    student_pct: pct(student, total),
    silence_pct: pct(silence, total),
    tech_pct: pct(tech, total),
    indirect_pct: pct(indirect, teacher),
    direct_pct: pct(direct, teacher),
    indirect_direct: direct > 0 ? Math.round((indirect / direct) * 100) / 100 : null,
    positive_negative: negative > 0 ? Math.round((positive / negative) * 100) / 100 : null,
    open_close: closeQ > 0 ? Math.round((openQ / closeQ) * 100) / 100 : null,
    question_pct: pct(openQ + closeQ, teacher),
    active_passive: passive > 0 ? Math.round((active / passive) * 100) / 100 : null,
    counts: cnt,
  };
}

/* ---------------- 6. 片段特征 + DBSCAN + PCA ---------------- */
const FEATURE_NAMES = ['教师占比', '学生占比', '沉寂占比', '技术占比', '开放提问比', '间接影响比', '编码多样性'];

function episodeFeatures(units) {
  const codes = units.map((u) => u.code);
  const total = codes.length || 1;
  const g = (grp) => codes.filter((c) => CODE_MAP[c].group === grp).length / total;
  const q = codes.filter((c) => c === '4.1' || c === '4.2').length;
  const openShare = q > 0 ? codes.filter((c) => c === '4.1').length / q : 0;
  const teacherCodes = codes.filter((c) => CODE_MAP[c].group === 'teacher').length;
  const indirectShare = teacherCodes > 0
    ? codes.filter((c) => CODE_MAP[c].indirect).length / teacherCodes : 0;
  // 编码多样性：香农熵 / log(16)
  const freq = {};
  codes.forEach((c) => { freq[c] = (freq[c] || 0) + 1; });
  let entropy = 0;
  Object.keys(freq).forEach((k) => {
    const p = freq[k] / total;
    entropy -= p * Math.log(p);
  });
  const maxEntropy = Math.log(Math.min(16, Math.max(2, Object.keys(freq).length)));

  return [
    g('teacher'),
    g('student'),
    g('silence'),
    g('tech'),
    openShare,
    indirectShare,
    maxEntropy > 0 ? Math.min(1, entropy / maxEntropy) : 0,
  ];
}

/* 欧氏距离 */
function dist(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) * (a[i] - b[i]);
  return Math.sqrt(s);
}

/* 自适应 eps：取 k-距离（k=MinPts-1）的中位数 × 1.25，避免短讲稿全被判成噪声 */
function autoEps(points, minPts) {
  const n = points.length;
  if (n < 2) return 0.5;
  const k = Math.max(1, Math.min(minPts - 1, n - 1));
  const kd = points.map((p, i) => {
    const ds = points
      .filter((_, j) => j !== i)
      .map((q) => dist(p, q))
      .sort((a, b) => a - b);
    const v = k - 1 < ds.length ? ds[k - 1] : ds[ds.length - 1];
    return v || 0;
  }).sort((a, b) => a - b);
  const median = kd[Math.floor(kd.length / 2)] || 0;
  return Math.max(0.22, Math.min(1.1, median * 1.25));
}

/* DBSCAN：基于密度的聚类（eps 邻域 + MinPts 核心点判定） */
function dbscan(points, eps, minPts) {
  const n = points.length;
  const UNVISITED = -1, NOISE = -2;
  const label = new Array(n).fill(UNVISITED);
  const neighbors = (i) => {
    const out = [];
    for (let j = 0; j < n; j++) if (i !== j && dist(points[i], points[j]) <= eps) out.push(j);
    return out;
  };
  let cluster = 0;
  for (let i = 0; i < n; i++) {
    if (label[i] !== UNVISITED) continue;
    const nb = neighbors(i);
    if (nb.length + 1 < minPts) { label[i] = NOISE; continue; }
    label[i] = cluster;
    const queue = nb.slice();
    for (let qi = 0; qi < queue.length; qi++) {
      const j = queue[qi];
      if (label[j] === NOISE) label[j] = cluster;
      if (label[j] !== UNVISITED) continue;
      label[j] = cluster;
      const nb2 = neighbors(j);
      if (nb2.length + 1 >= minPts) nb2.forEach((k) => { if (queue.indexOf(k) === -1) queue.push(k); });
    }
    cluster++;
  }
  return label;
}

/* Jacobi 特征分解（对称矩阵），返回 {values, vectors} 按特征值降序 */
function jacobiEigen(A, maxIter = 100) {
  const n = A.length;
  const a = A.map((r) => r.slice());
  const v = [];
  for (let i = 0; i < n; i++) {
    v.push(new Array(n).fill(0));
    v[i][i] = 1;
  }
  for (let iter = 0; iter < maxIter; iter++) {
    // 找最大非对角元素
    let p = 0, q = 1, max = 0;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (Math.abs(a[i][j]) > max) { max = Math.abs(a[i][j]); p = i; q = j; }
      }
    }
    if (max < 1e-10) break;
    const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
    const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
    const c = 1 / Math.sqrt(t * t + 1);
    const s = t * c;
    const app = a[p][p], aqq = a[q][q], apq = a[p][q];
    a[p][p] = app - t * apq;
    a[q][q] = aqq + t * apq;
    a[p][q] = 0; a[q][p] = 0;
    for (let i = 0; i < n; i++) {
      if (i !== p && i !== q) {
        const aip = a[i][p], aiq = a[i][q];
        a[i][p] = c * aip - s * aiq;
        a[p][i] = a[i][p];
        a[i][q] = s * aip + c * aiq;
        a[q][i] = a[i][q];
      }
    }
    for (let i = 0; i < n; i++) {
      const vip = v[i][p], viq = v[i][q];
      v[i][p] = c * vip - s * viq;
      v[i][q] = s * vip + c * viq;
    }
  }
  const pairs = a.map((row, i) => ({ val: row[i], vec: v.map((r) => r[i]) }));
  pairs.sort((x, y) => y.val - x.val);
  return { values: pairs.map((p) => p.val), vectors: pairs.map((p) => p.vec) };
}

/* 主成分分析：中心化 → 协方差 → 特征分解 → 投影到 2 维 */
function pca2d(points) {
  const n = points.length;
  const d = points[0] ? points[0].length : 0;
  if (n === 0 || d === 0) return { points: [], explained: [0, 0] };
  const mean = new Array(d).fill(0);
  points.forEach((p) => p.forEach((v, i) => { mean[i] += v / n; }));
  const centered = points.map((p) => p.map((v, i) => v - mean[i]));
  const cov = [];
  for (let i = 0; i < d; i++) {
    cov.push(new Array(d).fill(0));
    for (let j = 0; j < d; j++) {
      let s = 0;
      centered.forEach((p) => { s += p[i] * p[j]; });
      cov[i][j] = s / Math.max(1, n - 1);
    }
  }
  const { values, vectors } = jacobiEigen(cov);
  const total = values.reduce((s, v) => s + Math.max(0, v), 0) || 1;
  const pc1 = vectors[0] || new Array(d).fill(0);
  const pc2 = vectors[1] || new Array(d).fill(0);
  const proj = centered.map((p) => {
    let x = 0, y = 0;
    for (let i = 0; i < d; i++) { x += p[i] * pc1[i]; y += p[i] * pc2[i]; }
    return [x, y];
  });
  return {
    points: proj,
    explained: [
      Math.round((Math.max(0, values[0] || 0) / total) * 1000) / 10,
      Math.round((Math.max(0, values[1] || 0) / total) * 1000) / 10,
    ],
  };
}

/* 片段 → 聚类 → PCA */
function clusterEpisodes(coded) {
  const WIN = 6, STEP = 3;
  const episodes = [];
  if (coded.length <= WIN) {
    if (coded.length >= 2) episodes.push({ start: 0, end: coded.length - 1 });
  } else {
    for (let s = 0; s + WIN <= coded.length; s += STEP) episodes.push({ start: s, end: s + WIN - 1 });
    if (episodes.length === 0) episodes.push({ start: 0, end: coded.length - 1 });
  }
  if (episodes.length < 2) {
    return { episodes: episodes.map((e, i) => Object.assign(e, { cluster: 0, x: 0, y: 0 })), clusters: [], explained: [0, 0], note: '话语单元过少，无法聚类（至少需要 6 句）' };
  }
  const feats = episodes.map((e) => episodeFeatures(coded.slice(e.start, e.end + 1)));
  const MIN_PTS = 2;
  const eps = autoEps(feats, MIN_PTS);
  const labels = dbscan(feats, eps, MIN_PTS);
  const { points, explained } = pca2d(feats);

  // 给簇打模式标签
  const clusterStats = {};
  feats.forEach((f, i) => {
    const k = labels[i];
    if (k < 0) return;
    if (!clusterStats[k]) clusterStats[k] = { n: 0, sum: new Array(FEATURE_NAMES.length).fill(0) };
    clusterStats[k].n += 1;
    f.forEach((v, d) => { clusterStats[k].sum[d] += v; });
  });
  const usedNames = {};
  const clusters = Object.keys(clusterStats).map((k) => {
    const st = clusterStats[k];
    const avg = st.sum.map((v) => v / st.n);
    const maxIdx = avg.indexOf(Math.max.apply(null, avg));
    let name = '混合型';
    if (avg[1] >= 0.3) name = '互动型片段';
    else if (avg[0] >= 0.75 && avg[4] >= 0.4) name = '启发式讲授';
    else if (avg[0] >= 0.75) name = '主导讲授';
    else if (avg[2] >= 0.3) name = '任务沉寂';
    else if (avg[3] >= 0.3) name = '技术环节';
    // 同名簇加罗马序号区分，避免出现「启发式讲授、启发式讲授」
    usedNames[name] = (usedNames[name] || 0) + 1;
    const finalName = usedNames[name] > 1 ? name + ' ' + ['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ'][usedNames[name] - 1] : name;
    return {
      id: Number(k),
      size: st.n,
      name: finalName,
      avg: avg.map((v) => Math.round(v * 100) / 100),
      dominant: FEATURE_NAMES[maxIdx],
    };
  }).sort((a, b) => a.id - b.id);

  const out = episodes.map((e, i) => ({
    start: e.start + 1,
    end: e.end + 1,
    cluster: labels[i] < 0 ? -1 : labels[i],
    x: Math.round(points[i][0] * 1000) / 1000,
    y: Math.round(points[i][1] * 1000) / 1000,
  }));
  return { episodes: out, clusters: clusters, explained: explained, eps: Math.round(eps * 1000) / 1000, min_pts: MIN_PTS, note: '' };
}

/* ---------------- 7. 结论生成 ---------------- */
function buildVerdict(ratios, clusters, coded) {
  const parts = [];
  if (ratios.teacher_pct >= 70) parts.push('教师语言占比 ' + ratios.teacher_pct + '%，课堂以讲授为主');
  else if (ratios.student_pct >= 30) parts.push('学生语言占比 ' + ratios.student_pct + '%，参与度较好');
  else parts.push('教师语言 ' + ratios.teacher_pct + '% / 学生语言 ' + ratios.student_pct + '%');

  if (ratios.indirect_direct != null && ratios.indirect_direct < 0.6)
    parts.push('间接影响仅为直接影响的 ' + ratios.indirect_direct + ' 倍，建议多用提问与鼓励替代指令');
  const qTotal = (ratios.counts && ((ratios.counts['4.1'] || 0) + (ratios.counts['4.2'] || 0))) || 0;
  if (qTotal === 0) {
    parts.push('全程没有出现提问，学生没有思考的入口');
  } else if (ratios.open_close === null) {
    parts.push('提问 ' + qTotal + ' 次且全部是开放性问题（没有封闭性提问）');
  } else if (ratios.open_close < 0.5) {
    parts.push('开放/封闭提问比 ' + ratios.open_close + '，封闭问题占多数，学生只需答对错');
  } else if (ratios.open_close < 1) {
    parts.push('开放/封闭提问比 ' + ratios.open_close + '，仍略偏封闭，可再增加「为什么/还能怎么想」');
  } else {
    parts.push('开放/封闭提问比 ' + ratios.open_close + '，提问结构较启发');
  }
  if (ratios.tech_pct >= 20) parts.push('技术操作占 ' + ratios.tech_pct + '%，注意别让课件替代你讲');

  const noise = clusters.episodes.filter((e) => e.cluster === -1).length;
  if (noise > 0) parts.push('检出 ' + noise + ' 个低密度片段（互动结构与整体差异较大的时段，不等于教学事故）');
  if (clusters.clusters.length) {
    const names = clusters.clusters.map((c) => c.name).join('、');
    parts.push('课堂结构可归为 ' + clusters.clusters.length + ' 类：' + names);
  }
  return parts.join('；') + '。';
}

/* 口径提示：单方讲稿无法与真实课堂比「教师/学生语言占比」
 * 参照实测（SmoothConv 教育辅导子集，84 秒样本）：教师发言占 62.8%、学生附和占 22.2% 话轮 */
function buildCaveat(ratios) {
  if (ratios.student_pct === 0) {
    return '本讲稿是单方叙述，学生语言占比天然为 0，不能与真实课堂横向比较（实测 50 段真实教育对话中位数：教师发言约占 50%、学生纯附和占 14% 话轮）。这组比率只用于观察你自己每一次的讲授结构变化。';
  }
  if (ratios.student_pct < 10) {
    return '学生语言仅占 ' + ratios.student_pct + '%，接近单方讲述；若贴入的是含「生：」发言的记录，占比才具备课堂意义。';
  }
  return '';
}

/* ---------------- 主入口 ---------------- */
async function ifiasAnalyze(input = {}) {
  const transcript = String(input.transcript || '').trim();
  if (transcript.length < 30) throw new Error('讲稿太短（至少 30 字）才能做互动编码分析');
  const units = splitUnits(transcript.slice(0, 6000));
  if (units.length < 4) throw new Error('可编码的话语单元太少，请提供更完整的逐字稿');

  let coded = null;
  let engine = 'rule';
  if (ai.hasKey()) {
    try {
      console.log('[ifias] 调用大模型做 iFIAS 编码…');
      coded = await llmCode(units);
      engine = 'llm';
    } catch (e) {
      console.warn('[ifias] 编码降级本地规则 ->', e && e.message ? e.message : e);
    }
  }
  if (!coded) coded = ruleCode(units);

  const matrix = buildMatrix(coded);
  const raw = buildMatrixRaw(coded);
  const ratios = computeRatios(coded);
  const clustering = clusterEpisodes(coded);
  const verdict = buildVerdict(ratios, clustering, coded);

  return {
    engine: engine,
    total_units: coded.length,
    codes: coded,
    matrix: matrix,
    matrix_raw: raw,
    steady_cells: steadyState(raw, 2),
    content_cross: contentCross(raw),
    vector: sessionVector(coded),
    ratios: ratios,
    episodes: clustering.episodes,
    clusters: clustering.clusters,
    explained: clustering.explained,
    cluster_note: clustering.note || '',
    caveat: buildCaveat(ratios),
    eps: clustering.eps || null,
    min_pts: clustering.min_pts || null,
    verdict: verdict,
    code_table: CODE_TABLE.map((c) => ({ code: c.code, label: c.label, group: c.group })),
  };
}

module.exports = {
  ifiasAnalyze, splitUnits, ruleCodeOne, ruleCode, buildMatrix,
  computeRatios, clusterEpisodes, dbscan, pca2d, jacobiEigen, CODE_TABLE, GROUPS,
  buildMatrixRaw, steadyState, contentCross, sessionVector, batchTrajectory,
};
