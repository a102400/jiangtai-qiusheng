'use strict';

/**
 * 统一调度引擎
 * 原则：配了 API Key 就走真大模型；没配、或调用失败，就自动降级到本地规则引擎。
 * 这样保证 Demo 在任何网络环境下都不会白屏 —— 这正是黑客松现场最需要的。
 */

const ai = require('./deepseek');
const codexClient = require('./codex');
const { analyzeRule, improveScriptRule } = require('./analyzer');
const { analyzePrompt, improvePrompt, studentSystem, PERSONAS, CLASS_STUDENTS, classroomRoundPrompt, classroomCallOnPrompt, dangerPrompt, drillPrompt, QUESTION_DRILL_MISCONCEPTIONS, questionDrillStudentSystem, questionDrillEvaluationPrompt } = require('./prompts');
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

/**
 * 业务校验错误（用户自己能修的那些）
 * ------------------------------------------------------------------
 * "讲稿太短""请先选原句"这类提示必须原样告诉用户，否则他无从下手。
 * 但服务端统一 5xx 出口会把所有异常匿名化成「服务暂时不可用」——
 * 那是防内部信息外泄的必要措施，对业务校验却是误伤。
 *
 * 所以用 expose=true 做唯一判据：
 *   expose=true  → 400 + 原始文案（干净、可控、专门写给用户看的）
 *   其它异常      → 500 + 通用文案（绝不外泄内部细节）
 * 关键在于**默认不暴露**：只有显式标记的才透出，新增错误不会因为忘记处理而泄露堆栈。
 */
function bizError(message, status) {
  const e = new Error(message);
  e.expose = true;
  e.status = status || 400;
  return e;
}

/* ------------------------------------------------------------------ */
/* 降级原因（fallback_reason）                                          */
/* ------------------------------------------------------------------ */
/**
 * 为什么需要这个字段
 * ------------------------------------------------------------------
 * 模型调用失败时，引擎会**静默**降级到本地规则引擎，前端只看到 engine='rule'，
 * 用户根本不知道发生了什么：是没配 Key？是模型欠费了？是被限流了？还是模型报错了？
 * 这四种情况用户要做的动作完全不同（去配 Key / 去充值 / 稍后再试 / 换模型），
 * 所以必须把「为什么降级」显式带出来，不能笼统报成一种。
 *
 * 完整取值表（前端据此提示；这是冻结契约，请勿增删或改写）：
 *   'none'                 本次没有降级（模型成功出结果，或根本没走模型）
 *   'key-not-configured'   没有配置 API Key，从未调用过模型
 *   'rate-limited'         上游限流（HTTP 429）
 *   'insufficient-balance' 模型账号余额不足 / 欠费（HTTP 402）
 *   'auth-failed'          鉴权失败（HTTP 401/403：Key 无效或无权限）
 *   'model-error'          其它模型失败（网络异常、超时、返回格式不合法等）
 *
 * 铁律：**不许伪造**。降级原因必须来自真实的错误信号，
 * 绝不允许把任意失败都报成 'rate-limited'。
 */
const {
  FALLBACK_REASON,
  classifyFallbackReason,
  isRateLimitError,
  isInsufficientBalanceError,
  isAuthError,
  isNoKeyError,
  withFallback,
} = require('./fallback-reason');

/* 上面这些判定函数（upstreamStatus / stableCode / isRateLimitError /
   isInsufficientBalanceError / isAuthError / isNoKeyError / classifyFallbackReason）
   已整体提取到 ./fallback-reason.js —— 因为 heatmap / lessonplan / ifias / hollow /
   curriculum / panorama / blackboard 这 7 个模块各自 catch 错误、各自要标注降级原因，
   而它们反过来要被本文件 require，留在本文件会形成循环依赖。
   下面的 re-export 保证 engine.FALLBACK_REASON / engine.classifyFallbackReason
   等既有导出完全不变（契约测试依赖它们）。 */

/* ------------------------------------------------------------------ */
/* 学科知识点（subject_knowledge）规整                                  */
/* ------------------------------------------------------------------ */
/**
 * 学科知识覆盖**永远算不出来**：我们只有一段逐字稿，没有完整教案、没有知识点清单。
 * 所以这一套体系只提供「线索」——讲稿里明显提到过的、值得人工核对的。
 * 规范说明（模型不返回、或返回得不合格时的兜底）。
 */
const SUBJECT_SCOPE_NOTE = '没有完整教案或知识点清单，不能计算学科知识覆盖率。';

/**
 * scope_note 必须是诚实的：
 * - 不给「覆盖率 XX%」：没有知识点清单，任何百分比都是编的；
 * - 必须说明"算不出覆盖率"，模型没说明就补上规范说明。
 */
