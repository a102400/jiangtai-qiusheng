'use strict';

/**
 * iFIAS 算法层单元测试
 * ------------------------------------------------------------------
 * 补的是「算法算得对不对」，不是「接口有没有降级」。
 * 此前的 module-fallback-reason.test.js 只验证模型失败时是否带 fallback_reason，
 * 对矩阵、DBSCAN、Jacobi 特征分解、PCA 的正确性零覆盖。
 *
 * 覆盖对象（lib/ifias.js）：
 *   buildMatrix / buildMatrixRaw   转移矩阵计数与维度
 *   steadyState                    稳态格阈值语义
 *   contentCross                   内容十字区占比
 *   computeRatios                  口径（分母是谁）与除零返回 null
 *   jacobiEigen                    已知矩阵的特征值
 *   pca2d                          解释方差与中心化
 *   dbscan                         两簇分离与噪声判定
 *   clusterEpisodes                短稿不塌成全噪声（自适应 eps 的回归）
 *   sessionVector / batchTrajectory 维度与样本不足分支
 *   splitUnits / ruleCodeOne       切分与规则优先级
 *   ifiasAnalyze                   输入校验（不触发网络）
 *
 * 约定：断言里写清「为什么这个数是这个数」，方便评委当场核对。
 */

const { test } = require('node:test');
const assert = require('node:assert');

const ifias = require('../lib/ifias.js');

/* 把 code 字符串数组转成 pipeline 用的对象数组 */
const asCodes = (arr) => arr.map((code, i) => ({ i: i + 1, code: code, text: 'u' + (i + 1) }));

/* 带业务语义的片段构造：用于聚类测试 */
function codedFrom(codes) {
  return asCodes(codes).map((u) => Object.assign(u, { label: u.code, reason: 'test' }));
}

/* ---------------- 1. 转移矩阵 ---------------- */

test('buildMatrix：只统计相邻转移，且总数等于「有效编码数 - 1」', () => {
  // 4.2→g4(idx3)、8→g8(idx7)、5→g5(idx4)
  // 序列 4.2, 4.2, 8, 5 产生 3 次转移：(3,3) (3,7) (7,4)
  const { data } = ifias.buildMatrix(asCodes(['4.2', '4.2', '8', '5']));
  const sum = data.reduce((s, row) => s + row.reduce((a, b) => a + b, 0), 0);

  assert.strictEqual(sum, 3, '4 个编码应产生 3 次相邻转移');
  assert.strictEqual(data[3][3], 1, '4.2→4.2 应落在 g4 对角格');
  assert.strictEqual(data[3][7], 1, '4.2→8 应落在 g4→g8');
  assert.strictEqual(data[7][4], 1, '8→5 应落在 g8→g5');
  assert.strictEqual(data.length, 12, '12 类聚合矩阵必须是 12×12');
});

test('buildMatrix：无法归组的编码被丢弃后，矩阵仍然自洽', () => {
  // '99' 不在 GROUPS 里，应被过滤掉，不占任何格子
  const { data } = ifias.buildMatrix(asCodes(['4.2', '99', '8']));
  const sum = data.reduce((s, row) => s + row.reduce((a, b) => a + b, 0), 0);
  // 过滤后序列为 4.2, 8 → 只有 1 次转移，而不是 2 次
  assert.strictEqual(sum, 1, '无效编码不应制造转移');
});

test('buildMatrixRaw：16×16 原始矩阵，连续同类行为落对角线', () => {
  // 5 在 RAW_CODES 里位列第 6（下标 5）
  const { data, size } = ifias.buildMatrixRaw(asCodes(['5', '5', '5', '5']));
  assert.strictEqual(size, 16, '原始矩阵必须是 16 码口径');
  assert.strictEqual(data[5][5], 3, '连续 4 个讲授应有 3 次 5→5');
  assert.strictEqual(data.length, 16);
});

