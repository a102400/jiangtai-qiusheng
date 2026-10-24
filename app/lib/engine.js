'use strict';

/**
 * 统一调度引擎
 * 原则：配了 API Key 就走真大模型；没配、或调用失败，就自动降级到本地规则引擎。
 * 这样保证 Demo 在任何网络环境下都不会白屏 —— 这正是黑客松现场最需要的。
 */

const ai = require('./deepseek');
const { analyzeRule, improveScriptRule } = require('./analyzer');
const { analyzePrompt, improvePrompt, studentSystem, PERSONAS, classroomRoundPrompt, dangerPrompt, drillPrompt } = require('./prompts');
const crisis = require('./crisis');
const { panorama } = require('./panorama');
const { scoreBlackboard } = require('./blackboard');
const { classroomMetrics } = require('./heatmap');
const { lessonPlanCoverage } = require('./lessonplan');
const { curriculumCheck } = require('./curriculum');
const { hollowComfort } = require('./hollow');
const { ifiasAnalyze, batchTrajectory } = require('./ifias');
const { getSubject, detectSubject } = require('./subjects');
const {
  DEFAULT_PROFILE, PROFILE_LABELS, LEVEL_BASE_CAP, normalizeProfile, deriveLevelParams,
  profileSummary, profileEffectText, pickAskForLevel,
} = require('./profile');
const { SKILLS, SKILL_MAP, drillRule, validateLlmResult, canonicalKeys } = require('./drill');

function warn(scope, err) {
  console.warn(`[engine:${scope}] 降级为本地规则引擎 ->`, err && err.message ? err.message : err);
}

/* ---------------- 模块一：复盘分析 ---------------- */
async function analyze(input = {}) {
  const transcript = String(input.transcript || '').trim();
  if (transcript.length < 5) throw new Error('讲稿内容太短，无法分析');

  const subjectKey = input.subjectKey || detectSubject(input.subject);
  if (ai.hasKey()) {
    try {
      console.log('[engine] 调用大模型分析…（学科：' + subjectKey + '）');
      const raw = await ai.chat(
        [{ role: 'user', content: analyzePrompt({
          transcript, subject: input.subject, grade: input.grade, subjectKey,
        }) }],
        { temperature: 0.3, maxTokens: 2048 }
      );
      const json = ai.extractJson(raw);
      if (json && typeof json.overall_score !== 'undefined') {
        json.engine = 'llm';
        json.subject_key = subjectKey;
        json.subject_label = getSubject(subjectKey).label;
        // 缺失字段用规则引擎补齐，避免前端渲染崩掉
        const base = analyzeRule(input);
        const merged = Object.assign({ stats: base.stats }, base, json);
        // 指标来源标记：模型返回的字段会覆盖规则引擎的，必须在这里补齐，
        // 否则前端无法区分「实测」与「推断」。
        merged.speech_rate = Object.assign({}, base.speech_rate, json.speech_rate || {}, {
          // 平均语速是程序计算值，不允许模型改写数值后沿用计算来源。
          chars_per_min: base.speech_rate.chars_per_min,
          judge: base.speech_rate.judge,
          estimated: base.speech_rate.estimated,
          source: base.speech_rate.source,
          note: base.speech_rate.note,
        });
        merged.questions = Object.assign({}, base.questions, json.questions || {}, {
          // 等待时间由模型依据讲稿上下文推断，不是音频时间戳实测
          source: 'text-heuristic',
          note: '平均等待由模型依据讲稿上下文推断，不能测出真实课堂中已发生的等待秒数',
        });
        merged.pauses = Object.assign({}, base.pauses, json.pauses || {}, {
          source: 'text-heuristic',
          note: '停顿由文本标记与语速启发式估算，标点和省略号不等于真实停顿时长',
        });
        return merged;
      }
      throw new Error('模型未返回合法 JSON');
    } catch (err) {
      warn('analyze', err);
    }
  }
  const report = analyzeRule(input);
  report.engine = 'rule';
  return report;
}