function normalizeScopeNote(raw) {
  const note = typeof raw === 'string' ? raw.trim() : '';
  if (!note) return SUBJECT_SCOPE_NOTE;
  if (/\d+\s*%/.test(note)) return SUBJECT_SCOPE_NOTE;
  if (/不能计算|无法计算|不可计算|算不了|算不出/.test(note)) return note.slice(0, 200);
  return note.slice(0, 200) + '；' + SUBJECT_SCOPE_NOTE;
}

/**
 * 把模型返回的 subject_knowledge 规整成可信的形状。
 * 铁律：**证据不许伪造** —— covered[].evidence_quote 必须是逐字稿里的原样子串，
 * 对不上的整条丢弃（宁可少给，不能给假证据）。
 *
 * @param {*} raw 模型返回的 subject_knowledge
 * @param {string} transcript 原始逐字稿（用于校验证据）
 */
function normalizeSubjectKnowledge(raw, transcript) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const text = String(transcript || '');

  // covered：每项 {point, evidence_quote}，证据必须是原文子串
  const covered = [];
  (Array.isArray(src.covered) ? src.covered : []).forEach((item) => {
    if (!item || typeof item !== 'object') return;
    const point = String(item.point || '').trim();
    const quote = String(item.evidence_quote || '').trim();
    if (!point || !quote) return;
    // 证据校验：必须是逐字稿中的原样子串
    if (text.indexOf(quote) === -1) return;
    covered.push({ point: point.slice(0, 60), evidence_quote: quote.slice(0, 200) });
  });

  // needs_review：每项 {point, reason} —— 证据不足、需人工核对，不下"漏讲"的结论
  const needsReview = [];
  (Array.isArray(src.needs_review) ? src.needs_review : []).forEach((item) => {
    if (!item || typeof item !== 'object') return;
    const point = String(item.point || '').trim();
    if (!point) return;
    const reason = String(item.reason || '').trim();
    needsReview.push({ point: point.slice(0, 60), reason: reason.slice(0, 120) });
  });

  return {
    covered,
    needs_review: needsReview,
    scope_note: normalizeScopeNote(src.scope_note),
  };
}

/* ---------------- 模块一：复盘分析 ---------------- */
async function analyze(input = {}) {
  const transcript = String(input.transcript || '').trim();
  if (transcript.length < 5) throw bizError('讲稿内容太短，无法分析');

  const subjectKey = input.subjectKey || detectSubject(input.subject);
  const modelAvailable = ai.hasKey();
  // 降级原因初值：没配 Key 就从来没调过模型；有 Key 则先记 model-error，
  // 具体原因必须等 catch 到真实错误信号后再改写（不许凭空猜、不许一律报限流）。
  let fallbackReason = modelAvailable
    ? FALLBACK_REASON.MODEL_ERROR
    : FALLBACK_REASON.KEY_NOT_CONFIGURED;
  if (modelAvailable) {
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
        merged.questions = Object.assign(
          {},
          base.questions,
          json.questions || {},
          {
            // LLM 没有音频时间戳，不能输出真实平均等待。
            avg_wait_sec: null,
            source: 'unmeasured',
            wait_source: 'unmeasured',
            note:
              '当前输入没有可靠音频时间戳，无法测量真实提问等待时间。热力图中的逐次等待值属于文本推断。',
          }
        );
        // 等待推断统一由规则模块产出，模型不参与：
        // analyzePrompt 不产出 wait moments，合并时以规则版 wait_metrics 为准，
        // 保证 /api/analyze 与 /api/heatmap 的等待指标同源（同一讲稿 → 逐字相同的 moments）。
        merged.wait_metrics = base.wait_metrics;
        merged.pauses = Object.assign({}, base.pauses, json.pauses || {}, {
          source: 'text-heuristic',
          note: '停顿由文本标记与语速启发式估算，标点和省略号不等于真实停顿时长',
        });
        // knowledge 只能来自规则引擎，模型不得覆盖。
        // 原因：七环节是冻结契约（scheme=generic-seven-phase-cues-v1），
        // 模型一旦把「逆定理」「勾股定理公式」这类学科知识点写进 covered/missing，
        // 就会污染七环节体系，让「教学环节覆盖」被读成「学科知识覆盖」。
        merged.knowledge = {
          ...base.knowledge,
          covered: base.knowledge.covered.slice(),
          missing: base.knowledge.missing.slice(),
          cover_percent: base.knowledge.cover_percent,
          scheme: base.knowledge.scheme,
          source: base.knowledge.source,
        };
        // 学科知识点单独成一套（subject_knowledge）。
        // 模型可以给线索，但每条证据必须是逐字稿里的原样子串 —— 不伪造证据。
        merged.subject_knowledge = normalizeSubjectKnowledge(json.subject_knowledge, transcript);
        // 降级原因由后端判定，模型不得自曝（防止模型伪造「我是限流」）。
        // 必须在合并之后写：json 里若混进了 fallback_reason，不能让它生效。
        merged.fallback_reason = FALLBACK_REASON.NONE;
        return merged;
      }
      throw new Error('模型未返回合法 JSON');
    } catch (err) {
      fallbackReason = classifyFallbackReason(err);
      warn('analyze', err);
    }
  }
  const report = analyzeRule(input);
  report.engine = 'rule';
  report.fallback_reason = fallbackReason;
  return report;
}