test('steadyState：阈值是「大于等于」，且按次数降序', () => {
  const raw = ifias.buildMatrixRaw(asCodes(['5', '5', '5', '5'])); // 对角=3
  const hit3 = ifias.steadyState(raw, 3);
  const hit4 = ifias.steadyState(raw, 4);

  assert.strictEqual(hit3.length, 1, 'count=3 在 min=3 时应被收录');
  assert.strictEqual(hit3[0].code, '5');
  assert.strictEqual(hit3[0].count, 3);
  assert.strictEqual(hit4.length, 0, 'count=3 在 min=4 时不应被收录');
});

test('steadyState：多个稳态格按出现次数降序排列', () => {
  // 5 连续 5 次 → 对角 4；8 连续 3 次 → 对角 2（min=2 才收录）
  const raw = ifias.buildMatrixRaw(asCodes(['5', '5', '5', '5', '5', '8', '8', '8']));
  const cells = ifias.steadyState(raw, 2);
  assert.strictEqual(cells[0].code, '5', '出现更多的稳态格排前面');
  assert.strictEqual(cells[0].count, 4);
  assert.strictEqual(cells[1].code, '8');
  assert.strictEqual(cells[1].count, 2);
});

test('contentCross：只统计 4.x 与 5 之间的转移占比', () => {
  // 全部在 5 / 4.1 之间交替 → 十字区 100%
  const allInside = ifias.buildMatrixRaw(asCodes(['5', '4.1', '5', '4.1', '5']));
  assert.strictEqual(ifias.contentCross(allInside), 100, '5 与 4.1 互转应占满十字区');

  // 全部是学生应答 → 十字区 0%
  const noneInside = ifias.buildMatrixRaw(asCodes(['8', '8', '8']));
  assert.strictEqual(ifias.contentCross(noneInside), 0, '纯学生应答不进入内容十字区');
});

/* ---------------- 2. 比率口径 ---------------- */

test('computeRatios：间接/直接影响的分母是「教师语言」，不是总话语', () => {
  // 教师 5 句（4.2 ×2 间接，5 ×2 + 6 ×1 直接），学生 1 句
  const r = ifias.computeRatios(asCodes(['4.2', '4.2', '5', '5', '6', '8']));

  assert.strictEqual(r.total, 6);
  assert.strictEqual(r.teacher_pct, 83.3, '5/6 = 83.3%');
  assert.strictEqual(r.student_pct, 16.7, '1/6 = 16.7%');
  assert.strictEqual(r.indirect_pct, 40, '间接 2 ÷ 教师 5 = 40%');
  assert.strictEqual(r.direct_pct, 60, '直接 3 ÷ 教师 5 = 60%');
  assert.strictEqual(r.indirect_pct + r.direct_pct, 100, '两个分量之和必须是 100');
  assert.strictEqual(r.indirect_direct, 0.67, '2/3 保留两位小数');
  assert.strictEqual(r.question_pct, 40, '提问率的分母也是教师语言（2/5）');
});

test('computeRatios：无对应分母时返回 null，而不是 0', () => {
  // 只有讲授，没有提问、没有学生被动应答
  const r = ifias.computeRatios(asCodes(['5', '5', '5']));

  assert.strictEqual(r.open_close, null, '没有封闭问题时不能给出 0，否则会被读成「全开放」');
  assert.strictEqual(r.active_passive, null, '没有被动应答时不能给出 0');
  assert.strictEqual(r.indirect_direct, 0, '间接影响确实是 0 次，这里 0 是真实值而非缺失值');
  assert.strictEqual(r.question_pct, 0, '提问率的分母是教师语言，存在，所以是真实的 0');
});

test('computeRatios：开放提问比与正负强化比各自独立计算', () => {
  // 4.1 ×2 开放，4.2 ×1 封闭；表扬 2 ×2，批评 7 ×1
  const r = ifias.computeRatios(asCodes(['4.1', '4.1', '4.2', '2', '2', '7']));
  assert.strictEqual(r.open_close, 2, '开放 2 ÷ 封闭 1 = 2');
  assert.strictEqual(r.positive_negative, 2, '正强化 2（表扬）÷ 负强化 1（批评）= 2');
  assert.strictEqual(r.counts['4.1'], 2);
  assert.strictEqual(r.counts['4.2'], 1);
});

