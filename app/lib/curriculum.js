'use strict';

/**
 * 课标对照（28）：把试讲逐字稿对标义务教育课程标准（2022 年版）
 * 内置精简课标条目库（按学科 + 课题关键词匹配），LLM 逐条判定达成度。
 * 双引擎：有 Key 走大模型判定；无 Key 走关键词命中兜底。
 */

const ai = require('./deepseek');
const { withFallback } = require('./fallback-reason');

/* ---------------- 精简课标库 ----------------
 * 表述依据义务教育课程课程标准（2022 年版）的核心条目做教学化转写，
 * 用于师范微格训练的达成度自检，非官方原文引用。 */
const CURRICULUM = {
  math: {
    label: '数学课程标准（2022 年版）',
    items: [
      { code: 'M1', dim: '探究实践', desc: '经历勾股定理及其逆定理的探究过程，体会数形结合思想', keywords: ['勾股', '探究', '验证', '面积法', '拼图', '数形'] },
      { code: 'M2', dim: '知识技能', desc: '掌握勾股定理及其逆定理，能运用它们解决简单的实际问题', keywords: ['勾股', '逆定理', '斜边', '直角边', '应用', '解决'] },
      { code: 'M3', dim: '知识技能', desc: '理解平方根、算术平方根的概念和意义', keywords: ['平方根', '算术平方根', '开方'] },
      { code: 'M4', dim: '数学抽象', desc: '在具体情境中抽象出数学概念，会用数学的语言表达现实世界', keywords: ['情境', '抽象', '字母', '表示', '模型'] },
      { code: 'M5', dim: '逻辑推理', desc: '掌握推理的基本方法，能有条理地表述论证过程', keywords: ['推理', '证明', '推导', '因为', '所以', '论证'] },
      { code: 'M6', dim: '数与运算', desc: '理解分数、小数的意义和性质，掌握四则运算与算理', keywords: ['分数', '小数', '倒数', '通分', '约分', '运算', '加减乘除', '四则'] },
      { code: 'M7', dim: '数与代数', desc: '理解用字母表示数和方程思想，能解简单的一元方程', keywords: ['方程', '未知数', '等式', '解方程', '代入', '代数'] },
      { code: 'M8', dim: '图形与几何', desc: '认识常见平面图形和立体图形，掌握周长、面积的计算方法', keywords: ['图形', '周长', '面积', '体积', '长方形', '三角形', '圆', '立体'] },
      { code: 'M9', dim: '统计与概率', desc: '经历收集、整理、描述数据的过程，会用统计图表分析数据', keywords: ['统计', '数据', '图表', '条形', '折线', '扇形', '概率', '平均数'] },
      { code: 'M10', dim: '综合与实践', desc: '在真实情境中综合运用数学知识提出问题、解决问题', keywords: ['应用题', '实际问题', '生活', '综合', '购物', '测量'] },
    ],
  },
  chinese: {
    label: '语文课程标准（2022 年版）',
    items: [
      { code: 'C1', dim: '阅读与鉴赏', desc: '能用普通话正确、流利、有感情地朗读课文', keywords: ['朗读', '齐读', '范读', '有感情', '诵读'] },
      { code: 'C2', dim: '语言文字', desc: '体味和推敲重要词句在语言环境中的意义和作用', keywords: ['词句', '推敲', '赏析', '关键词', '语境', '修辞'] },
      { code: 'C3', dim: '阅读理解', desc: '在通读课文的基础上，理清思路，理解、分析主要内容', keywords: ['梳理', '概括', '段落', '思路', '主要内容', '层次'] },
      { code: 'C4', dim: '表达交流', desc: '能根据需要进行口头或书面的表达与交流，内容具体、语言得体', keywords: ['表达', '交流', '讨论', '发言', '写作', '口头'] },
      { code: 'C5', dim: '文化自信', desc: '感受作品中的人物形象与情感态度，受到优秀文化的熏陶', keywords: ['情感', '人物', '文化', '熏陶', '主题', '主旨'] },
      { code: 'C6', dim: '识字与写字', desc: '掌握汉字基本笔画和笔顺规则，养成规范、端正的书写习惯', keywords: ['生字', '笔画', '笔顺', '书写', '写字', '组词', '田字格'] },
      { code: 'C7', dim: '表达与习作', desc: '乐于书面表达，能不拘形式地写下自己的见闻、感受和想象', keywords: ['习作', '写作', '作文', '写话', '仿写', '段落', '日记'] },
      { code: 'C8', dim: '梳理与探究', desc: '主动积累语言材料，尝试运用分类、比较等方法整理学习收获', keywords: ['积累', '词语', '成语', '分类', '摘录', '对比', '总结'] },
    ],
  },
  english: {
    label: '英语课程标准（2022 年版）',
    items: [
      { code: 'E1', dim: '语言能力', desc: '能听懂有关熟悉话题的语段和简短故事，获取关键信息', keywords: ['listen', 'listening', '听懂', '听力', '关键信息', 'get'] },
      { code: 'E2', dim: '语言能力', desc: '能与他人就熟悉的话题进行简单的交流与表达', keywords: ['speak', 'pair', 'discuss', '交流', '对话', '表达', 'role'] },
      { code: 'E3', dim: '学习能力', desc: '借助图片、动作、上下文等理解所学语言材料', keywords: ['picture', 'context', '图片', '动作', '上下文', 'guess'] },
      { code: 'E4', dim: '思维品质', desc: '在语言学习中发展观察、比较、归纳等思维品质', keywords: ['compare', 'find', '归纳', '比较', '发现', 'rule'] },
      { code: 'E5', dim: '文化意识', desc: '了解中外文化差异，增强家国情怀和国际视野', keywords: ['culture', '中外', '文化', 'festival', 'difference'] },
      { code: 'E6', dim: '语言技能', desc: '正确认读、书写所学词汇，掌握基本句型并尝试运用', keywords: ['word', 'spell', '拼写', '句型', 'sentence', 'drill', '单词', '认读'] },
      { code: 'E7', dim: '语言能力', desc: '能借助图片读懂简单语篇，分角色表演故事', keywords: ['role play', 'act', '表演', '故事', 'story', 'read', 'retell'] },
    ],
  },
  science: {
    label: '科学 / 理化生课程标准（2022 年版）',
    items: [
      { code: 'S1', dim: '探究实践', desc: '掌握基本的实验操作技能，学会使用简单的实验仪器', keywords: ['实验', '操作', '仪器', '步骤', '装置', '测量'] },
      { code: 'S2', dim: '科学思维', desc: '经历科学探究过程，学习科学方法，发展科学思维', keywords: ['探究', '假设', '验证', '结论', '变量', '对照'] },
      { code: 'S3', dim: '科学态度', desc: '树立安全意识，遵守实验操作规范，爱护仪器', keywords: ['安全', '规范', '注意', '酒精灯', '防护'] },
      { code: 'S4', dim: 'STSE', desc: '认识科学·技术·社会·环境之间的联系，运用科学解释现象', keywords: ['生活', '应用', '技术', '社会', '环境', '现象'] },
      { code: 'S5', dim: '生命观念', desc: '形成结构与功能相适应等生命观念', keywords: ['结构', '功能', '适应', '细胞', '光合作用', '呼吸'] },
      { code: 'S6', dim: '物质科学', desc: '认识常见物质的性质与变化，初步建立物质观', keywords: ['性质', '变化', '状态', '溶解', '燃烧', '混合', '分离'] },
      { code: 'S7', dim: '地球与宇宙', desc: '认识地球与宇宙环境，理解天体运动与地理现象', keywords: ['地球', '太阳', '月球', '四季', '昼夜', '宇宙', '星座'] },
    ],
  },
  generic: {
    label: '教学论通用维度',
    items: [
      { code: 'G1', dim: '教学目标', desc: '教学目标明确、具体、可操作，体现学科核心素养要求', keywords: ['目标', '素养', '重点', '难点'] },
      { code: 'G2', dim: '学生主体', desc: '体现学生主体地位，设计有效的课堂互动与提问', keywords: ['提问', '互动', '讨论', '学生', '参与', '思考'] },
      { code: 'G3', dim: '评价反馈', desc: '评价贯穿教学全程，反馈及时、有针对性', keywords: ['评价', '反馈', '纠正', '表扬', '鼓励', '点评'] },
      { code: 'G4', dim: '板书设计', desc: '板书结构清晰，突出核心知识与思维过程', keywords: ['板书', '板演', '书写', '黑板', '主板书'] },
    ],
  },
};