/* ---------------- 模块三：改进建议 ---------------- */
async function improve(input = {}) {
  const transcript = String(input.transcript || '').trim();
  if (transcript.length < 5) throw bizError('讲稿内容太短，无法生成改进稿');

  const analysis = input.analysis || analyzeRule(input);

  const modelAvailable = ai.hasKey();
  let fallbackReason = modelAvailable
    ? FALLBACK_REASON.MODEL_ERROR
    : FALLBACK_REASON.KEY_NOT_CONFIGURED;
  if (modelAvailable) {
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
        const merged = Object.assign({}, base, json);
        // 降级原因由后端判定，模型不得自曝（必须在合并之后写）
        merged.fallback_reason = FALLBACK_REASON.NONE;
        return merged;
      }
      throw new Error('模型未返回合法 JSON');
    } catch (err) {
      fallbackReason = classifyFallbackReason(err);
      warn('improve', err);
    }
  }
  const result = improveScriptRule({ transcript, analysis, subject: input.subject });
  result.engine = 'rule';
  result.fallback_reason = fallbackReason;
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

  const modelAvailable = ai.hasKey();
  let fallbackReason = modelAvailable
    ? FALLBACK_REASON.MODEL_ERROR
    : FALLBACK_REASON.KEY_NOT_CONFIGURED;
  if (modelAvailable) {
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
          fallback_reason: FALLBACK_REASON.NONE,
        };
      }
      throw new Error('模型返回为空');
    } catch (err) {
      fallbackReason = classifyFallbackReason(err);
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
    fallback_reason: fallbackReason,
  };
}

/* ---------------- 模块二·专项：提问与追问训练评价 ---------------- */
const QUESTION_DRILL_RUBRIC = Object.freeze([
  'clear_question_task',
  'expression_space',
  'follow_up_adaptation',
]);

const QUESTION_DRILL_BOUNDARY_NOTE =
  '以上仅为文本和对话行为指标，不代表已经测得学生的真实理解。';

function normalizeDrillMessages(messages) {
  if (!Array.isArray(messages)) return [];

  return messages
    .filter((message) =>
      message &&
      (message.role === 'teacher' || message.role === 'student') &&
      typeof message.content === 'string'
    )
    .slice(-8)
    .map((message) => ({
      role: message.role,
      content: message.content.trim().slice(0, 1000),
    }))
    .filter((message) => message.content);
}

function unavailableDrillEvaluation(reason) {
  return {
    status: 'unavailable',
    reason,
    dimensions: [],
    summary: '本次未能生成有效评价。对话记录可以保留，稍后可重试评价。',
    boundary_note: QUESTION_DRILL_BOUNDARY_NOTE,
    rubric_version: 'question-drill-v1',
  };
}

function validateDrillEvaluation(raw, messages) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  const sourceQuotes = messages
    .filter((message) => message.role === 'teacher')
    .map((message) => message.content);

  if (!Array.isArray(raw.dimensions)) return null;

  const byKey = new Map();
  raw.dimensions.forEach((item) => {
    if (item && typeof item.key === 'string') {
      byKey.set(item.key, item);
    }
  });

  const dimensions = [];

  for (const key of QUESTION_DRILL_RUBRIC) {
    const item = byKey.get(key);
    if (!item) return null;

    const score = Number(item.score);
    if (!Number.isInteger(score) || score < 0 || score > 2) return null;

    const quote =
      typeof item.evidence_quote === 'string'
        ? item.evidence_quote.trim()
        : '';

    // 评价引用必须来自实际教师发言，不能接受模型编造的证据。
    if (quote && !sourceQuotes.some((source) => source.includes(quote))) {
      return null;
    }

    dimensions.push({
      key,
      score,
      evidence_quote: quote,
      feedback:
        typeof item.feedback === 'string'
          ? item.feedback.trim().slice(0, 500)
          : '',
    });
  }

  return {
    status: 'complete',
    dimensions,
    summary:
      typeof raw.summary === 'string'
        ? raw.summary.trim().slice(0, 1000)
        : '',
    boundary_note: QUESTION_DRILL_BOUNDARY_NOTE,
    rubric_version: 'question-drill-v1',
  };
}

