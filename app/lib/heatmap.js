'use strict';

/**
 * 课堂可视化三件套（15 / 16 / 17）——共用一次大模型调用，拿到三份数据：
 *  15. 提问等待热力图：每次提问后等了多久（红 <1s 自问自答 / 绿 ≥2s 真思考）
 *  16. 时间分配饼图  ：教师讲 / 学生答 / 互动 / 过渡 各占多少分钟
 *  17. 分环节改进稿  ：【导入】【新授】【互动】【小结】四段改进口述稿
 *
 * 与全项目一致：配了 Key 走真大模型；没配或调用失败，自动降级本地规则估算。
 *
 * 等待指标口径（本批新增 wait_metrics 统一字段）：
 *  · 逐次等待值统一由 wait-metrics.js 产出，本文件不再重复实现；
 *  · 旧字段 wait_moments / wait_source / wait_note 保留兼容；
 *  · 没有可靠音频时间戳时，等待秒数一律是「推断值」，不是实测值。
 *
 * 问句与互动任务（第三批 A）：
 *  · 问句判定（isQuestionSentence）用于等待推断；
 *  · 互动任务判定（isInteractiveSentence）用于环节分类与时间分配；
 *  · 两者都实现在 wait-metrics.js，本文件直接引入，避免两处口径漂移。
 */

const ai = require('./deepseek');
const {
  buildTextWaitMetrics,
  normalizeModelWaitMoments,
  isQuestionSentence,
  isInteractiveSentence,
} = require('./wait-metrics');
const { withFallback } = require('./fallback-reason');

const PHASES = [
  { key: 'lead-in', label: '导入', icon: '🎬' },
  { key: 'new', label: '新授', icon: '📖' },
  { key: 'interact', label: '互动', icon: '🙋' },
  { key: 'wrap', label: '小结', icon: '📌' },
];

/* ---------------- 本地规则兜底 ---------------- */

/**
 * @deprecated 当前无调用者，保留以备后续按旧口径切句的场景（勿删）。
 * 旧版切句：按 。！？；!?;\n 切并**丢掉**句末标点。
 * 现在时间分配与环节切分改用 splitTeachingUnits（保留标点），
 * 因为「问号」是问句判定的关键证据、「好，」这类过渡关键词也带标点。
 * 新代码请用 splitTeachingUnits（时间分配/环节切分）或 wait-metrics.js 的
 * splitSentencesKeepPunct（等待推断），不要再用这个丢标点的版本。
 */
function splitSentences(t) {
  return String(t)
    .split(/[。！？；!?;\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 3);
}

/**
 * 教学单元切分：按 。！？；!?;\n 切，**保留句末标点**。
 * 为什么必须保留标点：
 *   ① 问号是「这句是不是问句」的关键证据，丢掉标点会让「今天我们学什么呢？」判不出问句；
 *   ② 过渡类关键词（「好，」「接下来」）依赖标点才能匹配上。
 * 与 wait-metrics.js 的 splitSentencesKeepPunct 的区别：
 *   那个按「正文字符 ≥2」过滤（等待推断用），这个按「整段长度 ≥3」过滤（时间分配/环节切分用）。
 */
function splitTeachingUnits(text) {
  const src = String(text || '');
  const out = [];
  let buf = '';
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    buf += ch;
    if ('。！？；!?;\n'.indexOf(ch) !== -1) {
      const unit = buf.trim();
      if (unit.length >= 3) out.push(unit);
      buf = '';
    }
  }
  const tail = buf.trim();
  if (tail.length >= 3) out.push(tail);
  return out;
}

/* 保留句末标点的切句、问句判定、逐次等待推断统一收敛到 wait-metrics.js，
   本文件不再重复实现（避免两处口径漂移，也避免与 analyzer.js 互相依赖）。 */

/* 16 兜底：按关键词把一节课 40 分钟切成四块 */
function ruleTimeAllocation(transcript) {
  const total = 40;
  const sents = splitTeachingUnits(transcript);
  let s = 0;
  let it = 0;
  let tr = 0;
  sents.forEach((sentence) => {
    // 学生作答 / 练习类：回答、板演、练习、齐读、朗读、讨论、上台、同桌交流……
    if (/回答|板演|练习|齐读|朗读|讨论|上台|写一写|做一做|同桌交流/.test(sentence)) s++;
    // 互动（提问）类：只认真问句 —— 陈述句不再被算进来
    if (isQuestionSentence(sentence)) it++;
    // 过渡类
    if (/好[，,。]|接下来|下面|我们再来|翻到|来看|注意看/.test(sentence)) tr++;
  });
  const n = Math.max(1, sents.length);
  const nonTeacher = (s + it + tr) / n; // 非讲授句占比
  const teacher = Math.max(12, Math.round(total * Math.max(0.5, 1 - nonTeacher * 1.2)));
  const rest = total - teacher;
  const sum = s + it + tr || 1;
  const stu = Math.max(1, Math.round((rest * s) / sum));
  const inter = Math.max(1, Math.round((rest * it) / sum));
  return {
    teacher,
    student: stu,
    interaction: inter,
    transition: Math.max(0, rest - stu - inter),
    // 来源标注：这是按文本关键词估算出来的，不是实测的课堂计时。
    source: 'text-heuristic',
  };
}

