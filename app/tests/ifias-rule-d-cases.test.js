'use strict';

/**
 * 规则编码器 · 歧义登记表 D1–D13 回归测试
 * -----------------------------------------------------------------------------
 * 对应 docs/iFIAS标注手册.md 第 9 节。
 *
 * 这个文件的设计原则是「一条规则配一条反例」：
 *   只断言「D6 句子判 6」是不够的，因为把「小组」一律删掉也能让这条通过。
 *   所以每条修法都必须同时断言「不该被连带误伤的句子保持原判」——
 *   反例放在每条正例之后，标注为「反例」。
 *
 * 这些反例来自实际推演：修 D1 时最容易连累「好，我们看第 3 题」，
 * 修 D7 时最容易连累「安静地思考一下」。不写下来，下次改判据就会重犯。
 */

const test = require('node:test');
const assert = require('node:assert');
const ifias = require('../lib/ifias.js');

const code = (t) => ifias.ruleCodeOne(t).code;

test('D1：确认并采纳答案判 3，单纯评价仍判 2', () => {
  assert.strictEqual(code('好，是 5，请坐。'), '3',
    '「好，是 5」是对具体答案的确认与采纳，不是一般性表扬');
  assert.strictEqual(code('对，等于 12'), '3', '「对，等于 N」同属采纳');
  // 反例：句中有数字但不是在确认答案
  assert.strictEqual(code('好，我们看第 3 题'), '6',
    '反例：「好，我们看第 3 题」不能因为出现数字就被判成采纳');
  assert.strictEqual(code('这位同学说得很好，请坐'), '2',
    '反例：「说得很好」是评价而非采纳答案');
});

test('D2：提到设备判指令，动手操作设备才判技术', () => {
  assert.strictEqual(code('看大屏幕，这个三角形'), '6',
    '看屏幕是引导注意，没有操作设备');
  assert.strictEqual(code('打开投影，我们看下一页'), '13', '有操作动词才判 13');
  assert.strictEqual(code('（播放视频）'), '13', '括注的技术动作判 13');
  // 反例：打开的不是设备
  assert.strictEqual(code('打开课本第 12 页'), '6',
    '反例：打开课本是课堂指令，不是技术操作');
});

test('D4：设问自答按讲授计，但真提问不能被吞掉', () => {
  assert.strictEqual(code('为什么会这样呢，因为三角形具有稳定性'), '5',
    '有发问痕迹但自己给了理由，属讲授');
  // 反例：有「所以」但是真提问且不构成自答
  assert.strictEqual(code('大家看，这个图形有什么特点？'), '4.1',
    '反例：「大家看」不是自答标记，问句仍是开放提问');
  assert.strictEqual(code('你觉得为什么会这样？'), '4.1',
    '反例：只问不答仍是提问');
});

test('D6：教师说的组织语言是指令，不是生生讨论', () => {
  assert.strictEqual(code('小组讨论一下'), '6',
    'D6：这是教师指令；10 指学生之间真实发生的讨论');
  assert.strictEqual(code('同桌交流一下想法'), '6', '同理');
  assert.strictEqual(code('（学生小组讨论）'), '10', '真实的生生讨论才判 10');
  assert.strictEqual(code('生：我们小组认为是 5'), '8', '学生发言带标记时优先判学生类');
});

test('D7：带施压对象或祈使的「安静」判批评，纯状态判沉寂', () => {
  assert.strictEqual(code('安静，先听我说完'), '7',
    'D7：纪律压制与权威维护');
  assert.strictEqual(code('大家安静'), '7', '面向全班的纪律要求');
  assert.strictEqual(code('再说话就罚站'), '7', '显式惩罚');
  // 反例：这是让学生安静下来做事，不是压制
  assert.strictEqual(code('安静地思考一下'), '12',
    '反例：没有施压对象，属有益沉寂');
  assert.strictEqual(code('（学生安静思考）'), '12', '括注的状态描述判沉寂');
});

test('D8/D9：4.1 与 4.2 的边界', () => {
  assert.strictEqual(code('能不能用面积来解释？'), '4.1',
    'D8：解释类无唯一答案，属开放');
  assert.strictEqual(code('举个例子'), '4.1',
    'D9：无问号但属开放要求；注意「举例」在「举个例子」里不是相邻子串');
  assert.strictEqual(code('有什么关系'), '4.1', 'D9：需推理说明');
  assert.strictEqual(code('大家看，这个图形有什么特点？'), '4.1', '「有什么」是开放标记');
  // 反例：封闭问句必须留在 4.2，否则 4.1 会泛滥
  assert.strictEqual(code('对不对？'), '4.2',
    '反例：是非问句只有一个答案，必须判 4.2');
  assert.strictEqual(code('3 加 5 等于几？'), '4.2', '反例：有唯一答案');
});

test('D13：板书类括注判指令，不是讲授', () => {
  assert.strictEqual(code('（板书课题）'), '6', '板书是教师行为要求，属指令');
  assert.strictEqual(code('（学生笑）'), '11', '混乱类括注判 11');
});

test('说话人标记优先级最高：任何规则都不能把学生发言判成教师语言', () => {
  assert.strictEqual(code('生：我觉得是 3'), '8');
  assert.strictEqual(code('学生说：为什么是这样'), '9.2', '学生提出的疑问是 9.2');
  assert.strictEqual(code('全班答：是 7'), '8');
});

test('编码结果必须始终落在 14 类之内，且 reason 非空', () => {
  const samples = ['', '嗯。', '好。', '我们先复习上节课内容', '同学们好',
    '这个问题请大家思考', undefined, null];
  const valid = new Set(ifias.CODE_TABLE.map((c) => c.code));
  samples.forEach((s) => {
    const r = ifias.ruleCodeOne(s);
    assert.ok(valid.has(r.code), '码值必须合法：' + JSON.stringify(s) + ' → ' + r.code);
    assert.ok(typeof r.reason === 'string' && r.reason.length > 0, '必须给理由');
  });
});

test('判据顺序不可随意调换：纪律必须早于提问', () => {
  // 纪律句常带问号。若把提问判据提到纪律之前，这句会被记成教师提问，
  // 从而虚高「间接影响」占比——这是 D7 修复的真正难点。
  assert.strictEqual(code('你们安静点行不行？'), '7',
    '带问号的纪律句仍是批评，不能被 4.x 抢走');
});

test('「采纳」必须锚定句首：句中出现的「是 + 数字」不是采纳', () => {
  // 这两条是 scripts/rule-change-audit.js 在全量对比中抓到的真实回归。
  // 当时的正则是「好|对|是 …… 数字」，于是任何含「是 5」的句子都变成了采纳。
  assert.strictEqual(code('你为什么觉得是 5 呢？'), '4.1',
    '回归守护：句中「是 5」是提问内容，不是教师在确认答案');
  assert.strictEqual(code('大家先自己算一算，直角边是 3 和 4 的时候，斜边是多少。'), '6',
    '回归守护：即使句中有「是 3」和「是 4」，这句仍是课堂指令');
  // 正例仍然要成立
  assert.strictEqual(code('好，是 5，请坐。'), '3', '句首确认才是采纳');
  assert.strictEqual(code('对，等于 12'), '3', '同上');
});