async function questionDrillStudent(input = {}) {
  const messages = normalizeDrillMessages(input.messages);
  const misconceptionKey =
    QUESTION_DRILL_MISCONCEPTIONS[input.misconceptionKey]
      ? input.misconceptionKey
      : 'fixed_formula';

  const topic = String(input.topic || '本节课').trim().slice(0, 120);
  const quote = String(input.quote || '').trim().slice(0, 500);

  if (!quote) {
    throw bizError('请先选择或输入一段待练原句');
  }

  const modelAvailable = ai.hasKey();

  if (modelAvailable) {
    try {
      const system = questionDrillStudentSystem({
        topic,
        quote,
        misconceptionKey,
      });

      const llmMessages = [{ role: 'system', content: system }].concat(
        messages.map((message) => ({
          role: message.role === 'student' ? 'assistant' : 'user',
          content: message.content,
        }))
      );

      if (!messages.length) {
        const misconception =
          QUESTION_DRILL_MISCONCEPTIONS[misconceptionKey].misconception;
        llmMessages.push({
          role: 'user',
          content:
            '请基于固定误区“' + misconception + '”，开始本轮模拟回应。',
        });
      }

      const raw = await ai.chat(llmMessages, {
        temperature: 0.5,
        maxTokens: 160,
      });

      const reply = String(raw || '')
        .replace(/```/g, '')
        .replace(/^["'「」]|["'「」]$/g, '')
        .trim()
        .slice(0, 500);

      if (!reply) throw new Error('模拟学生返回为空');

      return {
        reply,
        persona: 'question-drill',
        engine: 'llm',
        misconception_key: misconceptionKey,
        rubric_version: 'question-drill-v1',
      };
    } catch (error) {
      warn('question-drill-student', error);
    }
  }

  const profile = QUESTION_DRILL_MISCONCEPTIONS[misconceptionKey];
  const reply = messages.some((message) => message.role === 'student')
    ? '我还是不太确定。你能根据我刚才的想法再问我一步吗？'
    : profile.firstReply;

  return {
    reply,
    persona: 'question-drill',
    engine: 'rule',
    misconception_key: misconceptionKey,
    rubric_version: 'question-drill-v1',
  };
}

async function questionDrillEvaluate(input = {}) {
  const messages = normalizeDrillMessages(input.messages);
  const teacherMessages = messages.filter(
    (message) => message.role === 'teacher'
  );

  if (!teacherMessages.length) {
    return unavailableDrillEvaluation('no-teacher-messages');
  }

  if (!ai.hasKey()) {
    return unavailableDrillEvaluation('model-not-configured');
  }

  try {
    const raw = await ai.chat(
      [
        {
          role: 'user',
          content: questionDrillEvaluationPrompt({
            goal: input.goal,
            quote: input.quote,
            messages,
          }),
        },
      ],
      {
        temperature: 0.1,
        maxTokens: 1200,
      }
    );

    const parsed = ai.extractJson(raw);
    const result = validateDrillEvaluation(parsed, messages);

    if (!result) {
      return unavailableDrillEvaluation('invalid-evaluation-response');
    }

    return result;
  } catch (error) {
    warn('question-drill-evaluate', error);
    return unavailableDrillEvaluation('evaluation-request-failed');
  }
}

/* ---------------- 模块四：课堂崩塌模拟 ---------------- */
/* 抽一张事件卡（按教学环节加权 / 失控升级），生成学生的第一反应 */
async function crisisStart(input = {}) {
  // 失控升级判定：连续应对失分 → 课堂升级为全班失控
  if (crisis.shouldEscalate(input.scoreHistory) && input.lastEventId !== crisis.ESCALATION.to) {
    const ev = crisis.ESCALATION;
    let studentSay = '老师管不住啦——哈哈哈哈！';
    // 引擎标签必须诚实：模型真的出了台词才标 llm，否则标 rule 并给出降级原因。
    let engine = 'rule';
    let fallbackReason = FALLBACK_REASON.KEY_NOT_CONFIGURED;
    if (ai.hasKey()) {
      fallbackReason = FALLBACK_REASON.MODEL_ERROR;
      try {
        const raw = await ai.chat(
          [{ role: 'user', content: `你扮演一名中学生，课堂因为老师没处理好刚才的事故彻底失控了，全班起哄。
输出一句最真实的全班起哄声中你喊的话（≤25字，口语，只输出这句话本身）。` }],
          { temperature: 0.95, maxTokens: 120 }
        );
        const t = String(raw).replace(/["'「」]/g, '').trim();
        if (t) { studentSay = t; engine = 'llm'; fallbackReason = FALLBACK_REASON.NONE; }
      } catch (e) {
        fallbackReason = classifyFallbackReason(e);
      }
    }
    return {
      event: { id: ev.to, title: ev.title, desc: ev.desc, hint: ev.hint, escalated: true },
      student_say: studentSay,
      engine,
      fallback_reason: fallbackReason,
    };
  }

  const ev = input.eventId
    ? crisis.CRISIS_EVENTS.find((e) => e.id === input.eventId)
    : crisis.pickEventByPhase(input.round, input.lastEventId);
  if (!ev) throw bizError('事件不存在');

  let studentSay = ev.fallback_replies[0];
  let engine = 'rule';
  let fallbackReason = FALLBACK_REASON.KEY_NOT_CONFIGURED;
  if (ai.hasKey()) {
    fallbackReason = FALLBACK_REASON.MODEL_ERROR;
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
      if (t) { studentSay = t; engine = 'llm'; fallbackReason = FALLBACK_REASON.NONE; }
    } catch (e) {
      fallbackReason = classifyFallbackReason(e);
    }
  }
  return {
    event: { id: ev.id, title: ev.title, desc: ev.desc, hint: ev.hint },
    student_say: studentSay,
    engine,
    fallback_reason: fallbackReason,
  };
}

/* 老师应对 → FIAS 控场评分（LLM 优先，规则保底） */
async function crisisRespond(input = {}) {
  const eventId = input.eventId;
  const response = String(input.response || '').trim();
  if (!response) throw bizError('请先输入你的应对');

  const modelAvailable = ai.hasKey();
  let fallbackReason = modelAvailable
    ? FALLBACK_REASON.MODEL_ERROR
    : FALLBACK_REASON.KEY_NOT_CONFIGURED;
  if (modelAvailable) {
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
          fallback_reason: FALLBACK_REASON.NONE,
        };
      }
      throw new Error('bad json');
    } catch (e) {
      fallbackReason = classifyFallbackReason(e);
    }
  }
  const r = crisis.ruleScoreResponse(eventId, response);
  r.model_answer = '先接住情绪（"老师看到了，你们先冷静一下"），再快速回到教学主线，课后单独处理。';
  r.engine = 'rule';
  r.fallback_reason = fallbackReason;
  return r;
}

/* ---------------- 模块五：双人对比 / 小组博弈 ---------------- */
async function compare(input = {}) {
  const a = String(input.transcriptA || '').trim();
  const b = String(input.transcriptB || '').trim();
  if (a.length < 5 || b.length < 5) throw bizError('两份讲稿都需要至少 5 个字');

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

  const modelAvailable = ai.hasKey();
  let fallbackReason = modelAvailable
    ? FALLBACK_REASON.MODEL_ERROR
    : FALLBACK_REASON.KEY_NOT_CONFIGURED;
  if (modelAvailable) {
    try {
      const raw = await ai.chat([{ role: 'user', content: prompt }], { temperature: 0.4, maxTokens: 900 });
      const json = ai.extractJson(raw);
      // fallback_reason 放在最后写：模型不得自曝降级原因
      if (json && json.winner) return { ...json, engine: 'llm', fallback_reason: FALLBACK_REASON.NONE };
      throw new Error('bad json');
    } catch (e) {
      fallbackReason = classifyFallbackReason(e);
    }
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
    fallback_reason: fallbackReason,
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

  const modelAvailable = ai.hasKey();
  let fallbackReason = modelAvailable
    ? FALLBACK_REASON.MODEL_ERROR
    : FALLBACK_REASON.KEY_NOT_CONFIGURED;
  if (modelAvailable) {
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
          fallback_reason: FALLBACK_REASON.NONE,
        };
      }
      throw new Error('bad json');
    } catch (e) {
      fallbackReason = classifyFallbackReason(e);
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
    fallback_reason: fallbackReason,
  };
}

/* ---------------- 课堂点名：点谁谁答 ---------------- */
/**
 * 本地兜底话术。四个质量档 × 三个人设 = 12 句，刻意都写成"学生腔"：
 * 小皮先讨价还价，小霸答完还追问，小走先慌再答非所问。
 * 这些话术不是给模型看的，是没 Key / 模型挂了时唯一能撑住演示的东西，
 * 所以每一句都必须能独立成立，不能依赖上下文。
 */
const CALL_ON_SCRIPTS = {
  naughty: {
    good: ['……行吧我试试。是不是先把两边同时除以二？'],
    partial: ['凭什么是我啊……那个，是不是跟上一题差不多？'],
    poor: ['啊？我还没看完题呢，老师你叫我干嘛。'],
    offtopic: ['老师，这个期末考试考吗？'],
  },
  geek: {
    good: ['先设未知数再代入，跟上次那题一个套路。那系数是负数的时候，这步还成立吗？'],
    partial: ['思路我大概有，但中间那个换元我没太跟上。'],
    poor: ['这块我预习的时候没看到，我先听别人说。'],
    offtopic: ['老师，这个能不能用后面的知识做？'],
  },
  drift: {
    good: ['啊、我？……哦，是把那个移到右边去吧？'],
    partial: ['我听到一半走神了，是从第二步开始变的吗？'],
    poor: ['啊？我？……什么题？'],
    offtopic: ['老师，现在几点了。'],
  },
};

const CALL_ON_MOOD = {
  good: '😊',
  partial: '🤔',
  poor: '😵',
  offtopic: '🙄',
};

/* 质量档对分数的推力。答得好不只是"不扣分"，是真的让专注度回来一点。 */
const CALL_ON_SCORE_SHIFT = {
  good: { attention: 10, comprehension: 14 },
  partial: { attention: 2, comprehension: 4 },
  poor: { attention: -4, comprehension: -8 },
  offtopic: { attention: -8, comprehension: -10 },
};

/* 质量档对课堂压力的推力。答崩比答错更伤——答非所问会让整个班觉得"这课没人管"。 */
const CALL_ON_PRESSURE = {
  good: { delta: -8, reason: '点名答得利落，课堂稳住了' },
  partial: { delta: 2, reason: '答得不完整，还得再补一句' },
  poor: { delta: 6, reason: '点名卡住，其他学生开始走神' },
  offtopic: { delta: 9, reason: '答非所问，课堂节奏被打断' },
};

/**
 * 规则兜底的应答质量判定。
 * 只有两条输入真正起作用：人设基线 + 老师有没有给提示。
 * 学情只做上下调一档——弱档班里小皮答得出来反而假。
 */
function callOnQualityRule(key, hasHint, level) {
  const base = key === 'geek' ? 'good' : key === 'drift' ? 'poor' : 'partial';
  const order = ['poor', 'partial', 'good'];
  let idx = order.indexOf(base === 'offtopic' ? 'poor' : base);
  if (base === 'poor') idx = 0;
  if (hasHint) idx += 1;
  if (level === 'weak') idx -= 1;
  if (level === 'excellent') idx += 1;
  idx = Math.max(0, Math.min(order.length - 1, idx));
  // 小走即使在优秀班、给了提示，也不会一跃变成 good——他一直没跟上。
  if (key === 'drift' && idx >= 2) idx = 1;
  return order[idx];
}

async function classroomCallOn(input = {}) {
  const key = STUDENT_KEYS.indexOf(input.key) !== -1 ? input.key : '';
  if (!key) throw bizError('未知的学生角色：' + String(input.key || ''), 400);

  const history = Array.isArray(input.history) ? input.history : [];
  const roundNo = Math.floor(history.filter((m) => m.role === 'student').length / 3) + 1;
  const hasProfile = !!(input.profile && typeof input.profile === 'object');
  const profile = hasProfile ? normalizeProfile(input.profile) : null;
  const levelParams = profile ? deriveLevelParams(profile.class.level, profile.class.activity, profile.class.size) : null;
  const levelLabel = profile ? (PROFILE_LABELS.level[profile.class.level] || PROFILE_LABELS.level.good) : '';
  const meta = CLASS_STUDENTS.find((x) => x.key === key) || { name: key };

  const ctx = {
    key,
    topic: input.topic,
    roundNo,
    pressure: input.pressure,
    callInstruction: String(input.callInstruction || '').slice(0, 80),
    recentChunk: String(input.transcript || '').slice(-1200),
    profile,
    recentDialogue: history
      .slice(-8)
      .map((m) => (m.role === 'teacher' ? '老师：' : '学生：') + String(m.content || '').slice(0, 120))
      .join('\n'),
  };

  const modelAvailable = ai.hasKey();
  let fallbackReason = modelAvailable ? FALLBACK_REASON.MODEL_ERROR : FALLBACK_REASON.KEY_NOT_CONFIGURED;

  if (modelAvailable) {
    try {
      const raw = await ai.chat(
        [{ role: 'user', content: classroomCallOnPrompt(ctx) }],
        { temperature: 0.9, maxTokens: 400 }
      );
      const json = ai.extractJson(raw);
      // 闸门：模型必须回同一个学生。回错人比回空更糟——老师点的是小走，答话的却是小霸，
      // 这种"张冠李戴"在试讲复盘里会直接毁掉可信度，所以宁可降级。
      const line = json && String(json.line || '').trim();
      if (json && json.key === key && line) {
        const quality = ['good', 'partial', 'poor', 'offtopic'].indexOf(json.answer_quality) !== -1
          ? json.answer_quality
          : callOnQualityRule(key, !!ctx.callInstruction, profile ? profile.class.level : '');
        const base = { attention: json.attention, comprehension: json.comprehension };
        const st = normStudentState(
          { key, mood: json.mood || CALL_ON_MOOD[quality], line, state_reason: json.state_reason },
          ctx.pressure, '', profile
        );
        if (isFinite(Number(base.attention))) st.attention = clampPct(base.attention);
        if (isFinite(Number(base.comprehension))) st.comprehension = clampPct(base.comprehension);
        const p = CALL_ON_PRESSURE[quality];
        st.answer_quality = quality;
        st.name = meta.name;
        st.pressure_delta = clampSigned(Number(json.pressure_delta) || p.delta, -20, 20);
        st.pressure_reason = String(json.pressure_reason || p.reason).slice(0, 30);
        return Object.assign(withProfileFields(st, levelParams, levelLabel, profile), {
          engine: 'llm',
          profile_applied: hasProfile,
          fallback_reason: FALLBACK_REASON.NONE,
        });
      }
      throw new Error('bad json');
    } catch (e) {
      fallbackReason = classifyFallbackReason(e);
      console.warn('[callon] 降级本地：', e.message);
    }
  }

  // 本地兜底
  return classroomCallOnRule(input, fallbackReason);
}

/**
 * 点名的本地规则分支（拆出来是为了能零网络跑测试）。
 * 调用方只需保证 key 合法；其余字段缺失都有默认值。
 * @param {object} input { key, callInstruction, pressure, history, profile }
 * @param {string} fallbackReason 从上层传下来的真实降级原因（不许在这里编造）
 */
function classroomCallOnRule(input = {}, fallbackReason = FALLBACK_REASON.KEY_NOT_CONFIGURED) {
  const key = STUDENT_KEYS.indexOf(input.key) !== -1 ? input.key : 'naughty';
  const history = Array.isArray(input.history) ? input.history : [];
  const hasProfile = !!(input.profile && typeof input.profile === 'object');
  const profile = hasProfile ? normalizeProfile(input.profile) : null;
  const levelParams = profile ? deriveLevelParams(profile.class.level, profile.class.activity, profile.class.size) : null;
  const levelLabel = profile ? (PROFILE_LABELS.level[profile.class.level] || PROFILE_LABELS.level.good) : '';
  const meta = CLASS_STUDENTS.find((x) => x.key === key) || { name: key };

  const hasHint = String(input.callInstruction || '').trim().length > 0;
  const quality = callOnQualityRule(key, hasHint, profile ? profile.class.level : '');
  const pool = CALL_ON_SCRIPTS[key] || CALL_ON_SCRIPTS.naughty;
  const line = pool[quality] || pool.partial;
  const shift = CALL_ON_SCORE_SHIFT[quality];
  const st = normStudentState(
    { key, mood: CALL_ON_MOOD[quality], line, state_reason: callOnReason(quality, hasHint) },
    input.pressure, '', profile
  );
  st.attention = clampPct(st.attention + shift.attention);
  st.comprehension = clampPct(st.comprehension + shift.comprehension);
  const p = CALL_ON_PRESSURE[quality];
  return Object.assign(withProfileFields(st, levelParams, levelLabel, profile), {
    answer_quality: quality,
    name: meta.name,
    pressure_delta: p.delta,
    pressure_reason: p.reason,
    engine: 'rule',
    profile_applied: hasProfile,
    fallback_reason: fallbackReason,
  });
}

function callOnReason(quality, hasHint) {
  if (quality === 'good') return hasHint ? '顺着提示答上来了' : '自己想到了这一步';
  if (quality === 'partial') return '答了一半，还差一步';
  if (quality === 'poor') return '被点到，没跟上';
  return '答非所问，注意力飘了';
}

function clampSigned(v, lo, hi) {
  const n = Number(v);
  if (!isFinite(n)) return 0;
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

/* ---------------- 模块八：危险瞬间摘录 ---------------- */
async function dangerMoments(input = {}) {
  const transcript = String(input.transcript || '').trim();
  // 讲稿太短：没有可摘录的内容，也没有调用过模型 → 不算降级
  if (transcript.length < 10) return { moments: [], engine: 'rule', fallback_reason: FALLBACK_REASON.NONE };

  const modelAvailable = ai.hasKey();
  let fallbackReason = modelAvailable
    ? FALLBACK_REASON.MODEL_ERROR
    : FALLBACK_REASON.KEY_NOT_CONFIGURED;
  if (modelAvailable) {
    try {
      const raw = await ai.chat(
        [{ role: 'user', content: dangerPrompt({ transcript: transcript.slice(0, 6000) }) }],
        { temperature: 0.3, maxTokens: 900 }
      );
      const json = ai.extractJson(raw);
      if (json && Array.isArray(json.moments) && json.moments.length > 0) {
        return { moments: json.moments.slice(0, 6), engine: 'llm', fallback_reason: FALLBACK_REASON.NONE };
      }
      throw new Error('bad json');
    } catch (e) {
      fallbackReason = classifyFallbackReason(e);
    }
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
  // 确认式提问数：优先用分析结果；旧数据/演示数据里没有该字段时，从讲稿现场数一遍。
  const FAKE_Q = ['听懂了吗', '理解了吗', '明白了吗', '对不对', '好不好', '行不行', '跟上没有', '算不算'];
  const askedCount =
    q && q.asked != null
      ? Number(q.asked)
      : (transcript.match(/[？?]/g) || []).length;
  const fakeCount =
    q && q.fake_questions != null
      ? Number(q.fake_questions)
      : FAKE_Q.reduce((sum, w) => sum + transcript.split(w).length - 1, 0);
  if (askedCount > 0 && fakeCount > 0) {
    moments.push({
      type: '确认式提问',
      quote: '讲稿中存在 ' + fakeCount + ' 个确认式提问',
      reason:
        '文本中出现“明白吗”“对不对”等确认式提问，无法仅凭讲稿判断真实等待时间。',
      fix:
        '改成点名加思考任务，例如“李同学，你说说这一步为什么这样做”。',
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
  return { moments, engine: 'rule', fallback_reason: fallbackReason };
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
  if (!skill) throw bizError('请选择要练习的技能');
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

  const modelAvailable = ai.hasKey();
  let fallbackReason = modelAvailable
    ? FALLBACK_REASON.MODEL_ERROR
    : FALLBACK_REASON.KEY_NOT_CONFIGURED;
  if (modelAvailable) {
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
      if (valid) {
        // 降级原因由后端判定，模型不得自曝
        valid.fallback_reason = FALLBACK_REASON.NONE;
        return valid;
      }
      throw new Error('模型返回的维度不可用');
    } catch (err) {
      fallbackReason = classifyFallbackReason(err);
      warn('drill', err);
    }
  }

  const result = drillRule({
    skill,
    transcript: trimmed,
    durationSec,
    profile,
    subject: input.subject,
    grade: input.grade,
  });
  result.fallback_reason = fallbackReason;
  return result;
}

/* ---------------- Codex 助手（形态 B） ----------------
 * 面向师范生的「Codex 教学教练」对话：生成改进逐字稿、板书建议、分层作业、教学话术等。
 * 双引擎：配了 CODEX_* 走 Codex，否则/失败自动降级 DeepSeek（lib/codex.js 内部处理）。
 */
async function codex(input = {}) {
  const prompt = String(input.prompt || '').trim();
  if (!prompt) throw new Error('缺少 prompt 字段');

  const context = String(input.context || '').slice(0, 8000);
  const history = Array.isArray(input.history) ? input.history.slice(-10) : [];

  const system =
    '你是「讲台求生」的 Codex 教学教练助手，服务对象是参加试讲训练的师范生。\n' +
    '你的任务：基于课堂讲稿/复盘数据，给出可直接落地的教学改进建议。\n' +
    '要求：1) 紧扣课标与学情，不空谈理论；2) 输出结构清晰（分点/分场景）；' +
    '3) 改进逐字稿要口语化、能直接念；4) 涉及学生互动时给出具体提问话术与预期回答；' +
    '5) 中文回答，避免英文术语堆砌。';

  const messages = [{ role: 'system', content: system }];
  for (const h of history) {
    messages.push({
      role: h.role === 'assistant' ? 'assistant' : 'user',
      content: String(h.content || '').slice(0, 2000),
    });
  }
  if (context) {
    messages.push({ role: 'system', content: `【参考上下文（讲稿/复盘/学情）】\n${context}` });
  }
  messages.push({ role: 'user', content: prompt });

  const r = await codexClient.chat(messages, { temperature: 0.7, maxTokens: 2048 });
  return {
    reply: r.text,
    engine: r.engine,            // 'codex' | 'deepseek-fallback'
    model: r.model,
    codexFellBack: !!r.codexFellBack,
  };
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
  panorama, compare, blackboard, classroomRound, classroomCallOn, dangerMoments,
  classroomMetricsView, lessonPlan, curriculum, hollow, ifias, ifiasBatch, mode,
  drill, drillSkills, profileDefaults, questionDrillStudent, questionDrillEvaluate,
  codex, codexMode: codexClient.mode,
  // 内部规整函数：导出供契约测试直接校验（不属于对外接口）
  normalizeSubjectKnowledge, SUBJECT_SCOPE_NOTE,
  // 点名的本地规则分支：导出供测试零网络直接跑（不属于对外接口）
  classroomCallOnRule,
  // 降级原因相关的内部判定：导出供契约测试直接校验（不属于对外接口）
  FALLBACK_REASON, classifyFallbackReason,
  isRateLimitError, isInsufficientBalanceError, isAuthError, isNoKeyError,
  withFallback,
};
