'use strict';

/**
 * 六视角全景透视（多智能体）
 * ------------------------------------------------------------------
 * 一次试讲结束（已有讲稿 + 分析 + 应对记录），并行跑 6 个 AI 视角：
 * 督导 / 学困生 / 家长 / 同行教师 / 教研组长 / 学情分析师
 * 每个视角都是独立 prompt + 独立评分，输出雷达图数据。
 * 无 Key 或失败时降级为本地模板（Demo 保底）。
 */

const ai = require('./deepseek');
const { withFallback, FALLBACK_REASON } = require('./fallback-reason');

const VIEWS = [
  {
    key: 'supervisor',
    label: 'AI 督导',
    icon: '🎓',
    desc: '资深教学督导视角，给出专业评级',
    prompt: (v) => `你是有 30 年经验的教学督导，刚刚旁听了一节《${v.subject}》试讲。
基于【诊断数据】给出督导视角评价。只输出 JSON：
{"score": <0-100>, "comment": "<≤60字的总评>", "advice": "<给这位实习老师最重要的一条建议，≤40字>"}
【诊断数据】${JSON.stringify(v.analysis).slice(0, 1500)}`,
    fallback: (v) => ({
      score: Math.max(50, Math.min(90, Number(v.analysis && v.analysis.overall_score) || 70)),
      comment: '教学基本功尚可，课堂结构完整，但互动深度和应变能力仍有提升空间。',
      advice: '把每 8 分钟一次的互动变成固定设计，而非随机发挥。',
    }),
  },
  {
    key: 'struggler',
    label: 'AI 学困生',
    icon: '🧒',
    desc: '成绩靠后的学生视角，反馈哪里没听懂',
    prompt: (v) => `你是一名跟不上的学困生，刚听完这节《${v.subject}》课。站在真实学困生角度。只输出 JSON：
{"score": <0-100 听懂程度>, "comment": "<哪里完全没听懂，口语化，≤60字>", "advice": "<希望老师怎么讲，≤40字>"}
【讲课内容】${String(v.transcript || '').slice(0, 1500)}`,
    fallback: () => ({
      score: 55,
      comment: '前面导入还行，但中间讲公式那段完全懵了，老师讲太快没反应过来。',
      advice: '能不能慢一点，先举个最简单的例子再讲公式？',
    }),
  },
  {
    key: 'parent',
    label: 'AI 家长',
    icon: '👨‍👩‍👧',
    desc: '家长视角，反馈最关心和最想吐槽的点',
    prompt: (v) => `你是一位关注孩子成绩又有点挑剔的家长，旁听了这节《${v.subject}》公开课。只输出 JSON：
{"score": <0-100 满意度>, "comment": "<最想跟老师/学校说的话，口语化，≤60字>", "advice": "<希望老师在哪个方面改进，≤40字>"}
【课堂概况】${JSON.stringify(v.analysis).slice(0, 1000)}`,
    fallback: () => ({
      score: 68,
      comment: '老师挺认真的，就是有点照本宣科，我家孩子这种坐不住的可能跟不上。',
      advice: '希望多关注中等偏下的孩子，别只顾着推进度。',
    }),
  },
  {
    key: 'peer',
    label: 'AI 同行教师',
    icon: '🤝',
    desc: '同行视角，专门挖掘亮点',
    prompt: (v) => `你是一位友善的同行实习教师，刚听完这节《${v.subject}》课，你的任务是找亮点。只输出 JSON：
{"score": <0-100>, "comment": "<这节课最值得你学习的一两个亮点，≤60字>", "advice": "<一个可以让亮点更亮的小技巧，≤40字>"}
【诊断数据】${JSON.stringify(v.analysis).slice(0, 1500)}`,
    fallback: () => ({
      score: 74,
      comment: '导入环节的情境设计很自然，提问铺垫有层次感，值得抄作业。',
      advice: '把好的提问写进教案固定下来，别只靠现场发挥。',
    }),
  },
  {
    key: 'director',
    label: 'AI 教研组长',
    icon: '📐',
    desc: '教研视角，重构教学设计',
    prompt: (v) => `你是学科教研组长，要从教学设计层面重构这节《${v.subject}》课。只输出 JSON：
{"score": <0-100 设计分>, "comment": "<现有设计的最大结构性问题，≤60字>", "advice": "<重构方向：环节顺序/重点分配，≤40字>"}
【诊断数据】${JSON.stringify(v.analysis).slice(0, 1500)}`,
    fallback: () => ({
      score: 66,
      comment: '讲授占比过高，探究环节形同虚设，学生活动时间被严重压缩。',
      advice: '压缩讲授到 15 分钟，把推导环节改造成小组探究任务。',
    }),
  },
  {
    key: 'analyst',
    label: 'AI 学情分析师',
    icon: '📊',
    desc: '数据视角，预测班级成绩分布',
    prompt: (v) => `你是学情分析师，根据这节课的教学质量预测考试后的班级成绩分布。只输出 JSON：
{"score": <0-100 教学有效性预估>, "comment": "<预测分布及原因，≤60字>", "advice": "<降低后进率最有效的一个动作，≤40字>"}
【诊断数据】${JSON.stringify(v.analysis).slice(0, 1500)}`,
    fallback: () => ({
      score: 63,
      comment: '预计两极分化：前排能到 85+，但按互动率推算后进率约 30%。',
      advice: '下节课前 5 分钟做上节内容小测，及时捞后进生。',
    }),
  },
];