/* 17 兜底：按环节关键词把逐字稿切成四段 */
function ruleSegments(transcript) {
  const sents = splitTeachingUnits(transcript);
  const buckets = { 导入: [], 新授: [], 互动: [], 小结: [] };
  sents.forEach((s) => {
    if (/同学们好|上课|今天我们来|首先|情境|生活中|现象|故事|复习|上节课/.test(s)) buckets['导入'].push(s);
    // 「互动」= 问句 + 互动任务（讨论/练习/板演/齐读…）；陈述句不再被划进互动环节
    else if (isInteractiveSentence(s)) buckets['互动'].push(s);
    else if (/总结|作业|下课|今天学会|回顾|课后|收获/.test(s)) buckets['小结'].push(s);
    else buckets['新授'].push(s);
  });
  return PHASES.map((p) => {
    const text = buckets[p.label].join('。');
    return {
      phase: p.label,
      script: text ? text.slice(0, 220) + (text.length > 220 ? '…' : '') : '（本地模式：逐字稿中缺少该环节，建议补充）',
      notes: ['本地规则按关键词切分；联网后可获得 AI 重写版（删口头禅 / 补卡壳 / 改提问）'],
    };
  });
}

/* ---------------- Prompt ---------------- */
function heatmapPrompt({ transcript, subject }) {
  return `你是一位经验丰富的微格教学分析师。下面是一位实习老师的试讲逐字稿（课题：《${subject || '本节课'}》）。
请一次性完成三项分析，只输出 JSON，不要任何解释：

{
  "wait_moments": [
    {"quote": "<从逐字稿原样摘录的提问句，≤34字>", "wait_sec": <该提问后的预估等待秒数，0.5 的倍数>, "reaction": "<当时学生的反应或氛围，≤22字>"}
  ],
  "time_allocation": {"teacher": <教师讲授分钟数>, "student": <学生回答/练习分钟数>, "interaction": <提问互动分钟数>, "transition": <过渡组织分钟数>},
  "segments": [
    {"phase": "导入", "script": "<改进后的导入环节口述稿，60-120字>", "notes": ["<本段关键改动，≤25字>", "<第二条改动>"]},
    {"phase": "新授", "script": "<…>", "notes": ["…"]},
    {"phase": "互动", "script": "<…>", "notes": ["…"]},
    {"phase": "小结", "script": "<…>", "notes": ["…"]}
  ]
}

【硬性要求】
1. wait_moments 覆盖逐字稿中每一次提问（最多 8 条），quote 必须是原文原句；等待秒数依据上下文推断：提问后立刻自己讲下去 = 0.5-1 秒；出现"等一等/想一想/停顿"或点了学生名字 = 2-3 秒。模型无法判断的条目可以不给 wait_sec（会按不可测量处理）
2. time_allocation 四个整数之和约等于 40（按一节课计），符合该课题的正常节奏
3. segments 固定四个环节；script 是"改进口述稿"：删掉口头禅、补上卡壳处的推导、把"明白吗"式伪提问改成"李XX，你说说看"式留白提问；notes 写清本段改了什么

【逐字稿】
${transcript}`;
}

/* ---------------- 数据清洗 ---------------- */
/**
 * 把模型返回的 time_allocation 规整成安全对象。
 * 铁律：没有可靠计时数据时**绝不伪造**（包括「全算教师讲授」这种兜底）。
 *   · 模型给了可用量（任一维度 > 0）→ 返回带 source='text-heuristic' 的对象；
 *   · 模型没给 / 给的全零 / 给的不是对象 → 返回 null，前端据此显示「未测量」。
 */