/* ---------------- 3. 特征分解与降维 ---------------- */

test('jacobiEigen：[[2,1],[1,2]] 的特征值必须是 3 和 1，且降序', () => {
  const { values, vectors } = ifias.jacobiEigen([[2, 1], [1, 2]]);

  assert.ok(Math.abs(values[0] - 3) < 1e-8, '第一特征值应为 3，实得 ' + values[0]);
  assert.ok(Math.abs(values[1] - 1) < 1e-8, '第二特征值应为 1，实得 ' + values[1]);

  // 验证特征向量确实满足 A·v = λ·v（这是「分解对了」的硬证据）
  const A = [[2, 1], [1, 2]];
  const v = vectors[0];
  const av = [
    A[0][0] * v[0] + A[0][1] * v[1],
    A[1][0] * v[0] + A[1][1] * v[1],
  ];
  assert.ok(Math.abs(av[0] - values[0] * v[0]) < 1e-8, 'A·v 的第 1 分量应等于 λ·v');
  assert.ok(Math.abs(av[1] - values[0] * v[1]) < 1e-8, 'A·v 的第 2 分量应等于 λ·v');
});

test('jacobiEigen：对角矩阵原样返回特征值，不做无谓旋转', () => {
  const { values } = ifias.jacobiEigen([[5, 0], [0, 1]]);
  assert.ok(Math.abs(values[0] - 5) < 1e-8);
  assert.ok(Math.abs(values[1] - 1) < 1e-8);
});

test('pca2d：一维数据的第一主成分解释方差应为 100%', () => {
  // 全部落在 x 轴上，y 恒为 0
  const { points, explained } = ifias.pca2d([[0, 0], [1, 0], [2, 0], [3, 0]]);

  assert.strictEqual(explained[0], 100, '一维分布的第一主成分应解释全部方差');
  assert.strictEqual(explained[1], 0, '第二主成分无方差可解释');

  // 中心化：投影后的均值应约为 0
  const mx = points.reduce((s, p) => s + p[0], 0) / points.length;
  const my = points.reduce((s, p) => s + p[1], 0) / points.length;
  assert.ok(Math.abs(mx) < 1e-6, '投影应已中心化（x 均值≈0）');
  assert.ok(Math.abs(my) < 1e-6, '投影应已中心化（y 均值≈0）');
});

test('pca2d：解释方差之和不超过 100，且空输入不崩', () => {
  const { explained } = ifias.pca2d([[1, 2], [2, 1], [3, 5], [4, 3]]);
  assert.ok(explained[0] + explained[1] <= 100.1, '前两主成分合计不能超过 100%');

  const empty = ifias.pca2d([]);
  assert.deepStrictEqual(empty.points, []);
  assert.deepStrictEqual(empty.explained, [0, 0]);
});

/* ---------------- 4. DBSCAN ---------------- */

test('dbscan：两个密集簇分开，孤立点判噪声', () => {
  const pts = [[0, 0], [0, 0.05], [0, 0.1], [5, 5], [5, 5.05], [5, 5.1], [99, 99]];
  const labels = ifias.dbscan(pts, 0.5, 2);

  assert.strictEqual(labels[0], labels[1], '同簇前两点标签应相同');
  assert.strictEqual(labels[0], labels[2], '同簇三点标签应相同');
  assert.strictEqual(labels[3], labels[4], '第二簇内部标签应相同');
  assert.notStrictEqual(labels[0], labels[3], '两个簇不能合并成一个');
  assert.strictEqual(labels[6], -2, '远离所有点的孤立点应为噪声（-2）');
});

test('dbscan：单点与空集不崩，单点在 MinPts=2 下判噪声', () => {
  assert.deepStrictEqual(ifias.dbscan([], 0.5, 2), [], '空输入应返回空标签');
  assert.deepStrictEqual(ifias.dbscan([[1, 1]], 0.5, 2), [-2], '单点凑不够 MinPts，应为噪声');
});

