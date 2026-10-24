'use strict';

/**
 * 学科专属评分维度
 * 不同学科的试讲评价标准差别很大：语文重朗读与文本细读、英语重全英授课比例、
 * 理化重演示安全与探究、数学重思维外显。这里给每个学科追加专属评分规则。
 */

const SUBJECTS = {
  auto: { label: '智能识别', key: 'auto', dims: '' },
  math: {
    label: '数学',
    key: 'math',
    dims: `
【数学学科专属评分】额外考察：
- 思维外显性：推导步骤是否"看得见"（每一步为什么这么做，是否说出来了），而不是跳步直接给结论。
- 数学语言：是否规范使用"设/因为/所以/由题意得"，是否有口语化的不规范表述。
- 变式与追问：是否有至少一次变式训练或"如果条件换了会怎样"的追问。
- 数形结合：是否用了图形、板书辅助理解。
- 错误预设：是否预判了学生的典型错误。`,
  },
  chinese: {
    label: '语文',
    key: 'chinese',
    dims: `
【语文学科专属评分】额外考察：
- 朗读示范：是否有教师范读、节奏停顿示范（这是语文新手最常漏的）。
- 文本细读：是否落在关键词句品味上，而不是架空分析感情。
- 问题链设计：主问题 + 追问是否形成有梯度的链条。
- 语言示范性：教师自身语言是否有文采、有无语病。
- 读写结合：是否有迁移表达或练笔设计。`,
  },
  english: {
    label: '英语',
    key: 'english',
    dims: `
【英语学科专属评分】额外考察：
- 全英授课比例：估计教师的英文输出占课堂语言的百分比（新手常低于 50%，应 ≥70%）。
- 指令简洁性：课堂指令（Open your books / Look at...）是否简短清晰可懂。
- 语音语貌：口音、重音、连读是否清楚（从文本无法听，但从讲稿的语言组织可侧评流畅度）。
- 情境真实性：是否创设了真实的语言使用场景。
- 中英切换：是否有"翻译腔"、逐句翻译讲解的问题。`,
  },
  science: {
    label: '理化生',
    key: 'science',
    dims: `
【理化生专属评分】额外考察：
- 实验安全：涉及演示实验时是否交代安全注意事项、操作步骤是否规范。
- 现象→结论：是否遵循"观察现象 → 收集证据 → 得出结论"的科学探究路径。
- 变量控制：讲到影响因素时是否提到控制变量。
- 生活联结：是否联系了真实生活情境。
- 前概念处理：是否处理了学生已有的错误前概念。`,
  },
  generic: {
    label: '通用',
    key: 'generic',
    dims: '',
  },
};

/* 根据课题文字智能识别学科（本地规则，无需调用模型） */
function detectSubject(subjectText) {
  const raw = String(subjectText || '');
  const t = raw.toLowerCase(); // 英文关键词需忽略大小写
  const rules = [
    // 先判英语：避免 "阅读课" 被语文规则抢走
    { key: 'english', words: ['英语', 'english', 'grammar', '时态', '单词', 'vocabulary', 'reading', 'phonics', ' Listening'.trim(), 'unit '] },
    { key: 'math', words: ['数', '方程', '函数', '几何', '勾股', '三角', '概率', '统计', '不等式', '因式分解', '面积', '体积', 'math'] },
    { key: 'english', words: ['英语', 'english', 'grammar', '时态', '单词', 'vocabulary', 'reading', 'phonics', 'unit ', '一般现在时', '现在进行时', '一般过去时', '被动语态', '完成时'] },
    { key: 'chinese', words: ['语文', '古诗', '文言', '散文', '作文', '诗词', '小说', '阅读课', '鲁迅', '课文'] },
    { key: 'science', words: ['物理', '化学', '生物', '实验', '电路', '力', '光学', '反应', '细胞', '光合', '压强', '浮力'] },
  ];
  for (const r of rules) {
    for (const w of r.words) {
      if (t.includes(w)) return r.key;
    }
  }
  return 'generic';
}

function getSubject(key, subjectText) {
  if (key && key !== 'auto' && SUBJECTS[key]) return SUBJECTS[key];
  return SUBJECTS[detectSubject(subjectText)] || SUBJECTS.generic;
}

module.exports = { SUBJECTS, detectSubject, getSubject };