function normalizeAlloc(a) {
  if (!a || typeof a !== 'object') return null;
  const t = Math.max(0, Number(a.teacher) || 0);
  const s = Math.max(0, Number(a.student) || 0);
  const i = Math.max(0, Number(a.interaction) || 0);
  const tr = Math.max(0, Number(a.transition) || 0);
  // 没有任何可用数值 → 不伪造，返回 null（前端显示「未测量」），拒绝「全算教师讲授」兜底。
  if (t + s + i + tr === 0) return null;
  // 来源标注：模型是按文本推断的，不是实测的课堂计时。
  return { teacher: t, student: s, interaction: i, transition: tr, source: 'text-heuristic' };
}

function normalizeSegments(list) {
  const byLabel = {};
  (Array.isArray(list) ? list : []).forEach((s) => {
    const label = String(s.phase || '').replace(/【】/g, '');
    if (PHASES.some((p) => p.label === label)) byLabel[label] = s;
  });
  return PHASES.map((p) => {
    const seg = byLabel[p.label] || {};
    return {
      phase: p.label,
      script: String(seg.script || '（AI 未返回该环节，建议补充）').slice(0, 600),
      notes: (Array.isArray(seg.notes) ? seg.notes : []).map((n) => String(n).slice(0, 40)).slice(0, 3),
    };
  });
}

/* ---------------- 主入口 ---------------- */
async function classroomMetrics(input = {}) {
  const transcript = String(input.transcript || '').trim();
  if (transcript.length < 10) throw new Error('讲稿内容太短，无法生成课堂可视化');

  // 捕获真实错误：模型失败时据此判定降级原因（不许笼统报成一种）
  let modelError = null;
  if (ai.hasKey()) {
    try {
      console.log('[heatmap] 调用大模型做课堂三件套分析…');
      const raw = await ai.chat(
        [{ role: 'user', content: heatmapPrompt({ transcript: transcript.slice(0, 6000), subject: input.subject }) }],
        { temperature: 0.4, maxTokens: 2400 }
      );
      const json = ai.extractJson(raw);
      if (json && Array.isArray(json.wait_moments) && Array.isArray(json.segments)) {
        // 模型返回的逐次等待统一规整：缺 wait_sec → null（不塞默认值），数值夹在 0–10
        const waitMetrics = normalizeModelWaitMoments(json.wait_moments);
        return withFallback(
          {
            // 新字段：统一等待指标（唯一事实来源）
            wait_metrics: waitMetrics,
            wait_moments: waitMetrics.moments, // 兼容字段（旧前端仍可能读）
            time_allocation: normalizeAlloc(json.time_allocation),
            segments: normalizeSegments(json.segments),
            engine: 'llm',
            // 兼容字段：旧前端仍可能读
            wait_source: waitMetrics.source,
            wait_note: waitMetrics.note,
          },
          null,
          true
        );
      }
      // 回落说明：模型没给出合法的 wait_moments（或 JSON 不合法）→ 抛错走下面的规则分支，
      // 整份结果按「本地规则」口径产出（engine='rule'），等待值来自 buildTextWaitMetrics，
      // 因此 wait_metrics.source 必然是 'text-heuristic'，**不会**冒用 'model-inference'。
      // 这是「模型没给逐次等待时用规则推断顶上」的有意设计：值是真实推断的，不是伪造的。
      throw new Error('模型未返回合法 JSON');
    } catch (e) {
      modelError = e;
      console.warn('[heatmap] 降级本地规则 ->', e && e.message ? e.message : e);
    }
  }

  // 规则分支：等待指标同样由 wait-metrics.js 产出（与 /api/analyze 规则分支同源）
  const waitMetrics = buildTextWaitMetrics(transcript);
  return withFallback(
    {
      // 新字段：统一等待指标（唯一事实来源）
      wait_metrics: waitMetrics,
      wait_moments: waitMetrics.moments, // 兼容字段（旧前端仍可能读）
      // 不伪造时间分配：规则分支没有任何实测/可靠的计时依据，
      // 因此 time_allocation 一律为 null（拒绝「全算教师讲授」式兜底），由前端显示「未测量」。
      // 若今后接入真实课堂计时，再在这里回填真实数值。
      time_allocation: null,
      segments: ruleSegments(transcript),
      engine: 'rule',
      // 兼容字段：旧前端仍可能读
      wait_source: waitMetrics.source,
      wait_note: waitMetrics.note,
    },
    modelError,
    ai.hasKey()
  );
}

module.exports = {
  classroomMetrics,
  PHASES,
  // 以下为内部辅助，导出便于回归测试锁定口径（不影响既有调用方）
  ruleTimeAllocation,
  ruleSegments,
  splitTeachingUnits,
};