/* ---------------- 5. 片段聚类（自适应 eps 的回归测试） ---------------- */

test('clusterEpisodes：同质讲稿不应被判成「全是噪声」', () => {
  // 12 句同类型讲授 → 3 个窗口（起始 0/3/6），特征彼此相同
  // 若 autoEps 退回固定小 eps，这 3 个窗口会被判成 3 个噪声点，这正是要防的回归
  const coded = codedFrom(new Array(12).fill('5'));
  const out = ifias.clusterEpisodes(coded);
  const noise = out.episodes.filter((e) => e.cluster === -1);

  assert.strictEqual(out.episodes.length, 3, '12 句按 6 句窗、3 句步长应得 3 个窗口');
  assert.strictEqual(noise.length, 0, '完全相同的片段之间距离为 0，不可能被判为噪声');
  assert.strictEqual(out.clusters.length, 1, '同质片段应聚成 1 类');
});

test('clusterEpisodes：话语单元不足时给出明确说明，而不是假装聚出结果', () => {
  const out = ifias.clusterEpisodes(codedFrom(['5', '5', '4.2', '8']));

  assert.strictEqual(out.clusters.length, 0, '不足 6 句时不应产出簇');
  assert.strictEqual(out.episodes.length, 1, '4 句只够 1 个窗口');
  assert.strictEqual(out.episodes[0].cluster, 0, '单窗口归入 0 类，不标噪声');
  assert.ok(out.note.indexOf('无法聚类') !== -1, '必须留下「为什么没聚类」的说明');
});

test('clusterEpisodes：混合讲稿能识别出讲授段与互动段', () => {
  // 前 9 句纯讲授，后 9 句师生交替 → 结构与特征明显不同
  const coded = codedFrom([
    '5', '5', '5', '5', '5', '5', '5', '5', '5',
    '4.1', '8', '4.1', '8', '4.1', '8', '4.1', '8', '4.1',
  ]);
  const out = ifias.clusterEpisodes(coded);

  assert.ok(out.clusters.length >= 2, '结构差异明显的两段应至少聚出 2 类');
  const names = out.clusters.map((c) => c.name).join('|');
  assert.ok(/讲授|互动/.test(names), '簇名应能反映课堂结构，实得：' + names);
});

/* ---------------- 6. 向量与批量轨迹 ---------------- */

test('sessionVector：恒为 7 维且取值范围在 [0,1]', () => {
  const v = ifias.sessionVector(codedFrom(['5', '4.1', '8', '2', '4.2', '9.2']));
  assert.strictEqual(v.length, 7, '片段特征固定 7 维');
  v.forEach((x, i) => {
    assert.ok(x >= 0 && x <= 1, '第 ' + (i + 1) + ' 维应在 [0,1]，实得 ' + x);
  });

  const zeros = ifias.sessionVector([]);
  assert.deepStrictEqual(zeros, [0, 0, 0, 0, 0, 0, 0], '空输入应返回 7 个 0，而不是崩');
});

test('batchTrajectory：少于 2 节课直接说明「画不出轨迹」', () => {
  const one = ifias.batchTrajectory([{ label: 'A', vector: [0.5, 0.1, 0, 0, 0.2, 0.5, 0.4] }]);
  assert.deepStrictEqual(one.points, []);
  assert.ok(one.note.indexOf('至少需要 2 次') !== -1);
});

test('batchTrajectory：恰好 2 节课时不判噪声，且给出坐标', () => {
  const out = ifias.batchTrajectory([
    { label: '第一次', vector: [0.9, 0.05, 0, 0, 0.1, 0.4, 0.3] },
    { label: '第二次', vector: [0.5, 0.3, 0, 0, 0.6, 0.7, 0.8] },
  ]);
  assert.strictEqual(out.points.length, 2, '两节课应产出两个点');
  out.points.forEach((p) => {
    assert.strictEqual(p.cluster, 0, '样本不足时不应把任一节课标成噪声');
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), '坐标必须是有限数');
  });
  assert.ok(out.note.indexOf('仅供观察方向') !== -1, '两节课时应提示「不足以聚类」');
});

