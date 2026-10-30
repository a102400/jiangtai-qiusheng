'use strict';

/**
 * 集成测试：语料文本 → 切句 → 规则编码 全链路
 * ---------------------------------------------------------------------------
 * ifias-rule-d-cases.test.js 测的是「单句判得对不对」，
 * 这个文件测的是「一篇文章走完全链路后，每一句是否都落在手册规定的位置」。
 *
 * 为什么要分开：单句测试喂的是手写字符串，而真实流程里，句子是 splitUnits 切出来的。
 * 切句会改变标点、拆分长句、过滤短片段——同一句话经过切分后判据可能不同
 * （例如「为什么呢？因为……」被拆成两句，就不再是「设问自答」）。
 * 所以单句对 ≠ 全链路对。
 *
 * fixtures/sample-lecture.txt 是**作者按手册构造的教学片段，不是真实课堂录音转写**。
 * 它的作用是覆盖 14 类中的多类并锁住边界判据，不能当研究语料引用。
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const ifias = require('../lib/ifias.js');

const FIXTURE = fs.readFileSync(path.join(__dirname, 'fixtures', 'sample-lecture.txt'), 'utf8');

/** 每句的期望码，顺序与 fixture 一致（按 splitUnits 切分后） */
const EXPECTED = [
  ['同学们好，上课。', '5', '开场白无指令无提问，归讲授'],
  ['请大家翻开课本第 12 页。', '6', '「请/翻开」是典型课堂指令'],
  ['看大屏幕，这个三角形有什么特点？', '4.1', '引导注意 + 开放提问；不能被「看大屏幕」抢成 13，也不能被「大家看」吞成 5'],
  ['谁来回答一下？', '4.2', '指向性提问，答案是既定的'],
  ['好，是 5，请坐。', '3', 'D1：确认并采纳具体答案'],
  ['大家安静，先听我说完。', '7', 'D7：纪律压制，不是沉寂'],
  ['小组讨论一下，前后桌四个人一组。', '6', 'D6：教师说的组织语言，不是 10'],
  ['安静地思考一下。', '12', 'D7 反例：无施压对象，属有益沉寂'],
  ['为什么要这样算呢，因为三角形具有稳定性。', '5', 'D4：设问自答按讲授计'],
  ['能不能用面积来解释？', '4.1', 'D8：解释类答案不唯一'],
  ['举个例子。', '4.1', 'D9：无问号也属开放要求'],
  ['（板书课题）', '6', 'D13：板书是行为要求，不是讲授'],
  ['打开投影，我们看下一页。', '13', 'D2 正例：有操作动词才判 13'],
  ['生：我觉得是 3。', '8', '学生标记最高优先'],
  ['（学生小组讨论）', '10', '真实的生生讨论'],
  ['嗯，很好，有进步。', '2', '表扬鼓励'],
  ['我们继续看下一道题。', '5', '无标记的过渡语归讲授'],
];

test('全链路：切句结果与期望句子列表一一对应（数量先对齐）', () => {
  const units = ifias.splitUnits(FIXTURE);
  assert.strictEqual(units.length, EXPECTED.length,
    '切句数量变了，说明 splitUnits 规则被改动，先核对期望表再更新测试');
});

test('全链路：每一句的编码都符合手册判据', () => {
  const units = ifias.splitUnits(FIXTURE);
  const wrong = [];
  units.forEach((u, i) => {
    const exp = EXPECTED[i];
    if (!exp) return;
    const got = ifias.ruleCodeOne(u).code;
    if (got !== exp[1]) wrong.push(`第 ${i + 1} 句「${u}」判 ${got}，手册要求 ${exp[1]}（${exp[2]}）`);
  });
  assert.deepStrictEqual(wrong, [], '存在与手册不一致的编码：\n' + wrong.join('\n'));
});

test('全链路：编码结果能进矩阵，且矩阵不因未知码崩溃', () => {
  const units = ifias.splitUnits(FIXTURE);
  const coded = units.map((u) => ({ text: u, code: ifias.ruleCodeOne(u).code }));
  const m = ifias.buildMatrix(coded);
  assert.ok(Array.isArray(m.data) && m.data.length === 12, '应为 12×12 聚合矩阵');
  const total = m.data.reduce((s, row) => s + row.reduce((a, b) => a + b, 0), 0);
  assert.strictEqual(total, coded.length - 1, 'n 句应产生 n-1 个相邻转移');
});
