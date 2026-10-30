'use strict';

/**
 * Cohen's κ 纯计算
 * ------------------------------------------------------------------
 * 为什么单独成文件：这个数字一旦算错，整章的结论就是错的，而且错得很隐蔽
 * （κ 看起来总是 0~1 之间的合理数字）。所以把它做成纯函数 + 独立测试，
 * 用能手算的表格验证，而不是「跑出来是 0.72 就信了」。
 *
 * 公式：κ = (Po − Pe) / (1 − Pe)
 *   Po = 观察一致率
 *   Pe = 期望一致率 = Σ（A 判为第 i 类的比例 × B 判为第 i 类的比例）
 *
 * 为什么要 κ 而不是「一致率」：
 *   两人都爱标「讲授」，即使瞎标也能有 60% 一致率。κ 扣掉了这份「靠猜也能对」的部分。
 */

/** @param {Array<[string,string]>} pairs 逐条的 [A 的码, B 的码] */
function cohenKappa(pairs) {
  const n = pairs.length;
  if (!n) return { n: 0, po: null, pe: null, kappa: null, distA: new Map(), distB: new Map() };

  const distA = new Map();
  const distB = new Map();
  let agree = 0;
  for (const [a, b] of pairs) {
    distA.set(a, (distA.get(a) || 0) + 1);
    distB.set(b, (distB.get(b) || 0) + 1);
    if (a === b) agree += 1;
  }
  const po = agree / n;
  let pe = 0;
  const cats = new Set([...distA.keys(), ...distB.keys()]);
  for (const c of cats) pe += ((distA.get(c) || 0) / n) * ((distB.get(c) || 0) / n);

  // Pe=1 意味着两人都只用同一个类别（此时必完全一致），κ 取 1；避免 0/0
  let kappa;
  if (pe >= 1) kappa = po >= 1 ? 1 : 0;
  else kappa = (po - pe) / (1 - pe);

  return { n, po, pe, kappa, distA, distB };
}

/** 单类二值 κ：把「是不是这一类」当二分类问题，看两人在这一类上的一致 */
function binaryKappa(pairs, target) {
  const bin = pairs.map(([a, b]) => [a === target ? 'Y' : 'N', b === target ? 'Y' : 'N']);
  return cohenKappa(bin);
}

/** 混淆矩阵：row = A，col = B */
function confusion(pairs, codes) {
  const set = codes && codes.length ? codes.slice() : [...new Set(pairs.flat())].sort();
  const idx = new Map(set.map((c, i) => [c, i]));
  const matrix = set.map(() => set.map(() => 0));
  pairs.forEach(([a, b]) => {
    const i = idx.get(a);
    const j = idx.get(b);
    if (i === undefined || j === undefined) return;
    matrix[i][j] += 1;
  });
  return { codes: set, matrix };
}

/**
 * 分歧清单，按严重度排序
 * 严重度不看「差了多少」，看「跨没跨组」：
 *   把「讲授」标成「指令」= 同为教师语言，报告结论不变；
 *   把「讲授」标成「学生应答」= 报告里教师语言占比会从 87% 变成 82%，结论会变。
 * 所以跨组分歧必须排在前面，先被讨论、先被修。
 */
function disagreements(pairs, ids, groupOf) {
  const out = [];
  pairs.forEach(([a, b], i) => {
    if (a === b) return;
    const ga = groupOf(a);
    const gb = groupOf(b);
    out.push({ id: ids[i], a, b, ga, gb, severity: ga !== gb ? '跨组' : '组内' });
  });
  return out.sort((x, y) => (x.severity === y.severity ? String(x.id).localeCompare(String(y.id), 'zh', { numeric: true }) : (x.severity === '跨组' ? -1 : 1)));
}

/** κ 的解读（Landis & Koch 1979），只说事实，不加褒贬 */
function interpret(k) {
  if (k === null || k === undefined || Number.isNaN(k)) return '无法计算';
  if (k < 0) return '差于随机（判据有系统性冲突）';
  if (k < 0.21) return '轻微';
  if (k < 0.41) return '一般';
  if (k < 0.61) return '中等';
  if (k < 0.81) return '高度';
  return '几乎完全一致';
}

module.exports = { cohenKappa, binaryKappa, confusion, disagreements, interpret };