/* 按学科 + 课题关键词选出最相关的课标条目
 * 1. 学科库中关键词命中的条目优先（最多 5 条）；
 * 2. 不足 4 条时用通用教学维度（G1-G4）补齐——这些维度对任何课都成立；
 * 3. 不再用零命中的专题条目（如勾股定理）补齐，避免总评出现「未涉及勾股定理」式误导。 */
function matchStandards(subjectKey, topic, transcript) {
  const lib = CURRICULUM[subjectKey] || CURRICULUM.generic;
  const text = String(topic || '') + ' ' + String(transcript || '');
  const hitItems = lib.items
    .map((s) => ({ item: s, hits: s.keywords.filter((k) => text.indexOf(k) !== -1).length }))
    .filter((s) => s.hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, 5)
    .map((s) => s.item);

  const picked = hitItems.slice();
  if (picked.length < 4) {
    CURRICULUM.generic.items.forEach((it) => {
      if (picked.length < 5 && !picked.some((p) => p.code === it.code)) picked.push(it);
    });
  }
  return { label: lib.label, standards: picked };
}

/* ---------------- Prompt ---------------- */
function curriculumPrompt({ label, standards, transcript, subject }) {
  const list = standards.map((s) => s.code + '（' + s.dim + '）：' + s.desc).join('\n');
  return `你是义务教育课程标准（2022 年版）的评审专家。课题：《${subject || '本节课'}》，学科课标：${label}。
下面是本课题相关的课程标准要求（前几条为本学科专题要求，其余为通用教学维度、对任何课都成立），以及一位实习老师的试讲逐字稿。请逐条判定这份试讲是否达成该条要求。只输出 JSON，不要任何解释：

{
  "standards": [
    {"code": "<课标编号，如 M6>", "achieved": "达成|部分达成|未达成", "evidence": "<逐字稿中的证据，或缺失说明，≤30字>"}
  ],
  "summary": "<≤50字总评：教学目标整体达成度与最大缺口>"
}

【课标要求】
${list}

【试讲逐字稿】
${transcript}`;
}

