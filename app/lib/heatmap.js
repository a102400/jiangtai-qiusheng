'use strict';

/**
 * 课堂可视化三件套（15 / 16 / 17）——共用一次大模型调用，拿到三份数据：
 *  15. 提问等待热力图：每次提问后等了多久（红 <1s 自问自答 / 绿 ≥2s 真思考）
 *  16. 时间分配饼图  ：教师讲 / 学生答 / 互动 / 过渡 各占多少分钟
 *  17. 分环节改进稿  ：【导入】【新授】【互动】【小结】四段改进口述稿
 *
 * 与全项目一致：配了 Key 走真大模型；没配或调用失败，自动降级本地规则估算。
 */

const ai = require('./deepseek');

const PHASES = [
  { key: 'lead-in', label: '导入', icon: '🎬' },
  { key: 'new', label: '新授', icon: '📖' },
  { key: 'interact', label: '互动', icon: '🙋' },
  { key: 'wrap', label: '小结', icon: '📌' },
];

/* ---------------- 本地规则兜底 ---------------- */
function splitSentences(t) {
  return String(t)
    .split(/[。！？；!?;\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 3);
}

/* 15 兜底：找问句 + 按上下文估算等待秒数 */
function ruleWaitMoments(transcript) {
  const sents = splitSentences(transcript);
  const moments = [];
  for (let i = 0; i < sents.length && moments.length < 8; i++) {
    const s = sents[i];
    if (!/[?？]|吗|呢|是不是|有没有|对不对|谁来|说说看/.test(s)) continue;
    const next = sents[i + 1] || '';
    let wait = 1.2;
    if (/等|想一想|思考|停顿|沉默|别急|慢慢来|先想想/.test(next)) wait = 3;
    else if (/[张王李刘陈杨赵黄周吴徐孙马朱胡林郭何高罗郑梁谢宋唐许韩冯邓曹彭曾肖田董潘袁蔡蒋余于杜叶程苏魏吕丁任沈姚卢姜崔钟谭陆汪范金石廖贾夏韦付方白邹孟熊秦邱江尹薛闫段雷侯龙史陶黎贺顾毛郝龚邵万钱严覃武戴莫孔向汤][同学生]/.test(s)) wait = 2.5;
    else if (/明白|理解|听懂|对吧|是吧|会不会|是不是/.test(s)) wait = 0.5;
    else wait = 0.8;
    moments.push({
      quote: s.slice(0, 34),
      wait_sec: wait,
      reaction:
        wait >= 2
          ? '本地估算：有留白，学生有机会思考'
          : wait >= 1
          ? '本地估算：等待偏短，只有少数人能跟上'
          : '本地估算：几乎没等，典型的自问自答',
    });
  }
  if (!moments.length) {
    moments.push({
      quote: '（整段未检测到提问）',
      wait_sec: 0,
      reaction: '本地估算：整节课没有提问，建议每 5 分钟设计一次点名',
    });
  }
  return moments;
}

/* 16 兜底：按关键词把一节课 40 分钟切成四块 */
function ruleTimeAllocation(transcript) {
  const total = 40;
  const sents = splitSentences(transcript);
  let s = 0;
  let it = 0;
  let tr = 0;
  sents.forEach((x) => {
    if (/回答|板演|练习|齐读|朗读|讨论|上台|写一写|做一做/.test(x)) s++;
    if (/[?？]|吗|呢|谁来|说说看|想一想/.test(x)) it++;
    if (/好[，,。]|接下来|下面|我们再来|翻到|来看|注意看/.test(x)) tr++;
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
  };
}

/* 17 兜底：按环节关键词把逐字稿切成四段 */
function ruleSegments(transcript) {
  const sents = splitSentences(transcript);
  const buckets = { 导入: [], 新授: [], 互动: [], 小结: [] };
  sents.forEach((s) => {
    if (/同学们好|上课|今天我们来|首先|情境|生活中|现象|故事|复习|上节课/.test(s)) buckets['导入'].push(s);
    else if (/[?？]|吗|呢|谁来|说说看|讨论|练习|回答|齐读|朗读/.test(s)) buckets['互动'].push(s);
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
1. wait_moments 覆盖逐字稿中每一次提问（最多 8 条），quote 必须是原文原句；等待秒数依据上下文推断：提问后立刻自己讲下去 = 0.5-1 秒；出现"等一等/想一想/停顿"或点了学生名字 = 2-3 秒
2. time_allocation 四个整数之和约等于 40（按一节课计），符合该课题的正常节奏
3. segments 固定四个环节；script 是"改进口述稿"：删掉口头禅、补上卡壳处的推导、把"明白吗"式伪提问改成"李XX，你说说看"式留白提问；notes 写清本段改了什么

【逐字稿】
${transcript}`;
}

/* ---------------- 数据清洗 ---------------- */
function normalizeMoment(m) {
  return {
    quote: String(m.quote || '（未识别）').slice(0, 40),
    wait_sec: Math.max(0, Math.min(10, Number(m.wait_sec) || 1)),
    reaction: String(m.reaction || '').slice(0, 40),
  };
}

function normalizeAlloc(a) {
  const t = Math.max(0, Number(a && a.teacher) || 0);
  const s = Math.max(0, Number(a && a.student) || 0);
  const i = Math.max(0, Number(a && a.interaction) || 0);
  const tr = Math.max(0, Number(a && a.transition) || 0);
  return { teacher: t, student: s, interaction: i, transition: tr };
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

  if (ai.hasKey()) {
    try {
      console.log('[heatmap] 调用大模型做课堂三件套分析…');
      const raw = await ai.chat(
        [{ role: 'user', content: heatmapPrompt({ transcript: transcript.slice(0, 6000), subject: input.subject }) }],
        { temperature: 0.4, maxTokens: 2400 }
      );
      const json = ai.extractJson(raw);
      if (json && Array.isArray(json.wait_moments) && Array.isArray(json.segments)) {
        return {
          wait_moments: json.wait_moments.slice(0, 8).map(normalizeMoment),
          time_allocation: normalizeAlloc(json.time_allocation),
          segments: normalizeSegments(json.segments),
          engine: 'llm',
          // 等待秒数由模型依据讲稿上下文推断，不是音频时间戳实测
          wait_source: 'text-heuristic',
          wait_note: '等待秒数依据讲稿上下文推断（提问后是否立刻自己讲下去、是否点了学生名字），不是音频时间戳实测值',
        };
      }
      throw new Error('模型未返回合法 JSON');
    } catch (e) {
      console.warn('[heatmap] 降级本地规则 ->', e && e.message ? e.message : e);
    }
  }

  return {
    wait_moments: ruleWaitMoments(transcript),
    time_allocation: ruleTimeAllocation(transcript),
    segments: ruleSegments(transcript),
    engine: 'rule',
    wait_source: 'text-heuristic',
    wait_note: '等待秒数由本地规则按标点与提问密度估算，不是音频时间戳实测值',
  };
}

module.exports = { classroomMetrics, PHASES };