/* ---------------- 模块三：改进建议 ---------------- */
async function improve(input = {}) {
  const transcript = String(input.transcript || '').trim();
  if (transcript.length < 5) throw new Error('讲稿内容太短，无法生成改进稿');

  const analysis = input.analysis || analyzeRule(input);

  if (ai.hasKey()) {
    try {
      console.log('[engine] 调用大模型生成改进稿…');
      const raw = await ai.chat(
        [{ role: 'user', content: improvePrompt({ transcript, analysis }) }],
        { temperature: 0.6, maxTokens: 4096 }
      );
      const json = ai.extractJson(raw);
      if (json && json.improved_script) {
        json.engine = 'llm';
        const base = improveScriptRule({ transcript, analysis, subject: input.subject });
        return Object.assign({}, base, json);
      }
      throw new Error('模型未返回合法 JSON');
    } catch (err) {
      warn('improve', err);
    }
  }
  const result = improveScriptRule({ transcript, analysis, subject: input.subject });
  result.engine = 'rule';
  return result;
}

/* ---------------- 模块二：AI 学生多轮对话 ---------------- */
async function studentChat(input = {}) {
  const personaKey = PERSONAS[input.persona] ? input.persona : 'naughty';
  const persona = PERSONAS[personaKey];
  const messages = Array.isArray(input.messages) ? input.messages : [];

  // 学情快照：缺省或非法都归一化，不抛错；缺省时 profileApplied=false，行为与改造前一致
  const hasProfile = !!(input.profile && typeof input.profile === 'object');
  const profile = hasProfile ? normalizeProfile(input.profile) : null;
  const levelParams = profile ? deriveLevelParams(profile.class.level, profile.class.activity, profile.class.size) : null;
  const difficulty = levelParams ? levelParams.difficulty : 'core';
  const summary = profile ? profileSummary(profile) : '';

  if (ai.hasKey()) {
    try {
      console.log('[engine] 调用大模型扮演学生…');
      const system = studentSystem({
        topic: input.topic,
        persona: personaKey,
        customPersona: input.customPersona,
        recentChunk: String(input.transcript || '').slice(-1200), // 只喂最近片段，省 token 且更贴题
        profile, // 学情上下文（缺省时整段不拼接）
      });
      const llmMessages = [{ role: 'system', content: system }].concat(
        messages.map((m) => ({
          role: m.role === 'student' ? 'assistant' : 'user',
          content: String(m.content || '').slice(0, 800),
        }))
      );
      // 若没有历史，给个开场指令让它先提问
      if (messages.length === 0) {
        llmMessages.push({ role: 'user', content: '（老师刚讲完这一段，请开始提问）' });
      }
      const raw = await ai.chat(llmMessages, { temperature: 0.9, maxTokens: 256 });
      const reply = String(raw).replace(/```/g, '').replace(/^["'「」]|["'「」]$/g, '').trim();
      if (reply) {
        return {
          reply, persona: personaKey, label: persona.label, engine: 'llm',
          profile_applied: hasProfile, difficulty, profile_summary: summary,
        };
      }
      throw new Error('模型返回为空');
    } catch (err) {
      warn('student', err);
    }
  }

  // 降级：本地题库，按已提问轮次推进，不重复
  const used = messages.filter((m) => m.role === 'student').map((m) => String(m.content));
  // 学情生效时按水平重排提问池（good 维持原顺序，行为与改造前一致）
  const askPool = profile ? pickAskForLevel(persona.asks, profile.class.level) : persona.asks;
  const available = askPool.filter((q) => used.indexOf(q) === -1);
  let reply;
  if (used.length === 0) {
    reply = askPool[0];
  } else if (available.length > 0) {
    reply = available[0];
  } else {
    reply = persona.follow[used.length % persona.follow.length];
  }
  return {
    reply, persona: personaKey, label: persona.label, engine: 'rule',
    profile_applied: hasProfile, difficulty, profile_summary: summary,
  };
}

/* ---------------- 模块四：课堂崩塌模拟 ---------------- */
/* 抽一张事件卡（按教学环节加权 / 失控升级），生成学生的第一反应 */
async function crisisStart(input = {}) {
  // 失控升级判定：连续应对失分 → 课堂升级为全班失控
  if (crisis.shouldEscalate(input.scoreHistory) && input.lastEventId !== crisis.ESCALATION.to) {
    const ev = crisis.ESCALATION;
    let studentSay = '老师管不住啦——哈哈哈哈！';
    if (ai.hasKey()) {
      try {
        const raw = await ai.chat(
          [{ role: 'user', content: `你扮演一名中学生，课堂因为老师没处理好刚才的事故彻底失控了，全班起哄。
输出一句最真实的全班起哄声中你喊的话（≤25字，口语，只输出这句话本身）。` }],
          { temperature: 0.95, maxTokens: 120 }
        );
        const t = String(raw).replace(/["'「」]/g, '').trim();
        if (t) studentSay = t;
      } catch (e) { /* 降级 */ }
    }
    return {
      event: { id: ev.to, title: ev.title, desc: ev.desc, hint: ev.hint, escalated: true },
      student_say: studentSay,
      engine: 'llm',
    };
  }

  const ev = input.eventId
    ? crisis.CRISIS_EVENTS.find((e) => e.id === input.eventId)
    : crisis.pickEventByPhase(input.round, input.lastEventId);
  if (!ev) throw new Error('事件不存在');

  let studentSay = ev.fallback_replies[0];
  let engine = 'rule';
  if (ai.hasKey()) {
    try {
      const raw = await ai.chat(
        [{
          role: 'user',
          content: `你扮演一名中学生，教室里刚发生了事故：${ev.desc}
输出一句这个场景下最真实的学生喊话（≤30字，口语，只输出这句话本身）。`,
        }],
        { temperature: 0.95, maxTokens: 120 }
      );
      const t = String(raw).replace(/["'「」]/g, '').trim();
      if (t) { studentSay = t; engine = 'llm'; }
    } catch (e) { /* 降级用本地 */ }
  }
  return {
    event: { id: ev.id, title: ev.title, desc: ev.desc, hint: ev.hint },
    student_say: studentSay,
    engine,
  };
}

/* 老师应对 → FIAS 控场评分（LLM 优先，规则保底） */
async function crisisRespond(input = {}) {
  const eventId = input.eventId;
  const response = String(input.response || '').trim();
  if (!response) throw new Error('请先输入你的应对');

  if (ai.hasKey()) {
    try {
      const ev = crisis.CRISIS_EVENTS.find((e) => e.id === eventId);
      const raw = await ai.chat(
        [{
          role: 'user',
          content: `你是一名用 FIAS（弗兰德斯互动分析系统）评估课堂的教研员。
课堂事故：${ev ? ev.title + '——' + ev.desc : eventId}
实习老师的应对：「${response.slice(0, 500)}」

按 FIAS 三区（强化/中立/削弱）评分。只输出 JSON：
{"score": <0-100 控场得分>, "grade": "优秀/合格/需改进", "dimension": "<≤12字，本次考察维度>", "feedback": "<≤80字点评：好在哪/差在哪，引用老师原话>", "model_answer": "<≤60字的示范应对>"}`,
        }],
        { temperature: 0.4, maxTokens: 400 }
      );
      const json = ai.extractJson(raw);
      if (json && typeof json.score !== 'undefined') {
        return {
          score: Math.max(0, Math.min(100, Number(json.score) || 0)),
          grade: json.grade || '合格',
          dimension: json.dimension || '',
          feedback: json.feedback || '',
          model_answer: json.model_answer || '',
          engine: 'llm',
        };
      }
      throw new Error('bad json');
    } catch (e) { /* 降级规则评分 */ }
  }
  const r = crisis.ruleScoreResponse(eventId, response);
  r.model_answer = '先接住情绪（"老师看到了，你们先冷静一下"），再快速回到教学主线，课后单独处理。';
  r.engine = 'rule';
  return r;
}

/* ---------------- 模块五：双人对比 / 小组博弈 ---------------- */
async function compare(input = {}) {
  const a = String(input.transcriptA || '').trim();
  const b = String(input.transcriptB || '').trim();
  if (a.length < 5 || b.length < 5) throw new Error('两份讲稿都需要至少 5 个字');

  const prompt = `你是微格教学比赛的评委组长。同一课题《${input.subject || '本节课'}》有两位实习老师各讲了一段，请对比评判。只输出 JSON：
{
  "winner": "A" or "B",
  "verdict": "<一句话判定谁更好，≤50字>",
  "score_a": <0-100>, "score_b": <0-100>,
  "a_strengths": ["<A的优点，≤2条>"],
  "a_weaknesses": ["<A的问题，≤2条>"],
  "b_strengths": ["<B的优点，≤2条>"],
  "b_weaknesses": ["<B的问题，≤2条>"],
  "learn_each_other": "<A和B最该互相学习的一点，≤50字>"
}
【A 的讲稿】
${a.slice(0, 2500)}
【B 的讲稿】
${b.slice(0, 2500)}`;

  if (ai.hasKey()) {
    try {
      const raw = await ai.chat([{ role: 'user', content: prompt }], { temperature: 0.4, maxTokens: 900 });
      const json = ai.extractJson(raw);
      if (json && json.winner) return { ...json, engine: 'llm' };
      throw new Error('bad json');
    } catch (e) { /* 降级 */ }
  }
  // 降级：用规则引擎各算一遍分
  const ra = analyzeRule({ transcript: a, subject: input.subject });
  const rb = analyzeRule({ transcript: b, subject: input.subject });
  const sa = ra.overall_score, sb = rb.overall_score;
  return {
    winner: sa >= sb ? 'A' : 'B',
    verdict: `离线对比：A ${sa} 分 / B ${sb} 分（基于规则引擎的语速、提问、口头禅统计）`,
    score_a: sa, score_b: sb,
    a_strengths: ['本地统计完成'], a_weaknesses: ['（离线模式，建议联网获取详细对比）'],
    b_strengths: ['本地统计完成'], b_weaknesses: ['（离线模式）'],
    learn_each_other: '联网后可获得逐条交叉学习建议',
    engine: 'rule',
  };
}

/* ---------------- 模块六：板书评分 ---------------- */
async function blackboard(input = {}) {
  return scoreBlackboard(input.imagePath, { subject: input.subject, grade: input.grade });
}

/* ---------------- 模块七：三学生同时在线（多智能体课堂） ---------------- */
/* 学生状态基线：专注 / 理解（AI 未给分时用它 + 压力推导） */
const STUDENT_STATE_BASE = {
  naughty: { attention: 52, comprehension: 62 },
  geek: { attention: 88, comprehension: 90 },
  drift: { attention: 42, comprehension: 35 },
};
const STUDENT_KEYS = ['naughty', 'geek', 'drift'];

function clampPct(v) { return Math.max(5, Math.min(100, Math.round(Number(v) || 0))); }

/**
 * 基线取值：无 profile → 原常量；有 profile → 原常量 + 学情偏移
 * 规格 §3.3 / §5.3：STUDENT_STATE_BASE 本身不删不改，只是换了取值来源。
 */
function baseFor(key, profile) {
  const base = STUDENT_STATE_BASE[key] || STUDENT_STATE_BASE.naughty;
  if (!profile) return { attention: base.attention, comprehension: base.comprehension };
  const d = deriveLevelParams(profile.class.level, profile.class.activity, profile.class.size);
  let att = base.attention + d.baseAttentionDelta;
  let cmp = base.comprehension + d.baseComprehensionDelta;
  // 走神学生（小走）：基础薄弱班额外 −3（更易走神）；班级大再按 size 规则 −2
  if (key === 'drift') {
    if (profile.class.level === 'weak') att -= 3;
    att += d.driftAttentionDelta - d.baseAttentionDelta;
  }
  // 学情是「整个班」的水平：弱档班级里三人的基线统一受该档上限约束
  // （规格 §8 验收：weak 档三名学生的 base_state.attention 均 ≤ 44、comprehension 均 ≤ 50）
  const cap = LEVEL_BASE_CAP[profile.class.level];
  if (cap) {
    att = Math.min(att, cap.attention);
    cmp = Math.min(cmp, cap.comprehension);
  }
  return {
    attention: Math.max(5, att),
    comprehension: Math.max(5, cmp),
  };
}

/**
 * 给学生条目补上学情相关字段（difficulty / base_state / state_reason 后缀）
 * 无学情时 difficulty 固定 'core'，state_reason 不加后缀 —— 与改造前一致。
 */
function withProfileFields(student, levelParams, levelLabel, profile) {
  const s = Object.assign({}, student);
  s.difficulty = difficultyFor(s.key, levelParams);
  s.base_state = student.base_state || { attention: 0, comprehension: 0 };
  if (profile && levelLabel) {
    const suffix = `（学情：${levelLabel}）`;
    const reason = String(s.state_reason || '');
    if (reason.indexOf(suffix) === -1 && reason.length + suffix.length <= 40) {
      s.state_reason = reason + suffix;
    }
  }
  return s;
}

/**
 * 由学情给出该生本轮的提问难度（三学生共用同一学情时基础档一致，个体可差异化）
 */
function difficultyFor(key, levelParams) {
  if (!levelParams) return 'core';
  if (levelParams.level === 'excellent') {
    if (key === 'drift') return 'basic';
    return 'advanced';
  }
  return levelParams.difficulty;
}

/* 附和节拍：真实课堂约 14% 的听话轮是纯附和；本产品每轮强制三人发言，
 * 故按「每 5 轮 2 次」≈13.3% 安排，接近实测中位数 */
function isBackchannelRound(roundNo) {
  const m = roundNo % 5;
  return m === 0 || m === 2;
}

/* 归一化单个学生：缺分则按「基线 − 压力惩罚 + 老师是否回应」推导，保证每条都有可解释数字 */
function normStudentState(raw, pressure, teacherAnswer, profile) {
  const s = raw || {};
  const key = STUDENT_KEYS.indexOf(s.key) !== -1 ? s.key : 'naughty';
  const base = baseFor(key, profile);
  const p = Number(pressure) || 0;
  const has = teacherAnswer && String(teacherAnswer).trim().length > 3;
  let att = Number(s.attention);
  let cmp = Number(s.comprehension);
  if (!isFinite(att)) att = base.attention - Math.round(p / 6) + (has ? 6 : 0);
  if (!isFinite(cmp)) cmp = base.comprehension - Math.round(p / 10) + (has ? 8 : 0);
  const reason = String(s.state_reason || '').slice(0, 24) || (has ? '老师回应后略有回升' : '按人设基线估计');
  return {
    key: key,
    mood: String(s.mood || '😊').slice(0, 4),
    line: String(s.line || '').slice(0, 80),
    hand_raise: !!s.hand_raise,
    attention: clampPct(att),
    comprehension: clampPct(cmp),
    state_reason: reason,
    // 基线值（学情调整后）；未注入学情时等于既有 STUDENT_STATE_BASE
    base_state: { attention: base.attention, comprehension: base.comprehension },
  };
}

async function classroomRound(input = {}) {
  const history = Array.isArray(input.history) ? input.history : [];
  // 第几轮课堂：已发生的学生发言数 / 3 + 1（模型自己数不清，显式告诉它）
  const roundNo = Math.floor(history.filter((m) => m.role === 'student').length / 3) + 1;
  // 学情快照：缺省时为 null，行为与改造前完全一致
  const hasProfile = !!(input.profile && typeof input.profile === 'object');
  const profile = hasProfile ? normalizeProfile(input.profile) : null;
  const levelParams = profile ? deriveLevelParams(profile.class.level, profile.class.activity, profile.class.size) : null;
  const profileEffect = profile ? profileEffectText(profile) : '';
  const levelLabel = profile ? (PROFILE_LABELS.level[profile.class.level] || PROFILE_LABELS.level.good) : '';
  const ctx = {
    roundNo: roundNo,
    topic: input.topic,
    recentChunk: String(input.transcript || '').slice(-1500),
    teacherAnswer: String(input.teacherAnswer || ''),
    pressure: input.pressure,
    profile, // 学情上下文（缺省时整段不拼接）
    // 多轮记忆（35）：把前面几轮的真实对话喂给模型，学生才能引用老师原话
    recentDialogue: history
      .slice(-8)
      .map((m) => (m.role === 'teacher' ? '老师：' : '学生：') + String(m.content || '').slice(0, 120))
      .join('\n'),
  };
  // 学情生效时，向模型说明本班三人的基线值
  if (levelParams) {
    ctx.profileBaselineNote =
      `本班基线为 小皮 专注${baseFor('naughty', profile).attention}/理解${baseFor('naughty', profile).comprehension}、` +
      `小霸 专注${baseFor('geek', profile).attention}/理解${baseFor('geek', profile).comprehension}、` +
      `小走 专注${baseFor('drift', profile).attention}/理解${baseFor('drift', profile).comprehension}，按此微调。`;
  }

  if (ai.hasKey()) {
    try {
      const raw = await ai.chat(
        [{ role: 'user', content: classroomRoundPrompt(ctx) }],
        { temperature: 0.95, maxTokens: 700 }
      );
      const json = ai.extractJson(raw);
      if (json && Array.isArray(json.students) && json.students.length >= 2) {
        let bc = json.backchannel && STUDENT_KEYS.indexOf(json.backchannel.key) !== -1 && json.backchannel.line
          ? { key: json.backchannel.key, line: String(json.backchannel.line).slice(0, 12) }
          : null;
        // 闸门：只在节拍轮（N % 4 === 3）保留附和，防止模型每轮都附和（真实课堂约 14%）
        if (bc && !isBackchannelRound(ctx.roundNo)) bc = null;
        const students = json.students.slice(0, 3).map((st) => normStudentState(st, ctx.pressure, ctx.teacherAnswer, profile));
        let finalBc = bc;
        const pNum = Number(ctx.pressure) || 0;
        if (!finalBc && isBackchannelRound(ctx.roundNo) && pNum < 75) {
          // 模型没照做：按真实课堂 14% 的节奏补一句附和，替换小走这一轮的话
          const drift = students.find((x) => x.key === 'drift');
          if (drift) {
            const quips = ['嗯，懂了', '哦——是这样', '对对，明白了', '嗯嗯'];
            drift.line = quips[ctx.roundNo % quips.length];
            drift.mood = '😊';
            drift.attention = clampPct(drift.attention + 5);
            drift.state_reason = '附和一句，注意力回来了点';
            finalBc = { key: 'drift', line: drift.line };
          }
        }
        return {
          backchannel: finalBc,
          students: students.map((s) => withProfileFields(s, levelParams, levelLabel, profile)),
          pressure_delta: Number(json.pressure_delta) || 0,
          pressure_reason: json.pressure_reason || '',
          verdict: json.verdict || '',
          engine: 'llm',
          profile_applied: hasProfile,
          profile_effect: profileEffect,
        };
      }
      throw new Error('bad json');
    } catch (e) {
      console.warn('[classroom] 降级本地：', e.message);
    }
  }
  // 本地兜底：三学生固定剧本 + 简单压力逻辑
  const pool = {
    naughty: [
      '老师，那要是特殊情况下还成立吗？',
      '这个公式在生活里到底用在哪啊？',
      '如果条件反过来，答案会反过来吗？',
    ],
    geek: [
      '它的逆命题成立吗？反过来一定对吗？',
      '这是不是可以用上次的方法证？',
      '换成字母系数还能一样处理吗？',
    ],
    drift: [
      '啊？老师你刚才说到第几步了……',
      '这个跟我们上个月学的那个是亲戚吗？',
      '不好意思，你写的符号我看不清。',
    ],
  };
  // 学情生效时按水平重排提问池：弱档先挑「基础概念」类困惑，优秀档先挑「原理/变式」类
  const askPool = profile
    ? {
        naughty: pickAskForLevel(pool.naughty, profile.class.level),
        geek: pickAskForLevel(pool.geek, profile.class.level),
        drift: pickAskForLevel(pool.drift, profile.class.level),
      }
    : pool;
  const used = (input.history || []).filter((m) => m.role === 'student').map((m) => m.content);
  const pick = (arr) => { const avail = arr.filter((q) => used.indexOf(q) === -1); return avail.length ? avail[0] : arr[used.length % arr.length]; };
  const round = ctx.roundNo - 1;
  // 举手概率由学情推导（handRaiseRate），无学情时沿用既有固定值
  const handRaiseRate = levelParams ? levelParams.handRaiseRate : null;
  const raiseFor = (key, fallback) => {
    if (handRaiseRate == null) return fallback;
    // 用轮次做确定性伪随机：同一轮同一学生结果稳定，便于回归测试
    const seed = (round + 1) * 7 + key.charCodeAt(0);
    return (seed % 100) / 100 < handRaiseRate;
  };
  const students = [
    normStudentState({ key: 'naughty', mood: '😤', line: pick(askPool.naughty), hand_raise: raiseFor('naughty', true) }, ctx.pressure, ctx.teacherAnswer, profile),
    normStudentState({ key: 'geek', mood: '🤔', line: pick(askPool.geek), hand_raise: raiseFor('geek', false) }, ctx.pressure, ctx.teacherAnswer, profile),
    normStudentState({ key: 'drift', mood: '😴', line: pick(askPool.drift), hand_raise: raiseFor('drift', true) }, ctx.pressure, ctx.teacherAnswer, profile),
  ];
  // 轮次漂移：老师一直不回应时，走神学生专注继续下滑
  if (!ctx.teacherAnswer) students[2].attention = clampPct(students[2].attention - Math.min(12, round * 2));

  // 附和轮：真实课堂约 14% 话轮是纯附和，这里每 4 轮安排一次（压力高时不附和）
  let backchannel = null;
  const pNow = Number(ctx.pressure) || 0;
  if (isBackchannelRound(ctx.roundNo) && pNow < 75) {
    const quips = ['嗯，懂了', '哦——是这样', '对对，明白了', '嗯嗯'];
    const line = quips[round % quips.length];
    students[2].line = line;
    students[2].mood = '😊';
    students[2].attention = clampPct(students[2].attention + 5);
    students[2].state_reason = '附和一句，注意力回来了点';
    backchannel = { key: 'drift', line: line };
  }
  return {
    students: students.map((s) => withProfileFields(s, levelParams, levelLabel, profile)),
    backchannel,
    pressure_delta: ctx.teacherAnswer ? -10 : 15,
    pressure_reason: ctx.teacherAnswer ? '本地方言：回答让课堂稳定了一些' : '本地兜底：学生发难，压力上升',
    verdict: '',
    engine: 'rule',
    profile_applied: hasProfile,
    profile_effect: profileEffect,
  };
}

/* ---------------- 模块八：危险瞬间摘录 ---------------- */
async function dangerMoments(input = {}) {
  const transcript = String(input.transcript || '').trim();
  if (transcript.length < 10) return { moments: [], engine: 'rule' };

  if (ai.hasKey()) {
    try {
      const raw = await ai.chat(
        [{ role: 'user', content: dangerPrompt({ transcript: transcript.slice(0, 6000) }) }],
        { temperature: 0.3, maxTokens: 900 }
      );
      const json = ai.extractJson(raw);
      if (json && Array.isArray(json.moments) && json.moments.length > 0) {
        return { moments: json.moments.slice(0, 6), engine: 'llm' };
      }
      throw new Error('bad json');
    } catch (e) { /* 降级 */ }
  }
  // 本地规则兜底：口头禅扎堆 + 伪提问
  const moments = [];
  const fw = input.analysis && input.analysis.filler_words;
  if (fw && fw.detail) {
    const top = Object.keys(fw.detail).sort((a, b) => fw.detail[b] - fw.detail[a])[0];
    if (top) {
      moments.push({
        type: '口头禅扎堆',
        quote: '（"' + top + '" 出现 ' + fw.detail[top] + ' 次）',
        reason: '高频口头禅会稀释专业感，让学生走神',
        fix: '把「' + top + '」替换成 1 秒停顿，用沉默代替填充词',
      });
    }
  }
  const q = input.analysis && input.analysis.questions;
  if (q && q.avg_wait_sec != null && q.avg_wait_sec < 2) {
    moments.push({
      type: '伪提问',
      quote: '（提问后平均只等 ' + q.avg_wait_sec + ' 秒）',
      reason: '按讲稿推断的提问后留白不足 2 秒，疑似自问自答（该秒数由文本启发式推算，非实测）',
      fix: '点名 + 沉默等 3 秒，把「明白吗」改成「李XX，你说说看」',
    });
  }
  const sr = input.analysis && input.analysis.speech_rate;
  if (sr && sr.chars_per_min > 160) {
    moments.push({
      type: '逻辑跳跃',
      quote: '（语速 ' + sr.chars_per_min + ' 字/分，超过 160）',
      reason: '讲太快时学生跟不上你的推导跳步',
      fix: '每个结论后加一句「所以这一步的关键是…」',
    });
  }
  if (!moments.length) {
    moments.push({
      type: '冷场',
      quote: '（整段无学生互动痕迹）',
      reason: '逐字稿中看不到提问或点名，课堂可能变成教师独白',
      fix: '每 5 分钟设计一次点名互动',
    });
  }
  return { moments, engine: 'rule' };
}

/* ---------------- 模块九：课堂可视化三件套（热力图/时间分配/分段稿） ---------------- */
async function classroomMetricsView(input = {}) {
  return classroomMetrics({
    transcript: input.transcript,
    subject: input.subject,
  });
}

/* ---------------- 模块十：教案导入覆盖检查 ---------------- */
async function lessonPlan(input = {}) {
  return lessonPlanCoverage({
    plan: input.plan,
    transcript: input.transcript,
    subject: input.subject,
  });
}

/* ---------------- 模块十三：iFIAS 互动编码分析 ---------------- */
async function ifias(input = {}) {
  return ifiasAnalyze({ transcript: input.transcript, subject: input.subject });
}

/* 多节课互动结构轨迹：把每次复盘的 7 维向量投到同一张 PCA 平面上并聚类 */
async function ifiasBatch(input = {}) {
  return batchTrajectory(input.sessions || []);
}

/* ---------------- 模块十二：匿名树洞（32） ---------------- */
async function hollow(input = {}) {
  return hollowComfort({ text: input.text });
}

/* ---------------- 模块十一：课标对照 ---------------- */
async function curriculum(input = {}) {
  return curriculumCheck({
    transcript: input.transcript,
    subject: input.subject,
    subjectKey: input.subjectKey,
  });
}

/* ---------------- 模块十五：3 分钟专项技能练习 ---------------- */

/* 五项技能定义（后端单一真源，前端通过接口拿同一份） */
function drillSkills() {
  return {
    skills: SKILLS.map((s) => ({
      key: s.key,
      label: s.label,
      focus: s.focus,
      brief: s.brief,
      checklist: s.checklist.slice(),
      starter: s.starter,
    })),
    default_skill: 'question_wait',
    duration_sec: 180,
    engine: 'rule',
  };
}

/* 专项练习评分：有 Key 走大模型，失败/无 Key 自动降级规则兜底 */
async function drill(input = {}) {
  const skill = String(input.skill || '').trim();
  if (!skill) throw new Error('请选择要练习的技能');
  if (!SKILL_MAP[skill]) throw new Error('未知技能：' + skill);

  const transcript = String(input.transcript || '').trim();
  if (transcript.replace(/\s/g, '').length < 30) {
    // 文案同时覆盖规格 §3.5 的「练习内容太短（至少 30 字）」与团队的提示语
    throw new Error('练习内容太短（至少 30 字）：这段内容偏短，评分可能不稳。补几句再提交，结果会更准。');
  }

  const durationSec = Math.max(1, Math.min(600, Math.round(Number(input.durationSec) || 180)));
  const profile = input.profile && typeof input.profile === 'object' ? normalizeProfile(input.profile) : null;
  const skillDef = SKILL_MAP[skill];
  // 讲稿过长截断，避免拖垮大模型（与既有 dangerMoments 同样做法）
  const trimmed = transcript.slice(0, 6000);

  if (ai.hasKey()) {
    try {
      console.log('[engine] 调用大模型做专项练习评分…（技能：' + skill + '）');
      const raw = await ai.chat(
        [{ role: 'user', content: drillPrompt({
          transcript: trimmed,
          skill,
          skillLabel: skillDef.label,
          durationSec,
          profile,
          dimensionKeys: canonicalKeys(skill),
        }) }],
        { temperature: 0.35, maxTokens: 1600 }
      );
      const json = ai.extractJson(raw);
      const valid = validateLlmResult(json, { skill, transcript: trimmed, durationSec });
      if (valid) return valid;
      throw new Error('模型返回的维度不可用');
    } catch (err) {
      warn('drill', err);
    }
  }

  return drillRule({
    skill,
    transcript: trimmed,
    durationSec,
    profile,
    subject: input.subject,
    grade: input.grade,
  });
}

function mode() {
  return {
    aiMode: ai.hasKey() ? 'live' : 'demo',
    model: ai.modelName(),
    baseUrl: ai.baseUrl(),
    hasKey: ai.hasKey(),
  };
}

/* 学情默认值（供前端对齐用） */
function profileDefaults() {
  return {
    default_profile: JSON.parse(JSON.stringify(DEFAULT_PROFILE)),
    labels: JSON.parse(JSON.stringify(PROFILE_LABELS)),
  };
}

module.exports = {
  analyze, improve, studentChat, crisisStart, crisisRespond,
  panorama, compare, blackboard, classroomRound, dangerMoments,
  classroomMetricsView, lessonPlan, curriculum, hollow, ifias, ifiasBatch, mode,
  drill, drillSkills, profileDefaults,
};