/* ---------------- 本地规则兜底 ---------------- */
function ruleCheck(standards, transcript) {
  const t = String(transcript || '');
  const list = standards.map((s) => {
    const hits = s.keywords.filter((k) => t.indexOf(k) !== -1);
    const achieved = hits.length >= 2 ? '达成' : hits.length === 1 ? '部分达成' : '未达成';
    return {
      code: s.code,
      desc: s.desc,
      dim: s.dim,
      achieved,
      evidence: hits.length ? '讲稿涉及：' + hits.slice(0, 3).join('、') : '讲稿中未见相关表述',
    };
  });
  const ok = list.filter((s) => s.achieved === '达成').length;
  return {
    label: '本地规则对照',
    standards: list,
    summary: '离线模式：按关键词命中粗判，' + list.length + ' 条课标中 ' + ok + ' 条达成（联网后由 AI 逐条精细判定）。',
    engine: 'rule',
  };
}

/* ---------------- 主入口 ---------------- */
async function curriculumCheck(input = {}) {
  const transcript = String(input.transcript || '').trim();
  if (transcript.length < 10) throw new Error('讲稿内容太短，无法做课标对照');
  const subjectKey = input.subjectKey || 'generic';
  const matched = matchStandards(subjectKey, input.subject, transcript);

  // 捕获真实错误：模型失败时据此判定降级原因（不许笼统报成一种）
  let modelError = null;
  if (ai.hasKey()) {
    try {
      console.log('[curriculum] 调用大模型做课标对照…');
      const raw = await ai.chat(
        [
          {
            role: 'user',
            content: curriculumPrompt({
              label: matched.label,
              standards: matched.standards,
              transcript: transcript.slice(0, 5000),
              subject: input.subject,
            }),
          },
        ],
        { temperature: 0.3, maxTokens: 1200 }
      );
      const json = ai.extractJson(raw);
      if (json && Array.isArray(json.standards)) {
        const byCode = {};
        json.standards.forEach((s) => { byCode[String(s.code || '')] = s; });
        return withFallback(
          {
            label: matched.label,
            standards: matched.standards.map((s) => {
              const r = byCode[s.code] || {};
              return {
                code: s.code,
                desc: s.desc,
                dim: s.dim,
                achieved: ['达成', '部分达成', '未达成'].indexOf(r.achieved) !== -1 ? r.achieved : '未达成',
                evidence: String(r.evidence || '（AI 未给出判定依据）').slice(0, 60),
              };
            }),
            summary: String(json.summary || '').slice(0, 80),
            engine: 'llm',
          },
          null,
          true
        );
      }
      throw new Error('模型未返回合法 JSON');
    } catch (e) {
      modelError = e;
      console.warn('[curriculum] 降级本地规则 ->', e && e.message ? e.message : e);
    }
  }
  return withFallback(ruleCheck(matched.standards, transcript), modelError, ai.hasKey());
}

module.exports = { curriculumCheck, CURRICULUM, matchStandards };