/* ---------------- 7. 切分与规则编码 ---------------- */

test('splitUnits：按句末标点与换行切分，过滤过短片段，最多 80 句', () => {
  assert.deepStrictEqual(
    ifias.splitUnits('今天学函数。先看定义！对吗？'),
    ['今天学函数。', '先看定义！', '对吗？'],
    '三种句末标点都应切开'
  );
  assert.deepStrictEqual(ifias.splitUnits('好。\n第二行。'), ['好。', '第二行。'], '仅过滤 1 字片段；2 字片段（如「好。」）会保留，这是既定口径');

  const many = new Array(100).fill('这是一句测试话。').join('');
  assert.strictEqual(ifias.splitUnits(many).length, 80, '上限 80 句，防止一次喂爆模型');
});

test('ruleCodeOne：规则优先级正确（表扬先于指令，学生发言先于提问）', () => {
  assert.strictEqual(ifias.ruleCodeOne('这位同学说得很好，请坐').code, '2', '「很好+请坐」应判表扬而非指令');
  assert.strictEqual(ifias.ruleCodeOne('对不对？').code, '4.2', '是非问句应判封闭提问');
  assert.strictEqual(ifias.ruleCodeOne('你觉得为什么会这样？').code, '4.1', '「为什么+你觉得」应判开放提问');
  assert.strictEqual(ifias.ruleCodeOne('请看黑板').code, '6', '「请看」应判指令');
  assert.strictEqual(ifias.ruleCodeOne('生：我觉得是 3').code, '8', '带「生：」的陈述应判被动应答');
  assert.strictEqual(ifias.ruleCodeOne('学生说：为什么是这样').code, '9.2', '学生提出的疑问应判主动提问');
  assert.strictEqual(ifias.ruleCodeOne('大家翻开课本第 32 页').code, '6', '「翻开」应判指令');
});

/* ---------------- 8. 入口校验（不触发网络） ---------------- */

test('ifiasAnalyze：讲稿过短时在调用模型之前就报错', async () => {
  await assert.rejects(
    () => ifias.ifiasAnalyze({ transcript: '今天学函数。' }),
    /讲稿太短/,
    '不足 30 字应直接拒绝，不应消耗模型额度'
  );
});

test('ifiasAnalyze：可编码单元不足 4 句时给出可读错误', async () => {
  // 无标点的长句 → 只有 1 个话语单元，且长度 > 30 字以绕过第一个校验
  const long = '今天我们要一起学习函数的单调性以及它在实际问题中的判断方法和应用场景';
  await assert.rejects(
    () => ifias.ifiasAnalyze({ transcript: long }),
    /话语单元太少/,
    '不足 4 个单元应提示补充逐字稿'
  );
});

test('CODE_TABLE：14 类 / 16 个可编码值，分组与直接影响标记自洽', () => {
  assert.strictEqual(ifias.CODE_TABLE.length, 16, '可编码值必须是 16 个');
  assert.strictEqual(new Set(ifias.CODE_TABLE.map((c) => c.code)).size, 16, '编码不得重复');

  const groups = new Set(ifias.CODE_TABLE.map((c) => c.group));
  assert.deepStrictEqual(
    Array.from(groups).sort(),
    ['silence', 'student', 'teacher', 'tech'],
    '只应有四类归属'
  );

  // 直接影响 = 教师语言里 indirect 为 false 的部分，必须存在且非空
  const direct = ifias.CODE_TABLE.filter((c) => c.group === 'teacher' && !c.indirect);
  assert.deepStrictEqual(direct.map((c) => c.code), ['5', '6', '7'], '直接影响的教师行为应为讲授/指令/批评');
  assert.strictEqual(ifias.GROUPS.length, 12, '聚合矩阵按 12 类展示');
});