/* ---------------- 主入口：并行跑六视角 ---------------- */
async function panorama(input = {}) {
  const ctx = {
    subject: input.subject || '本节课',
    transcript: String(input.transcript || ''),
    analysis: input.analysis || {},
  };

  const jobs = VIEWS.map(async (view) => {
    // 每个视角独立降级：捕获真实错误，用于标注该视角的降级原因
    let viewError = null;
    if (ai.hasKey()) {
      try {
        const raw = await ai.chat(
          [{ role: 'user', content: view.prompt(ctx) }],
          { temperature: 0.7, maxTokens: 300 }
        );
        const json = ai.extractJson(raw);
        if (json && typeof json.score !== 'undefined') {
          return withFallback(
            {
              key: view.key, label: view.label, icon: view.icon,
              score: Math.max(0, Math.min(100, Number(json.score) || 0)),
              comment: String(json.comment || ''),
              advice: String(json.advice || ''),
              engine: 'llm',
            },
            null,
            true
          );
        }
        throw new Error('bad json');
      } catch (e) {
        // 单视角失败不影响整体，降级该视角（原因记录下来，供返回值标注）
        viewError = e;
      }
    }
    const fb = view.fallback(ctx);
    return withFallback(
      {
        key: view.key, label: view.label, icon: view.icon,
        score: fb.score, comment: fb.comment, advice: fb.advice,
        engine: 'rule',
      },
      viewError,
      ai.hasKey()
    );
  });

  const results = await Promise.all(jobs);
  const avg = Math.round(results.reduce((s, r) => s + r.score, 0) / results.length);
  // 汇总降级原因：六视角全部由模型给出 → 'none'；否则取第一个真正的降级原因。
  // 这里不用 withFallback —— 它只看单个 engine 字段，而本层是 6 个视角的聚合。
  const degraded = results.find(
    (r) => r.fallback_reason && r.fallback_reason !== FALLBACK_REASON.NONE
  );
  return {
    views: results,
    average: avg,
    // 汇总层的来源：只要有一个视角降级，整体就不能自称「模型生成」。
    engine: degraded ? 'rule' : 'llm',
    fallback_reason: degraded ? degraded.fallback_reason : FALLBACK_REASON.NONE,
  };
}

module.exports = { panorama, VIEWS };
