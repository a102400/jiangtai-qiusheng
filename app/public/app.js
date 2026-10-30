'use strict';

/* ==================================================================
   讲台求生 · 全栈版前端
   所有 AI 能力都通过同源 /api/* 接口完成，前端不持有任何密钥。
   ================================================================== */

const SAMPLE =
  '同学们好，那个，今天我们一起来学习勾股定理。然后大家看大屏幕，这里有一个直角三角形，' +
  '直角边分别是 a 和 b，然后斜边是 c。就是我们在古代的时候，中国古代的数学家就发现了这个问题，' +
  '那个西周的商高就提出过「勾三股四弦五」。然后我们来看一下这个公式，就是 a 的平方加 b 的平方等于 c 的平方。' +
  '好，我问大家一个问题，这公式大家能理解吗？……那我们继续。然后我们来做一道例题，' +
  '就是一个直角三角形的两条直角边分别是 3 和 4，然后求斜边。代入我们的公式就是 3 的平方加 4 的平方等于 25，' +
  '所以斜边就是 5。就是这样的。然后大家记住这个结论就可以了，考试可能会考。' +
  '那个今天我们作业是课后练习题第一题到第五题。好，下课。';

/* ---------- DOM ---------- */
const $ = (id) => document.getElementById(id);

const subjectInput = $('subjectInput');
const gradeInput = $('gradeInput');
const subjectKeyInput = $('subjectKeyInput');
const compareToggle = $('compareToggle');
const scriptInputB = $('scriptInputB');
const scriptBWrap = $('scriptBWrap');
const durationInput = $('durationInput');
const scriptInput = $('scriptInput');

/* ==================================================================
   等待秒数口径（唯一事实来源）
   ------------------------------------------------------------------
   没有音频时间戳 → 真实等待时间「不可测量」。
   讲稿文本推算出来的秒数只是启发式推断，不能冒充实测值，
   也不允许参与「最弱维度」判断或达标判断。
   唯一允许显示具体秒数的场景是固定演示（?jtq-demo=1），
   且界面必须标注「示例」。
   ================================================================== */
function waitSecondsForDisplay(q, isDemo) {
  const payload = Number(q && q.avg_wait_sec);

  if (Number.isFinite(payload) && payload >= 0) return payload;

  // 只有固定演示才允许退回内置示例值；正常分析一律「不可测量」。
  if (!isDemo) return null;

  // 演示模式：后端可能不再下发 avg_wait_sec，退回内置演示值（固定示例）。
  const demoQ =
    window.JTQDemo &&
    window.JTQDemo.DEMO_ANALYSIS &&
    window.JTQDemo.DEMO_ANALYSIS.questions;

  if (!demoQ) return null;

  const demo = Number(demoQ.avg_wait_sec);
  return Number.isFinite(demo) && demo >= 0 ? demo : null;
}

/*
 * 时长来源标注。
 * 后端只要 durationSec 非 0 就按 'user-duration' 计算，但这个值可能来自
 * 视频转写自动读取，而不是用户真的知道试讲有多长。两者含义不同，
 * 因此在界面上明确区分，避免把媒体时长当成用户提供的时长。
 */
let durationSource = 'empty';

function markDurationSource(source, message) {
  durationSource = source;

  const hint = $('durationSourceHint');
  if (!hint) return;

  if (message) {
    hint.textContent = message;
  }

  if (durationInput) {
    durationInput.setAttribute('data-duration-source', source);
  }
}

if (durationInput) {
  // 用户手动修改 → 以用户填写为准
  durationInput.addEventListener('input', function () {
    if (!durationInput.value.trim()) {
      markDurationSource(
        'empty',
        '请填写与本次逐字稿对应的总时长；平均语速将包含其中的停顿和互动时间。'
      );
      return;
    }

    markDurationSource(
      'user',
      '时长由你填写。平均语速 = 非空白字数 ÷ 该时长，属于整体平均值。'
    );
  });
}
const fillSampleBtn = $('fillSampleBtn');
const analyzeBtn = $('analyzeBtn');
const analyzeBtnText = $('analyzeBtnText');
const charHint = $('charHint');
const errTip = $('errTip');

const resultEmpty = $('resultEmpty');
const resultBody = $('resultBody');
const scoreRing = $('scoreRing');
const scoreNum = $('scoreNum');
const scoreSummary = $('scoreSummary');
const engineTag = $('engineTag');
const metricsGrid = $('metricsGrid');
const transcriptHi = $('transcriptHi');
const suggestionsList = $('suggestionsList');

const improveBtn = $('improveBtn');
const improveEmpty = $('improveEmpty');
const improveBody = $('improveBody');
const keyChanges = $('keyChanges');
const improvedScript = $('improvedScript');
const blackboardBox = $('blackboardBox');
const homeworkBox = $('homeworkBox');
const nextFocusBox = $('nextFocusBox');

const personaBar = $('personaBar');
const chatLog = $('chatLog');
const chatForm = $('chatForm');
const chatInput = $('chatInput');
const askBtn = $('askBtn');
const clearChatBtn = $('clearChatBtn');

// 新增功能相关元素
const videoFile = $('videoFile');
const uploadBtn = $('uploadBtn');
const uploadTip = $('uploadTip');
const curveBox = $('curveBox');
const themeBtn = $('themeBtn');
const autoDemoBtn = $('autoDemoBtn');
const speakToggle = $('speakToggle');

/* ---------- 状态 ---------- */
let lastScript = '';
let lastSubject = '';
let lastAnalysis = null;
let currentPersona = 'naughty';
let messages = []; // [{role:'teacher'|'student', content}]

/* ---------- 工具 ---------- */
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function highlight(text, words) {
  let html = escapeHtml(text);
  words.forEach((w) => {
    const safe = escapeHtml(w);
    if (safe) html = html.split(safe).join('<mark>' + safe + '</mark>');
  });
  return html;
}

/* ---------- 口头禅排行榜（12） ---------- */
function renderFillerRank(f) {
  const box = $('fillerRankBox');
  if (!box) return;
  const detail = (f && f.detail) || {};
  const list = Object.keys(detail)
    .map((w) => ({ word: w, n: detail[w] || 0 }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n);
  const total = f && f.total != null ? f.total : list.reduce((s, x) => s + x.n, 0);

  if (!list.length) {
    box.innerHTML = '<div class="fr-empty">✓ 本次没有检测到口头禅，继续保持。</div>';
    return;
  }
  const chars = String(lastScript || '').replace(/\s/g, '').length || 1;
  const density = ((total / chars) * 100).toFixed(1);
  const max = list[0].n || 1;
  const chips = list.slice(0, 8).map((x, i) => {
    const level = x.n >= 5 ? 'hot' : x.n >= 3 ? 'warm' : 'cool';
    const pct = Math.max(18, Math.round((x.n / max) * 100));
    return '<div class="fr-chip ' + level + '" title="「' + escapeHtml(x.word) + '」出现 ' + x.n + ' 次">' +
      '<span class="fr-rank">' + (i + 1) + '</span>' +
      '<span class="fr-word">' + escapeHtml(x.word) + '</span>' +
      '<span class="fr-bar"><i style="width:' + pct + '%"></i></span>' +
      '<b class="fr-n">' + x.n + '</b>' +
      '</div>';
  }).join('');
  const top = list[0].word;
  box.innerHTML =
    '<div class="fr-head">共 <b>' + total + '</b> 处 · 平均每 100 字 <b>' + density + '</b> 处' +
    (total >= 10 ? ' · <span style="color:#dc2626">偏多，重点清理</span>' : '') + '</div>' +
    '<div class="fr-chips">' + chips + '</div>' +
    '<p class="fr-fix">把「' + escapeHtml(top) + '」换成 0.5 秒停顿，或用「大家想一想」过渡——第一句话的替换收益最大。</p>';
}

/* 固定演示页面：只有显式打开 ?jtq-demo=1 地址，才允许读取内置示例。
   正常训练路径不会因为接口报错而自动切换到演示数据。 */
const JTQ_DEMO_PAGE =
  new URLSearchParams(window.location.search).get('jtq-demo') === '1';

// 暂时保留旧变量，兼容文件内可能存在的其他引用。
// post() 不再根据该变量自动降级。
let offlineMode = JTQ_DEMO_PAGE;

function offlineFallback(url, body) {
  const D = window.JTQDemo || {};
  if (url === '/api/analyze') return D.DEMO_ANALYSIS;
  if (url === '/api/improve') return D.DEMO_IMPROVE;
  if (url === '/api/crisis/start') return D.DEMO_CRISIS;
  if (url === '/api/crisis/respond') return D.DEMO_CRISIS_SCORE;
  if (url === '/api/panorama') return D.DEMO_PANORAMA;
  if (url === '/api/classroom/round') {
    // 学情生效时用带学情的演示回合；没有学情时保持既有演示剧本不变。
    const p = body && body.profile;
    if (cfgProfileIsConfigured(p)) {
      return D.DEMO_CLASSROOM_PROFILE;
    }
    return D.DEMO_CLASSROOM;
  }
  if (url === '/api/classroom/call-on') {
    // 点名是按学生分流的：点谁就得回谁，返回同一个模板会让演示立刻露馅
    const all = D.DEMO_CLASS_CALLON || {};
    const key = body && body.key;
    return (key && all[key]) || all.naughty || null;
  }
  if (url === '/api/danger') return D.DEMO_DANGER;
  if (url === '/api/heatmap') return D.DEMO_HEATMAP;
  if (url === '/api/lesson-plan') return D.DEMO_LESSONPLAN;
  if (url === '/api/curriculum') return D.DEMO_CURRICULUM;
  if (url === '/api/hollow') return D.DEMO_HOLLOW;
  if (url === '/api/ifias') return D.DEMO_IFIAS;
  if (url === '/api/ifias-batch') return D.DEMO_IFIAS_BATCH;
  if (url === '/api/drill/skills') return D.DEMO_DRILL_SKILLS;
  if (url === '/api/drill') return D.DEMO_DRILL_RESULT;
  if (url === '/api/student/chat') {
    // 离线演示也必须「听得见老师刚说了什么」：
    // 之前带学情时无条件返回同一条固定台词，无论老师说哪一句都是同一句反问，
    // 演示时立刻露馅（看起来像没接模型）。这里按两点轮换：是否已有老师发言、第几轮。
    const list = Array.isArray(body && body.messages) ? body.messages : [];
    const teacherLines = list.filter((m) => m.role === 'teacher').map((m) => String(m.content || ''));
    const askedCount = list.filter((m) => m.role === 'student').length;
    const lastTeacher = teacherLines.length ? teacherLines[teacherLines.length - 1] : '';
    // 朴素回声：截老师原话开头，套进反问模板，让离线演示也有「接住你」的观感
    const echo = lastTeacher.replace(/[「」“”"'《》]/g, '').replace(/\s+/g, '');
    const tail = echo.length > 12 ? echo.slice(0, 12) + '…' : echo;
    const echoTemplates = [
      (t) => '老师你刚才说「' + t + '」，那要是条件换一下还成立吗？',
      (t) => '「' + t + '」这一步我没太跟上，是从这儿开始变的吗？',
      (t) => '老师你说「' + t + '」的时候有点快，能再说一遍吗？',
    ];
    const asks = ['老师，这个结论放到特殊情况还成立吗？', '如果我把条件反过来，答案会不会反过来？', '老师你讲太快了，能不能慢一点？'];
    const line = echo
      ? echoTemplates[askedCount % echoTemplates.length](tail)
      : asks[askedCount % asks.length];
    const hasProfile = !!(body && body.profile);
    return {
      reply: line,
      persona: hasProfile ? 'naughty' : 'geek',
      label: 'AI 学生',
      engine: 'offline-demo',
      profile_applied: hasProfile,
      difficulty: 'core',
      profile_summary: hasProfile ? '学情：中等 · 提问聚焦概念与常见错误' : '',
    };
  }
  if (url === '/api/blackboard') return { mode: 'checklist', checklist: ['主板书写课题与主问题', '推导编号分步', '副板书留给学生生成', '重点加框'], layout_template: '主板书 | 副板书', key_points: ['课题', '推导', '结论'], common_mistakes: ['随写随擦'], engine: 'offline-demo' };
  return null;
}

// 读取页面 URL 上的 sharecode 并透传给后端（与线上网关一致；本地无则不带）
function currentShareCode() {
  try {
    return new URLSearchParams(window.location.search).get('sharecode') || '';
  } catch (e) {
    return '';
  }
}

// 一份 profile 是否算「已配置」（演示数据分流用）：
// 除了 level 非默认，只要教学任务或学情里填了内容，也算用户确实配置过；
// 否则走既有默认演示剧本，保持既有演示文案不变。
function cfgProfileIsConfigured(p) {
  if (!p || typeof p !== 'object') return false;
  const task = p.task || {};
  const cls = p.class || {};
  const lvl = cls.level || p.level;
  if (lvl && lvl !== 'good') return true;
  if (String(task.topic || '').trim()) return true;
  const lists = [task.objectives, task.keyPoints, task.difficulties, cls.priorKnowledge, cls.commonErrors];
  if (lists.some((x) => Array.isArray(x) && x.length)) return true;
  if (task.lessonType && task.lessonType !== 'new') return true;
  if (task.assessment && task.assessment !== 'formative') return true;
  if (Number(task.durationMin) > 0) return true;
  if (Number(cls.size) > 0 && Number(cls.size) !== 45) return true;
  if (cls.activity && cls.activity !== 'mid') return true;
  return false;
}

async function post(url, body) {
  if (JTQ_DEMO_PAGE) {
    const example = offlineFallback(url, body || {});

    if (example == null) {
      throw new Error('该功能尚未提供固定演示数据：' + url);
    }

    // 深复制，避免页面逻辑修改共享的示例对象。
    const cloned = JSON.parse(JSON.stringify(example));

    if (!cloned || typeof cloned !== 'object' || Array.isArray(cloned)) {
      throw new Error('演示数据格式不正确：' + url);
    }

    // 统一补齐来源，不能依赖每份旧示例都已正确标记。
    cloned.engine = 'offline-demo';
    return cloned;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);

  try {
    let response;

    try {
      const sc = currentShareCode();
      const reqHeaders = { 'Content-Type': 'application/json' };
      if (sc) reqHeaders['X-Share-Code'] = sc;
      response = await fetch(url, {
        method: 'POST',
        headers: reqHeaders,
        body: JSON.stringify(body || {}),
        signal: controller.signal
      });
    } catch (error) {
      if (error && error.name === 'AbortError') {
        throw new Error(
          '请求超过 45 秒，已停止等待。请稍后重试；本次未使用演示数据替代。'
        );
      }

      throw new Error(
        '无法连接服务端，请检查网络和后端服务。本次未生成分析结果。'
      );
    }

    let json;

    try {
      json = await response.json();
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error('读取响应超时，请稍后重试。');
      }

      throw new Error(
        '服务端返回了非 JSON 内容，请检查后端或代理配置。'
      );
    }

    if (!response.ok) {
      const message =
        json && typeof json.error === 'string'
          ? json.error
          : '请求失败，HTTP ' + response.status;

      throw new Error(message);
    }

    if (!json || json.ok !== true || json.data == null) {
      const message =
        json && typeof json.error === 'string'
          ? json.error
          : '服务端响应格式不正确，请检查接口返回内容。';

      throw new Error(message);
    }

    // 正常训练不接受固定演示结果冒充真实分析。
    if (
      typeof json.data === 'object' &&
      json.data.engine === 'offline-demo'
    ) {
      throw new Error(
        '服务端返回了固定演示数据，已停止将其作为本次训练结果展示。'
      );
    }

    return json.data;
  } finally {
    clearTimeout(timer);
  }
}

function setErr(msg) {
  errTip.textContent = msg || '';
  errTip.className = msg ? 'tip err' : 'tip';
}

function busy(btn, text, original) {
  btn.disabled = true;
  if (analyzeBtnText && btn === analyzeBtn) analyzeBtnText.textContent = text;
  else btn.textContent = text;
  return () => {
    btn.disabled = false;
    if (analyzeBtnText && btn === analyzeBtn) analyzeBtnText.textContent = original;
    else btn.textContent = original;
  };
}

/* ---------- 健康检查（顶部徽章） ---------- */
async function loadHealth() {
  const dot = $('modeDot');
  const text = $('modeText');
  const model = $('modelBadge');

  if (JTQ_DEMO_PAGE) {
    if (dot) {
      dot.className = 'dot demo';
      dot.style.removeProperty('background');
    }
    if (text) text.textContent = '固定示例演示';
    if (model) model.textContent = '来源：内置示例，不代表个人分析';
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);

  try {
    const response = await fetch('/api/health', {
      signal: controller.signal,
      cache: 'no-store'
    });

    if (!response.ok) {
      throw new Error('健康检查失败');
    }

    const json = await response.json();

    if (dot) dot.style.removeProperty('background');

    if (json.aiMode === 'live') {
      if (dot) dot.className = 'dot live';
      if (text) text.textContent = '模型服务已配置';
      if (model) {
        model.textContent = '模型：' + (json.model || '未返回名称');
      }
    } else {
      if (dot) dot.className = 'dot demo';
      if (text) text.textContent = '服务端可用 · 规则模式';
      if (model) model.textContent = '来源：服务端规则计算';
    }
  } catch (error) {
    if (dot) {
      dot.className = 'dot';
      dot.style.removeProperty('background');
    }
    if (text) text.textContent = '后端未连接';
    if (model) model.textContent = '正常训练需连接后端';
  } finally {
    clearTimeout(timer);
  }
}

/* ==================================================================
   结果来源标签（唯一事实来源：后端 report.engine + report.fallback_reason）
   ------------------------------------------------------------------
   fallback_reason 只在「模型调用失败、降级到规则引擎」时出现，取值表与后端
   契约严格一致，不要自行扩充：
     none                  模型调用成功，没有发生降级
     key-not-configured   服务端没有配置 API Key
     rate-limited          上游 429，调用太频繁
     insufficient-balance  上游 402，账户余额不足
     auth-failed           上游 401/403，密钥无效
     model-error           其它模型调用失败
   旧报告（存于 localStorage 或云端）没有这个字段 → 走兜底分支，
   既不能报错，也不能显示 undefined。
   ================================================================== */

/* 真正「降级了」的原因：模型调了但失败，用户需要知道下一步该做什么。 */
const FALLBACK_REASON_DEGRADED = {
  'rate-limited': '模型请求过于频繁，请稍后重试',
  'insufficient-balance': '模型账户余额不足，请联系部署方充值',
  'auth-failed': '模型密钥无效，请联系部署方检查',
  'model-error': '模型请求失败，已降级'
};

/* 服务端压根没配 Key：不是「调了失败」，是纯规则模式。 */
const FALLBACK_REASON_KEY_NOT_CONFIGURED = 'key-not-configured';

function hasFallbackReason(reason) {
  return (
    typeof reason === 'string' &&
    Object.prototype.hasOwnProperty.call(FALLBACK_REASON_DEGRADED, reason)
  );
}

/**
 * 报告的「结果来源」标签。
 * 降级后返回的报告仍然是规则引擎的计算结果，所以文案先说清楚「规则计算」，
 * 再说降级原因，不能只显示一条错误信息让用户以为报告没生成。
 * @param {string} engine 后端报告里的 engine
 * @param {string} [fallbackReason] 后端报告里的 fallback_reason（可能缺失）
 * @returns {{className: string, text: string}}
 */
function describeSourceLabel(engine, fallbackReason) {
  const reason = typeof fallbackReason === 'string' ? fallbackReason : '';

  // 固定演示永远显示「固定示例」，绝不显示任何降级原因。
  if (engine === 'offline-demo') {
    return { className: 'demo', text: '固定示例 · 非对当前讲稿的分析' };
  }
  if (engine === 'llm') {
    return { className: 'llm', text: '模型生成 · 反馈需结合原文核对' };
  }

  // 板书评分既可能走视觉模型（上传图片），也可能走 LLM/规则，单独标注。
  if (engine === 'vision') {
    return { className: 'vision', text: '视觉模型评分 · 需人工复核' };
  }

  if (engine === 'rule' || engine === 'rules') {
    if (hasFallbackReason(reason)) {
      return {
        className: 'rule-degraded',
        text: '规则计算 · ' + FALLBACK_REASON_DEGRADED[reason]
      };
    }

    if (reason === FALLBACK_REASON_KEY_NOT_CONFIGURED) {
      return { className: 'rule', text: '服务端规则计算 · 未配置模型' };
    }

    // 旧报告 / 未知取值：只说清楚是规则计算，不编造降级原因。
    return { className: 'rule', text: '服务端规则计算 · 不等同于固定示例' };
  }

  return { className: '', text: '结果来源未明确 · 请先核对分析配置' };
}

/**
 * 其它模块（危险瞬间、教案覆盖、课标对照、专项练习…）的来源标签样式。
 * 各模块文案不同，但「是否降级、用哪种样式」必须走同一套判断。
 * @param {string} engine
 * @param {string} [fallbackReason]
 * @param {string} [fallbackClassName] 非降级时使用的样式名，默认 rule
 */
function sourceTagClassName(engine, fallbackReason, fallbackClassName) {
  const reason = typeof fallbackReason === 'string' ? fallbackReason : '';
  const fallback = fallbackClassName || 'rule';

  if (engine === 'llm') return 'llm';

  if (engine === 'rule' || engine === 'rules') {
    return hasFallbackReason(reason) ? 'rule-degraded' : fallback;
  }

  return fallback;
}

/** 降级原因的补充说明（供其它模块的来源说明复用）；没有降级时返回空串。 */
function degradedSuffix(fallbackReason) {
  if (!hasFallbackReason(fallbackReason)) return '';
  return ' · ' + FALLBACK_REASON_DEGRADED[fallbackReason];
}

/* 把「来源标签」渲染成一个 engine-tag 小徽标；无明确来源（engine 缺失/未知）时返回空串，
   绝不显示 undefined。供 heatmap / panorama / hollow / blackboard 四个模块复用，
   与 iFIAS / 教案覆盖 / 课标对照 走同一套口径（describeSourceLabel 是唯一事实来源）。 */
function sourceTagSpan(engine, fallbackReason) {
  const info = describeSourceLabel(engine, fallbackReason);
  if (!info || !info.text) return '';
  const cls = info.className || '';
  return '<span class="engine-tag' + (cls ? ' ' + cls : '') + '">' + escapeHtml(info.text) + '</span>';
}

/* 供 cloud.js 复用同一套逻辑（cloud.js 在 app.js 之前加载，只能运行时取用）。 */
window.JTQSourceLabel = {
  describe: describeSourceLabel,
  tagClass: sourceTagClassName,
  suffix: degradedSuffix
};

/* ---------- 分析 ---------- */
function renderAnalysis(report) {
  const q = report.questions || {};
  const f = report.filler_words || {};
  const k = report.knowledge || {};
  const r = report.speech_rate || {};
  const p = report.pauses || {};

  // 分数环 + 总分
  // 数字列滚动与环的 conic-gradient 由 countup.js 用同一根曲线推进（0 → score）。
  // 没有 countup.js（老缓存 / 被裁掉的构建）时退回落静态值，绝不显示空白。
  const score = report.overall_score || 0;
  if (window.jtqCount && typeof window.jtqCount.score === 'function') {
    window.jtqCount.score(score);
  } else {
    scoreNum.textContent = score;
    scoreRing.style.background =
      'conic-gradient(var(--brand) 0 ' + score + '%, var(--line) ' + score + '% 100%)';
  }

  // 结论句：整段淡入会像「一块色板糊上来」，按字拆开、逐字模糊渐入
  // （BlurText 的 blur 档）。同一段文字只播一次，重放历史不会反复糊屏。
  scoreSummary.textContent = report.summary || '';
  if (window.jtqBlurText) window.jtqBlurText.mount(scoreSummary);

  // 结果来源标签：不再把所有非模型结果都说成「未配置 API Key」。
  // 规则模式也可能是模型请求失败后由服务端规则处理，两者来源不同。
  // 后端用 fallback_reason 说明「为什么降级」，前端照实显示。
  const engineInfo = describeSourceLabel(report.engine, report.fallback_reason);

  engineTag.className =
    'engine-tag' + (engineInfo.className ? ' ' + engineInfo.className : '');
  engineTag.textContent = engineInfo.text;

  // 指标卡：区分程序计算、文本推断和固定示例。
  // 不在量规与来源明确之前用红绿颜色和「达标／不足」伪装成已验证的结论。
  const isDemo = report.engine === 'offline-demo';

  function validNumber(value, min, max) {
    if (
      value === null ||
      value === undefined ||
      value === '' ||
      typeof value === 'boolean'
    ) {
      return null;
    }

    const number = Number(value);

    if (!Number.isFinite(number)) return null;
    if (number < min || number > max) return null;

    return number;
  }

  function displayNumber(value, digits) {
    if (value === null) return '未提供';

    return new Intl.NumberFormat('zh-CN', {
      maximumFractionDigits: digits
    }).format(value);
  }

  function listValues(value) {
    if (!Array.isArray(value)) return [];

    return value
      .filter((item) => typeof item === 'string' && item.trim())
      .map((item) => item.trim());
  }

  const rate = validNumber(r.chars_per_min, 0, Infinity);
  const fillerTotal = validNumber(f.total, 0, Infinity);
  const asked = validNumber(q.asked, 0, Infinity);
  const candidateQuestions =
    validNumber(q.genuine_questions, 0, Infinity);
  const coverage = validNumber(k.cover_percent, 0, 100);

  // 等待秒数口径：没有音频时间戳时，等待时间「不可测量」。
  // 唯一允许显示具体秒数的是固定演示（且必须标注「示例」）；
  // 正常分析里后端把 avg_wait_sec 置为 null，这里不会用文本推断值冒充实测值。
  const demoWait = waitSecondsForDisplay(q, isDemo);

  const sourceChars = Array.from(
    String(lastScript || '').replace(/\s/g, '')
  ).length;

  const fillerDensity =
    !isDemo && fillerTotal !== null && sourceChars > 0
      ? (fillerTotal / sourceChars) * 100
      : null;

  const coveredItems = listValues(k.covered);
  const missingItems = listValues(k.missing);

  // 七环节清单只有一份定义（见文件顶部 GENERIC_PHASE_NAMES）。
  const genericPhases = new Set(GENERIC_PHASE_NAMES);

  const reportedCoverageItems = [
    ...coveredItems,
    ...missingItems
  ];

  // 后端已冻结契约：knowledge 永远只含七环节（模型分支也不得覆盖，
  // 仍取规则引擎的 base.knowledge）。所以这里不再看 engine，
  // 只校验「报告回来的条目是不是那七个环节」：
  // 万一拿到旧数据 / 异常数据，就不硬套七环节口径，改用保守措辞。
  const isGenericRuleCoverage =
    !isDemo &&
    reportedCoverageItems.length > 0 &&
    reportedCoverageItems.every((item) => genericPhases.has(item));

  let rateReference;

  if (isDemo) {
    rateReference = '固定示例数值，不用于评价当前讲稿。';
  } else if (r.source === 'estimated-duration') {
    rateReference = '按默认 240 秒估算，不代表实际语速。';
  } else if (r.source === 'user-duration') {
    rateReference = '字数 ÷ 用户提供时长，属于整体平均值。';
  } else {
    rateReference = '计算来源未明确标注，请核对时长与返回字段。';
  }

  if (!isDemo && typeof r.note === 'string' && r.note.trim()) {
    rateReference += '\n' + r.note.trim();
  }

  // 用户填写与媒体读取要分开说明：两者都不是"真实课堂实测时长"。
  // durationSource 记录的是界面操作来源，后端 source 才是实际计算口径，
  // 两者不一致时以后端为准，避免出现「user-duration 却提示未填写」。
  const backendSaysUserDuration = r.source === 'user-duration';
  const fieldIsEmpty = !durationInput || !String(durationInput.value).trim();

  if (!isDemo && durationSource === 'media') {
    rateReference +=
      '\n注意：本次时长来自媒体文件读取，可能包含片头或多余段落，不一定等于实际试讲长度。';
  } else if (!isDemo && backendSaysUserDuration) {
    if (durationSource === 'media') {
      // 已在上面处理
    } else if (durationSource === 'user') {
      rateReference += '\n时长由你在页面中填写。';
    } else {
      rateReference +=
        '\n时长来自本次请求输入（非本页手工填写）。若不是你预期的时长，请重新提交。';
    }
  } else if (!isDemo && fieldIsEmpty) {
    rateReference += '\n当前未填写时长，以上按默认 240 秒换算。';
  }

  let questionReference;

  if (isDemo) {
    questionReference = '固定示例；不代表真实学生已经参与互动。';
  } else if (report.engine === 'llm') {
    questionReference = '模型识别的文本问题数，不等于实际课堂提问次数。';
  } else if (report.engine === 'rule' || report.engine === 'rules') {
    questionReference = '按问号计数；不能识别所有没有问号的口头提问。';
  } else {
    questionReference = '基于输入文本识别，识别方式需核对。';
  }

  if (candidateQuestions !== null) {
    questionReference +=
      '\n“真提问”候选值：' +
      displayNumber(candidateQuestions, 0) +
      '；仅为启发式或模型分类，不代表有效互动。';
  }

  // 覆盖口径统一说明（唯一事实来源）：
  // 这一项是「逐字稿里匹配到的通用教学环节线索比例」，
  // 绝不能被读成知识点掌握情况、课堂质量或课程完成度的结论。
  // 七环节名称固定为后端 knowledge.missing 里可能出现的那七个。
  const GENERIC_PHASE_REF =
    '逐字稿中匹配到的通用教学环节线索比例' +
    '（七环节：情境引入 / 知识推导 / 公式结论 / 例题讲解 / 课堂互动 / 小结回顾 / 作业布置），' +
    '不是知识点掌握率。';

  let coverageReference;

  if (isDemo) {
    coverageReference = '固定示例环节线索比例，与真实训练结果不可直接比较。';
  } else if (isGenericRuleCoverage) {
    coverageReference = GENERIC_PHASE_REF;
  } else {
    coverageReference =
      GENERIC_PHASE_REF +
      '\n报告未标注本项是否按七环节口径统计，请结合原文核对。';
  }

  if (missingItems.length) {
    coverageReference +=
      '\n报告标记待补充：' +
      missingItems.join('、') +
      (isGenericRuleCoverage ? '（未匹配到的通用环节）' : '');
  } else {
    coverageReference += '\n未返回缺失列表，不等于全部环节都已讲到。';
  }

  const cards = [
    {
      label: isDemo
        ? '示例平均语速'
        : r.source === 'estimated-duration'
          ? '平均语速（估算）'
          : '平均语速',
      val: displayNumber(rate, 0),
      unit: rate === null ? '' : '字/分',
      ref: rateReference,
      cls: 'neutral'
    },
    {
      label: isDemo ? '示例等待' : '真实提问等待',
      val: isDemo ? displayNumber(demoWait, 1) : '无法测量',
      unit: isDemo && demoWait !== null ? '秒（示例）' : '',
      ref: isDemo
        ? '固定示例等待值，非当前讲稿实测。'
        : '当前分析依据讲稿文本，没有可靠的等待时间戳。' +
          '\n不将启发式推算秒数用于达标判断。',
      cls: 'neutral'
    },
    {
      label: '口头禅匹配',
      val: displayNumber(fillerTotal, 0),
      unit: fillerTotal === null ? '' : '次',
      ref:
        (isDemo
          ? '固定示例计数，不针对当前文本计算。'
          : fillerDensity === null
            ? '未提供完整计数或有效文本。'
            : '每百字 ' +
              displayNumber(fillerDensity, 2) +
              ' 次；按当前逐字稿非空白字符数计算。'
        ) + '\n词语匹配可能受语境影响，不单凭总次数判定合格。',
      cls: 'neutral'
    },
    {
      label: '文本提问',
      val: displayNumber(asked, 0),
      unit: asked === null ? '' : '次',
      ref: questionReference,
      cls: 'neutral'
    },
    {
      label: isDemo ? '示例环节线索' : '通用教学环节线索',
      val: displayNumber(coverage, 0),
      unit: coverage === null ? '' : '%',
      ref: coverageReference,
      cls: 'neutral'
    }
  ];

  metricsGrid.innerHTML = cards
    .map(
      (card) =>
        '<div class="metric ' + card.cls + '">' +
        '<div class="label">' + escapeHtml(card.label) + '</div>' +
        '<div class="val">' + escapeHtml(String(card.val)) + '<u>' + escapeHtml(card.unit) + '</u></div>' +
        '<div class="ref">' + escapeHtml(card.ref) + '</div>' +
        '</div>'
    )
    .join('');

  // 指标卡是刚重建的，GlareHover 的类名要重新挂（聚光和磁吸走事件委托，不用管）
  if (window.jtqRbFx && typeof window.jtqRbFx.refreshGlare === 'function') {
    window.jtqRbFx.refreshGlare();
  }

  // 报告卡分批入场（react-bits AnimatedContent）。gsap 未加载时这个函数
  // 直接返回 null，卡片保持默认可见 —— 不能让它变成「有动画才看得见」。
  if (window.jtqRbFx && typeof window.jtqRbFx.enterMetrics === 'function') {
    window.jtqRbFx.enterMetrics(metricsGrid);
  }

  // 逐字稿高亮
  const words = Object.keys(f.detail || {});
  transcriptHi.innerHTML = highlight(lastScript, words);

  // 口头禅排行榜（12）
  renderFillerRank(f);

  // 建议
  suggestionsList.innerHTML = (report.suggestions || [])
    .map(
      (s, i) =>
        '<div class="sug"><span class="ico">' + (i + 1) + '</span>' +
        '<div><b>' + escapeHtml(s.title || '建议') + '</b>' +
        '<p>' + escapeHtml(s.detail || '') + '</p></div></div>'
    )
    .join('');

  // 名师点评库：按短板匹配评委典型点评
  renderMasterQuotes(report);

  // 学科内容核对：模型提示，需人工确认（不是评分，也不是结论）
  renderSubjectKnowledge(report);

  // 通用教学环节线索：把七环节摊开，让「匹配到哪些 / 没匹配到哪些」看得见
  renderPhaseCues(report);
}

/* 通用教学环节线索（七环节清单）
   ------------------------------------------------------------------
   把后端 knowledge.covered / knowledge.missing 摊开给用户看：
   每个环节标「已出现线索」还是「未检测到线索」。

   口径边界（必须写在界面上）：
   - 命中与否**完全以后端返回的清单为准**，前端不做关键词匹配；
   - 前端只提供「完整七个环节名」用于展示未命中的项（GENERIC_PHASE_NAMES）；
   - 「未检测到线索」只代表逐字稿里没匹配到特征表达，
     **不等于这节课没做这个环节** —— 这句话必须留给用户看到。 */
function renderPhaseCues(report) {
  const box = $('phaseCueBox');
  if (!box) return;

  const k = (report && report.knowledge) || null;

  if (!k || (!Array.isArray(k.covered) && !Array.isArray(k.missing))) {
    box.innerHTML =
      '<p class="tip">本次分析没有返回通用教学环节线索（当前模式不提供这一项，或逐字稿里没匹配到任何环节）。</p>';
    return;
  }

  const pick = (list) =>
    (Array.isArray(list) ? list : [])
      .filter((item) => typeof item === 'string' && item.trim())
      .map((item) => item.trim());

  const covered = pick(k.covered);
  const missing = pick(k.missing);

  if (!covered.length && !missing.length) {
    box.innerHTML =
      '<p class="tip">本次分析没有返回通用教学环节线索。</p>';
    return;
  }

  const coveredSet = new Set(covered);
  const missingSet = new Set(missing);

  // 后端返回了、但不在前端展示清单里的环节名（两份定义漂移）：
  // 不能悄悄丢掉，原样补在清单后面。
  const extraNames = [];
  covered.forEach((n) => {
    if (!GENERIC_PHASE_NAMES.includes(n) && !extraNames.includes(n)) extraNames.push(n);
  });
  missing.forEach((n) => {
    if (!GENERIC_PHASE_NAMES.includes(n) && !extraNames.includes(n)) extraNames.push(n);
  });

  const row = (name, hit) =>
    '<li class="pc-item ' + (hit ? 'hit' : 'miss') + '">' +
    '<span class="pc-name">' + escapeHtml(name) + '</span>' +
    '<span class="pc-state">' + (hit ? '已出现线索' : '未检测到线索') + '</span>' +
    '</li>';

  const mainItems = GENERIC_PHASE_NAMES.map((name) => row(name, coveredSet.has(name)));
  const extraItems = extraNames.map((name) => row(name, coveredSet.has(name)));

  const total = coveredSet.size + missingSet.size;
  const hitCount = coveredSet.size;

  box.innerHTML =
    '<p class="tip pc-intro">这是逐字稿中匹配到的通用教学环节线索比例，不是知识点掌握率。</p>' +
    '<ul class="phase-cue-list">' +
    mainItems.join('') +
    extraItems.join('') +
    '</ul>' +
    (extraItems.length
      ? '<p class="tip pc-note">后端另外返回了 ' +
        extraNames.length +
        ' 个不在页面清单里的环节名，已原样列出，请人工核对两处口径是否一致。</p>'
      : '') +
    '<p class="tip pc-summary">共 ' +
    total +
    ' 个环节，其中 ' +
    hitCount +
    ' 个在逐字稿里匹配到了线索。</p>' +
    '<p class="tip pc-note">「未检测到线索」只说明逐字稿里没匹配到该环节的特征表达，不等于这节课没做这个环节。</p>';
}

/* 学科内容核对展示区
   ------------------------------------------------------------------
   subject_knowledge 是「模型提示」：它列出逐字稿里出现过的学科内容线索、
   以及还需要人工核对的点。它不是评分、不是结论，也不能替代老师备课核对。
   结构（后端 be4 冻结）：{ covered:[{point,evidence_quote}], needs_review:[{point,reason}], scope_note }
   兼容：
   - 整个字段都没有 → 一句说明，不渲染空白块；
   - covered 为空数组 → 友好空态（后端在规则模式下就会这样返回：
     没有教案分母就不编内容，只给 scope_note 说明为什么算不出来）。 */
function renderSubjectKnowledge(report) {
  const box = $('subjectKnowledgeBox');
  if (!box) return;

  const data = (report && report.subject_knowledge) || null;

  if (!data || (!Array.isArray(data.covered) && !Array.isArray(data.needs_review))) {
    box.innerHTML =
      '<p class="tip">当前模式没有提供独立的学科内容核对结果。</p>';
    return;
  }

  const covered = (data.covered || []).map(
    (item) =>
      '<li class="sk-covered"><b>已出现：</b>' +
      escapeHtml((item && item.point) || '') +
      '<br><span class="sk-evidence">' +
      escapeHtml((item && item.evidence_quote) || '') +
      '</span></li>'
  ).join('');

  const review = (data.needs_review || []).map(
    (item) =>
      '<li class="sk-review"><b>待核对：</b>' +
      escapeHtml((item && item.point) || '') +
      '<br><span class="sk-evidence">' +
      escapeHtml((item && item.reason) || '') +
      '</span></li>'
  ).join('');

  const scopeNote = data.scope_note
    ? '<p class="tip">' + escapeHtml(data.scope_note) + '</p>'
    : '';

  // 两组都空 → 给友好空态，不留一个空的 <ul>。
  if (!covered && !review) {
    box.innerHTML =
      '<p class="tip sk-hint">模型提示，需人工确认；不是评分，也不是结论。</p>' +
      '<p class="tip">本次分析没有产出可核对的学科内容线索。</p>' +
      scopeNote;
    return;
  }

  box.innerHTML =
    '<p class="tip sk-hint">模型提示，需人工确认；不是评分，也不是结论。</p>' +
    '<ul class="subject-review-list">' +
    covered +
    review +
    '</ul>' +
    scopeNote;
}

async function runAnalyze() {
  setErr('');
  const script = scriptInput.value.trim();
  if (script.length < 10) {
    setErr('请先输入至少 10 个字的讲稿，或点击「填入示例讲稿」');
    return;
  }
  const restore = busy(analyzeBtn, 'AI 正在分析…', '开始 AI 分析');
  try {
    const data = await post('/api/analyze', {
      transcript: script,
      subject: subjectInput.value.trim(),
      grade: gradeInput.value.trim(),
      subjectKey: subjectKeyInput ? subjectKeyInput.value : 'auto',
      durationSec: Number(durationInput.value) || 0,
      segments: lastSegments, // 视频转写才有；用于计算真实语速曲线
    });
    lastScript = script;
    lastSubject = subjectInput.value.trim();
    lastAnalysis = data;

    // 训练闭环钩子：通知「提问专项训练」模块本轮基线分析已完成。
    // 只透传训练所需字段；演示场景（固定示例页 / 离线分析结果）会被专项模块拒绝写入真实记录。
    document.dispatchEvent(
      new CustomEvent('jtq:analysis-complete', {
        detail: {
          report: data,
          transcript: script,
          subject: subjectInput.value.trim(),
          grade: gradeInput.value.trim(),
          isDemo:
            JTQ_DEMO_PAGE || Boolean(data && data.engine === 'offline-demo'),
        },
      })
    );

    if (data && data.subject_label) {
      const tip = $('subjectDetectedTip');
      if (tip) tip.textContent = '已按「' + data.subject_label + '」学科标准评分';
    }
    renderAnalysis(data);
    renderCurve(data);

    // 双人对比模式
    const bScript = scriptInputB ? scriptInputB.value.trim() : '';
    if (compareToggle && compareToggle.value === 'on' && bScript.length >= 10) {
      runCompare(script, bScript);
    }

    // 演示数据护栏：固定演示页面返回的是内置示例，不是对当前讲稿的分析结果。
    // 不得写入云端存档、不得上榜、不得进入本地成长档案与徽章统计，
    // 也不提供导出报告 / 分享海报等个人成绩传播入口。
    const isDemoResult =
      JTQ_DEMO_PAGE || Boolean(data && data.engine === 'offline-demo');

    resultEmpty.hidden = true;
    resultBody.hidden = false;
    const exportBtn = document.getElementById('exportBtn');
    if (exportBtn) exportBtn.hidden = isDemoResult;
    const posterBtnEl = document.getElementById('posterBtn');
    if (posterBtnEl) posterBtnEl.hidden = isDemoResult;

    if (isDemoResult) {
      const rankTitleEl = $('rankTitle');
      if (rankTitleEl) rankTitleEl.hidden = true;

      const badgeRowEl = $('badgeRow');
      if (badgeRowEl) badgeRowEl.replaceChildren();
    }

    // 换了讲稿，之前的结果作废
    improveBody.hidden = true;
    improveEmpty.hidden = false;
    resetChat();
    switchTab('report');

    // 单列布局：结果区在输入区下方，分析完成后自动带过去，省一次手动滚动
    try {
      const rect = resultBody.getBoundingClientRect();
      if (rect.top > window.innerHeight * 0.45 || rect.top < -80) {
        resultBody.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    } catch (e) { /* 老浏览器忽略 */ }

    // 已登录用户自动把复盘报告存到云端（我的复盘记录）
    if (window.JTQCloud && window.JTQCloud.signedIn && !isDemoResult) {
      try {
        window.JTQCloud.saveReport(data, {
          subject: subjectInput.value.trim(),
          grade: gradeInput.value.trim(),
          transcript: script,
        });
        // 校内榜：登录后每次复盘自动上榜（未登录静默跳过）
        window.JTQCloud.pushLeaderboard(
          data.overall_score != null ? Number(data.overall_score) : null,
          subjectInput.value.trim(),
          gradeInput.value.trim()
        );
      } catch (_) { /* 云端存档失败不打断本地展示 */ }
    }
    // 成长档案：无论是否登录都沉淀本地历史（演示数据不计入）
    if (!isDemoResult) {
      saveToHistory(data, { subject: subjectInput.value.trim() });
      if (!$('pane-growth').hidden) renderGrowth();
    }

    // 等级称号 + 徽章（演示数据不参与成就计算）
    if (!isDemoResult) {
      renderRank(data.overall_score || 0);
      unlockBadge('first', '首次复盘', '🎬', '完成第一次 AI 分析');
      const fw = (data.filler_words || {}).total;
      if (fw === 0) unlockBadge('filler0', '口头禅清零', '🤫', '一次分析中口头禅为 0');
      const hist2 = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
      if (hist2.length >= 3 && hist2.slice(-3).every((h) => h.score >= 80)) {
        unlockBadge('high3', '三连高分', '🏆', '连续 3 次 80 分以上');
      }
      if (compareToggle && compareToggle.value === 'on') unlockBadge('compare', '博弈赢家', '⚔️', '完成一次双人对比');
    }

    // 危险瞬间（异步，不阻塞主流程）
    runDanger();
    // 课堂可视化三件套：热力图 + 时间饼图 + 分段稿（异步，不阻塞主流程）
    runHeatmap();
    // 教案覆盖检查（粘了教案才跑）
    const planEl = $('planInput');
    if (planEl && planEl.value.trim().length >= 10) runPlanCheck();
    // 课标对照（2022 版）
    runCurriculumCheck();
    // iFIAS 课堂互动编码（异步，不阻塞主流程）
    runIfias();
  } catch (e) {
    setErr(e.message || '分析失败');
    // 分析失败时清掉上一轮的结果，避免用户把旧报告误当成本次讲稿的分析。
    // 演示数据（offline-demo）不算失败，会正常走上面的渲染分支。
    resultEmpty.hidden = false;
    resultBody.hidden = true;
    const exportBtn = document.getElementById('exportBtn');
    if (exportBtn) exportBtn.hidden = true;
    const posterBtnEl = document.getElementById('posterBtn');
    if (posterBtnEl) posterBtnEl.hidden = true;
  } finally {
    restore();
  }
}


/* ==================================================================
   🧭 iFIAS 课堂互动编码分析（14 类编码 + 互动矩阵 + DBSCAN + PCA）
   ================================================================== */
const IFIAS_GROUP_COLOR = { teacher: '#4F46E5', student: '#16a34a', silence: '#64748B', tech: '#f59e0b' };
const IFIAS_GROUP_NAME = { teacher: '教师语言', student: '学生语言', silence: '沉寂', tech: '技术' };

async function runIfias() {
  const box = $('ifiasBox');
  if (!box || !lastScript) return;

  // 保存本次请求上下文，避免较早的请求覆盖较新的分析结果。
  const transcript = lastScript;
  const subject = lastSubject || '';
  const analysis = lastAnalysis;

  const requestToken = {};
  runIfias.activeRequest = requestToken;

  function isCurrentRequest() {
    return (
      runIfias.activeRequest === requestToken &&
      lastScript === transcript &&
      lastSubject === subject &&
      lastAnalysis === analysis
    );
  }

  box.innerHTML = '<p class="tip">正在按 iFIAS 逐句编码（14 类）…</p>';

  const loadingText = '正在按 iFIAS 逐句编码（14 类）…';

  try {
    const data = await post('/api/ifias', {
      transcript: transcript,
      subject: subject
    });

    if (!isCurrentRequest()) return;

    if (!data || typeof data !== 'object') {
      throw new Error('互动编码结果格式不正确');
    }

    renderIfias(data);

    // 演示可以展示矩阵、聚类与结构图，但不能写入真实轨迹。
    saveIfiasSession(data, {
      subject: subject,
      analysisEngine: analysis && analysis.engine
    });
  } catch (error) {
    if (!isCurrentRequest()) return;

    box.innerHTML =
      '<p class="tip err">互动编码分析失败：' +
      escapeHtml(error && error.message ? error.message : '未知错误') +
      '</p>';
  } finally {
    // 关键：即使本次请求被判为过期，也不能把加载态留在页面上。
    // 若当前渲染的还是自己写入的加载文案，说明没有更新的结果覆盖它，
    // 这时必须给出明确说明，而不是永远显示「正在编码」。
    if (
      runIfias.activeRequest === requestToken &&
      box.textContent.trim() === loadingText
    ) {
      box.innerHTML =
        '<p class="tip">互动编码未完成，可能是请求被新的分析取代或结果无法解析。' +
        '可重新分析本段讲稿。</p>';
    }
  }
}

function renderIfias(d) {
  const box = $('ifiasBox');
  if (!box || !d || !d.codes) return;
  const r = d.ratios || {};
  const codes = d.codes || [];
  const table = {};
  (d.code_table || []).forEach((c) => { table[c.code] = c; });
  const groupOf = (code) => (table[code] ? table[code].group : 'teacher');

  // 1) 比率卡
  const cards = [
    { k: '教师语言', v: r.teacher_pct, u: '%', cls: r.teacher_pct > 70 ? 'bad' : 'ok', ref: '建议 ≤68%' },
    { k: '学生语言', v: r.student_pct, u: '%', cls: r.student_pct >= 30 ? 'ok' : 'warn', ref: '建议 ≥30%' },
    { k: '间接/直接', v: r.indirect_direct == null ? '—' : r.indirect_direct, u: '', cls: (r.indirect_direct || 0) >= 1 ? 'ok' : 'warn', ref: '≥1 更民主' },
    { k: '开放/封闭提问', v: r.open_close == null ? '—' : r.open_close, u: '', cls: (r.open_close || 0) >= 1 ? 'ok' : 'warn', ref: '≥1 更启发' },
    { k: '提问占教师语言', v: r.question_pct, u: '%', cls: r.question_pct >= 25 ? 'ok' : 'warn', ref: '建议 ≥25%' },
    { k: '有益沉寂', v: r.silence_pct, u: '%', cls: r.silence_pct <= 15 ? 'ok' : 'warn', ref: '≤15% 较紧凑' },
  ];
  const cardsHtml = cards.map((c) =>
    '<div class="metric ' + c.cls + '"><div class="label">' + c.k + '</div>' +
    '<div class="val">' + c.v + '<u>' + c.u + '</u></div><div class="ref">' + c.ref + '</div></div>'
  ).join('');

  // 2) 编码时间线
  const tl = codes.map((c) => {
    const grp = groupOf(c.code);
    const color = IFIAS_GROUP_COLOR[grp] || '#4F46E5';
    return '<span class="tl-seg" style="background:' + color + '" ' +
      'title="#' + c.i + ' [' + c.code + ' ' + escapeHtml(c.label) + '] ' + escapeHtml(c.text) + '"></span>';
  }).join('');

  // 3) 互动矩阵（12×12）
  const mtx = d.matrix || { labels: [], data: [] };
  const n = mtx.labels.length || 12;
  const CS = 21, PAD = 70, TOP = 58;
  const W = PAD + n * CS + 8, H = TOP + n * CS + 8;
  let maxCell = 0;
  (mtx.data || []).forEach((row) => row.forEach((v) => { if (v > maxCell) maxCell = v; }));
  let grid = '';
  mtx.labels.forEach((lb, i) => {
    grid += '<text x="' + (PAD - 4) + '" y="' + (TOP + i * CS + CS - 6) + '" text-anchor="end" font-size="9" fill="#64748b">' +
      escapeHtml(lb) + '</text>';
    grid += '<text x="' + (PAD + i * CS + CS / 2) + '" y="' + (TOP - 5) + '" text-anchor="middle" font-size="9" fill="#64748b">' +
      escapeHtml(lb) + '</text>';
  });
  mtx.labels.forEach((_, i) => {
    (mtx.data[i] || []).forEach((v, j) => {
      const alpha = maxCell ? Math.min(0.92, 0.1 + (v / maxCell) * 0.82) : 0;
      const fill = v > 0 ? 'rgba(79,70,229,' + alpha.toFixed(2) + ')' : 'rgba(148,163,184,0.08)';
      grid += '<rect x="' + (PAD + j * CS) + '" y="' + (TOP + i * CS) + '" width="' + (CS - 1) + '" height="' + (CS - 1) +
        '" rx="3" fill="' + fill + '" stroke="rgba(148,163,184,.25)" stroke-width=".5"><title>' +
        escapeHtml(mtx.labels[i]) + ' → ' + escapeHtml(mtx.labels[j]) + '：' + v + ' 次</title></rect>';
      if (v > 0) {
        grid += '<text x="' + (PAD + j * CS + CS / 2) + '" y="' + (TOP + i * CS + CS / 2 + 3) + '" text-anchor="middle" font-size="9" font-weight="700" fill="' +
          (alpha > 0.55 ? '#fff' : '#4F46E5') + '">' + v + '</text>';
      }
    });
  });

  // 3b) 原始 16 码矩阵
  const rm = d.matrix_raw || { labels: [], data: [], size: 16 };
  const rn = rm.labels.length || 16;
  const RCS = 17, RPAD = 40, RTOP = 40;
  const RW = RPAD + rn * RCS + 6, RH = RTOP + rn * RCS + 6;
  let rmax = 0;
  (rm.data || []).forEach((row) => row.forEach((v) => { if (v > rmax) rmax = v; }));
  let rawGrid = '';
  rm.labels.forEach((lb, i) => {
    rawGrid += '<text x="' + (RPAD - 3) + '" y="' + (RTOP + i * RCS + RCS - 5) + '" text-anchor="end" font-size="8" fill="#64748b">' + escapeHtml(lb) + '</text>';
    rawGrid += '<text x="' + (RPAD + i * RCS + RCS / 2) + '" y="' + (RTOP - 4) + '" text-anchor="middle" font-size="8" fill="#64748b">' + escapeHtml(lb) + '</text>';
  });
  rm.labels.forEach((lb, i) => {
    (rm.data[i] || []).forEach((v, j) => {
      const a = rmax ? Math.min(0.95, 0.08 + (v / rmax) * 0.86) : 0;
      const isDiag = i === j;
      const fill = v > 0 ? 'rgba(79,70,229,' + a.toFixed(2) + ')' : 'rgba(148,163,184,0.07)';
      rawGrid += '<rect x="' + (RPAD + j * RCS) + '" y="' + (RTOP + i * RCS) + '" width="' + (RCS - 1) + '" height="' + (RCS - 1) +
        '" rx="2" fill="' + fill + '" stroke="' + (isDiag ? 'rgba(220,38,38,.45)' : 'rgba(148,163,184,.22)') +
        '" stroke-width="' + (isDiag ? '1' : '.4') + '"><title>' + escapeHtml(lb) + ' → ' + escapeHtml(rm.labels[j]) + '：' + v + ' 次' +
        (isDiag ? '（对角=稳态格）' : '') + '</title></rect>';
      if (v > 0) {
        rawGrid += '<text x="' + (RPAD + j * RCS + RCS / 2) + '" y="' + (RTOP + i * RCS + RCS / 2 + 2.6) + '" text-anchor="middle" font-size="7.5" font-weight="700" fill="' +
          (a > 0.55 ? '#fff' : '#4F46E5') + '">' + v + '</text>';
      }
    });
  });

  const steady = (d.steady_cells || []).map((c) =>
    '<span class="if-steady">' + escapeHtml(c.code) + ' ' + escapeHtml(c.label) + ' ×' + c.count + '</span>').join('') ||
    '<span class="if-note-inline">未检出稳态格（行为切换频繁，或讲稿过短）</span>';

  // 4) PCA 散点 + 聚类
  const eps = d.episodes || [];
  const clusters = d.clusters || [];
  const CW = 560, CH = 250, CP = 34;
  let sx = eps.map((e) => e.x), sy = eps.map((e) => e.y);
  let minX = Math.min.apply(null, sx.concat([0])), maxX = Math.max.apply(null, sx.concat([0]));
  let minY = Math.min.apply(null, sy.concat([0])), maxY = Math.max.apply(null, sy.concat([0]));
  if (maxX - minX < 1e-6) { minX -= 0.5; maxX += 0.5; }
  if (maxY - minY < 1e-6) { minY -= 0.5; maxY += 0.5; }
  const px = (x) => CP + ((x - minX) / (maxX - minX)) * (CW - CP * 2);
  const py = (y) => (CH - CP) - ((y - minY) / (maxY - minY)) * (CH - CP * 2);
  const CCOLOR = ['#4F46E5', '#16a34a', '#f59e0b', '#0ea5e9', '#ec4899'];
  let dots = '';
  eps.forEach((e) => {
    const isNoise = e.cluster < 0;
    const col = isNoise ? '#dc2626' : CCOLOR[e.cluster % CCOLOR.length];
    const cname = isNoise ? '低密度片段（结构差异大）' : (clusters.find((c) => c.id === e.cluster) || {}).name || '簇' + e.cluster;
    if (isNoise) {
      dots += '<text x="' + px(e.x) + '" y="' + (py(e.y) + 4) + '" text-anchor="middle" font-size="12" fill="' + col + '">✕' +
        '<title>片段 ' + e.start + '–' + e.end + '：' + cname + '</title></text>';
    } else {
      dots += '<circle cx="' + px(e.x) + '" cy="' + py(e.y) + '" r="5.5" fill="' + col + '" fill-opacity=".85" stroke="#fff" stroke-width="1">' +
        '<title>片段 ' + e.start + '–' + e.end + '：' + cname + '</title></circle>';
    }
  });
  const exp = d.explained || [0, 0];

  const clusterChips = clusters.map((c) =>
    '<span class="if-cluster" style="--cc:' + CCOLOR[c.id % CCOLOR.length] + '">' +
    '<b>' + escapeHtml(c.name) + '</b> · ' + c.size + ' 段 · 主导 ' + escapeHtml(c.dominant) + '</span>'
  ).join('') || '<span class="if-cluster">未形成稳定簇（片段结构差异大）</span>';

  // 5) 编码明细（前 14 条）
  const detail = codes.slice(0, 14).map((c) => {
    const grp = groupOf(c.code);
    return '<div class="if-row"><span class="if-code" style="background:' + (IFIAS_GROUP_COLOR[grp] || '#4F46E5') + '">' +
      c.code + '</span><span class="if-lb">' + escapeHtml(c.label) + '</span>' +
      '<span class="if-tx">' + escapeHtml(c.text) + '</span></div>';
  }).join('');

  box.innerHTML =
    (d.caveat ? '<div class="if-caveat">⚠️ 口径提示：' + escapeHtml(d.caveat) + '</div>' : '') +
    '<div class="if-head"><span class="if-badge">' +
    (d.engine === 'llm'
      ? 'AI 逐句编码'
      : '规则编码' + degradedSuffix(d.fallback_reason)) + '</span>' +
    '共编码 <b>' + d.total_units + '</b> 句 · 片段 <b>' + eps.length + '</b> 个 · 噪声 <b>' +
    eps.filter((e) => e.cluster === -1).length + '</b> 个</div>' +
    '<div class="metrics if-metrics">' + cardsHtml + '</div>' +
    '<div class="if-sub">编码时间线（按句序；颜色 = 语言归属）</div>' +
    '<div class="if-timeline">' + tl + '</div>' +
    '<div class="if-legend">' +
    Object.keys(IFIAS_GROUP_NAME).map((g) =>
      '<span><i style="background:' + IFIAS_GROUP_COLOR[g] + '"></i>' + IFIAS_GROUP_NAME[g] + '</span>').join('') +
    '</div>' +
    '<div class="if-sub if-sub-row">互动矩阵（行 → 列；数字为转移次数）' +
    '<span class="if-toggle"><button class="if-tg active" data-ifm="agg" type="button">聚合 ' + n + ' 类</button>' +
    '<button class="if-tg" data-ifm="raw" type="button">原始 ' + rn + ' 码</button></span></div>' +
    '<div class="if-matrix" id="ifMatrixAgg"><svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;max-width:560px">' + grid + '</svg></div>' +
    '<div class="if-matrix" id="ifMatrixRaw" hidden><svg viewBox="0 0 ' + RW + ' ' + RH + '" style="width:100%;max-width:620px">' + rawGrid + '</svg></div>' +
    '<div class="if-sub">稳态格（对角格，行为连续出现 ≥2 次）· 内容十字区 ' + (d.content_cross == null ? '—' : d.content_cross + '%') + '</div>' +
    '<div class="if-strow">' + steady + '</div>' +
    '<div class="if-sub">片段聚类 + PCA 结构图（DBSCAN ε=' + (d.eps == null ? '自适应' : d.eps) +
    ' / MinPts=' + (d.min_pts || 2) + '；解释方差 ' + exp[0] + '% + ' + exp[1] + '%）</div>' +
    '<div class="if-pca"><svg viewBox="0 0 ' + CW + ' ' + CH + '" style="width:100%">' +
    '<line x1="' + CP + '" y1="' + (CH - CP) + '" x2="' + (CW - CP) + '" y2="' + (CH - CP) + '" stroke="#cbd5e1"/>' +
    '<line x1="' + CP + '" y1="' + CP + '" x2="' + CP + '" y2="' + (CH - CP) + '" stroke="#cbd5e1"/>' +
    '<text x="' + (CW / 2) + '" y="' + (CH - 8) + '" text-anchor="middle" font-size="10" fill="#64748B">PC1（' + exp[0] + '%）</text>' +
    '<text x="10" y="' + (CH / 2) + '" font-size="10" fill="#64748B" transform="rotate(-90 10 ' + (CH / 2) + ')">PC2（' + exp[1] + '%）</text>' +
    dots + '</svg></div>' +
    '<div class="if-clusters">' + clusterChips + '</div>' +
    (d.cluster_note ? '<p class="if-note">' + escapeHtml(d.cluster_note) + '</p>' : '') +
    '<div class="if-sub">编码明细（前 14 句）</div>' +
    '<div class="if-rows">' + detail + '</div>' +
    '<div class="if-verdict">🔎 ' + escapeHtml(d.verdict || '') + '</div>';

  box.querySelectorAll('.if-tg').forEach((b) => {
    b.addEventListener('click', () => {
      const mode = b.getAttribute('data-ifm');
      box.querySelectorAll('.if-tg').forEach((x) => x.classList.toggle('active', x === b));
      const agg = $('ifMatrixAgg'), raw = $('ifMatrixRaw');
      if (agg) agg.hidden = mode !== 'agg';
      if (raw) raw.hidden = mode !== 'raw';
    });
  });

  // 渲染函数不负责存档。
  // 存档由 runIfias() 在校验结果来源和当前请求后处理，
  // 否则重绘图表就会顺手产生历史记录。
}

/* ---------- Tab ---------- */

function switchTab(name) {
  const tabs = Array.from(
    document.querySelectorAll('.tabs .tab[data-tab]')
  );
  const panes = Array.from(
    document.querySelectorAll('.tabpane')
  );

  const targetTab = tabs.find(
    (tab) => tab.getAttribute('data-tab') === name
  );
  const targetPane = document.getElementById('pane-' + name);

  // 避免无效名称导致所有面板都被关闭。
  if (!targetTab || !targetPane) return;

  tabs.forEach((tab) => {
    const tabName = tab.getAttribute('data-tab');
    const selected = tabName === name;
    const tabId = 'jtq-tab-' + tabName;

    tab.id = tab.id || tabId;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', 'pane-' + tabName);
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    tab.classList.toggle('active', selected);

    const pane = document.getElementById('pane-' + tabName);
    if (pane) {
      pane.setAttribute('role', 'tabpanel');
      pane.setAttribute('aria-labelledby', tab.id);
      pane.tabIndex = 0;
    }
  });

  panes.forEach((pane) => {
    pane.classList.toggle('active', pane === targetPane);
  });

  // 工作台导航只订阅状态，不接管原有业务数据。
  document.dispatchEvent(new CustomEvent('jtq:tabchange', {
    detail: { name }
  }));
}

document.querySelectorAll('.tabs').forEach((tabBar) => {
  tabBar.setAttribute('role', 'tablist');
  tabBar.setAttribute('aria-label', '复盘与演练功能');

  const tabs = Array.from(
    tabBar.querySelectorAll('.tab[data-tab]')
  );

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const name = tab.getAttribute('data-tab');
      switchTab(name);

      // 保留原有成长页加载逻辑。
      if (name === 'growth') {
        renderGrowth();
        loadLeaderboard(lbCurrent);
        renderLbLoginTip();
        renderDaily();
        renderIfiasTrail();
        loadHollow();
      }
    });

    tab.addEventListener('keydown', (event) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;

      const index = tabs.indexOf(tab);
      let nextIndex = index;

      if (event.key === 'ArrowRight') {
        nextIndex = (index + 1) % tabs.length;
      } else if (event.key === 'ArrowLeft') {
        nextIndex = (index - 1 + tabs.length) % tabs.length;
      } else if (event.key === 'Home') {
        nextIndex = 0;
      } else if (event.key === 'End') {
        nextIndex = tabs.length - 1;
      } else {
        return;
      }

      event.preventDefault();

      // 手动激活模式：方向键移动焦点，Enter/空格切换。
      tabs.forEach((item, itemIndex) => {
        item.tabIndex = itemIndex === nextIndex ? 0 : -1;
      });
      tabs[nextIndex].focus();
    });
  });
});

/* ---------- 改进建议 ---------- */
async function runImprove() {
  const restore = busy(improveBtn, 'AI 正在改写…', '生成改进版逐字稿');
  setErr('');
  try {
    const data = await post('/api/improve', {
      transcript: lastScript,
      analysis: lastAnalysis,
      subject: lastSubject,
    });

    keyChanges.innerHTML = (data.key_changes || [])
      .map((c) => '<li>' + escapeHtml(c) + '</li>')
      .join('');
    improvedScript.textContent = data.improved_script || '';

    const bb = data.blackboard_design || {};
    blackboardBox.innerHTML =
      '<b>分区</b>' + escapeHtml(bb.layout || '—') +
      '<div style="height:8px"></div><b>板上必写</b>' +
      ((bb.key_points || []).map((p) => '· ' + escapeHtml(p)).join('<br>') || '—');

    const hw = data.layered_homework || {};
    homeworkBox.innerHTML =
      '<b>基础（必做）</b>' + escapeHtml(hw.basic || '—') +
      '<div style="height:8px"></div><b>提高（选做）</b>' + escapeHtml(hw.advanced || '—') +
      '<div style="height:8px"></div><b>拓展（挑战）</b>' + escapeHtml(hw.extended || '—');

    nextFocusBox.textContent = '下一次试讲，最该练的一件事：' + (data.next_focus || '给提问留足 3 秒');

    improveEmpty.hidden = true;
    improveBody.hidden = false;
  } catch (e) {
    setErr(e.message || '生成改进稿失败');
  } finally {
    restore();
  }
}

/* ==================================================================
   👥 三学生课堂（多人同时在线 + 表情 + 举手 + 压力系统）
   ================================================================== */
/* ---------- 学生名册与学情数值 ----------
 * 判定逻辑在 public/classroom-roster.js（纯函数，node:test 直接可测）。
 * 下面这组 || 兜底只在该文件未加载时生效（旧缓存页面），正常路径一律以它为准；
 * 单测也只锁那边，别两份各改一半。 */
const CLASS_ROSTER = window.jtqClassRoster || null;
const CLASS_META = CLASS_ROSTER
  ? CLASS_ROSTER.CLASS_META
  : {
      naughty: { name: '小皮', avatar: '😈', desc: '调皮型' },
      geek: { name: '小霸', avatar: '🤓', desc: '学霸型' },
      drift: { name: '小走', avatar: '😵', desc: '走神型' },
    };
const CLASS_KEYS = CLASS_ROSTER ? CLASS_ROSTER.KEYS : ['naughty', 'geek', 'drift'];

// 后端还没返回状态时的默认名册：三个「还没开口」的学生
const idleRoster = CLASS_ROSTER ? CLASS_ROSTER.idleRoster : function () {
  return CLASS_KEYS.map((k) => ({ key: k, mood: '😊', hand_raise: false }));
};

// 角色白名单：只认自有属性，避免 constructor / toString 被当成有效学生
const hasClassKey = CLASS_ROSTER ? CLASS_ROSTER.hasKey : function (key) {
  return typeof key === 'string' &&
    Object.prototype.hasOwnProperty.call(CLASS_META, key);
};

// 学情数值：数字或非空数字串 → 0–100 整数；其余（空白串/数组/对象/布尔）→ null
const scoreOf = CLASS_ROSTER ? CLASS_ROSTER.scoreOf : function (value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : null;
  }
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : null;
  }
  return null;
};

const stateColor = CLASS_ROSTER ? CLASS_ROSTER.colorOf : function (value) {
  const n = scoreOf(value);
  if (n === null) return '#94A3B8';
  if (n >= 70) return '#16a34a';
  if (n >= 45) return '#f59e0b';
  return '#dc2626';
};

/* 学生模型工厂：单人拆台与三学生课堂共用（见 classroom-roster.js 的注释）。
 * 这里保留一份等价兜底，只在该文件未加载（旧缓存页面）时生效。 */
const makeStudent = CLASS_ROSTER && CLASS_ROSTER.makeStudent
  ? CLASS_ROSTER.makeStudent
  : function (key, patch) {
      const p = (patch && typeof patch === 'object') ? patch : {};
      const k = hasClassKey(key) ? key : '';
      return {
        key: k,
        name: (p.name && String(p.name).trim()) || (k ? CLASS_META[k].name : ''),
        mood: (p.mood && String(p.mood).trim()) || '😊',
        hand_raise: p.hand_raise === true,
        speaking: p.speaking === true,
        attention: scoreOf(p.attention),
        comprehension: scoreOf(p.comprehension),
        state_reason: typeof p.state_reason === 'string' ? p.state_reason : '',
        difficulty: ['basic', 'core', 'advanced'].indexOf(p.difficulty) !== -1 ? p.difficulty : '',
      };
    };

/* 立绘状态唯一判定：举手 > 发言 > 闭嘴。绘制与卡片都读这一份。 */
const portraitStateOf = CLASS_ROSTER && CLASS_ROSTER.portraitStateOf
  ? CLASS_ROSTER.portraitStateOf
  : function (s) {
      if (!s) return 'closed';
      if (s.hand_raise === true) return 'raise';
      if (s.speaking === true) return 'default';
      return 'closed';
    };

/* 场景几何：站位与命中盒子只在 classroom-roster.js 里算一份。
 * 画布绘制和「点画布点名」都用它，避免两份坐标公式漂移成「看到小走、点中小霸」。 */
const figSize = CLASS_ROSTER && CLASS_ROSTER.figSize
  ? CLASS_ROSTER.figSize
  : function (maxW, maxH, ratio) {
      const r = ratio > 0 ? ratio : 0.78;
      let h = maxH, w = h * r;
      if (w > maxW) { w = maxW; h = w / r; }
      return { w: w, h: h };
    };
const sceneLayout = CLASS_ROSTER && CLASS_ROSTER.sceneLayout
  ? CLASS_ROSTER.sceneLayout
  : function () { return []; };
const sceneHitTest = CLASS_ROSTER && CLASS_ROSTER.hitTest
  ? CLASS_ROSTER.hitTest
  : function () { return null; };

const chatModeBar = $('chatModeBar');
const classMode = $('classMode');
const soloMode = $('soloMode');
/* 单人拆台也走同一套学生模型：场景画布 + 学生卡容器 */
const soloSceneCanvas = $('soloSceneCanvas');
const soloStudentsBox = $('soloStudents');
const classLog = $('classLog');
const classForm = $('classForm');
const classInput = $('classInput');
const classNextBtn = $('classNextBtn');
const classResetBtn = $('classResetBtn');
const classStudentsBox = $('classStudents');
const pressureNum = $('pressureNum');
const pressureFill = $('pressureFill');
const pressureHint = $('pressureHint');
const doomedOverlay = $('doomedOverlay');
const doomedReason = $('doomedReason');

let classPressure = 20;
let classMessages = []; // {role:'teacher'|'student', name, content}
let classDoomed = false;

/* ---------- 2D 教室场景（原生 Canvas，扩展自现有 classNextRound，不新建平行模块）---------- */
const classSceneCanvas = $('classSceneCanvas');
let classSceneCtx = null;
let classSceneReady = false;

if (chatModeBar) {
  chatModeBar.addEventListener('click', (e) => {
    const btn = e.target.closest('.msw');
    if (!btn) return;
    chatModeBar.querySelectorAll('.msw').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const isClass = btn.getAttribute('data-mode') === 'class';
    classMode.hidden = !isClass;
    soloMode.hidden = isClass;
    if (isClass) requestAnimationFrame(drawClassScene);
    else requestAnimationFrame(drawSoloScene);
    if (isClass && !lastAnalysis && !lastScript) {
      setErr('建议先提交讲稿，三学生会基于你的讲课内容发问（当然也可以空手开局）');
    }
  });
}

// 切回「AI 学生拆台」Tab 时重绘 2D 教室场景（画布在隐藏时尺寸为 0，需重新绘制）。
// 切走时只摘掉「正在发言」标记：不删对话、不清业务数据，也不当成训练结束。
document.addEventListener('jtq:tabchange', (e) => {
  const name = e.detail && e.detail.name;
  if (name === 'chat') {
    requestAnimationFrame(drawClassScene);
    requestAnimationFrame(drawSoloScene);
    return;
  }
  clearClassSpeaking();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) clearClassSpeaking();
  else {
    requestAnimationFrame(drawClassScene);
    requestAnimationFrame(drawSoloScene);
  }
});

let lastClassStates = []; // 最近一轮学生状态，供驾驶舱计算
let lastClassSlots = []; // 最近一帧的站位盒子（画布点击命中用，与绘制同源）

/**
 * 学生卡头像：优先用课堂里同一个 SVG 立绘的头部裁切，emoji 只作降级。
 *
 * 为什么不再直接放 emoji：
 *   立绘已经是这套产品识别学生的唯一视觉系统（2D 教室里画的就是它），
 *   卡片上再放一个 😈🤓😵，等于同一个学生有两张脸；而且 emoji 在不同系统上
 *   长相差异极大（Windows 的 🤓 和 macOS 的不是同一张脸）。
 *
 * 降级链：立绘地址拿不到 → emoji；img 加载失败 → onerror 删掉 img，露出底层 emoji。
 * 两条路都不会留下破图标或空白。
 */
function classAvatarHtml(key, meta) {
  const emoji = '<span class="cs-av-emoji">' + meta.avatar + '</span>';
  const src = (key && window.jtqStudentArt && window.jtqStudentArt.srcOf)
    ? window.jtqStudentArt.srcOf(key, 'closed')
    : '';
  if (!src) return '<span class="cs-av">' + emoji + '</span>';
  return '<span class="cs-av" data-av="' + key + '">' + emoji +
    '<img class="cs-av-img" src="' + src + '" alt="" decoding="async" onerror="this.remove()">' +
    '</span>';
}

/**
 * 单个学生卡片的 HTML —— 三学生课堂与单人拆台共用同一份模板。
 *
 * 为什么必须共用：卡片上写的是「这个学生是谁、现在什么状态」。
 * 单人模式如果另写一套模板，早晚会漂移成「同一个角色两张脸、
 * 课堂显示专注度、单人却没有」。学生模型统一之后，模板也必须统一。
 *
 * @param {object} s makeStudent() 产出的学生对象
 * @param {object} [opts] { aria: 无障碍描述, clickable: boolean }
 */
function studentCardHtml(s, opts) {
  const o = opts || {};
  // 非法角色（含 constructor / toString 这类原型链属性）不渲染成有效学生
  const key = hasClassKey(s && s.key) ? s.key : '';
  const m = key ? CLASS_META[key] : CLASS_META.naughty;
  const name = (s && s.name) ? String(s.name) : m.name;
  const aria = o.aria || ('点名 ' + name + ' 回答');
  // 先规整成 number|null：空白串 / 数组不再被当成 0 分渲染成红色告警条
  const att = scoreOf(s && s.attention);
  const comp = scoreOf(s && s.comprehension);
  const has = att !== null && comp !== null;
  const reason = s && s.state_reason ? escapeHtml(s.state_reason) : '';
  // 学情生效时，后端会给出本轮提问难度（basic / core / advanced）。白名单外一律不显示。
  const diffLabel = { basic: '基础', core: '常规', advanced: '进阶' };
  const diff = s && s.difficulty ? diffLabel[s.difficulty] || '' : '';
  const bars = has
    ? '<div class="cs-bars">' +
      '<div class="cs-bar" title="专注度 ' + att + (reason ? ' · ' + reason : '') + '">' +
      '<span class="cs-bl">专注</span><div class="cs-bt"><i style="width:' + att + '%;background:' + stateColor(att) + '"></i></div>' +
      '<b style="color:' + stateColor(att) + '">' + att + '</b></div>' +
      '<div class="cs-bar" title="理解度 ' + comp + (reason ? ' · ' + reason : '') + '">' +
      '<span class="cs-bl">理解</span><div class="cs-bt"><i style="width:' + comp + '%;background:' + stateColor(comp) + '"></i></div>' +
      '<b style="color:' + stateColor(comp) + '">' + comp + '</b></div>' +
      '</div>'
    : '';
  // 合法角色才可点。非法角色卡片没有 data-k，也就没有 role/tabindex，
  // 键盘用户不会 tab 到一个点了没反应的元素上 —— 那是比不可点更差的可访问性。
  const clickable = (key && o.clickable !== false)
    ? ' role="button" tabindex="0" data-k="' + key + '" aria-label="' + escapeHtml(aria) + '"'
    : '';
  return '<div class="cs-card' + (s && s.speaking ? ' speaking' : '') + '"' + clickable + '>' +
    (s && s.hand_raise ? '<span class="cs-raise">🙋</span>' : '') +
    classAvatarHtml(key, m) +
    '<div class="cs-nm">' + escapeHtml(name) + '</div>' +
    (diff ? '<span class="difficulty-tag" title="本轮提问难度">' + escapeHtml(diff) + '</span>' : '') +
    '<div class="cs-mood">' + escapeHtml((s && s.mood) || '😊') + '</div>' +
    bars +
    (reason ? '<div class="cs-why">' + reason + '</div>' : '') +
    '</div>';
}

function renderClassStudents(states) {
  const list = (states && states.length) ? states : idleRoster();
  lastClassStates = list;
  classStudentsBox.innerHTML = list.map((s) => studentCardHtml(s)).join('');
  drawClassScene();
}

/* 离开课堂时摘掉「正在发言」的展示。
 * 不删除对话、不清业务记录，也不把「切走 Tab」解释成训练结束。 */
function clearClassSpeaking() {
  if (!lastClassStates || !lastClassStates.length) return;
  let changed = false;
  lastClassStates.forEach((s) => {
    if (s && s.speaking) {
      s.speaking = false;
      changed = true;
    }
  });
  if (changed) renderClassStudents(lastClassStates);
}

/* ---------- 实时驾驶舱：节奏 / 张力 / 参与度 ---------- */
function setGauge(barId, valId, noteId, pct, label, note, color) {
  const bar = $(barId), val = $(valId), nt = $(noteId);
  if (bar) { bar.style.width = Math.max(2, Math.min(100, pct)) + '%'; bar.style.background = color; }
  if (val) { val.textContent = label; val.style.color = color; }
  if (nt) nt.textContent = note;
}

function renderCockpit() {
  // 节奏：最近 3 条学生话语的平均字数（短=推进吃力，长=节奏过赶）
  const stu = classMessages.filter((m) => m.role === 'student').slice(-3);
  if (!stu.length) {
    setGauge('ckPaceBar', 'ckPaceV', 'ckPaceN', 0, '—', '等第一轮课堂', '#64748B');
  } else {
    const avg = stu.reduce((acc, m) => acc + String(m.content || '').length, 0) / stu.length;
    const pct = Math.round((avg / 45) * 100);
    if (avg < 16) setGauge('ckPaceBar', 'ckPaceV', 'ckPaceN', pct, '偏慢', '学生话很短，课堂推不动', '#f59e0b');
    else if (avg > 42) setGauge('ckPaceBar', 'ckPaceV', 'ckPaceN', pct, '偏快', '节奏太赶，学生跟不上', '#dc2626');
    else setGauge('ckPaceBar', 'ckPaceV', 'ckPaceN', pct, '适中', '推进顺畅', '#16a34a');
  }

  // 张力：直接复用压力值
  const tColor = classPressure >= 75 ? '#dc2626' : classPressure >= 50 ? '#f59e0b' : '#16a34a';
  const tLabel = classPressure >= 75 ? '快失控' : classPressure >= 50 ? '偏紧' : '稳定';
  setGauge('ckTensionBar', 'ckTensionV', 'ckTensionN', classPressure, tLabel,
    classPressure >= 75 ? '用控场话术把节奏拉回来' : classPressure >= 50 ? '学生开始躁动' : '课堂在你手里', tColor);

  // 参与度：三名学生当前专注度均值
  const atts = (lastClassStates || [])
    .map((x) => scoreOf(x && x.attention))
    .filter((v) => v !== null);
  if (!atts.length) {
    setGauge('ckFocusBar', 'ckFocusV', 'ckFocusN', 0, '—', '等学生开口', '#64748B');
  } else {
    const mean = Math.round(atts.reduce((a, b) => a + b, 0) / atts.length);
    const fColor = mean >= 70 ? '#16a34a' : mean >= 45 ? '#f59e0b' : '#dc2626';
    setGauge('ckFocusBar', 'ckFocusV', 'ckFocusN', mean, mean + '%',
      mean >= 70 ? '全班在听' : mean >= 45 ? '有人开始走神' : '多数人已经飘了', fColor);
  }
}

function updatePressure(delta, reason) {
  classPressure = Math.max(0, Math.min(100, classPressure + delta));
  pressureNum.textContent = classPressure;
  pressureFill.style.width = classPressure + '%';
  if (classPressure >= 100) {
    showDoomed(reason);
  } else if (classPressure >= 75) {
    pressureHint.textContent = '⚠️ 课堂快失控了！用控场话术把节奏拉回来';
    pressureHint.style.color = '#dc2626';
  } else if (classPressure >= 50) {
    pressureHint.textContent = '😰 学生开始躁动，压力上升中';
    pressureHint.style.color = '#d97706';
  } else if (classPressure <= 25) {
    pressureHint.textContent = '😌 课堂很稳，你在掌控之中';
    pressureHint.style.color = '#16a34a';
  } else {
    pressureHint.textContent = '稳住，你能行';
    pressureHint.style.color = '#64748B';
  }
  renderCockpit();
  drawClassScene();
}

function showDoomed(reason) {
  classDoomed = true;
  doomedReason.textContent = reason || '模拟课堂压力已达到本轮上限。';
  doomedOverlay.style.display = 'flex';
  unlockBadge('doomed', '社死体验者', '💀', '在课堂压力爆表后依然站到了最后');
}

/* ---------- 2D 教室场景绘制（原生 Canvas，纯前端，无外部依赖）---------- */
function getCssVar(name, fallback) {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  } catch (_) {
    return fallback;
  }
}

function truncateStr(str, n) {
  str = String(str || '');
  return str.length > n ? str.slice(0, n) + '…' : str;
}

// 各角色场景配色（与 CLASS_META 对应，仅用于画布区分，不进逻辑）
const CLASS_SCENE_COLOR = {
  naughty: { body: '#197A63', skin: '#DCEFE8' },
  geek: { body: '#5262A3', skin: '#E8EAF6' },
  drift: { body: '#A66B16', skin: '#F7EBDD' },
};

function setupClassScene() {
  if (classSceneReady || !classSceneCanvas) return;
  classSceneCtx = classSceneCanvas.getContext('2d');
  if (!classSceneCtx) return;
  classSceneReady = true;
  // 画布在隐藏 Tab / 隐藏模式内尺寸为 0，ResizeObserver 在显示后会触发重绘
  if ('ResizeObserver' in window) {
    new ResizeObserver(drawClassScene).observe(classSceneCanvas);
  } else {
    window.addEventListener('resize', drawClassScene);
  }
}

function drawClassStudent(ctx, cx, baseY, s, maxW, maxH) {
  const key = hasClassKey(s && s.key) ? s.key : 'naughty';
  const c = CLASS_SCENE_COLOR[key] || CLASS_SCENE_COLOR.naughty;

  // 立绘状态：举手 → raise；发言 → default（张嘴）；其余 → closed（闭嘴）。
  // 判定只在 classroom-roster.js 的 portraitStateOf 里有一份，卡片与画布不会各说一套。
  const artState = portraitStateOf(s);

  // 立绘：用户提供的三张 SVG（透明背景、矢量、随 dpr 清晰）。
  // 加载成功用立绘；失败则退回下面的简笔小人，课堂场景不会因素材缺失而空掉。
  const art = window.jtqStudentArt ? window.jtqStudentArt.get(key, artState) : null;
  const ratio = window.jtqStudentArt ? window.jtqStudentArt.ratioOf(key) : 0.78;

  // 尺寸公式只在 classroom-roster.js 里有一份：命中盒子用的是同一个函数，
  // 所以「画出来的框」和「能点中的框」永远一样大。
  const size = figSize(maxW, maxH, ratio);
  const figH = size.h;
  const figW = size.w;
  const left = cx - figW / 2;
  const top = baseY - figH;

  // 地面投影：让立绘「站」在教室地面上，而不是浮着
  ctx.save();
  ctx.globalAlpha = 0.12;
  ctx.fillStyle = '#25312C';
  ctx.beginPath();
  ctx.ellipse(cx, baseY - 1, figW * 0.38, Math.max(2.5, figH * 0.03), 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  if (art) {
    // art 已经是按内容包围盒烘焙好的位图（见 students-art.js 的 bake），
    // 直接 4 参数绘制即可，三个人物天然等高
    ctx.drawImage(art, left, top, figW, figH);
  } else {
    // 简笔兜底：总高约 60 单位，与旧版比例一致
    const scale = figH / 60;
    const headY = baseY - 42 * scale;
    ctx.fillStyle = c.body;
    roundRect(ctx, cx - 17 * scale, headY + 7 * scale, 34 * scale, 32 * scale, 10 * scale);
    ctx.fill();
    ctx.fillStyle = c.skin;
    ctx.beginPath();
    ctx.arc(cx, headY, 18 * scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#25312C';
    ctx.beginPath();
    ctx.arc(cx - 6 * scale, headY - 1 * scale, 1.6 * scale, 0, Math.PI * 2);
    ctx.arc(cx + 6 * scale, headY - 1 * scale, 1.6 * scale, 0, Math.PI * 2);
    ctx.fill();
  }

  // 举手：立绘本身就有「raise」状态（真实举手），这里不再画 ✋ 符号。
  // 符号只是占位，真正的举手动作由状态立绘表达（见上方 artState）。

  // 发言高亮：头顶一枚带柔光的小圆点
  if (s && s.speaking) {
    ctx.save();
    ctx.fillStyle = 'rgba(79,70,229,.16)';
    ctx.beginPath();
    ctx.arc(cx, top - 2, 8.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = getCssVar('--brand', '#4F46E5');
    ctx.beginPath();
    ctx.arc(cx, top - 2, 3.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

/**
 * 名牌 + 专注度条（画在课桌层之上，所以压在桌面上，像桌上立着的姓名牌）。
 *
 * 为什么单独成函数：课堂画面要分三层画 ——
 *   背景（墙/黑板）→ 人物 → 课桌 → 名牌。
 * 名牌顺序反了就会被课桌挡掉，名字读不出来。
 */
function drawClassOverlay(ctx, cx, baseY, s, maxW, maxH) {
  const key = hasClassKey(s && s.key) ? s.key : 'naughty';
  const meta = CLASS_META[key];
  const ratio = window.jtqStudentArt ? window.jtqStudentArt.ratioOf(key) : 0.78;
  const size = figSize(maxW, maxH, ratio);
  const figW = size.w;
  const figH = size.h;

  const label = meta.name + ' · ' + String(meta.desc || '').replace('型', '');
  ctx.font = '600 ' + Math.max(10, Math.round(figH * 0.075)) + 'px sans-serif';
  ctx.textAlign = 'center';
  const textW = ctx.measureText(label).width;

  // 纸片名牌：小小一张卡片立在桌沿上
  const cardW = textW + 20;
  const cardH = Math.max(15, Math.round(figH * 0.095));
  const cardX = cx - cardW / 2;
  const cardY = baseY + 4;
  ctx.save();
  ctx.fillStyle = 'rgba(88,72,48,.18)';
  roundRect(ctx, cardX, cardY + 2, cardW, cardH, 4);
  ctx.fill();
  ctx.fillStyle = 'rgba(250,246,237,.95)';
  roundRect(ctx, cardX, cardY, cardW, cardH, 4);
  ctx.fill();
  ctx.strokeStyle = 'rgba(150,130,96,.5)';
  ctx.lineWidth = 1;
  roundRect(ctx, cardX + 0.5, cardY + 0.5, cardW - 1, cardH - 1, 4);
  ctx.stroke();
  ctx.fillStyle = '#3d3327';
  ctx.fillText(label, cx, cardY + cardH * 0.7);
  ctx.restore();

  // 专注度：立绘本身不能染色，还是用脚下细条表达
  const barW = figW * 0.6;
  const barY = cardY + cardH + 5;
  ctx.fillStyle = 'rgba(120,102,72,.22)';
  roundRect(ctx, cx - barW / 2, barY, barW, 3, 1.5);
  ctx.fill();
  // scoreOf 保证非法值（空白串 / 数组）不会画成 0 长度的红色条
  const attention = s ? scoreOf(s.attention) : null;
  if (attention !== null) {
    const pct = attention / 100;
    ctx.fillStyle = stateColor(attention);
    roundRect(ctx, cx - barW / 2, barY, barW * pct, 3, 1.5);
    ctx.fill();
  }
}

/**
 * 画一张教室矢量图层（背景 / 课桌）。
 * SVG 本身分辨率无关，不需要像立绘那样先烘焙成位图，
 * 直接 drawImage 到目标尺寸即可。
 */
function drawClassroomLayer(ctx, W, H, name) {
  const art = window.jtqClassroomArt ? window.jtqClassroomArt.get(name) : null;
  if (!art) return false;
  try {
    ctx.drawImage(art, 0, 0, W, H);
  } catch (_) {
    return false;
  }
  return true;
}

/** 矢量课桌层缺失时的兜底：一条木色桌沿 + 前挡板，位置与 desks.svg 对齐。 */
function drawDeskFallback(ctx, W, H) {
  const topY = H * 0.795;
  const edgeY = H * 0.8275;
  ctx.fillStyle = '#cbb189';
  ctx.fillRect(0, topY, W, edgeY - topY);
  ctx.fillStyle = '#e9d8ba';
  ctx.fillRect(0, topY, W, 2);
  ctx.fillStyle = '#b0926c';
  ctx.fillRect(0, edgeY, W, H - edgeY);
  ctx.fillStyle = 'rgba(120,102,72,.25)';
  ctx.fillRect(0, edgeY - 2, W, 2);
}

function drawClassScene() {
  if (!classSceneReady) setupClassScene();
  if (!classSceneCtx || !classSceneCanvas || classMode.hidden) return;

  const rect = classSceneCanvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.round(rect.width * dpr);
  const h = Math.round(rect.height * dpr);
  if (classSceneCanvas.width !== w || classSceneCanvas.height !== h) {
    classSceneCanvas.width = w;
    classSceneCanvas.height = h;
  }

  const ctx = classSceneCtx;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);

  const W = rect.width, H = rect.height;

  // 教室背景：优先用矢量图层（教室美术层里的 backdrop）。
  // 这张图是可编辑资产 —— Inkscape / Figma 改完直接替换文件即可，
  // 不用动这里。加载失败才退回代码画的扁平背景。
  const hasBackdrop = drawClassroomLayer(ctx, W, H, 'backdrop');
  if (!hasBackdrop) {
    ctx.fillStyle = getCssVar('--bg', '#F4F9FF');
    ctx.fillRect(0, 0, W, H);
    const boardX = W * 0.17, boardY = H * 0.035, boardW = W * 0.66, boardH = H * 0.185;
    ctx.fillStyle = '#244C42';
    roundRect(ctx, boardX, boardY, boardW, boardH, 10);
    ctx.fill();
  }

  // 黑板上的课题文字留在画布上：它是动态的（跟着当前试讲内容变），
  // 矢量图层里只放不变的美术部分。
  const topic = (lastSubject || '').trim();
  ctx.fillStyle = '#F1F5F2';
  ctx.textAlign = 'center';
  ctx.font = '600 ' + Math.round(H * 0.058) + 'px sans-serif';
  ctx.fillText(topic ? ('课题：' + truncateStr(topic, 18)) : '课堂目标板', W * 0.5, H * 0.035 + H * 0.185 * 0.46);
  ctx.font = Math.round(H * 0.042) + 'px sans-serif';
  ctx.fillStyle = '#D6E7DF';
  ctx.fillText('三学生课堂 · 模拟状态', W * 0.5, H * 0.035 + H * 0.185 * 0.82);

  // 地面：不再画横线。横线正好压在立绘脚部，视觉上像人物被截断；
  // 改为每个角色脚下的投影椭圆来锚定（在 drawClassStudent 里画）。
  // 教师视角：教师本人不在画内（原讲台+圆点已撤，立绘放大后没有位置）。
  const floorY = H * 0.845;

  // 学生（复用 lastClassStates；为空时退化为默认三人）
  const states = (lastClassStates && lastClassStates.length)
    ? lastClassStates
    : idleRoster();
  // 按实际人数均分站位：非法角色被过滤后只剩两人时，不该继续挤在左半边
  const seated = states.slice(0, 3);
  const ratioOf = (k) => (window.jtqStudentArt ? window.jtqStudentArt.ratioOf(k) : 0.78);
  // 站位算一次存下来：点击命中直接读这份，保证「画在哪」和「点得中哪」是同一份数据
  const slots = sceneLayout(seated, W, H, ratioOf);
  lastClassSlots = slots;
  const baseY = floorY;
  const maxH = H * 0.62;
  const maxW = W * 0.27;
  seated.forEach((s, i) => {
    const cx = slots[i] ? slots[i].cx : W * 0.5;
    drawClassStudent(ctx, cx, baseY, s, maxW, maxH);
  });

  // 课桌层画在人物之后：立绘是半身裁切，平底看着像被切断；
  // 桌子一挡就自然变成「学生坐在桌后」。矢量层缺失时用代码兜底。
  if (!drawClassroomLayer(ctx, W, H, 'desks')) {
    drawDeskFallback(ctx, W, H);
  }

  // 名牌与专注度条压在桌面上（必须在课桌之后画，否则会被桌子挡住）
  seated.forEach((s, i) => {
    const cx = slots[i] ? slots[i].cx : W * 0.5;
    drawClassOverlay(ctx, cx, baseY, s, maxW, maxH);
  });

  // 视角说明
  ctx.fillStyle = 'rgba(58,46,30,.42)';
  ctx.textAlign = 'left';
  ctx.font = Math.round(H * 0.038) + 'px sans-serif';
  ctx.fillText('教师视角', W * 0.05, H * 0.965);
}

function classBubble(name, text, kind) {
  const div = document.createElement('div');
  div.className = 'msg ' + (kind === 'teacher' ? 'tea' : 'stu');
  div.innerHTML = '<b>' + escapeHtml(name) + '</b><div class="bubble-text">' + escapeHtml(text) + '</div>';
  classLog.appendChild(div);
  classLog.scrollTop = classLog.scrollHeight;
  return div;
}

function classSysBubble(html) {
  const div = document.createElement('div');
  div.className = 'msg sys';
  div.innerHTML = html;
  classLog.appendChild(div);
  classLog.scrollTop = classLog.scrollHeight;
}

async function classNextRound() {
  if (classDoomed) return;
  // 点名还没回来时不推进整轮：否则两路请求会同时改写 lastClassStates
  if (classCallBusy) return;
  classNextBtn.disabled = true;
  classNextBtn.textContent = '课堂进行中…';
  const lastTeacher = classMessages.filter((m) => m.role === 'teacher').slice(-1)[0];
  try {
    const data = await post('/api/classroom/round', {
      topic: lastSubject || subjectInput.value.trim(),
      transcript: lastScript,
      teacherAnswer: lastTeacher ? lastTeacher.content : '',
      pressure: classPressure,
      history: classMessages,
      // 学情快照（可选字段，缺省时后端走原逻辑）
      profile: cfgCurrentProfilePayload(),
    });
    if (data.verdict) {
      classSysBubble('<b>🔍 课堂观察员：</b>' + escapeHtml(data.verdict));
    }
    // 非法角色在源头就丢掉：不占卡片、不占站位、不产生气泡与朗读。
    // 允许 renderClassStudents 里再兜一层，但入口必须先滤干净。
    const incoming = (Array.isArray(data.students) ? data.students : [])
      .filter((s) => s && typeof s === 'object' && hasClassKey(s.key));
    const states = [];
    for (const s of incoming) {
      // 非法角色不顶替成小皮参与气泡与朗读：key 归空，卡片走兜底展示
      const key = hasClassKey(s.key) ? s.key : '';
      const meta = CLASS_META[key || 'naughty'];
      const nm = s.name || meta.name;
      const card = {
        key: key,
        mood: s.mood, hand_raise: s.hand_raise, speaking: true,
        attention: s.attention, comprehension: s.comprehension, state_reason: s.state_reason,
        difficulty: s.difficulty,
      };
      states.push(card);
      renderClassStudents(states);
      try {
        await new Promise((r) => setTimeout(r, 450)); // 依次发言，像真实课堂
        const isBc = data.backchannel && data.backchannel.key === s.key;
        classBubble(nm + ' ' + (s.mood || '') + (isBc ? ' · 附和' : ''), s.line, 'student');
        speak(s.line, { scene: 'class', key: card.key });
        classMessages.push({ role: 'student', name: nm, content: s.line });
      } finally {
        // 必须写在 finally：中途任何异常都不能让角色永远停在「正在发言」，
        // 否则头顶发言圆点和卡片高亮会一直亮着，直到下一次重开课堂。
        card.speaking = false;
        renderClassStudents(states);
      }
    }
    renderClassStudents(incoming.map((s) => ({
      key: s.key, mood: s.mood, hand_raise: s.hand_raise,
      attention: s.attention, comprehension: s.comprehension, state_reason: s.state_reason,
      difficulty: s.difficulty,
    })));
    updatePressure(data.pressure_delta, data.pressure_reason);
    cfgApplyBackendProfile({
      profile_applied: data.profile_applied,
      difficulty: incoming[0] ? incoming[0].difficulty : '',
      profile_effect: data.profile_effect,
    });
    renderCockpit();
    if (data.pressure_reason) {
      classSysBubble('<span style="color:#64748B;font-size:12px">压力变化：' + escapeHtml(data.pressure_delta > 0 ? '+' : '') + data.pressure_delta + ' · ' + escapeHtml(data.pressure_reason) + '</span>');
    }
  } catch (e) {
    setErr(e.message || '课堂回合失败');
  } finally {
    classNextBtn.disabled = false;
    classNextBtn.textContent = '下一轮课堂 →';
  }
}

/* ---------- 课堂点名：点谁谁答 ----------
 * 为什么值得单独做：一轮课堂是「三人一起反应」，老师只能接着话往下讲，
 * 没有「我主动问某一个人」这个动作 —— 而这恰恰是试讲里最常被扣分的环节
 * （点名对象是否明确、等待是否够、点了之后怎么接）。
 *
 * 三个约束，缺一不可：
 *   1. 只能点「当前真的在座」的学生（后端可能只返回 2 人，第 3 个不该能点）；
 *   2. 同一时刻只能有一次点名（连点会并发打出多条请求，学生自己跟自己抢话）；
 *   3. 点名的结果必须进 classMessages，否则下一轮模型不知道这件事发生过。
 */
let classCallBusy = false;

function callOnAllowedKey(key) {
  if (!hasClassKey(key)) return false;
  if (classDoomed) return false;
  if (!lastClassStates || !lastClassStates.length) return false;
  return lastClassStates.some((s) => s && s.key === key);
}

async function callOnStudent(key, instruction) {
  if (classCallBusy) return;
  if (!callOnAllowedKey(key)) return false;
  // 上一轮课堂还在跑的时候不许插队：两边都会改 lastClassStates，同时进行会互相覆盖
  if (classNextBtn && classNextBtn.disabled) return false;

  const target = lastClassStates.find((s) => s && s.key === key);
  if (!target) return false;
  const meta = CLASS_META[key];
  const said = String(instruction || '').trim();

  classCallBusy = true;
  target.speaking = true;
  renderClassStudents(lastClassStates);

  // 老师自己说的话也算数：先落到对话记录里，模型才知道「老师是怎么问的」。
  // 只叫了名字没给任何提示时，不伪造老师台词。
  if (said) {
    classBubble('你（老师）', said, 'teacher');
    classMessages.push({ role: 'teacher', content: said });
  } else {
    classSysBubble('📣 <b>点名</b>：' + escapeHtml(meta.name));
  }

  try {
    const data = await post('/api/classroom/call-on', {
      key: key,
      topic: lastSubject || (subjectInput ? subjectInput.value.trim() : ''),
      transcript: lastScript,
      callInstruction: said,
      pressure: classPressure,
      history: classMessages,
      profile: cfgCurrentProfilePayload(),
    });
    const line = String((data && data.line) || '').trim();
    if (!line) throw new Error('点名没有得到回应');

    classBubble(meta.name + ' ' + ((data && data.mood) || ''), line, 'student');
    speak(line, { scene: 'class', key: key });
    classMessages.push({ role: 'student', name: meta.name, content: line });

    // 把回应带来的状态变化写回这名学生，而不是整班重排：
    // 点名只影响被点的人，其他两位的分数不该凭空跳动。
    target.mood = (data && data.mood) || target.mood;
    if (scoreOf(data && data.attention) !== null) target.attention = scoreOf(data.attention);
    if (scoreOf(data && data.comprehension) !== null) target.comprehension = scoreOf(data.comprehension);
    if (data && data.state_reason) target.state_reason = data.state_reason;
    if (data && data.difficulty) target.difficulty = data.difficulty;

    updatePressure(Number(data && data.pressure_delta) || 0, (data && data.pressure_reason) || '');
    if (data && data.engine === 'rule') {
      // 引擎降级时说清楚，别让用户以为模型真的懂教学
      classSysBubble('<span style="color:#64748B;font-size:12px">点名回应来自本地规则引擎（' +
        escapeHtml(fallbackReasonText(data.fallback_reason)) + '）</span>');
    }
    return true;
  } catch (e) {
    setErr(e.message || '点名失败');
    return false;
  } finally {
    // 必须写在 finally：请求异常时也要把「正在发言」摘掉，否则圆点会一直亮着
    target.speaking = false;
    classCallBusy = false;
    renderClassStudents(lastClassStates);
  }
}

/* 降级原因 → 人话（只覆盖此接口可能出现的三种，其余归为「模型调用失败」） */
function fallbackReasonText(reason) {
  if (reason === 'key-not-configured') return '未配置模型 Key';
  if (reason === 'rate-limited') return '上游限流';
  if (reason === 'insufficient-balance') return '模型余额不足';
  if (reason === 'auth-failed') return '鉴权失败';
  return '模型调用失败';
}

/* 卡片点击：事件委托在容器上。
 * 不能用每张卡单独绑定 —— renderClassStudents 每轮 innerHTML 重建，
 * 单独绑的监听器会随旧节点一起被丢掉，而且会越积越多。 */
if (classStudentsBox) {
  classStudentsBox.addEventListener('click', (e) => {
    const card = e.target.closest ? e.target.closest('.cs-card') : null;
    if (!card) return;
    const key = card.getAttribute('data-k');
    if (!key) return; // 非法角色的卡片没有 data-k，不可点
    const said = classInput ? classInput.value.trim() : '';
    if (said && classInput) classInput.value = '';
    callOnStudent(key, said);
  });
  classStudentsBox.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
    const card = e.target.closest ? e.target.closest('.cs-card') : null;
    if (!card) return;
    const key = card.getAttribute('data-k');
    if (!key) return;
    e.preventDefault();
    const said = classInput ? classInput.value.trim() : '';
    if (said && classInput) classInput.value = '';
    callOnStudent(key, said);
  });
}

/* 画布点击：点画上的学生也能点名。
 * 命中盒子读的是 lastClassSlots（绘制时存下的同一份），不重新算坐标。 */
if (classSceneCanvas) {
  classSceneCanvas.addEventListener('click', (e) => {
    if (classDoomed) return;
    const rect = classSceneCanvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const slot = sceneHitTest(lastClassSlots, e.clientX - rect.left, e.clientY - rect.top, 4);
    if (!slot || !hasClassKey(slot.key)) return;
    const said = classInput ? classInput.value.trim() : '';
    if (said && classInput) classInput.value = '';
    callOnStudent(slot.key, said);
  });
}

function resetClass() {
  // 重新开课时必须掐掉上一节课的朗读：speak() 是往浏览器全局 TTS 队列里塞，
  // 不清就会出现「新课堂已经开局，耳边还在念上一轮台词」。
  // stopSpeak() 之前只有定义没有调用点（死代码），这里把它接上。
  stopSpeak();
  classPressure = 20;
  classMessages = [];
  classDoomed = false;
  classCallBusy = false;
  doomedOverlay.style.display = 'none';
  updatePressure(0, '');
  pressureNum.textContent = '20';
  classLog.innerHTML = '<div class="msg sys">上课了。全班盯着你——小皮在转笔，小霸在预习，小走盯着窗外。<br>点「下一轮课堂」开始，或在输入框回应学生（也可以点 🎤 直接说）。</div>';
  renderClassStudents();
  renderCockpit(); // 清空后同步驾驶舱，避免残留上一轮数值
  drawClassScene();
}

/* 老师这句话到底有没有被「听见」：
 * 旧实现只有「回车提交」才会把老师的话写进 classMessages，
 * 如果老师在输入框里打了字、却直接点「下一轮课堂」按钮，这段文字会被静默丢掉 ——
 * 模型拿到的 teacherAnswer 是空的，于是学生像完全没听见一样继续自顾自发难。
 * 收口成一个函数，按钮和回车走同一条路。 */
function commitClassTeacherInput() {
  if (!classInput) return false;
  const text = classInput.value.trim();
  if (!text) return false;
  classInput.value = '';
  classBubble('你（老师）', text, 'teacher');
  classMessages.push({ role: 'teacher', content: text });
  return true;
}

if (classNextBtn) classNextBtn.addEventListener('click', () => {
  commitClassTeacherInput();
  classNextRound();
});
if (classResetBtn) classResetBtn.addEventListener('click', resetClass);
if ($('doomedRetry')) $('doomedRetry').addEventListener('click', resetClass);
if (classForm) classForm.addEventListener('submit', (e) => {
  e.preventDefault();
  if (!commitClassTeacherInput()) return;
  classNextRound();
});

/* ---------- 课堂语音回嘴（点🎤说话，识别完自动提交） ---------- */
const classMicBtn = $('classMicBtn');
let classRecog = null;
let classListening = false;

function stopClassMic() {
  if (classRecog) { try { classRecog.stop(); } catch (e) { /* noop */ } }
  classListening = false;
  if (classMicBtn) { classMicBtn.textContent = '🎤'; classMicBtn.classList.remove('rec'); }
}

if (classMicBtn) {
  classMicBtn.addEventListener('click', () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setErr('当前浏览器不支持语音输入，请用 Chrome / Edge，或直接打字回应');
      return;
    }
    if (classListening) { stopClassMic(); return; }
    try {
      classRecog = new SR();
      classRecog.lang = 'zh-CN';
      classRecog.continuous = false;   // 说完一句自动结束
      classRecog.interimResults = true; // 边说边出字，现场更有反馈感
      classRecog.onresult = (ev) => {
        let text = '';
        for (let i = 0; i < ev.results.length; i++) text += ev.results[i][0].transcript;
        classInput.value = text;
      };
      classRecog.onerror = (ev) => {
        if (ev.error !== 'no-speech') setErr('语音识别出错：' + ev.error + '（需允许麦克风权限）');
        stopClassMic();
      };
      classRecog.onend = () => {
        stopClassMic();
        const t = classInput.value.trim();
        if (t.length >= 2) {
          unlockBadge('voice', '开口练习', '🎤', '使用过一次语音输入');
          // 说完即发：现场不打字，直接开口应答
          if (typeof classForm.requestSubmit === 'function') classForm.requestSubmit();
          else classForm.dispatchEvent(new Event('submit', { cancelable: true }));
        }
      };
      classRecog.start();
      classListening = true;
      classMicBtn.textContent = '⏺';
      classMicBtn.classList.add('rec');
      setErr('');
    } catch (e) {
      setErr('无法启动语音识别：' + (e && e.message ? e.message : '未知错误'));
    }
  });
}

/* ==================================================================
   🎯 单人拆台：也是「课堂」，只是台上只有一名学生
   ------------------------------------------------------------------
   要求（用户 2026-10-30）：单个学生也要按多人课堂的学生模型来。
   于是单人模式不再只是「一个聊天头像」，而是复用台上那整套东西：

     · 同一个学生对象  → classroom-roster.js 的 makeStudent()
     · 同一张立绘      → students-art.js（default / closed / raise 三态）
     · 同一套状态机    → portraitStateOf()：举手 > 发言 > 闭嘴
     · 同一张学生卡    → studentCardHtml()
     · 同一块教室场景  → 同一份 backdrop/desks 矢量层 + 同一套取景参数

   唯一的区别是取景：1 人时 sceneLayout() 把人摆在正中（roster 里早有这支分支）。
   数值口径也照旧：单人接口没有专注/理解数据，学生卡就不画这两根条，
   绝不填 0 —— 缺失不能伪装成结论。
   ================================================================== */
let soloCtx = null;
let soloReady = false;
let soloSlots = [];
let soloStudent = null;
let soloRaiseTimer = 0;

function setupSoloScene() {
  if (soloReady || !soloSceneCanvas) return;
  soloCtx = soloSceneCanvas.getContext('2d');
  if (!soloCtx) return;
  soloReady = true;
  // 画布在隐藏模式 / 隐藏 Tab 里尺寸为 0，显示后需要重绘
  if ('ResizeObserver' in window) {
    new ResizeObserver(drawSoloScene).observe(soloSceneCanvas);
  } else {
    window.addEventListener('resize', drawSoloScene);
  }
}

/** 单人模式的学生：换人设 / 自定义人设时重建；只是改状态时用 setSoloState */
function resetSoloStudent() {
  const custom = $('customPersona') ? $('customPersona').value.trim() : '';
  soloStudent = makeStudent(currentPersona, custom
    ? { name: '定制学生', state_reason: '自定义人设：' + truncateStr(custom, 26) }
    : {});
  renderSoloStudent();
}

/** 只改状态字段（举手 / 发言 / 难度），不换人 */
function setSoloState(patch) {
  const custom = $('customPersona') ? $('customPersona').value.trim() : '';
  const merged = Object.assign({}, soloStudent || {}, patch || {});
  if (custom) {
    merged.name = '定制学生';
    if (!merged.state_reason) merged.state_reason = '自定义人设：' + truncateStr(custom, 26);
  }
  soloStudent = makeStudent(currentPersona, merged);
  renderSoloStudent();
  return soloStudent;
}

function renderSoloStudent() {
  if (soloStudentsBox) {
    const s = soloStudent || makeStudent(currentPersona);
    soloStudentsBox.innerHTML = studentCardHtml(s, { aria: '让 ' + s.name + ' 提问' });
  }
  drawSoloScene();
}

function drawSoloScene() {
  if (!soloReady) setupSoloScene();
  if (!soloCtx || !soloSceneCanvas || (soloMode && soloMode.hidden)) return;

  const rect = soloSceneCanvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.round(rect.width * dpr);
  const h = Math.round(rect.height * dpr);
  if (soloSceneCanvas.width !== w || soloSceneCanvas.height !== h) {
    soloSceneCanvas.width = w;
    soloSceneCanvas.height = h;
  }

  const ctx = soloCtx;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);

  const W = rect.width, H = rect.height;

  // 与三学生课堂同一块教室背景（矢量层缺失时同一份代码兜底）
  if (!drawClassroomLayer(ctx, W, H, 'backdrop')) {
    ctx.fillStyle = getCssVar('--bg', '#F4F9FF');
    ctx.fillRect(0, 0, W, H);
    const boardX = W * 0.17, boardY = H * 0.035, boardW = W * 0.66, boardH = H * 0.185;
    ctx.fillStyle = '#244C42';
    roundRect(ctx, boardX, boardY, boardW, boardH, 10);
    ctx.fill();
  }

  // 黑板上的课题文字是动态的，留在画布上（同多人课堂）
  const topic = (lastSubject || '').trim();
  ctx.fillStyle = '#F1F5F2';
  ctx.textAlign = 'center';
  ctx.font = '600 ' + Math.round(H * 0.058) + 'px sans-serif';
  ctx.fillText(topic ? ('课题：' + truncateStr(topic, 18)) : '课堂目标板', W * 0.5, H * 0.035 + H * 0.185 * 0.46);
  ctx.font = Math.round(H * 0.042) + 'px sans-serif';
  ctx.fillStyle = '#D6E7DF';
  ctx.fillText('单人拆台 · 模拟状态', W * 0.5, H * 0.035 + H * 0.185 * 0.82);

  const s = soloStudent || makeStudent(currentPersona);
  const ratioOf = (k) => (window.jtqStudentArt ? window.jtqStudentArt.ratioOf(k) : 0.78);
  // 取景参数与多人课堂完全一致（maxH 0.62 / maxW 0.27），
  // 这样「同一个学生」在两处的大小、站位手感一致，命中盒也不必另算一套。
  const slots = sceneLayout([s], W, H, ratioOf);
  soloSlots = slots;
  const baseY = H * 0.845;
  const maxH = H * 0.62;
  const maxW = W * 0.27;
  const cx = slots[0] ? slots[0].cx : W * 0.5;

  drawClassStudent(ctx, cx, baseY, s, maxW, maxH);
  if (!drawClassroomLayer(ctx, W, H, 'desks')) drawDeskFallback(ctx, W, H);
  drawClassOverlay(ctx, cx, baseY, s, maxW, maxH);

  ctx.fillStyle = 'rgba(58,46,30,.42)';
  ctx.textAlign = 'left';
  ctx.font = Math.round(H * 0.038) + 'px sans-serif';
  ctx.fillText('教师视角', W * 0.05, H * 0.965);
}

/* 单人场景：点学生 = 让他开口（与课堂「点谁谁答」同一个动线） */
if (soloSceneCanvas) {
  soloSceneCanvas.addEventListener('click', (e) => {
    const rect = soloSceneCanvas.getBoundingClientRect();
    const hit = sceneHitTest(soloSlots, e.clientX - rect.left, e.clientY - rect.top, 8);
    if (!hit) return;
    if (askBtn && askBtn.disabled) return;
    callStudent();
  });
}

/* 单人学生卡：点击 / 回车也能让他开口 */
if (soloStudentsBox) {
  const trigger = () => {
    if (askBtn && askBtn.disabled) return;
    callStudent();
  };
  soloStudentsBox.addEventListener('click', trigger);
  soloStudentsBox.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      trigger();
    }
  });
}

/* ---------- AI 学生对话（单人模式） ---------- */
function resetChat() {
  messages = [];
  chatLog.innerHTML = '<div class="msg sys">选好性格，点下面的按钮，AI 学生就会基于你的讲稿向你发难。</div>';
  // 重新开一轮 = 学生回到「还没开口」：闭嘴、不举手。
  // 走的是同一套学生模型，不是单独往 DOM 里塞个表情。
  clearTimeout(soloRaiseTimer);
  if (soloStudentsBox) setSoloState({ hand_raise: false, speaking: false, mood: '😊' });
}

/* 气泡头像与课堂学生卡用的是同一张立绘（同一个学生只能有一张脸）。
 * 立绘取不到时退回原来的「学」字，不会留破图标。 */
function soloAvatarHtml() {
  const key = hasClassKey(currentPersona) ? currentPersona : 'naughty';
  const src = (window.jtqStudentArt && window.jtqStudentArt.srcOf)
    ? window.jtqStudentArt.srcOf(key, portraitStateOf(soloStudent))
    : '';
  if (!src) return '<span class="av">学</span>';
  return '<span class="av av-stu">学' +
    '<img src="' + src + '" alt="" decoding="async" onerror="this.remove()">' +
    '</span>';
}

function addBubble(role, text, label) {
  const wrap = document.createElement('div');
  wrap.className = 'msg' + (role === 'teacher' ? ' out' : '');
  wrap.innerHTML =
    (role === 'teacher' ? '<span class="av">师</span>' : soloAvatarHtml()) +
    '<div class="bub">' +
    (label ? '<small>' + escapeHtml(label) + '</small>' : '') +
    escapeHtml(text) +
    '</div>';
  chatLog.appendChild(wrap);
  chatLog.scrollTop = chatLog.scrollHeight;
  if (role === 'student') speak(text, { scene: 'chat', pitch: 1.05 }); // 勾选朗读时用语音念出来
}

function addTyping() {
  const wrap = document.createElement('div');
  wrap.className = 'msg';
  wrap.innerHTML =
    soloAvatarHtml() + '<div class="bub"><span class="typing"><i></i><i></i><i></i></span></div>';
  chatLog.appendChild(wrap);
  chatLog.scrollTop = chatLog.scrollHeight;
  return wrap;
}

async function callStudent() {
  setErr('');
  askBtn.disabled = true;
  // 与多人课堂同一套状态机：先举手（立绘换 raise），再开口（speaking → 张嘴）。
  // 550ms 是人「举手—开口」的自然间隔，太快看起来像抽搐。
  clearTimeout(soloRaiseTimer);
  setSoloState({ hand_raise: true, speaking: false });
  soloRaiseTimer = setTimeout(() => setSoloState({ hand_raise: false, speaking: true }), 550);
  const typing = addTyping();
  try {
    const data = await post('/api/student/chat', {
      messages,
      persona: currentPersona,
      customPersona: $('customPersona') ? $('customPersona').value.trim() : '',
      topic: lastSubject || subjectInput.value.trim(),
      transcript: lastScript,
      // 学情快照（可选字段，缺省时后端走原逻辑）
      profile: cfgCurrentProfilePayload(),
    });
    if (typing.parentNode) typing.parentNode.removeChild(typing);
    messages.push({ role: 'student', content: data.reply });
    cfgApplyBackendProfile({
      profile_applied: data.profile_applied,
      difficulty: data.difficulty,
      profile_summary: data.profile_summary,
    });
    const cp = $('customPersona') ? $('customPersona').value.trim() : '';
    // 学生对话的来源标记：模型调用失败降级时，用同一套降级原因措辞说明原因。
    addBubble(
      'student',
      data.reply,
      (cp ? '定制学生' : (data.label || 'AI 学生')) +
        (data.engine === 'llm' ? '' : ' · 本地' + degradedSuffix(data.fallback_reason))
    );
    // 难度标签沿用课堂学生卡的口径（basic / core / advanced，白名单外不显示）
    clearTimeout(soloRaiseTimer);
    setSoloState({ hand_raise: false, speaking: false, difficulty: data.difficulty || '' });
  } catch (e) {
    if (typing.parentNode) typing.parentNode.removeChild(typing);
    clearTimeout(soloRaiseTimer);
    setSoloState({ hand_raise: false, speaking: false });
    setErr(e.message || '学生提问失败');
  } finally {
    askBtn.disabled = false;
  }
}

/* ---------- 语音输入（Web Speech API 实时听写） ---------- */
const dictateBtn = $('dictateBtn');
const dictateTip = $('dictateTip');
let recog = null;
let dictating = false;

function stopDictate() {
  if (recog) { try { recog.stop(); } catch (e) { /* noop */ } }
  dictating = false;
  if (dictateTip) dictateTip.hidden = true;
  if (dictateBtn) dictateBtn.textContent = '🎤 语音输入';
}

if (dictateBtn) {
  dictateBtn.addEventListener('click', () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setErr('当前浏览器不支持语音输入，建议使用 Edge 或 Chrome');
      return;
    }
    if (dictating) { stopDictate(); return; }
    try {
      recog = new SR();
      recog.lang = 'zh-CN';
      recog.continuous = true;
      recog.interimResults = true;
      let base = scriptInput.value;
      recog.onresult = (ev) => {
        let interim = '';
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const t = ev.results[i][0].transcript;
          if (ev.results[i].isFinal) base += t; else interim += t;
        }
        scriptInput.value = base + interim;
        charHint.textContent = scriptInput.value.replace(/\s/g, '').length + ' 字';
      };
      recog.onerror = (ev) => {
        setErr('语音识别出错：' + (ev.error || '未知') + '（需允许麦克风权限）');
        stopDictate();
      };
      recog.onend = () => stopDictate();
      recog.start();
      dictating = true;
      dictateTip.hidden = false;
      dictateBtn.textContent = '■ 停止';
      unlockBadge('voice', '开口练习', '🎤', '使用过一次语音输入');
      setErr('');
    } catch (e) {
      setErr('无法启动语音识别：' + e.message);
    }
  });
}

/* ---------- 双人对比（小组博弈） ---------- */
async function runCompare(aScript, bScript) {
  let box = $('compareBox');
  if (!box) {
    box = document.createElement('div');
    box.id = 'compareBox';
    box.className = 'pano-card';
    box.style.cssText = 'border:1px solid var(--line,#e2e8f0);border-radius:12px;padding:14px 16px;margin:12px 0';
    const insertAt = transcriptHi.parentNode.insertBefore(box, transcriptHi);
  }
  box.innerHTML = '<p style="color:#64748B;font-size:13px">AI 评委正在对比两份讲稿…</p>';
  try {
    const d = await post('/api/compare', {
      transcriptA: aScript, transcriptB: bScript, subject: lastSubject,
    });
    const win = d.winner === 'A' ? 'A 稿（你的）' : 'B 稿（对比稿）';
    box.innerHTML =
      '<b style="font-size:15px">🏆 对比结果：' + escapeHtml(win) + ' 胜出</b>' +
      '<p style="margin:6px 0 10px;font-size:13px;color:#475569">' + escapeHtml(d.verdict || '') + '</p>' +
      '<div style="display:flex;gap:12px;flex-wrap:wrap">' +
      ['A', 'B'].map((k) => {
        const s = k === 'A' ? d.score_a : d.score_b;
        const st = k === 'A' ? d.a_strengths : d.b_strengths;
        const wk = k === 'A' ? d.a_weaknesses : d.b_weaknesses;
        return '<div style="flex:1;min-width:200px;border:1px solid var(--line,#e2e8f0);border-radius:10px;padding:10px 12px">' +
          '<b>' + k + ' 稿 <span style="color:var(--brand,#4F46E5)">' + s + '</span> 分</b>' +
          '<p style="margin:6px 0 4px;font-size:12px;color:#16a34a">+ ' + escapeHtml((st || []).join('；') || '—') + '</p>' +
          '<p style="margin:0;font-size:12px;color:#dc2626">− ' + escapeHtml((wk || []).join('；') || '—') + '</p>' +
          '</div>';
      }).join('') + '</div>' +
      (d.learn_each_other ? '<p style="margin:10px 0 0;font-size:13px;color:#64748b">💡 ' + escapeHtml(d.learn_each_other) + '</p>' : '');
  } catch (e) {
    box.innerHTML = '<p style="color:#dc2626;font-size:13px">对比失败：' + escapeHtml(e.message || '') + '</p>';
  }
}

if (compareToggle && scriptBWrap) {
  compareToggle.addEventListener('change', () => {
    const on = compareToggle.value === 'on';
    scriptBWrap.hidden = !on;
    // B 稿输入框在「高级设置」折叠区内，开启双人对比时自动展开，
    // 否则用户看不到刚打开的 B 稿框
    if (on) {
      const adv = document.getElementById('trainingAdvanced');
      if (adv && !adv.open) adv.open = true;
    }
  });
}

/* ---------- 板书拍照评分 ---------- */
const blackboardFile = $('blackboardFile');
const blackboardBtn = $('blackboardBtn');
const blackboardTip = $('blackboardTip');
const blackboardResult = $('blackboardResult');

if (blackboardBtn && blackboardFile) {
  blackboardBtn.addEventListener('click', () => blackboardFile.click());
  blackboardFile.addEventListener('change', async () => {
    const file = blackboardFile.files && blackboardFile.files[0];
    if (!file) return;
    blackboardTip.textContent = '正在评分…';
    blackboardResult.innerHTML = '';
    try {
      const form = new FormData();
      form.append('image', file, file.name);
      form.append('meta', JSON.stringify({ subject: lastSubject, grade: gradeInput.value.trim() }));
      const sc = currentShareCode();
      const bheaders = {};
      if (sc) bheaders['X-Share-Code'] = sc;
      const res = await fetch('/api/blackboard', { method: 'POST', body: form, headers: bheaders });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || '评分失败');
      const d = json.data;
      if (d.mode === 'image') {
        const bbEngineTag = sourceTagSpan(d.engine, d.fallback_reason);
        blackboardResult.innerHTML =
          (bbEngineTag ? '<div style="margin:0 0 8px">' + bbEngineTag + '</div>' : '') +
          '<b>板书综合得分 <span style="color:var(--brand,#4F46E5)">' + d.total_score + '</span></b>' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0">' +
          [['结构', d.structure_score], ['工整', d.legibility_score], ['完整', d.completeness_score], ['版面', d.layout_score]]
            .map(([k, v]) => '<span style="border:1px solid var(--line,#e2e8f0);border-radius:8px;padding:4px 10px;font-size:12px">' + k + ' ' + v + '</span>').join('') +
          '</div>' +
          '<p style="font-size:13px;color:#16a34a;margin:4px 0">+ ' + escapeHtml((d.highlights || []).join('；')) + '</p>' +
          '<p style="font-size:13px;color:#dc2626;margin:4px 0">− ' + escapeHtml((d.problems || []).join('；')) + '</p>' +
          (d.rewrite ? '<pre style="white-space:pre-wrap;background:var(--card,#f8fafc);border:1px solid var(--line,#e2e8f0);border-radius:8px;padding:10px;font-size:12px">' + escapeHtml(d.rewrite) + '</pre>' : '');
      } else {
        const bbEngineTag = sourceTagSpan(d.engine, d.fallback_reason);
        blackboardResult.innerHTML =
          (bbEngineTag ? '<div style="margin:0 0 8px">' + bbEngineTag + '</div>' : '') +
          '<b>板书自检清单</b><p style="font-size:12px;color:#64748B;margin:4px 0 8px">未配置视觉模型，已给出基于《' + escapeHtml(lastSubject || '本节课') + '》的自检清单与模板</p>' +
          '<ul style="margin:0 0 10px;padding-left:18px;font-size:13px">' +
          (d.checklist || []).map((c) => '<li>' + escapeHtml(c) + '</li>').join('') + '</ul>' +
          '<p style="font-size:13px;margin:0 0 6px"><b>板上必须出现：</b>' + escapeHtml((d.key_points || []).join('、')) + '</p>' +
          '<p style="font-size:13px;color:#dc2626;margin:0 0 8px"><b>常见错误：</b>' + escapeHtml((d.common_mistakes || []).join('；')) + '</p>' +
          '<pre style="white-space:pre-wrap;background:var(--card,#f8fafc);border:1px solid var(--line,#e2e8f0);border-radius:8px;padding:10px;font-size:12px;margin:0">' + escapeHtml(d.layout_template || '') + '</pre>';
      }
      blackboardTip.textContent = '评分完成';
    } catch (e) {
      blackboardTip.textContent = '评分失败';
      blackboardResult.innerHTML = '<p style="color:#dc2626;font-size:13px">' + escapeHtml(e.message || '') + '</p>';
    } finally {
      blackboardFile.value = '';
    }
  });
}

/* ---------- 成长档案（本地历史 + 云端记录） ---------- */
const HISTORY_KEY = 'jtq_local_history';

/**
 * 固定演示页的成长轨迹（只读，不落盘）。
 * 演示模式刻意不写 localStorage（见 saveToHistory），
 * 于是成长档案会退回「至少完成 2 次复盘」的空态——路演最后一步变成空白页。
 * 这里给一份内置轨迹，让「练一次 → 看得见进步」这条叙事在演示里成立。
 */
const DEMO_GROWTH_HISTORY = [
  { at: '2026-10-12T09:20:00', subject: '勾股定理 · 初中八年级', score: 52, filler: 9, questions: 3, rate: 168, engine: 'llm' },
  { at: '2026-10-16T19:05:00', subject: '勾股定理 · 初中八年级', score: 63, filler: 6, questions: 4, rate: 182, engine: 'llm' },
  { at: '2026-10-22T10:40:00', subject: '勾股定理 · 初中八年级', score: 71, filler: 4, questions: 5, rate: 195, engine: 'llm' },
  { at: '2026-10-28T20:15:00', subject: '勾股定理 · 初中八年级', score: 78, filler: 2, questions: 6, rate: 206, engine: 'llm' }
];

/**
 * 从报告对象里取一个「可缺省」的计数。
 * 为什么不能写 `(obj || {}).field || 0`：
 *   后端缺字段时它会静默变成 0，把「没有这个数据」显示成「这个值是 0」，
 *   在成长档案里就是凭空多出一个「0 次提问 / 0 字每分」的假结论。
 * 所以：字段存在且是有限数值才返回数字；否则返回 null（前端显示「未测量」）。
 * @param {object} obj   报告里的子对象（如 report.questions）
 * @param {string[]} keys 按优先级尝试的字段名
 * @returns {number|null}
 */
function pickHistoryCount(obj, keys) {
  const src = obj && typeof obj === 'object' ? obj : {};
  for (const key of keys) {
    const v = src[key];
    if (v === null || v === undefined || v === '' || typeof v === 'boolean') continue;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * 成长档案里「最近一次语速」的文案。
 * 0 字/分不是有效测量值（真的讲了课就必然 > 0），显示成「0 字/分」
 * 等于凭空造一个结论 —— 所以凡是不 > 0 的取值一律显示「语速 未测量」。
 * 这样也顺带修正了修复前已经写进 localStorage 的那批假 0 记录。
 */
function describeHistoryRate(rate) {
  const n = Number(rate);
  return Number.isFinite(n) && n > 0 ? '语速 ' + n + ' 字/分' : '语速 未测量';
}

function saveToHistory(report, meta) {
  // 演示页面与演示结果都不进入个人成长档案
  if (
    JTQ_DEMO_PAGE ||
    !report ||
    report.engine === 'offline-demo'
  ) {
    return;
  }

  try {
    const hist = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    hist.push({
      at: new Date().toISOString(),
      subject: meta.subject,
      score: report.overall_score,
      filler: (report.filler_words || {}).total || 0,
      // 提问数：后端 questions 对象里只有 asked（没有 total），
      // 原来读 .total 会恒得 0 —— 成长档案里每一次都显示「0 次提问」。
      // 缺值一律存 null（未测量），不再用 0 冒充「零次提问」。
      questions: pickHistoryCount(report.questions, ['asked', 'total']),
      // 语速同理：chars_per_min 缺失时存 null，不存 0。
      // （0 字/分在任何情况下都不是有效测量值）
      rate: pickHistoryCount(report.speech_rate, ['chars_per_min']),
      // 来源信息：新记录带上，老记录没有这个字段（显示时不编造来源）。
      engine: typeof report.engine === 'string' ? report.engine : '',
      fallback_reason:
        typeof report.fallback_reason === 'string' ? report.fallback_reason : '',
    });
    localStorage.setItem(HISTORY_KEY, JSON.stringify(hist.slice(-50)));
  } catch (e) { /* 隐私模式下 localStorage 可能不可用 */ }
}

function renderGrowth() {
  const curveBox = $('growthCurve');
  const listBox = $('growthList');
  if (!curveBox) return;
  let hist = [];
  if (JTQ_DEMO_PAGE) {
    // 演示页不读本机历史（会串到真人档案），用内置轨迹撑住这条叙事
    hist = DEMO_GROWTH_HISTORY.slice();
  } else {
    try { hist = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch (e) { hist = []; }
  }

  // 合并云端记录（登录后才有）
  const cloudRecords = (window.JTQCloud && window.JTQCloud.getRecords) ? window.JTQCloud.getRecords() : [];
  const merged = hist.concat(cloudRecords);

  if (merged.length < 2) {
    curveBox.innerHTML = '<p style="color:#64748B;font-size:13px;padding:8px 0">至少完成 2 次复盘后，这里会画出你的成长曲线。</p>';
    if (listBox) listBox.innerHTML = '';
    return;
  }
  const sorted = merged.slice().sort((a, b) => new Date(a.at || a.created_at) - new Date(b.at || b.created_at)).slice(-20);
  const W = 620, H = 160, pl = 34, pr = 14, pt = 14, pb = 24;
  const x = (i) => pl + (i * (W - pl - pr)) / Math.max(1, sorted.length - 1);
  const yScore = (v) => pt + (1 - v / 100) * (H - pt - pb);
  const yFiller = (v) => {
    const max = Math.max(10, ...sorted.map((r) => r.filler || 0));
    return pt + (1 - (r0(v) / max)) * (H - pt - pb);
  };
  function r0(v) { return v; }
  let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%">';
  s += '<polyline points="' + sorted.map((r, i) => x(i).toFixed(1) + ',' + yScore(r.score || 0).toFixed(1)).join(' ') +
    '" fill="none" stroke="#4F46E5" stroke-width="2.5"/>';
  sorted.forEach((r, i) => {
    s += '<circle cx="' + x(i).toFixed(1) + '" cy="' + yScore(r.score || 0).toFixed(1) + '" r="4" fill="#4F46E5"/>';
    s += '<text x="' + x(i).toFixed(1) + '" y="' + (yScore(r.score || 0) - 8).toFixed(1) + '" text-anchor="middle" font-size="10" font-weight="700">' + r.score + '</text>';
  });
  s += '<text x="' + (W - pr) + '" y="' + (H - 4) + '" text-anchor="end" font-size="10" fill="#64748b">总分趋势（越往后越靠右）</text>';
  s += '</svg>';
  curveBox.innerHTML = s;

  const first = sorted[0], last = sorted[sorted.length - 1];
  const delta = (last.score || 0) - (first.score || 0);
  const deltaTxt = delta > 0 ? '↑ 提升 ' + delta + ' 分' : delta < 0 ? '↓ 下降 ' + Math.abs(delta) + ' 分' : '持平';

  // 最近一次的来源标签：与主分析页同一套逻辑。
  // 老记录没有 engine 字段 → 不显示来源标签（不编造来源），只显示已知信息。
  const lastSource =
    typeof last.engine === 'string' && last.engine
      ? describeSourceLabel(last.engine, last.fallback_reason)
      : null;
  const lastSourceHtml = lastSource
    ? '<span class="engine-tag' + (lastSource.className ? ' ' + lastSource.className : '') +
      '" style="margin-left:8px;vertical-align:middle">' + escapeHtml(lastSource.text) + '</span>'
    : '';

  if (listBox) {
    listBox.innerHTML =
      '<div class="pano-card" style="border:1px solid var(--line,#e2e8f0);border-radius:12px;padding:12px 16px;margin-top:10px">' +
      '<b>共 ' + sorted.length + ' 次复盘 · 首次 ' + (first.score || 0) + ' 分 → 最近 ' + (last.score || 0) + ' 分 <span style="color:' + (delta >= 0 ? '#16a34a' : '#dc2626') + '">' + deltaTxt + '</span></b>' +
      '<p style="margin:6px 0 0;font-size:13px;color:#64748b">最近一次：' + escapeHtml(last.subject || '未命名') +
      ' · ' + describeHistoryRate(last.rate) + ' · 口头禅 ' + (last.filler || 0) + ' 处' + lastSourceHtml + '</p></div>';
  }
}

/* ==================================================================
   📅 每日一练（41）：每天一道微格题 + 打卡连续天数
   ================================================================== */
const DAILY_TOPICS = [
  { sub: '数学', topic: '分数的意义', hint: '用一个生活情境导入，别直接讲定义', keys: ['情境导入', '折纸或分物体验', '抽象出分数符号'] },
  { sub: '数学', topic: '一元一次方程', hint: '先让学生说「未知」是什么，再列式子', keys: ['问题情境', '设未知数列方程', '解方程与检验'] },
  { sub: '数学', topic: '三角形内角和', hint: '别直接给结论，让学生撕角拼一拼', keys: ['猜想', '动手验证', '归纳结论并证明'] },
  { sub: '语文', topic: '《春》朱自清', hint: '范读一段，让学生说听到了什么画面', keys: ['范读', '画面想象', '关键词句赏析'] },
  { sub: '语文', topic: '比喻与拟人', hint: '给两个句子对比，让学生自己发现差别', keys: ['例句对比', '归纳特点', '仿写练习'] },
  { sub: '语文', topic: '古诗《静夜思》', hint: '读准节奏，再问「诗人为什么睡不着」', keys: ['朗读节奏', '意象理解', '情感体会'] },
  { sub: '英语', topic: 'There be 句型', hint: '用教室实物导入，全英尽量多', keys: ['实物导入', '句型呈现', 'pair work 操练'] },
  { sub: '英语', topic: '一般过去时', hint: '先讲昨天做了什么，再引出时态', keys: ['生活情境', '时态对比', '口头输出'] },
  { sub: '英语', topic: 'Asking the way', hint: '设置一个问路任务，让学生演一遍', keys: ['任务导入', '关键句型', '角色扮演'] },
  { sub: '物理', topic: '光的反射', hint: '演示激光笔，让学生描述现象', keys: ['演示实验', '规律归纳', '作图应用'] },
  { sub: '物理', topic: '牛顿第一定律', hint: '从推桌子停下来的经验出发，制造认知冲突', keys: ['生活经验', '理想实验推理', '定律表述'] },
  { sub: '化学', topic: '质量守恒定律', hint: '先让学生猜「反应后质量变了吗」', keys: ['猜想', '实验验证', '微观解释'] },
  { sub: '化学', topic: '溶液的形成', hint: '现场溶解食盐和泥沙，让学生分类', keys: ['对比实验', '溶液特征', '生活应用'] },
  { sub: '生物', topic: '光合作用', hint: '从「植物为什么饿不死」这个问题切入', keys: ['问题驱动', '实验证据', '过程梳理'] },
  { sub: '生物', topic: '细胞的结构', hint: '用细胞模型或图片，让学生找不同', keys: ['模型观察', '结构功能对应', '动植物对比'] },
  { sub: '历史', topic: '秦统一中国', hint: '用一个「如果你是秦王」的情境', keys: ['情境代入', '统一措施', '历史影响'] },
  { sub: '地理', topic: '中国的气候', hint: '用同一时间不同城市的穿衣差异导入', keys: ['生活现象', '气候类型', '成因分析'] },
  { sub: '道德与法治', topic: '尊重他人', hint: '用一个小冲突场景让学生讨论', keys: ['情境冲突', '观点碰撞', '价值引导'] },
  { sub: '信息技术', topic: '算法的顺序结构', hint: '用「泡面步骤」类比算法步骤', keys: ['生活类比', '流程图表达', '上机验证'] },
  { sub: '音乐', topic: '《茉莉花》', hint: '先听一遍，让学生说旋律感觉', keys: ['聆听感受', '旋律分析', '跟唱表现'] },
];

const DAILY_KEY = 'jtq_daily_checkin';
function todayStr(d) {
  const t = d || new Date();
  const m = String(t.getMonth() + 1).padStart(2, '0');
  const day = String(t.getDate()).padStart(2, '0');
  return t.getFullYear() + '-' + m + '-' + day;
}
function dailyIndexOfToday() {
  const d = new Date();
  const days = Math.floor(d.getTime() / 86400000);
  return days % DAILY_TOPICS.length;
}
function getCheckins() {
  try {
    const arr = JSON.parse(localStorage.getItem(DAILY_KEY) || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}
function saveCheckins(arr) {
  try { localStorage.setItem(DAILY_KEY, JSON.stringify(arr.slice(-180))); } catch (e) { /* 隐私模式 */ }
}
/* 连续天数：从今天（或昨天）往前数连续打卡 */
function calcStreak(list) {
  const set = {};
  list.forEach((d) => { set[d] = 1; });
  let streak = 0;
  const cur = new Date();
  if (!set[todayStr(cur)]) cur.setDate(cur.getDate() - 1); // 今天没打卡，仍从昨天起算
  while (set[todayStr(cur)]) {
    streak++;
    cur.setDate(cur.getDate() - 1);
  }
  return streak;
}

function renderDaily() {
  const box = $('dailyBody');
  if (!box) return;
  const item = DAILY_TOPICS[dailyIndexOfToday()];
  const list = getCheckins();
  const today = todayStr();
  const done = list.indexOf(today) !== -1;
  const streak = calcStreak(list);
  const total = list.length;

  // 最近 7 天打卡点阵
  let dots = '';
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const k = todayStr(d);
    const on = list.indexOf(k) !== -1;
    dots += '<span class="dd-dot' + (on ? ' on' : '') + '" title="' + k + '">' + (on ? '✓' : d.getDate()) + '</span>';
  }

  box.innerHTML =
    '<div class="dd-head"><span class="dd-tag">' + escapeHtml(item.sub) + '</span>' +
    '<b class="dd-topic">《' + escapeHtml(item.topic) + '》</b></div>' +
    '<p class="dd-hint">💡 ' + escapeHtml(item.hint) + '</p>' +
    '<div class="dd-keys">' + item.keys.map((k) => '<span class="dd-key">' + escapeHtml(k) + '</span>').join('') + '</div>' +
    '<div class="dd-actions">' +
    '<button class="ghost-btn sm" id="dailyUseBtn" type="button">用这个题目练</button>' +
    '<button class="' + (done ? 'ghost-btn sm' : 'primary sm') + '" id="dailyCheckBtn" type="button"' + (done ? ' disabled' : '') + '>' +
    (done ? '今日已打卡 ✓' : '打卡') + '</button>' +
    '</div>' +
    '<div class="dd-stats">连续 <b>' + streak + '</b> 天 · 累计 <b>' + total + '</b> 天</div>' +
    '<div class="dd-dots">' + dots + '</div>';

  const useBtn = $('dailyUseBtn');
  if (useBtn) useBtn.addEventListener('click', () => {
    if (subjectInput) subjectInput.value = item.topic;
    const sk = $('subjectKeyInput');
    if (sk) sk.value = 'auto';
    if (scriptInput) {
      scriptInput.value = '【每日一练】' + item.topic + '\n';
      scriptInput.focus();
      scriptInput.setSelectionRange(scriptInput.value.length, scriptInput.value.length);
      scriptInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    const hint = $('dailyTip');
    if (hint) {
      hint.textContent = '✓ 已填入《' + item.topic + '》：把开头续写成 5 分钟试讲稿，再点「开始 AI 分析」。';
      hint.hidden = false;
    }
  });

  const checkBtn = $('dailyCheckBtn');
  if (checkBtn) checkBtn.addEventListener('click', () => {
    const cur = getCheckins();
    if (cur.indexOf(today) === -1) {
      cur.push(today);
      saveCheckins(cur);
    }
    const s = calcStreak(getCheckins());
    if (s >= 3) unlockBadge('daily3', '三日不辍', '📅', '连续 3 天完成每日一练');
    if (s >= 7) unlockBadge('daily7', '七日成师', '🗓️', '连续 7 天完成每日一练');
    renderDaily();
  });
}


/* ---------- 多节课互动结构轨迹（iFIAS 向量 → PCA 平面 + 跨课聚类） ---------- */
const IFIAS_SESS_KEY = 'jtq_ifias_sessions';

function getIfiasSessions() {
  try {
    const a = JSON.parse(localStorage.getItem(IFIAS_SESS_KEY) || '[]');
    return Array.isArray(a) ? a : [];
  } catch (e) { return []; }
}

function saveIfiasSession(d, context) {
  const meta = context || {};

  const demoPage =
    new URLSearchParams(window.location.search).get('jtq-demo') === '1';

  const demoAnalysis =
    meta.analysisEngine === 'offline-demo' ||
    Boolean(lastAnalysis && lastAnalysis.engine === 'offline-demo');

  // 多层检查：页面模式、主报告来源、iFIAS 响应自身来源。
  if (demoPage || demoAnalysis || !d || d.engine === 'offline-demo') {
    return;
  }

  if (
    !Array.isArray(d.vector) ||
    d.vector.length !== 7 ||
    !d.vector.every(function (value) {
      return typeof value === 'number' && Number.isFinite(value);
    })
  ) {
    return;
  }

  const subject =
    typeof meta.subject === 'string' ? meta.subject : lastSubject || '';

  const arr = getIfiasSessions();
  const previous = arr[arr.length - 1];

  // 保留原有相邻去重策略：向量完全相同则跳过。
  if (
    previous &&
    Array.isArray(previous.vector) &&
    previous.vector.join(',') === d.vector.join(',')
  ) {
    return;
  }

  const n = arr.length + 1;

  arr.push({
    at: new Date().toISOString(),
    label: '第 ' + n + ' 次' + (subject ? '·' + subject : ''),
    subject: subject,
    vector: d.vector.slice(),
    teacher: (d.ratios || {}).teacher_pct,
    // 新增来源字段。旧记录没有该字段，不据此推断旧记录的来源，
    // 也不根据「向量恰好与示例相同」去删除旧数据。
    engine: typeof d.engine === 'string' ? d.engine : 'unknown'
  });

  try {
    localStorage.setItem(IFIAS_SESS_KEY, JSON.stringify(arr.slice(-12)));
  } catch (error) {
    console.warn('[JTQ] iFIAS 轨迹未能保存到本地。', error);
    return;
  }

  const box = $('ifiasTrail');

  // 不能只检查 box.hidden：它的父级 Tab 可能处于隐藏状态，
  // 但 box 自身并没有 hidden 属性。改用是否实际渲染来判断。
  if (box && box.getClientRects().length > 0) {
    renderIfiasTrail();
  }
}

async function renderIfiasTrail() {
  const box = $('ifiasTrail');
  if (!box) return;
  const arr = getIfiasSessions();
  if (arr.length < 2) {
    box.innerHTML = '<p class="tip">已有 ' + arr.length + ' 次记录。再完成 ' + (2 - arr.length) + ' 次复盘，就能画出你的课堂结构轨迹。</p>';
    return;
  }
  box.innerHTML = '<p class="tip">正在投影到 PCA 平面…</p>';
  try {
    const data = await post('/api/ifias-batch', {
      sessions: arr.map((s) => ({ label: s.label, at: s.at, vector: s.vector })),
    });
    renderIfiasTrailView(data || {}, arr);
  } catch (e) {
    box.innerHTML = '<p class="tip">轨迹生成失败：' + escapeHtml(e.message || '') + '</p>';
  }
}

function renderIfiasTrailView(d, sessions) {
  const box = $('ifiasTrail');
  if (!box) return;
  const pts = d.points || [];
  if (!pts.length) {
    box.innerHTML = '<p class="tip">' + escapeHtml(d.note || '轨迹数据不足') + '</p>';
    return;
  }
  const W = 560, H = 260, P = 38;
  let xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  let minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
  let minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
  if (maxX - minX < 1e-6) { minX -= 0.4; maxX += 0.4; }
  if (maxY - minY < 1e-6) { minY -= 0.4; maxY += 0.4; }
  const px = (x) => P + ((x - minX) / (maxX - minX)) * (W - P * 2);
  const py = (y) => (H - P) - ((y - minY) / (maxY - minY)) * (H - P * 2);
  const CC = ['#4F46E5', '#16a34a', '#f59e0b', '#0ea5e9', '#ec4899'];

  // 轨迹线（按时间顺序连起来）
  let path = '';
  pts.forEach((p, i) => {
    path += (i === 0 ? 'M' : 'L') + px(p.x).toFixed(1) + ',' + py(p.y).toFixed(1) + ' ';
  });
  let dots = '';
  pts.forEach((p, i) => {
    const isNoise = p.cluster < 0;
    const col = isNoise ? '#dc2626' : CC[p.cluster % CC.length];
    dots += '<circle cx="' + px(p.x) + '" cy="' + py(p.y) + '" r="6" fill="' + col + '" fill-opacity=".88" stroke="#fff" stroke-width="1.4">' +
      '<title>' + escapeHtml(p.label) + '（' + (p.at ? new Date(p.at).toLocaleDateString('zh-CN') : '') + '）</title></circle>';
    dots += '<text x="' + px(p.x) + '" y="' + (py(p.y) - 10) + '" text-anchor="middle" font-size="9.5" fill="#64748b">' + (i + 1) + '</text>';
  });
  const exp = d.explained || [0, 0];

  // 首末对比
  const first = pts[0], last = pts[pts.length - 1];
  const moved = Math.sqrt(Math.pow(last.x - first.x, 2) + Math.pow(last.y - first.y, 2));
  const idx1 = 1; // 教师占比在向量第 1 维
  const t0 = sessions[0] && sessions[0].vector ? sessions[0].vector[0] : null;
  const t1 = sessions[sessions.length - 1] && sessions[sessions.length - 1].vector ? sessions[sessions.length - 1].vector[0] : null;
  const teacherTxt = (t0 != null && t1 != null)
    ? '教师语言占比 ' + Math.round(t0 * 100) + '% → ' + Math.round(t1 * 100) + '%'
    : '';

  box.innerHTML =
    '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%">' +
    '<line x1="' + P + '" y1="' + (H - P) + '" x2="' + (W - P) + '" y2="' + (H - P) + '" stroke="#cbd5e1"/>' +
    '<line x1="' + P + '" y1="' + P + '" x2="' + P + '" y2="' + (H - P) + '" stroke="#cbd5e1"/>' +
    '<path d="' + path.trim() + '" fill="none" stroke="#c7d2fe" stroke-width="2" stroke-dasharray="4 3"/>' +
    dots +
    '<text x="' + (W / 2) + '" y="' + (H - 10) + '" text-anchor="middle" font-size="10" fill="#64748B">PC1（' + exp[0] + '%）</text>' +
    '<text x="11" y="' + (H / 2) + '" font-size="10" fill="#64748B" transform="rotate(-90 11 ' + (H / 2) + ')">PC2（' + exp[1] + '%）</text>' +
    '</svg>' +
    '<div class="if-trail-sum">' +
    '<span>共 <b>' + pts.length + '</b> 次复盘</span>' +
    (teacherTxt ? '<span>' + teacherTxt + '</span>' : '') +
    '<span>首末结构位移 <b>' + moved.toFixed(2) + '</b></span>' +
    (pts.some((p) => p.cluster === -1) ? '<span style="color:#dc2626">' + pts.filter((p) => p.cluster === -1).length + ' 次为孤立结构</span>' : '') +
    '</div>' +
    '<p class="if-note">' + escapeHtml(d.note || '点越靠近说明课堂结构越相似；从 1 到 ' + pts.length + ' 的位移方向，就是你的课堂在变的方向。') + '</p>';
}

/* ==================================================================
   🕳️ 匿名树洞（32）：AI 安慰 + 匿名帖
   ================================================================== */
const HOLLOW_KEY = 'jtq_hollow_posts';
const HOLLOW_LIKES_KEY = 'jtq_hollow_likes';   // 本地兜底点赞 {key: n}
const HOLLOW_LIKED_KEY = 'jtq_hollow_liked';   // 已经点过的 key，防重复
const HOLLOW_HIDDEN_KEY = 'jtq_hollow_hidden'; // 举报后本地隐藏

let hollowSort = 'new';       // new | hot
let hollowCloudLikes = {};    // {postId: n}
let hollowMerged = [];

function lsArr(k) {
  try {
    const v = JSON.parse(localStorage.getItem(k) || '[]');
    return Array.isArray(v) ? v : [];
  } catch (e) { return []; }
}
function lsObj(k) {
  try {
    const v = JSON.parse(localStorage.getItem(k) || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch (e) { return {}; }
}
function lsSave(k, v) {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 隐私模式 */ }
}

function getHollowPosts() { return lsArr(HOLLOW_KEY); }
function saveHollowPosts(arr) {
  try { localStorage.setItem(HOLLOW_KEY, JSON.stringify(arr.slice(-30))); } catch (e) { /* 隐私模式 */ }
}
function getHollowLikes() { return lsObj(HOLLOW_LIKES_KEY); }
function getLikedSet() { return lsArr(HOLLOW_LIKED_KEY); }
function getHiddenSet() { return lsArr(HOLLOW_HIDDEN_KEY); }

function postKey(p) {
  return p.from === 'cloud' ? 'c' + p.id : 'l' + String(p.text || '').slice(0, 24);
}

function likeCountOf(p) {
  const key = postKey(p);
  const cloud = p.from === 'cloud' ? (hollowCloudLikes[String(p.id)] || 0) : 0;
  const local = getHollowLikes()[key] || 0;
  return cloud + local;
}

function renderHollowTabs() {
  document.querySelectorAll('.hollow-tab').forEach((t) => {
    t.classList.toggle('active', t.getAttribute('data-sort') === hollowSort);
  });
  const c = $('hollowCount');
  if (c) c.textContent = hollowMerged.length ? '共 ' + hollowMerged.length + ' 条' : '';
}

function renderHollow() {
  const listBox = $('hollowPosts');
  if (!listBox) return;
  renderHollowTabs();
  if (!hollowMerged.length) {
    listBox.innerHTML = '<p class="tip">还没有人开口。第一个说出来的人，往往最勇敢。</p>';
    return;
  }
  const liked = getLikedSet();
  const list = hollowMerged.slice();
  if (hollowSort === 'hot') list.sort((a, b) => likeCountOf(b) - likeCountOf(a));

  listBox.innerHTML = list.map((p) => {
    const key = postKey(p);
    const n = likeCountOf(p);
    const stamp = p.from === 'cloud' && p.created_at
      ? new Date(p.created_at).toLocaleDateString('zh-CN')
      : (p.at || '');
    const school = p.school ? ' · ' + escapeHtml(p.school) : '';
    const mark = p.from === 'cloud'
      ? '<span class="hp-cloud">☁️ 共享</span>'
      : '<span class="hp-local">本机</span>';
    const isLiked = liked.indexOf(key) !== -1;
    return '<div class="hollow-post">' +
      '<div class="hp-meta">匿名' + school + ' · ' + escapeHtml(stamp) + mark + '</div>' +
      '<p class="hp-text">' + escapeHtml(p.text || '') + '</p>' +
      (p.reply ? '<div class="hp-reply"><b>AI 树洞回信</b>' + sourceTagSpan(p.engine, p.fallback_reason) + '<p>' + escapeHtml(p.reply) + '</p></div>' : '') +
      '<div class="hp-actions">' +
      '<button class="hp-report" data-k="' + escapeHtml(key) + '" type="button">举报</button>' +
      '<button class="hp-like' + (isLiked ? ' on' : '') + '" data-k="' + escapeHtml(key) + '" type="button">' +
      (isLiked ? '❤️ ' : '🤍 ') + n + '</button>' +
      '</div>' +
      '</div>';
  }).join('');

  listBox.querySelectorAll('.hp-like').forEach((b) => {
    b.addEventListener('click', () => toggleLike(b.getAttribute('data-k')));
  });
  listBox.querySelectorAll('.hp-report').forEach((b) => {
    b.addEventListener('click', () => reportPost(b.getAttribute('data-k')));
  });
}

async function toggleLike(key) {
  const liked = getLikedSet();
  const post = hollowMerged.find((p) => postKey(p) === key);
  if (!post) return;

  if (liked.indexOf(key) !== -1) {
    // 已赞：只允许取消本地计数，云端记录不删（append-only 设计，避免给公开表 UPDATE 权限）
    const m = getHollowLikes();
    if (m[key]) { m[key] -= 1; if (m[key] <= 0) delete m[key]; lsSave(HOLLOW_LIKES_KEY, m); }
    lsSave(HOLLOW_LIKED_KEY, liked.filter((k) => k !== key));
    renderHollow();
    return;
  }
  if (post.from === 'cloud' && window.JTQCloud && window.JTQCloud.pushHollowLike) {
    try {
      const res = await window.JTQCloud.pushHollowLike(post.id);
      if (res && res.saved) hollowCloudLikes[String(post.id)] = (hollowCloudLikes[String(post.id)] || 0) + 1;
      else {
        const m = getHollowLikes();
        m[key] = (m[key] || 0) + 1;
        lsSave(HOLLOW_LIKES_KEY, m);
      }
    } catch (e) {
      const m = getHollowLikes();
      m[key] = (m[key] || 0) + 1;
      lsSave(HOLLOW_LIKES_KEY, m);
    }
  } else {
    const m = getHollowLikes();
    m[key] = (m[key] || 0) + 1;
    lsSave(HOLLOW_LIKES_KEY, m);
  }
  liked.push(key);
  lsSave(HOLLOW_LIKED_KEY, liked);
  renderHollow();
}

async function reportPost(key) {
  const reason = window.prompt('举报这条内容（可选填原因，如：广告/攻击他人/与树洞无关）', '与树洞无关');
  if (reason === null) return; // 用户取消
  const post = hollowMerged.find((p) => postKey(p) === key);
  if (post && post.from === 'cloud' && window.JTQCloud && window.JTQCloud.pushHollowReport) {
    try { await window.JTQCloud.pushHollowReport(post.id, reason); } catch (e) { /* 静默 */ }
  }
  const hidden = getHiddenSet();
  if (hidden.indexOf(key) === -1) hidden.push(key);
  lsSave(HOLLOW_HIDDEN_KEY, hidden);
  hollowMerged = hollowMerged.filter((p) => postKey(p) !== key);
  renderHollow();
  setErr('已举报并从你的视图隐藏，感谢你帮树洞保持干净。');
}

/* 拉云端帖 + 点赞数 + 合并本地未同步帖 */
async function loadHollow() {
  const local = getHollowPosts();
  let cloud = [];
  if (window.JTQCloud && window.JTQCloud.fetchHollowPosts) {
    try {
      const res = await window.JTQCloud.fetchHollowPosts();
      if (res && !res.error && Array.isArray(res.posts)) cloud = res.posts;
    } catch (e) { /* 断网：只用本地 */ }
    try {
      if (window.JTQCloud.fetchHollowLikes) {
        const lk = await window.JTQCloud.fetchHollowLikes();
        if (lk && !lk.error) hollowCloudLikes = lk.counts || {};
      }
    } catch (e) { /* 点赞拉取失败不影响列表 */ }
  }
  const cloudTexts = cloud.map((p) => String(p.text || '').trim());
  const unsynced = local.filter((p) => cloudTexts.indexOf(String(p.text || '').trim()) === -1);
  const hidden = getHiddenSet();
  hollowMerged = cloud
    .map((p) => ({ id: p.id, text: p.text, reply: p.reply, school: p.school, created_at: p.created_at, from: 'cloud' }))
    .concat(unsynced.map((p) => ({ text: p.text, reply: p.reply, at: p.at, from: 'local' })))
    .filter((p) => hidden.indexOf(postKey(p)) === -1);
  renderHollow();
}

async function submitHollow() {
  const input = $('hollowInput');
  const btn = $('hollowSubmit');
  if (!input) return;
  const text = input.value.trim();
  if (text.length < 8) { input.focus(); return; }
  const restore = busy(btn, '树洞在听…', '说给树洞听');
  try {
    const data = await post('/api/hollow', { text: text });
    const reply = (data && data.reply) || '';
    let pushed = false;
    if (window.JTQCloud && window.JTQCloud.pushHollowPost) {
      try {
        const res = await window.JTQCloud.pushHollowPost({ text: text, reply: reply });
        pushed = !!(res && res.saved);
      } catch (e) { pushed = false; }
    }
    if (!pushed) {
      const arr = getHollowPosts();
      const d = new Date();
      arr.push({
        text: text,
        reply: reply,
        engine: data.engine,
        fallback_reason: data.fallback_reason,
        at: d.toLocaleDateString('zh-CN') + ' ' + d.toTimeString().slice(0, 5),
        likes: 0,
      });
      saveHollowPosts(arr);
    }
    input.value = '';
    await loadHollow();
    unlockBadge('hollow', '敢说出来', '🕳️', '在匿名树洞说出一次社死经历');
  } catch (e) {
    setErr(e.message || '树洞暂时听不见，稍后再试');
  } finally {
    restore();
  }
}

/* ==================================================================
   🏆 校内排行榜（21）：今日最高 / 本周进步 / 总分榜
   ================================================================== */
let lbCurrent = 'today';

function renderLb(rows, type) {
  const box = $('lbBody');
  if (!box) return;
  if (type === 'team') return renderLbTeam(rows, box);
  const meId = (window.JTQCloud && window.JTQCloud.currentUserId) || '';
  if (!rows || rows.length === 0) {
    box.innerHTML = '<p style="color:#64748B;font-size:13px;padding:10px 2px">' +
      (type === 'week' ? '本周还没有人完成第二次试讲，先去复盘一次抢占进步榜！'
        : type === 'team' ? '还没有战队数据：先在上面填「战队/班级」并保存，复盘一次就会为你的战队积累战绩。'
        : '榜单还空着，完成第一次 AI 复盘就会上榜。') + '</p>';
    return;
  }
  box.innerHTML = '<div class="lb-rows">' + rows.slice(0, 20).map((r, i) => {
    const isMe = meId && r.owner_id === meId;
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : (i + 1);
    const top = i < 3 ? ' top' + (i + 1) : '';
    const name = escapeHtml(r.nickname || r.owner_name || '华师同学');
    const sub = r.subject ? '《' + escapeHtml(r.subject) + '》' : '';
    const school = r.school ? '<span class="lb-school">' + escapeHtml(r.school) + '</span>' : '';
    const avatar = '<span class="lb-avatar">' + escapeHtml(r.avatar || (r.nickname || '华').slice(0, 1)) + '</span>';
    const gainTxt = type === 'week' && r.gain != null
      ? '<span class="lb-gain ' + (r.gain >= 0 ? 'up' : 'down') + '">' +
        (r.gain >= 0 ? '↑ +' : '↓ ') + r.gain + '</span>' : '';
    const score = r.score != null ? r.score : '—';
    return '<div class="lb-row' + (isMe ? ' me' : '') + top + '">' +
      '<span class="lb-rank">' + medal + '</span>' +
      avatar +
      '<span class="lb-name">' + name + school + (sub ? ' <span class="lb-sub">' + sub + '</span>' : '') + '</span>' +
      (gainTxt || '<span></span>') +
      '<span class="lb-score">' + score + '</span>' +
      '</div>';
  }).join('') + '</div>';
}

/* 战队榜渲染（A）：战队名 + 均分 + 人次 + 最高分 */
function renderLbTeam(rows, box) {
  const myTeam = (window.JTQCloud && window.JTQCloud.getTeam) ? window.JTQCloud.getTeam() : '';
  if (!rows || !rows.length) {
    box.innerHTML = '<p style="color:#64748B;font-size:13px;padding:10px 2px">还没有战队数据：先在上面填「战队/班级」并保存，复盘一次就会为你的战队积累战绩。</p>';
    return;
  }
  box.innerHTML = '<div class="lb-rows">' + rows.map((r, i) => {
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : (i + 1);
    const top = i < 3 ? ' top' + (i + 1) : '';
    const isMe = myTeam && r.team === myTeam;
    return '<div class="lb-row team-row' + (isMe ? ' me' : '') + top + '">' +
      '<span class="lb-rank">' + medal + '</span>' +
      '<span class="lb-avatar">' + escapeHtml(r.avatar || '🏳️') + '</span>' +
      '<span class="lb-name">' + escapeHtml(r.team) +
      (r.school ? '<span class="lb-school">' + escapeHtml(r.school) + '</span>' : '') + '</span>' +
      '<span class="team-meta">' + r.count + ' 人次 · 最高 ' + r.best + '</span>' +
      '<span class="lb-score">' + r.avg + '</span>' +
      '</div>';
  }).join('') + '</div>' +
    '<p class="lb-note">战队均分 = 该战队所有复盘分数的平均值，按均分降序。</p>';
}

async function loadLeaderboard(type) {
  lbCurrent = type || lbCurrent;
  document.querySelectorAll('.lb-tab').forEach((t) => {
    t.classList.toggle('active', t.getAttribute('data-lb') === lbCurrent);
  });
  const box = $('lbBody');
  if (box) box.innerHTML = '<p style="color:#64748B;font-size:13px;padding:10px 2px">榜单加载中…</p>';
  if (!window.JTQCloud) {
    if (box) box.innerHTML = '<p style="color:#64748B;font-size:13px;padding:10px 2px">云服务未加载（需联网），稍后再来看看榜单。</p>';
    return;
  }
  const res = await window.JTQCloud.fetchLeaderboard(lbCurrent);
  if (res.error === 'cloud-not-ready') {
    renderLb([], lbCurrent);
    if (box) box.innerHTML = '<p style="color:#64748B;font-size:13px;padding:10px 2px">云服务还没就绪（需联网），榜单暂不可用。</p>';
    return;
  }
  if (res.error) {
    if (box) box.innerHTML = '<p style="color:#dc2626;font-size:13px;padding:10px 2px">榜单读取失败：' + escapeHtml(res.error) + '</p>';
    return;
  }
  renderLb(res.rows, lbCurrent);
}

/* 登录提示条：未登录时引导登录（登录后才写得进榜单） */
function renderLbLoginTip() {
  const tip = $('lbLoginTip');
  if (!tip) return;
  if (window.JTQCloud && window.JTQCloud.signedIn) {
    const nick = window.JTQCloud.getNickname();
    const school = window.JTQCloud.getSchool();
    const avatar = window.JTQCloud.getAvatar();
    tip.innerHTML = '已登录 · ' + escapeHtml(avatar) + ' ' +
      escapeHtml(nick || window.JTQCloud.userName || '华师同学') +
      (school ? ' · ' + escapeHtml(school) : '') +
      (window.JTQCloud.getTeam && window.JTQCloud.getTeam() ? ' · ' + escapeHtml(window.JTQCloud.getTeam()) : '');
  } else {
    tip.innerHTML = '<a href="javascript:void(0)" id="lbLoginLink" style="color:var(--brand,#4F46E5)">点此登录后上榜</a>';
    const link = $('lbLoginLink');
    if (link) link.addEventListener('click', () => window.JTQCloud && window.JTQCloud.open());
  }
}

const AVATAR_CHOICES = ['🎓', '👩‍🏫', '🧑‍🏫', '🐣', '🐻', '🍀', '⚡', '🌟'];
function renderAvatarPicker() {
  const box = $('lbAvatarPicker');
  if (!box) return;
  const cur = (window.JTQCloud && window.JTQCloud.getAvatar) ? window.JTQCloud.getAvatar() : '🎓';
  box.innerHTML = AVATAR_CHOICES.map((a) =>
    '<button type="button" class="lb-av' + (a === cur ? ' on' : '') + '" data-av="' + a + '">' + a + '</button>'
  ).join('');
  box.querySelectorAll('.lb-av').forEach((b) => {
    b.addEventListener('click', () => {
      if (window.JTQCloud && window.JTQCloud.setAvatar) window.JTQCloud.setAvatar(b.getAttribute('data-av'));
      renderAvatarPicker();
      renderLbLoginTip();
    });
  });
}

(function initLeaderboard() {
  const nickInput = $('nicknameInput');
  const schoolSel = $('schoolSelect');
  const teamInput = $('teamInput');
  if (schoolSel && window.JTQCloud && window.JTQCloud.getSchool) schoolSel.value = window.JTQCloud.getSchool();
  if (teamInput && window.JTQCloud && window.JTQCloud.getTeam) teamInput.value = window.JTQCloud.getTeam();
  renderAvatarPicker();
  if (nickInput) {
    try { nickInput.value = localStorage.getItem('jtq_nickname') || ''; } catch (e) { /* 隐私模式 */ }
    const save = $('saveNickBtn');
    if (save) save.addEventListener('click', () => {
      const v = window.JTQCloud ? window.JTQCloud.setNickname(nickInput.value) : String(nickInput.value || '').trim().slice(0, 12);
      nickInput.value = v;
      if (schoolSel && window.JTQCloud && window.JTQCloud.setSchool) window.JTQCloud.setSchool(schoolSel.value);
      if (teamInput && window.JTQCloud && window.JTQCloud.setTeam) window.JTQCloud.setTeam(teamInput.value);
      save.textContent = '已保存 ✓';
      setTimeout(() => { save.textContent = '保存'; }, 1500);
      renderLbLoginTip();
    });
  }
  document.querySelectorAll('.lb-tab').forEach((t) => {
    t.addEventListener('click', () => loadLeaderboard(t.getAttribute('data-lb')));
  });
  renderLbLoginTip();
  // 每日一练 + 匿名树洞初渲染
  renderDaily();
  loadHollow();
  const hollowBtn = $('hollowSubmit');
  if (hollowBtn) hollowBtn.addEventListener('click', submitHollow);
  document.querySelectorAll('.hollow-tab').forEach((t) => {
    t.addEventListener('click', () => {
      hollowSort = t.getAttribute('data-sort') || 'new';
      renderHollow();
    });
  });
  // 首屏若已停留在成长档案 Tab，直接拉榜
  const pane = $('pane-growth');
  if (pane && pane.classList.contains('active')) loadLeaderboard(lbCurrent);
})();

/* ==================================================================
   🏅 求生等级 + 成就徽章
   ================================================================== */
const RANKS = [
  { min: 90, title: '👑 讲台之王', color: '#f59e0b' },
  { min: 80, title: '🌟 教坛新秀', color: '#7C3AED' },
  { min: 70, title: '✅ 求生成功', color: '#16a34a' },
  { min: 60, title: '😅 惊险过关', color: '#d97706' },
  { min: 0, title: '💀 社死现场', color: '#dc2626' },
];
function rankOf(score) {
  for (const r of RANKS) if (score >= r.min) return r;
  return RANKS[RANKS.length - 1];
}

const BADGE_DEFS = [
  { id: 'first', ico: '🎬', name: '首次复盘', desc: '完成第一次 AI 分析' },
  { id: 'high3', ico: '🏆', name: '三连高分', desc: '连续 3 次 80 分以上' },
  { id: 'filler0', ico: '🤫', name: '口头禅清零', desc: '一次分析中口头禅为 0' },
  { id: 'doomed', ico: '💀', name: '社死体验者', desc: '课堂压力爆表后依然站到了最后' },
  { id: 'crisis', ico: '💥', name: '控场达人', desc: '在崩塌模拟中拿到 80+ 控场分' },
  { id: 'challenge', ico: '🛡️', name: '极限求生', desc: '通关极限挑战全部 6 关' },
  { id: 'compare', ico: '⚔️', name: '博弈赢家', desc: '完成一次双人对比' },
  { id: 'voice', ico: '🎤', name: '开口练习', desc: '使用过一次语音输入' },
  { id: 'daily3', ico: '📅', name: '三日不辍', desc: '连续 3 天完成每日一练' },
  { id: 'daily7', ico: '🗓️', name: '七日成师', desc: '连续 7 天完成每日一练' },
  { id: 'hollow', ico: '🕳️', name: '敢说出来', desc: '在匿名树洞说出一次社死经历' },
];
const BADGE_KEY = 'jtq_badges';

function loadBadges() {
  try { return JSON.parse(localStorage.getItem(BADGE_KEY) || '{}'); } catch (e) { return {}; }
}
function saveBadge(id, name, ico, desc) {
  try {
    const b = loadBadges();
    if (b[id]) return false;
    b[id] = { name: name || id, ico: ico || '🏅', desc: desc || '', at: new Date().toISOString() };
    localStorage.setItem(BADGE_KEY, JSON.stringify(b));
    renderBadges();
    return true;
  } catch (e) { return false; }
}
function unlockBadge(id, name, ico, desc) {
  // 固定演示页面不写入任何成就徽章（否则示例流程会污染用户的真实档案）
  if (JTQ_DEMO_PAGE) return;

  const b = loadBadges();
  if (!b[id]) {
    saveBadge(id, name, ico, desc);
    // 轻提示
    const tip = document.createElement('div');
    tip.style.cssText = 'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:130;' +
      'background:linear-gradient(90deg,#4F46E5,#7C3AED);color:#fff;padding:10px 18px;border-radius:99px;' +
      'font-size:13px;font-weight:700;box-shadow:0 10px 30px rgba(79,70,229,.4);animation:fadeUp .35s ease';
    tip.innerHTML = ico + ' 解锁成就：' + name;
    document.body.appendChild(tip);
    setTimeout(() => { tip.style.opacity = '0'; tip.style.transition = 'opacity .4s'; }, 2600);
    setTimeout(() => tip.remove(), 3200);
  }
}
function renderBadges() {
  const row = $('badgeRow');
  if (!row) return;
  const owned = loadBadges();
  row.innerHTML = BADGE_DEFS.map((b) => {
    const has = !!owned[b.id];
    return '<span class="badge' + (has ? '' : ' locked') + '" title="' + escapeHtml(has ? (owned[b.id].desc || b.desc) : '未解锁：' + b.desc) + '">' +
      '<span class="b-ico">' + b.ico + '</span>' + escapeHtml(has ? owned[b.id].name : b.name) + '</span>';
  }).join('');
}

function renderRank(score) {
  const el = $('rankTitle');
  if (!el) return;
  const r = rankOf(score);
  el.hidden = false;
  el.textContent = r.title;
  el.style.background = 'linear-gradient(90deg,' + r.color + ',' + r.color + 'cc)';
}

/* ==================================================================
   ⚠️ 危险瞬间
   ================================================================== */
async function runDanger() {
  const box = $('dangerBox');
  if (!box || !lastScript) return;

  // 保存本次请求上下文，避免较早的请求覆盖较新的分析结果。
  const transcript = lastScript;
  const analysis = lastAnalysis;

  const requestToken = {};
  runDanger.activeRequest = requestToken;

  function isCurrentRequest() {
    return (
      runDanger.activeRequest === requestToken &&
      lastScript === transcript &&
      lastAnalysis === analysis
    );
  }

  function sourceLabel(engine, fallbackReason) {
    if (engine === 'offline-demo') {
      return '固定示例 · 不代表当前讲稿的真实风险判断';
    }

    if (engine === 'llm') {
      return '模型生成 · 风险判断需要人工核对';
    }

    if (engine === 'rule' || engine === 'rules') {
      // 降级原因与主报告用同一套措辞：说清楚「规则计算」，再说明为什么降级。
      return '规则识别 · 风险判断需要人工核对' + degradedSuffix(fallbackReason);
    }

    return '结果来源未明确 · 风险判断需要人工核对';
  }

  const dangerLoadingText = '正在识别需要核对的风险片段…';

  box.innerHTML = '<p class="tip">' + dangerLoadingText + '</p>';

  try {
    const data = await post('/api/danger', {
      transcript: transcript,
      analysis: analysis
    });

    if (!isCurrentRequest()) return;

    if (!data || typeof data !== 'object') {
      throw new Error('风险分析结果格式不正确');
    }

    box.replaceChildren();

    const source = document.createElement('p');
    source.className = 'tip evidence-source';
    source.textContent = sourceLabel(data.engine, data.fallback_reason);
    box.appendChild(source);

    const moments = Array.isArray(data.moments)
      ? data.moments
      : [];

    if (!moments.length) {
      const empty = document.createElement('p');
      empty.className = 'tip';
      empty.textContent =
        '本次分析未识别出风险片段；这不代表已经确认不存在问题。';
      box.appendChild(empty);
      return;
    }

    moments.forEach(function (item) {
      const moment =
        item && typeof item === 'object' ? item : {};

      const card = document.createElement('div');
      card.className = 'danger-card';

      const head = document.createElement('div');
      head.className = 'dc-head';

      const type = document.createElement('span');
      type.className = 'dc-type';
      type.textContent = moment.type || '待核对风险';
      head.appendChild(type);

      const quote = document.createElement('div');
      quote.className = 'dc-quote';

      const rawQuote = String(moment.quote || '');
      quote.textContent = rawQuote
        ? '摘录：' + rawQuote
        : '未提供可定位的原句';

      const reason = document.createElement('p');
      reason.className = 'dc-why';
      reason.textContent =
        '判断：' + String(moment.reason || '未提供判断依据');

      const fix = document.createElement('p');
      fix.className = 'dc-fix';
      fix.textContent =
        '建议：' + String(moment.fix || '请结合上下文自行核对');

      const actions = document.createElement('div');
      actions.className = 'evidence-actions';

      const locateButton = document.createElement('button');
      locateButton.type = 'button';
      locateButton.className = 'ghost-btn sm';
      locateButton.textContent = '定位逐字稿原句';
      locateButton.disabled = !rawQuote.trim();

      const status = document.createElement('span');
      status.className = 'evidence-match-status';
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');

      locateButton.addEventListener('click', function () {
        if (!isCurrentRequest()) {
          status.textContent =
            '讲稿或分析已经更新，请重新生成风险分析。';
          return;
        }

        if (!window.JTQEvidence) {
          status.textContent =
            '定位工具未加载，请检查 evidence.js。';
          return;
        }

        const root = $('transcriptHi');

        if (!root) {
          status.textContent = '未找到逐字稿容器。';
          return;
        }

        const result = window.JTQEvidence.locate(root, rawQuote);

        if (result.found) {
          status.textContent =
            result.method === 'exact'
              ? '已定位完全一致的原文；风险判断仍需核对。'
              : '已定位忽略空白差异的原文；风险判断仍需核对。';
        } else {
          status.textContent =
            '未找到匹配原文。摘录可能经过改写，暂不能作为已核验的原句证据。';
        }
      });

      actions.appendChild(locateButton);
      actions.appendChild(status);
      card.appendChild(head);
      card.appendChild(quote);
      card.appendChild(reason);
      card.appendChild(fix);
      card.appendChild(actions);
      box.appendChild(card);
    });
  } catch (error) {
    if (!isCurrentRequest()) return;

    box.innerHTML =
      '<p class="tip err">风险分析失败：' +
      escapeHtml(error && error.message ? error.message : '未知错误') +
      '</p>';
  } finally {
    // 与 iFIAS 同理：被判为过期时也不能把加载文案永远留在页面上。
    if (
      runDanger.activeRequest === requestToken &&
      box.textContent.trim() === dangerLoadingText
    ) {
      box.innerHTML =
        '<p class="tip">风险片段检查未完成，可能是请求被新的分析取代或结果无法解析。' +
        '可重新分析本段讲稿。</p>';
    }
  }
}

/* ==================================================================
   ⏱️ 课堂可视化三件套：等待热力图 + 时间分配饼图 + 分环节改进稿
   ================================================================== */
/* ==================================================================
   通用教学环节（七环节）—— 只用于「展示完整清单」
   ------------------------------------------------------------------
   ⚠️ 这一份常量**只负责展示**：让「未检测到线索」的环节也能被列出来。
   匹配判断（哪些环节算命中）一律以后端返回的
   knowledge.covered / knowledge.missing 为准，
   前端不做任何关键词匹配 —— 避免与后端 app/lib/analyzer.js 的 ANCHORS
   形成两处定义、两套判断、两处漂移。
   顺序与后端 ANCHORS 对齐：情境引入 / 知识推导 / 公式结论 / 例题讲解 /
   课堂互动 / 小结回顾 / 作业布置。
   ================================================================== */
const GENERIC_PHASE_NAMES = [
  '情境引入',
  '知识推导',
  '公式结论',
  '例题讲解',
  '课堂互动',
  '小结回顾',
  '作业布置'
];

let lastHeatmap = null;

function waitColor(sec) {
  if (!Number.isFinite(sec)) return '#64748b'; // 灰：无法测量
  if (sec >= 2) return '#16a34a';
  if (sec >= 1) return '#ea580c';
  return '#dc2626';
}

/* 等待来源标签（唯一事实来源：后端 wait_metrics.source）
   颜色与秒数表达的是「文本推断」，不是真实课堂行为。
   取值表与后端 app/lib/wait-metrics.js 严格一致，不要自行扩充：
     text-heuristic  规则推断（规则分支）
     model-inference 模型推断（LLM 分支）
     unmeasured      无法测量
   未列出的取值一律显示「来源未明确」，不猜。

   注意：这里**故意不列 'timestamp'**。
   本批明确不启用时间戳测量 —— 转写分段只有 start/end、没有说话人区分，
   测到的只是「提问后的下一段语音间隔」，不能称为「学生思考等待时间」。
   在真正接入带 speaker 的可靠时间戳之前，界面上不允许出现任何
   让人以为「这是实测」的措辞；万一后端误产出该值，
   落到兜底显示「来源未明确」——宁可说不清楚，也不要说错。 */
const WAIT_SOURCE_LABELS = {
  'text-heuristic': '文本推断',
  'model-inference': '模型推断',
  'unmeasured': '无法测量',
  // 固定演示数据专用：显式标出「演示」，避免被读成对当前讲稿的推断。
  // 后端不会产出这个取值，只有 demo-data.js 会用。
  'offline-demo': '固定演示'
};

function waitSourceLabel(source) {
  return WAIT_SOURCE_LABELS[source] || '来源未明确';
}

/* 15. 提问等待热力图：横轴=讲稿进度，每个提问一个色条
   逐次秒数是「文本推断」，不是音频时间戳实测值：
   - 有可推算值 → 正常配色 + 图例标注「文本推断」
   - 无可推算值 → 中性灰 + 「?」，绝不画成红色「0 秒」
   - 讲稿里根本没有提问（moments 为空数组）→ 走空态文案，
     既不画空 svg，也不显示「0 秒」。 */
function renderHeatmap(moments, meta = {}) {
  const box = $('heatmapBox');
  if (!box) return;

  const sourceLabel = waitSourceLabel(meta.source);
  const note = meta.note || '等待来源未记录。';

  // 来源说明固定排在最上面：读者先知道这是什么口径，再看图。
  const sourceLine =
    '<p class="tip hm-source">⚠ 等待来源：' +
    escapeHtml(sourceLabel) +
    '。' +
    escapeHtml(note) +
    '</p>';

  // 整张图的分析引擎来源（LLM / 规则 / 演示），与上面的「等待来源」是两回事：
  // 等待来源说明「秒数怎么来的」，这里说明「这份提问分析+时间分配+分段整体是 AI 还是规则算的」。
  const engineLine = sourceTagSpan(meta.engine, meta.fallback_reason)
    ? '<div style="margin:0 0 6px">' + sourceTagSpan(meta.engine, meta.fallback_reason) + '</div>'
    : '';

  if (!Array.isArray(moments) || !moments.length) {
    box.innerHTML =
      engineLine +
      sourceLine +
      '<p class="tip">本段讲稿未检测到提问，无法评估等待时长。' +
      '整节课没有提问本身就是最大的风险。</p>';
    return;
  }
  const W = 640;
  const axisY = 96;
  const barH = 58;
  const n = moments.length;
  let bars = '';
  moments.forEach((m, i) => {
    const x = 34 + (i * (W - 68)) / Math.max(1, n - 1) - 14;

    // 缺值必须显式挡掉：Number(null) === 0、Number('') === 0，
    // 直接 Number() 会把「模型没给秒数」变成「等了 0 秒」——
    // 那正是后端 wait-metrics.js 反复强调不能犯的错，
    // 表现到界面上就是一条红色「✕ 0s」，等于凭空造了一个结论。
    const rawWait = m ? m.wait_sec : null;
    const rawSec =
      rawWait === null ||
      rawWait === undefined ||
      rawWait === '' ||
      typeof rawWait === 'boolean'
        ? NaN
        : Number(rawWait);

    const isNoQuestion =
      String((m && m.quote) || '').includes('未检测到提问');

    const hasWait =
      !isNoQuestion &&
      Number.isFinite(rawSec) &&
      rawSec >= 0;

    const sec = hasWait ? rawSec : null;
    const c = waitColor(sec);
    const label =
      sec === null
        ? '?'
        : sec >= 2
          ? '✓'
          : sec >= 1
            ? '!'
            : '✕';

    const waitText =
      sec === null
        ? '无法测量'
        : sec + ' 秒';

    // 每条自带来源（后端 moments[].source）：整段可能是规则推断，
    // 也可能是模型推断；逐条标出来，读者才知道这一条的秒数是谁给的。
    const itemSourceLabel = waitSourceLabel(m.source || meta.source);

    bars +=
      '<g>' +
      '<rect x="' + x + '" y="' + (axisY - barH) + '" width="28" height="' + barH + '" rx="6" fill="' + c + '" opacity="0.92">' +
      '<title>' +
        escapeHtml(
          String(m.quote || '') +
            '（' +
            waitText +
            '：' +
            (m.reaction || '') +
            '｜来源：' +
            itemSourceLabel +
            '）'
        ) +
      '</title></rect>' +
      '<text x="' + (x + 14) + '" y="' + (axisY - barH + 24) + '" text-anchor="middle" font-size="14" font-weight="800" fill="#fff">' + label + '</text>' +
      '<text x="' + (x + 14) + '" y="' + (axisY + 18) + '" text-anchor="middle" font-size="10.5" fill="var(--text-3)">' +
        escapeHtml(sec === null ? '?' : sec + 's') +
      '</text>' +
      '</g>';
  });
  const axis =
    '<line x1="24" y1="' + axisY + '" x2="' + (W - 24) + '" y2="' + axisY + '" stroke="var(--line)" stroke-width="3"/>' +
    '<text x="24" y="' + (axisY + 34) + '" font-size="11" fill="var(--text-3)">开场</text>' +
    '<text x="' + (W - 24) + '" y="' + (axisY + 34) + '" font-size="11" fill="var(--text-3)" text-anchor="end">结课</text>';
  const legend =
    '<div class="hm-legend">' +
    '<span><i style="background:#dc2626"></i>&lt;1 秒 · 文本推断偏短</span>' +
    '<span><i style="background:#ea580c"></i>1–2 秒 · 文本推断中等</span>' +
    '<span><i style="background:#16a34a"></i>≥2 秒 · 文本推断有留白</span>' +
    '<span><i style="background:#64748b"></i>无法测量</span>' +
    '<span class="hm-tip">师范 Tip（教学建议，与本图数值口径无关）：提问后沉默 3 秒，是把课堂还给学生。参考数据：50 段真实教育对话标注统计，停顿中位 0.97 秒、最长 5.67 秒——真实课堂是敢停的</span>' +
    '</div>' +
    '<p class="tip hm-explain">颜色表示的是文本推断，不是真实课堂行为：绿色 = 文本中存在较明显的思考留白线索。</p>';
  box.innerHTML =
    engineLine +
    sourceLine +
    '<svg viewBox="0 0 ' + W + ' 140" class="hm-svg" role="img" aria-label="提问等待热力图">' + axis + bars + '</svg>' + legend;
}

/* 16. 时间分配饼图：环形图 + 理想配比对照 */
function renderPie(alloc) {
  const box = $('pieBox');
  if (!box) return;
  // 未测量态：后端在无可靠计时数据时返回 time_allocation=null（不伪造「全算讲授」），
  // 任何缺字段或全零的情况也统一按「未测量」处理——绝不画零值饼图或假分配。
  const total = alloc && typeof alloc === 'object'
    ? (Number(alloc.teacher) || 0) + (Number(alloc.student) || 0) + (Number(alloc.interaction) || 0) + (Number(alloc.transition) || 0)
    : 0;
  if (!total) {
    box.innerHTML =
      '<p class="tip">⏱ 时间分配未测量（无可靠课堂计时数据），暂不展示饼图。' +
      '接入真实音频/逐字稿时间戳后才会给出可靠的分钟分配。</p>';
    return;
  }
  const items = [
    { key: 'teacher', label: '教师讲', color: '#4F46E5', ideal: 45 },
    { key: 'student', label: '学生答', color: '#0D9488', ideal: 20 },
    { key: 'interaction', label: '互动提问', color: '#D97706', ideal: 25 },
    { key: 'transition', label: '过渡组织', color: '#64748B', ideal: 10 },
  ];
  const R = 70;
  const C = 2 * Math.PI * R;
  let acc = 0;
  let arcs = '';
  items.forEach((it) => {
    const pct = (alloc[it.key] || 0) / total;
    const len = pct * C;
    arcs +=
      '<circle cx="100" cy="100" r="' + R + '" fill="none" stroke="' + it.color + '" stroke-width="30" ' +
      'stroke-dasharray="' + len + ' ' + (C - len) + '" stroke-dashoffset="' + -acc * C + '" transform="rotate(-90 100 100)"/>';
    acc += pct;
  });
  const legend = items
    .map((it) => {
      const v = alloc[it.key] || 0;
      const pct = Math.round((v / total) * 100);
      const diff = pct - it.ideal;
      const diffTxt = diff > 3 ? '超出理想 ' + diff + '%' : diff < -3 ? '低于理想 ' + -diff + '%' : '接近理想';
      const diffCls = diff > 3 ? 'over' : diff < -3 ? 'under' : 'near';
      return (
        '<div class="pie-item">' +
        '<span class="pie-dot" style="background:' + it.color + '"></span>' +
        '<span class="pie-label">' + it.label + '</span>' +
        '<span class="pie-val">' + v + ' 分钟 · ' + pct + '%</span>' +
        '<span class="pie-diff ' + diffCls + '">' + diffTxt + '</span>' +
        '</div>'
      );
    })
    .join('');
  // 来源必须写在图上：这四个分钟数是按逐字稿关键词推断的（source=text-heuristic），
  // 不是课堂实测计时。不标出来，读者会把「教师 26 分钟」当成真实数据。
  const allocHeuristic = !alloc.source || alloc.source === 'text-heuristic';
  const allocSourceLine = allocHeuristic
    ? '<p class="tip pie-source">⏱ 按逐字稿文本推断的分钟数（非实测课堂计时），只用来看节奏比例，不能当作真实课时数据。</p>'
    : '';

  box.innerHTML =
    allocSourceLine +
    '<div class="pie-wrap">' +
    '<svg viewBox="0 0 200 200" class="pie-svg" role="img" aria-label="时间分配环形图">' + arcs +
    '<text x="100" y="96" text-anchor="middle" font-size="26" font-weight="800" fill="var(--text)">' + total + '</text>' +
    '<text x="100" y="118" text-anchor="middle" font-size="11" fill="var(--text-3)">分钟 / 一节课</text></svg>' +
    '<div class="pie-legend">' + legend + '</div>' +
    '</div>' +
    '<p class="curve-note">理想配比参考：教师讲 45% / 学生答 20% / 互动 25% / 过渡 10%。讲授一旦超过 60%，学生就只剩"听"、没有"学"。</p>';
}

/* 17. 分环节改进稿 */
const SEG_STYLE = {
  导入: { icon: '🎬', color: '#0D9488' },
  新授: { icon: '📖', color: '#4F46E5' },
  互动: { icon: '🙋', color: '#D97706' },
  小结: { icon: '📌', color: '#DC2626' },
};

function renderSegScript(segments) {
  const box = $('segScript');
  if (!box) return;
  if (!segments || !segments.length) {
    box.innerHTML = '<p class="tip">暂无分段数据。</p>';
    return;
  }
  box.innerHTML = segments
    .map((s) => {
      const st = SEG_STYLE[s.phase] || { icon: '📌', color: '#64748B' };
      return (
        '<div class="seg-card" style="border-top-color:' + st.color + '">' +
        '<div class="seg-head"><span class="seg-phase" style="background:' + st.color + '">' + st.icon + ' ' + escapeHtml(s.phase) + '</span></div>' +
        '<p class="seg-script">' + escapeHtml(s.script || '') + '</p>' +
        (s.notes && s.notes.length
          ? '<ul class="seg-notes">' + s.notes.map((nt) => '<li>✎ ' + escapeHtml(nt) + '</li>').join('') + '</ul>'
          : '') +
        '</div>'
      );
    })
    .join('');
}

function segFullText(segments) {
  return (segments || []).map((s) => '【' + s.phase + '】\n' + (s.script || '')).join('\n\n');
}

function copyText(text, done) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
  } else {
    fallbackCopy(text, done);
  }
}

function fallbackCopy(text, done) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
    done();
  } catch (e) {
    /* 忽略：老浏览器不支持时静默失败 */
  }
  document.body.removeChild(ta);
}

async function runHeatmap() {
  if (!lastScript) return;
  const hmBox = $('heatmapBox');
  const pieBox = $('pieBox');
  if (hmBox) hmBox.innerHTML = '<p class="tip">正在生成提问等待热力图…</p>';
  if (pieBox) pieBox.innerHTML = '<p class="tip">正在统计时间分配…</p>';
  try {
    const data = await post('/api/heatmap', { transcript: lastScript, subject: lastSubject });
    lastHeatmap = data;

    // 等待指标统一读 wait_metrics（新契约）。
    // 兼容回退：旧数据 / 旧演示数据没有 wait_metrics 时，
    // 退回 wait_moments / wait_source / wait_note，不能报错。
    // 后端已把兼容字段 wait_source 对齐成 wait_metrics.source
    // （text-heuristic / model-inference），所以这里直接透传即可；
    // 万一取不到，用 'unknown' → 界面显示「来源未明确」，不硬猜口径。
    const rawMetrics = data.wait_metrics || {};
    const waitMetrics = {
      moments: Array.isArray(rawMetrics.moments)
        ? rawMetrics.moments
        : Array.isArray(data.wait_moments)
          ? data.wait_moments
          : [],
      source: rawMetrics.source || data.wait_source || 'unknown',
      note: rawMetrics.note || data.wait_note || '等待来源未记录。'
    };

    renderHeatmap(
      waitMetrics.moments,
      Object.assign({}, waitMetrics, {
        engine: data.engine,
        fallback_reason: data.fallback_reason,
      })
    );
    renderPie(data.time_allocation);
    renderSegScript(data.segments);
  } catch (e) {
    if (hmBox) hmBox.innerHTML = '<p class="tip">生成失败：' + escapeHtml(e.message || '') + '</p>';
    if (pieBox) pieBox.innerHTML = '<p class="tip">时间分配生成失败。</p>';
  }
}

const copySegBtn = $('copySegBtn');
if (copySegBtn) {
  copySegBtn.addEventListener('click', () => {
    if (!lastHeatmap || !lastHeatmap.segments) return;
    const original = copySegBtn.textContent;
    copyText(segFullText(lastHeatmap.segments), () => {
      copySegBtn.textContent = '✅ 已复制，去粘贴练嘴吧';
      setTimeout(() => { copySegBtn.textContent = original; }, 2200);
    });
  });
}

/* ==================================================================
   🎓 名师点评库（42）：微格教学评委的典型点评，按本次短板匹配
   ================================================================== */
const MASTER_QUOTES = {
  语言: [
    { quote: '「那个、然后、就是」不是口头禅，是你思维留空时的拐杖——删掉它们，句子反而更有力。', fix: '写逐字稿时刻意删除，用 1 秒停顿代替填充词' },
    { quote: '语速是激情的副产品，但超过 160 字/分，学生就从「听课」变成「追话」。', fix: '重点段降到 130–150 字/分，每个结论后停 2 秒' },
    { quote: '「大家明白吗」是全世界最没有信息量的一句话——它问不出任何学情，只安慰了你自己。', fix: '改成「王XX，你用刚才的结论说说这一步」' },
  ],
  互动: [
    { quote: '提问后不留等待就自答，是新教师最常见的惯性——你怕冷场，学生就永远学不会思考。', fix: '点名后闭嘴 3 秒，把沉默当成教学工具' },
    { quote: '一节课全是封闭式提问，等于让学生整节课都在猜你的心思。', fix: '每节课至少设计 2 个「为什么/如果…会怎样」的开放问题' },
    { quote: '真正的互动不是热闹，是让每个孩子都被看见一次。', fix: '给后排和角落的学生至少一次点名机会' },
  ],
  设计: [
    { quote: '导入花了 6 分钟还在绕，学生的新鲜感是有额度的，请省着花。', fix: '导入 90 秒内必须触达本课核心问题' },
    { quote: '直接给结论的课最「顺」，也最没有思维含量——学生记住了答案，没学会方法。', fix: '把结论拆成「观察→猜想→验证」三步走' },
    { quote: '环节断裂的课像拼凑的幻灯片，过渡句才是缝合课堂的线。', fix: '每个环节之间写一句承上启下的话并练熟' },
  ],
  教态: [
    { quote: '整节课没有一个超过 2 秒的停顿——你讲得很努力，但课堂需要呼吸。', fix: '在关键结论前后刻意停 2 秒，目光扫视全班' },
    { quote: '眼睛只看 PPT 和黑板，就永远不知道学生已经掉队多久了。', fix: '每讲完一段抬头扫视一次全班，看表情调整节奏' },
    { quote: '声音发虚是因为底气不足，而底气来自你对内容真正的熟悉。', fix: '把导入和结论两段各练 10 遍，形成肌肉记忆' },
  ],
  板书: [
    { quote: '板书写满即擦，是数字时代的肌肉记忆，也是学生笔记的灾难。', fix: '主板书写课题→推导→结论，保留到下课' },
    { quote: '板书没有分区，学生的笔记就只能靠缘分。', fix: '左 2/3 主板书，右 1/3 副板书（演算+学生生成）' },
  ],
  应变: [
    { quote: '课堂出事故时，先接住情绪，再回到教学——顺序反了就会双输。', fix: '万能三步：看见情绪→快速处理→课后单聊' },
    { quote: '被学生问倒不可怕，可怕的是不懂装懂——「这个问题我们下课一起研究」是标准答案。', fix: '准备一句兜底话术，真诚比全能更得分' },
  ],
  进阶: [
    { quote: '这节课的底子很好——接下来请追求「让学习真实发生」的细节：等待、追问、板演。', fix: '挑一个互动点打磨到精致，胜过十个环节都平庸' },
    { quote: '能把控节奏的教师很多，能让学生眼里有光的教师很少——你已经有这个苗头了。', fix: '保留这节课你最得意的一个设计，固定成你的个人风格' },
  ],
};

/* 从报告推导最弱维度（gap 越大越弱） */
function weakestDims(report) {
  const dims = [];
  const r = report.speech_rate || {};
  const q = report.questions || {};
  const f = report.filler_words || {};
  const k = report.knowledge || {};
  const p = report.pauses || {};
  if (r.chars_per_min > 160 || (f.total || 0) >= 8) {
    dims.push({ dim: '语言', gap: Math.max(0, (r.chars_per_min || 0) - 140) + (f.total || 0) * 2 });
  }
  // 「互动」维度不再用推断秒数打分，只看提问设计本身：
  // 有没有文本问题 / 有没有需要思考的问题候选 / 有没有确认式提问。
  const askedCount = Number(q.asked);
  const genuineCount = Number(q.genuine_questions);
  const fakeCount = Number(q.fake_questions);

  const noQuestionDesign =
    !Number.isFinite(askedCount) ||
    askedCount === 0;

  const noOpenPrompt =
    Number.isFinite(genuineCount) &&
    genuineCount === 0;

  const hasFakePrompt =
    Number.isFinite(fakeCount) &&
    fakeCount > 0;

  if (noQuestionDesign || noOpenPrompt || hasFakePrompt) {
    dims.push({
      dim: '互动',
      gap:
        40 +
        (noQuestionDesign ? 18 : 0) +
        (noOpenPrompt ? 10 : 0) +
        (hasFakePrompt ? 8 : 0),
    });
  }
  if ((k.cover_percent || 0) < 75) dims.push({ dim: '设计', gap: 90 - (k.cover_percent || 0) });
  if (!p.count_gt_2s) dims.push({ dim: '教态', gap: 22 });
  if ((report.overall_score || 0) < 70) dims.push({ dim: '应变', gap: 80 - (report.overall_score || 0) });
  dims.sort((a, b) => b.gap - a.gap);
  return dims;
}

function renderMasterQuotes(report) {
  const box = $('masterQuoteBox');
  if (!box) return;
  const dims = weakestDims(report);
  const picked = [];
  const pushFrom = (dim, n) => {
    const list = MASTER_QUOTES[dim] || [];
    for (let i = 0; i < Math.min(n, list.length); i++) picked.push({ dim, item: list[i] });
  };
  if (dims.length) {
    pushFrom(dims[0].dim, 2);
    if (dims[1]) pushFrom(dims[1].dim, 1);
    const rest = ['设计', '互动', '语言', '教态', '板书', '应变'].filter((d) => !dims.slice(0, 2).some((x) => x.dim === d));
    if (picked.length < 4 && rest.length) pushFrom(rest[0], 1);
    if (picked.length < 4) pushFrom('进阶', 1);
  } else {
    pushFrom('进阶', 2);
  }
  box.innerHTML = picked
    .map(
      (p) =>
        '<div class="mq-card">' +
        '<span class="mq-dim">' + escapeHtml(p.dim) + '</span>' +
        '<p class="mq-quote">' + escapeHtml(p.item.quote) + '</p>' +
        '<p class="mq-fix">✅ ' + escapeHtml(p.item.fix) + '</p>' +
        '</div>'
    )
    .join('');
}

/* ==================================================================
   🎴 分享海报（22）：Canvas 绘制战绩卡 + 二维码 + 一键保存
   ================================================================== */
const POSTER_FONT = '"PingFang SC","Microsoft YaHei",sans-serif';

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* 海报文字防溢出：按 canvas 实测宽度逐级收字号。
   只缩字号、不截断文本，保证信息不失真、也不出现半个字。 */
function fitCanvasFont(ctx, text, maxWidth, baseSize, minSize, weight) {
  const str = String(text == null ? '' : text);
  if (!str) return baseSize;

  for (let size = baseSize; size > minSize; size -= 1) {
    ctx.font = (weight || '400') + ' ' + size + 'px ' + POSTER_FONT;
    if (ctx.measureText(str).width <= maxWidth) return size;
  }

  return minSize;
}

/* CDN 不可用时画一个装饰性码形图案（带定位角，视觉等价） */
function drawFakeQR(ctx, x, y, size) {
  const n = 21;
  const cell = size / n;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x, y, size, size);
  ctx.fillStyle = '#0F172A';
  let seed = 20261021;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if ((r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7)) continue;
      if (rand() > 0.5) ctx.fillRect(x + c * cell, y + r * cell, cell * 0.92, cell * 0.92);
    }
  }
  const eye = (ex, ey) => {
    ctx.fillStyle = '#0F172A';
    ctx.fillRect(ex, ey, cell * 7, cell * 7);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(ex + cell, ey + cell, cell * 5, cell * 5);
    ctx.fillStyle = '#0F172A';
    ctx.fillRect(ex + cell * 2, ey + cell * 2, cell * 3, cell * 3);
  };
  eye(x, y);
  eye(x + (n - 7) * cell, y);
  eye(x, y + (n - 7) * cell);
}

function drawQRCode(ctx, x, y, size, text) {
  return new Promise((resolve) => {
    if (window.QRCode) {
      const holder = document.createElement('div');
      holder.style.cssText = 'position:fixed;left:-9999px;top:0';
      document.body.appendChild(holder);
      let settled = false;
      const finish = (useFake) => {
        if (settled) return;
        settled = true;
        if (holder.parentNode) document.body.removeChild(holder);
        if (useFake) drawFakeQR(ctx, x, y, size);
        resolve();
      };
      try {
        // eslint-disable-next-line no-new
        new QRCode(holder, {
          text,
          width: size,
          height: size,
          colorDark: '#0F172A',
          colorLight: '#ffffff',
          correctLevel: (window.QRCode.CorrectLevel && QRCode.CorrectLevel.M) || 0,
        });
        setTimeout(() => {
          const cv = holder.querySelector('canvas');
          const img = holder.querySelector('img');
          if (cv) {
            ctx.drawImage(cv, x, y, size, size);
            finish(false);
          } else if (img && img.src) {
            img.onload = () => {
              try { ctx.drawImage(img, x, y, size, size); } catch (e) { drawFakeQR(ctx, x, y, size); }
              finish(false);
            };
            img.onerror = () => finish(true);
          } else {
            finish(true);
          }
        }, 250);
      } catch (e) {
        finish(true);
      }
    } else {
      drawFakeQR(ctx, x, y, size);
      resolve();
    }
  });
}

async function renderPoster() {
  const canvas = $('posterCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const score = lastAnalysis ? lastAnalysis.overall_score || 0 : 0;
  const rank = rankOf(score);
  const subject = lastSubject || '本节课';
  const r = lastAnalysis ? lastAnalysis.speech_rate || {} : {};
  const q = lastAnalysis ? lastAnalysis.questions || {} : {};
  const f = lastAnalysis ? lastAnalysis.filler_words || {} : {};
  const sugs = (lastAnalysis && lastAnalysis.suggestions) || [];
  const owned = loadBadges();
  const badges = Object.keys(owned).slice(0, 5);

  // 背景
  const g = ctx.createLinearGradient(0, 0, 0, 960);
  g.addColorStop(0, '#4F46E5');
  g.addColorStop(0.45, '#3730A3');
  g.addColorStop(1, '#0F172A');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 540, 960);

  ctx.textAlign = 'center';

  // 顶部品牌
  ctx.font = '800 34px ' + POSTER_FONT;
  ctx.fillStyle = '#ffffff';
  ctx.fillText('讲台求生', 270, 76);
  ctx.font = '400 16px ' + POSTER_FONT;
  ctx.fillStyle = 'rgba(255,255,255,.72)';
  ctx.fillText('上台前，先被 AI 拆台一次', 270, 104);

  // 分数环
  const cx = 270;
  const cy = 292;
  const rad = 98;
  ctx.beginPath();
  ctx.arc(cx, cy, rad, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,.16)';
  ctx.lineWidth = 16;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, rad, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * score) / 100);
  ctx.strokeStyle = rank.color || '#FDE68A';
  ctx.lineWidth = 16;
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.font = '800 78px ' + POSTER_FONT;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(String(score), cx, cy + 26);
  ctx.font = '500 17px ' + POSTER_FONT;
  ctx.fillStyle = 'rgba(255,255,255,.66)';
  ctx.fillText('求生评分', cx, cy + 54);

  // 称号 + 课题
  ctx.font = '700 27px ' + POSTER_FONT;
  ctx.fillStyle = '#FDE68A';
  ctx.fillText(rank.title || '—', 270, 446);
  ctx.font = '400 17px ' + POSTER_FONT;
  ctx.fillStyle = 'rgba(255,255,255,.82)';
  ctx.fillText('《' + subject + '》试讲复盘', 270, 478);

  // 关键数据三卡
  // 普通分析不再显示「平均等待 N 秒」：没有音频时间戳，等待时间不可测量。
  // 改成展示「提问设计」（文本提问数 + 候选思考题数）；
  // 固定演示允许展示示例秒数，但必须标注「示例」。
  const posterIsDemo =
    lastAnalysis &&
    lastAnalysis.engine === 'offline-demo';

  const posterAsked =
    q.asked != null
      ? q.asked
      : q.total != null
        ? q.total
        : null;

  const posterGenuine =
    q.genuine_questions != null
      ? q.genuine_questions
      : q.authentic != null
        ? q.authentic
        : null;

  const posterWait = posterIsDemo ? waitSecondsForDisplay(q, posterIsDemo) : null;

  const stats = [
    {
      label: '语速',
      val: r.chars_per_min == null ? '未提供' : r.chars_per_min + ' 字/分',
      sub: ''
    },
    posterIsDemo
      ? {
          label: '示例等待',
          val: posterWait == null ? '未提供' : posterWait + ' 秒',
          sub: '固定示例 · 非实测'
        }
      : {
          label: '提问设计',
          val: posterAsked == null ? '未提供' : posterAsked + ' 次',
          sub:
            posterGenuine == null
              ? '候选思考题未提供'
              : '候选思考题 ' + posterGenuine + ' 次'
        },
    {
      label: '口头禅',
      val: f.total == null ? '未提供' : f.total + ' 次',
      sub: ''
    }
  ];
  const cw = 148;
  const gap = 14;
  const startX = (540 - cw * 3 - gap * 2) / 2;
  // 卡片左右各留 10px 安全边距，文字宽度按实测值收敛，绝不出框。
  const cardInner = cw - 20;
  stats.forEach((s, i) => {
    const x = startX + i * (cw + gap);
    ctx.fillStyle = 'rgba(255,255,255,.10)';
    roundRect(ctx, x, 506, cw, 86, 14);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    const valSize = fitCanvasFont(ctx, s.val, cardInner, 23, 13, '700');
    ctx.font = '700 ' + valSize + 'px ' + POSTER_FONT;
    ctx.fillText(s.val, x + cw / 2, 540);

    ctx.fillStyle = 'rgba(255,255,255,.62)';
    const labelSize = fitCanvasFont(ctx, s.label, cardInner, 13, 10, '400');
    ctx.font = '400 ' + labelSize + 'px ' + POSTER_FONT;
    ctx.fillText(s.label, x + cw / 2, 562);

    if (s.sub) {
      ctx.fillStyle = 'rgba(255,255,255,.55)';
      const subSize = fitCanvasFont(ctx, s.sub, cardInner, 11, 9, '400');
      ctx.font = '400 ' + subSize + 'px ' + POSTER_FONT;
      ctx.fillText(s.sub, x + cw / 2, 580);
    }
  });

  // 徽章行
  if (badges.length) {
    ctx.font = '600 14px ' + POSTER_FONT;
    ctx.fillStyle = 'rgba(255,255,255,.62)';
    ctx.fillText('已解锁 ' + badges.length + ' 枚成就徽章', 270, 634);
    const ico = Object.values(owned)
      .slice(0, 5)
      .map((b) => b.ico || '🏅')
      .join('  ');
    ctx.font = '24px ' + POSTER_FONT;
    ctx.fillText(ico, 270, 668);
  }

  // 改进重点
  if (sugs.length) {
    ctx.fillStyle = 'rgba(255,255,255,.10)';
    roundRect(ctx, 40, 700, 460, 96, 14);
    ctx.fill();
    ctx.font = '700 14px ' + POSTER_FONT;
    ctx.fillStyle = '#A5B4FC';
    ctx.fillText('下一步最该练', 270, 728);
    ctx.font = '500 15px ' + POSTER_FONT;
    ctx.fillStyle = 'rgba(255,255,255,.9)';
    ctx.fillText(String(sugs[0].title || '').slice(0, 22), 270, 754);
    ctx.font = '400 12px ' + POSTER_FONT;
    ctx.fillStyle = 'rgba(255,255,255,.6)';
    ctx.fillText(String(sugs[0].detail || '').slice(0, 30), 270, 776);
  }

  // 二维码（白底圆角卡片）
  const qrSize = 128;
  const qrX = (540 - qrSize) / 2;
  const qrY = 812;
  ctx.fillStyle = '#ffffff';
  roundRect(ctx, qrX - 8, qrY - 8, qrSize + 16, qrSize + 16, 14);
  ctx.fill();
  const shareUrl = location.origin + location.pathname + '?sharecode=2WZXYSXJ6D';
  await drawQRCode(ctx, qrX, qrY, qrSize, shareUrl);

  ctx.font = '400 14px ' + POSTER_FONT;
  ctx.fillStyle = 'rgba(255,255,255,.66)';
  ctx.fillText('扫码测测你的讲台求生分', 270, qrY + qrSize + 40);
}

const posterBtn = $('posterBtn');
const posterOverlay = $('posterOverlay');
if (posterBtn) {
  posterBtn.addEventListener('click', async () => {
    posterOverlay.classList.add('show');
    await renderPoster();
  });
}
if ($('posterCloseBtn')) {
  $('posterCloseBtn').addEventListener('click', () => posterOverlay.classList.remove('show'));
}
if (posterOverlay) {
  posterOverlay.addEventListener('click', (e) => {
    if (e.target === posterOverlay) posterOverlay.classList.remove('show');
  });
}
if ($('posterDownloadBtn')) {
  $('posterDownloadBtn').addEventListener('click', () => {
    const canvas = $('posterCanvas');
    const score = lastAnalysis ? lastAnalysis.overall_score || 0 : 0;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = '讲台求生-' + score + '分.png';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }, 'image/png');
  });
}

/* ==================================================================
   📋 教案导入（25）：对照教案检查知识点覆盖
   ================================================================== */
async function runPlanCheck() {
  const box = $('planBox');
  const planEl = $('planInput');
  if (!box || !planEl) return;
  const plan = planEl.value.trim();
  if (plan.length < 10 || !lastScript) return;
  box.innerHTML = '<p class="tip">正在对照教案检查知识点覆盖…</p>';
  try {
    const data = await post('/api/lesson-plan', { plan, transcript: lastScript, subject: lastSubject });
    renderPlanCover(data);
  } catch (e) {
    box.innerHTML = '<p class="tip">教案检查失败：' + escapeHtml(e.message || '') + '</p>';
  }
}

function renderPlanCover(data) {
  const box = $('planBox');
  if (!box) return;
  const cov = data.coverage || [];
  if (!cov.length) {
    box.innerHTML = '<p class="tip">' + escapeHtml(data.verdict || '未识别到教案知识点。') + '</p>';
    return;
  }
  const okCount = cov.filter((c) => c.status === '讲透了').length;
  const midCount = cov.filter((c) => c.status === '提到了').length;
  const missCount = cov.filter((c) => c.status === '漏讲').length;
  const statusCls = { 讲透了: 'ok', 提到了: 'partial', 漏讲: 'miss' };
  let html =
    '<div class="plan-summary">' +
    '<span>共 ' + cov.length + ' 个知识点</span>' +
    '<span style="color:var(--ok)">讲透 ' + okCount + '</span>' +
    '<span style="color:var(--warn)">提到 ' + midCount + '</span>' +
    '<span style="color:var(--danger)">漏讲 ' + missCount + '</span>' +
    (data.engine === 'llm'
      ? '<span class="engine-tag llm" style="margin-left:auto">AI 逐条比对</span>'
      : '<span class="engine-tag ' + sourceTagClassName(data.engine, data.fallback_reason) +
        '" style="margin-left:auto">离线字面匹配' + degradedSuffix(data.fallback_reason) + '</span>') +
    '</div>';
  if (data.verdict) html += '<p class="tip" style="margin:2px 0 6px">' + escapeHtml(data.verdict) + '</p>';
  html += cov
    .map(
      (c) =>
        '<div class="plan-item">' +
        '<div class="pi-head"><span class="pi-status ' + (statusCls[c.status] || 'partial') + '">' + escapeHtml(c.status) + '</span>' +
        '<span>' + escapeHtml(c.point) + '</span></div>' +
        (c.evidence ? '<p class="pi-ev">' + escapeHtml(c.evidence) + '</p>' : '') +
        '</div>'
    )
    .join('');
  if (data.missing && data.missing.length) {
    html += '<p class="tip" style="color:var(--danger)">⚠️ 漏讲：' + escapeHtml(data.missing.join('、')) + '</p>';
  }
  if (data.suggestions && data.suggestions.length) {
    html += '<ul class="seg-notes" style="margin-top:4px">' + data.suggestions.map((s) => '<li>✎ ' + escapeHtml(s) + '</li>').join('') + '</ul>';
  }
  box.innerHTML = html;
}

/* .txt 教案直读 */
const planFileBtn = $('planFileBtn');
const planFile = $('planFile');
if (planFileBtn && planFile) {
  planFileBtn.addEventListener('click', () => planFile.click());
  planFile.addEventListener('change', () => {
    const file = planFile.files && planFile.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      $('planInput').value = String(reader.result || '').slice(0, 20000);
    };
    reader.readAsText(file, 'utf-8');
  });
}

/* ==================================================================
   📐 课标对照（28）：对标义务教育课程标准（2022 年版）
   ================================================================== */
async function runCurriculumCheck() {
  const box = $('curriculumBox');
  if (!box || !lastScript) return;
  box.innerHTML = '<p class="tip">正在对照 2022 课标核验教学目标…</p>';
  try {
    const data = await post('/api/curriculum', {
      transcript: lastScript,
      subject: lastSubject,
      subjectKey: (lastAnalysis && lastAnalysis.subject_key) || 'generic',
    });
    renderCurriculum(data);
  } catch (e) {
    box.innerHTML = '<p class="tip">课标对照失败：' + escapeHtml(e.message || '') + '</p>';
  }
}

function renderCurriculum(data) {
  const box = $('curriculumBox');
  if (!box) return;
  const cls = { 达成: 'ok', 部分达成: 'partial', 未达成: 'miss' };
  let html =
    '<p class="tip" style="margin:0 0 6px;font-weight:700">' + escapeHtml(data.label || '课标对照') +
    (data.engine === 'llm'
      ? ' · AI 逐条判定'
      : ' · 离线关键词粗判' + degradedSuffix(data.fallback_reason)) + '</p>';
  if (data.summary) html += '<p class="tip" style="margin:0 0 10px;font-weight:600">' + escapeHtml(data.summary) + '</p>';
  html += (data.standards || [])
    .map(
      (s) =>
        '<div class="std-item">' +
        '<div class="si-head"><span class="si-mark ' + (cls[s.achieved] || 'miss') + '">' + escapeHtml(s.achieved) + '</span>' +
        '<span>' + escapeHtml(s.code) + (s.dim ? ' · ' + escapeHtml(s.dim) : '') + '</span></div>' +
        '<p class="si-desc">' + escapeHtml(s.desc) + '</p>' +
        '<p class="si-ev">' + escapeHtml(s.evidence || '') + '</p>' +
        '</div>'
    )
    .join('');
  box.innerHTML = html;
}

/* ---------- 事件绑定 ---------- */
analyzeBtn.addEventListener('click', runAnalyze);
renderBadges();
renderClassStudents();
resetSoloStudent(); // 单人台上先摆好这名学生（与课堂同一套模型）
resetClass();

/* ==================================================================
   💥 课堂崩塌模拟
   ================================================================== */
const crisisEmpty = $('crisisEmpty');
const crisisBody = $('crisisBody');
const crisisEventCard = $('crisisEventCard');
const crisisLog = $('crisisLog');
const crisisForm = $('crisisForm');
const crisisInput = $('crisisInput');
const crisisStartBtn = $('crisisStartBtn');
const crisisNextBtn = $('crisisNextBtn');
const crisisResetBtn = $('crisisResetBtn');
const crisisRecBtn = $('crisisRecBtn');
const crisisReplay = $('crisisReplay');
const crisisRecTip = $('crisisRecTip');

let crisisCurrent = null; // 当前事件 {id,title,desc,hint,escalated}
let crisisScores = [];   // 历次控场得分
let crisisLastId = null;
let crisisRound = 0;     // 教学环节轮次（决定事故强度）

function crisisBubble(role, text) {
  const div = document.createElement('div');
  const isStudent = role === 'student';
  div.className = 'msg ' + (isStudent ? 'stu' : 'tea');
  div.innerHTML = (isStudent ? '<b>学生</b>' : '<b>你（老师）</b>') +
    '<div class="bubble-text">' + escapeHtml(text) + '</div>';
  crisisLog.appendChild(div);
  crisisLog.scrollTop = crisisLog.scrollHeight;
  return div;
}

function crisisScoreCard(r) {
  const color = r.score >= 80 ? '#16a34a' : r.score >= 65 ? '#d97706' : '#dc2626';
  const div = document.createElement('div');
  div.className = 'msg sys';
  div.innerHTML =
    '<b style="color:' + color + '">FIAS 控场得分 <span class="score-num" data-target="' + r.score + '">0</span>（' + escapeHtml(r.grade || '') + '）</b>' +
    (r.dimension ? '<div style="font-size:12px;color:#64748B;margin:2px 0 6px">考察维度：' + escapeHtml(r.dimension) + '</div>' : '') +
    '<div class="bubble-text">' + escapeHtml(r.feedback || '') + '</div>' +
    (r.model_answer ? '<div class="bubble-text" style="margin-top:6px;border-left:3px solid var(--brand,#4F46E5);padding-left:8px"><b>示范应对：</b>' + escapeHtml(r.model_answer) + '</div>' : '');
  crisisLog.appendChild(div);
  crisisLog.scrollTop = crisisLog.scrollHeight;
  // 得分数字滚动动画
  const numEl = div.querySelector('.score-num');
  const target = r.score;
  const t0 = performance.now();
  const dur = 700;
  (function tick(t) {
    const p = Math.min(1, (t - t0) / dur);
    numEl.textContent = Math.round(target * (1 - Math.pow(1 - p, 3)));
    if (p < 1) requestAnimationFrame(tick);
  })(t0);
}

/* ==================================================================
   🏆 极限挑战（23）：6 关事故序列 + 3 条生命 + ≥60 过关 + S/A/B/C 结算
   ================================================================== */
const CHALLENGE_LEVELS = ['power', 'fight', 'parent', 'cry', 'chaos', 'phone'];
const CHALLENGE_NAMES = ['断电', '吵架', '家长', '哭泣', '哄堂', '手机'];
let crisisMode = 'drill';
let chState = null; // {level, lives, scores, finished}

const crisisModeBar = $('crisisModeBar');
if (crisisModeBar) {
  crisisModeBar.addEventListener('click', (e) => {
    const btn = e.target.closest('.msw');
    if (!btn) return;
    crisisModeBar.querySelectorAll('.msw').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    crisisMode = btn.getAttribute('data-cmode');
    resetCrisis();
    if (crisisMode === 'challenge') {
      chState = null;
      crisisStartBtn.textContent = '🏆 开始极限挑战';
      const p = crisisEmpty.querySelector('p');
      if (p) {
        p.innerHTML =
          '六起连环事故：<b>断电 → 吵架 → 家长 → 哭泣 → 哄堂 → 手机</b>。<br>' +
          '3 条生命，每次控场得分 <b>≥60</b> 才能过关，低于 60 扣 1 条命。<br>' +
          '全部通关按平均分授予 <b>S / A / B / C</b> 评级——敢来试试吗？';
      }
    } else {
      chState = null;
      $('challengeHud').hidden = true;
      $('chResult').hidden = true;
      crisisNextBtn.textContent = '下一次事故 →';
      crisisStartBtn.textContent = '💥 随机触发课堂事故';
      const p = crisisEmpty.querySelector('p');
      if (p) {
        p.innerHTML =
          '课堂不会永远顺利——设备断电、学生吵架、家长推门、有人哭了……<br>' +
          '点下方按钮，随机触发一次课堂事故，输入你的应对，<br>AI 按 FIAS 量化你的<b>控场得分</b>。';
      }
    }
  });
}

function renderChallengeHud() {
  const hud = $('challengeHud');
  if (!hud) return;
  if (crisisMode !== 'challenge' || !chState) {
    hud.hidden = true;
    return;
  }
  hud.hidden = false;
  $('chLevels').innerHTML = CHALLENGE_NAMES.map((n, i) => {
    let cls = 'ch-level';
    let txt = String(i + 1);
    if (i < chState.level || (chState.finished && chState.scores[i] != null && chState.scores[i] >= 60)) {
      cls += ' done';
      txt = '✓';
    } else if (chState.finished && chState.scores[i] != null) {
      cls += ' fail';
      txt = '✕';
    } else if (i === chState.level) {
      cls += ' cur';
    }
    return '<span class="' + cls + '" title="第 ' + (i + 1) + ' 关：' + n + '">' + txt + '</span>';
  }).join('');
  $('chLives').textContent = '❤'.repeat(Math.max(0, chState.lives)) + '🖤'.repeat(Math.max(0, 3 - chState.lives));
}

async function startChallengeLevel() {
  if (!chState) {
    chState = { level: 0, lives: 3, scores: [], finished: false };
    crisisScores = [];
    crisisRound = 0;
    crisisLastId = null;
    crisisLog.innerHTML = '';
  }
  if (chState.level >= CHALLENGE_LEVELS.length) {
    showChallengeResult(true);
    return;
  }
  const eventId = CHALLENGE_LEVELS[chState.level];
  crisisStartBtn.disabled = true;
  crisisStartBtn.textContent = '第 ' + (chState.level + 1) + ' / 6 关酝酿中…';
  try {
    const data = await post('/api/crisis/start', { eventId, round: chState.level + 1, scoreHistory: crisisScores });
    crisisCurrent = data.event;
    crisisLastId = data.event.id;
    crisisRound = chState.level + 1;
    crisisEmpty.hidden = true;
    crisisBody.hidden = false;
    $('chResult').hidden = true;
    crisisNextBtn.hidden = true;
    crisisEventCard.innerHTML =
      '<b style="font-size:16px">第 ' + (chState.level + 1) + ' 关 · ' + crisisCurrent.title + '</b>' +
      '<p style="margin:8px 0 4px;color:#475569">' + escapeHtml(crisisCurrent.desc) + '</p>' +
      '<p style="margin:0;font-size:12px;color:#64748B">🎯 ' + escapeHtml(crisisCurrent.hint) + '　·　过关线 60 分</p>';
    crisisBubble('student', data.student_say);
    renderChallengeHud();
    renderCrisisCurve();
    crisisInput.focus();
  } catch (e) {
    setErr(e.message || '触发事故失败');
  } finally {
    crisisStartBtn.disabled = false;
    crisisStartBtn.textContent = '🏆 开始极限挑战';
  }
}

function showChallengeResult(win) {
  crisisNextBtn.hidden = true;
  chState.finished = true;
  renderChallengeHud();
  const scores = chState.scores.filter((s) => s != null);
  const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
  let grade = 'C';
  let gtxt = '课堂社死 · 3 命耗尽';
  if (win && avg >= 90) {
    grade = 'S';
    gtxt = '讲台之王 · 临危不乱';
  } else if (win && avg >= 80) {
    grade = 'A';
    gtxt = '教坛新秀 · 稳得住场';
  } else if (win && avg >= 70) {
    grade = 'B';
    gtxt = '求生成功 · 险中求胜';
  } else if (win) {
    grade = 'C';
    gtxt = '惊险过关';
  }
  const box = $('chResult');
  box.hidden = false;
  box.innerHTML =
    '<div class="ch-grade">' + grade + '</div>' +
    '<p style="font-weight:700;margin:4px 0 2px">' + gtxt + '</p>' +
    '<p class="tip">平均控场 ' + avg + ' 分 · ' + (win ? '全部 6 关通关' : '止步第 ' + (chState.level + 1) + ' 关') + '</p>' +
    '<div class="poster-actions" style="margin-top:10px"><button class="primary" id="chRetryBtn" type="button">🔁 重新挑战</button></div>';
  $('chRetryBtn').addEventListener('click', () => {
    chState = null;
    crisisScores = [];
    crisisRound = 0;
    crisisLastId = null;
    crisisLog.innerHTML = '';
    box.hidden = true;
    startChallengeLevel();
  });
  if (win) unlockBadge('challenge', '极限求生', '🛡️', '通关极限挑战全部 6 关');
}

async function startCrisis() {
  if (crisisMode === 'challenge') return startChallengeLevel();
  crisisStartBtn.disabled = true;
  crisisStartBtn.textContent = '事故酝酿中…';
  try {
    const data = await post('/api/crisis/start', {
      lastEventId: crisisLastId,
      round: crisisRound,
      scoreHistory: crisisScores,
    });
    crisisCurrent = data.event;
    crisisLastId = data.event.id;
    crisisRound++;
    crisisEmpty.hidden = true;
    crisisBody.hidden = false;
    if (crisisRound === 1) crisisLog.innerHTML = '';
    crisisNextBtn.hidden = true;
    crisisEventCard.innerHTML =
      '<b style="font-size:16px' + (data.event.escalated ? ';color:#dc2626' : '') + '">' + crisisCurrent.title + '</b>' +
      '<p style="margin:8px 0 4px;color:#475569">' + escapeHtml(crisisCurrent.desc) + '</p>' +
      '<p style="margin:0;font-size:12px;color:#64748B">🎯 ' + escapeHtml(crisisCurrent.hint) +
      '　·　第 ' + crisisRound + ' 轮' + (data.event.escalated ? '　·　<span style="color:#dc2626;font-weight:700">⚠ 前次应对失分导致课堂失控升级</span>' : '') + '</p>';
    crisisBubble('student', data.student_say);
    renderCrisisCurve();
    crisisInput.focus();
  } catch (e) {
    setErr(e.message || '触发事故失败');
  } finally {
    crisisStartBtn.disabled = false;
    crisisStartBtn.textContent = '💥 随机触发课堂事故';
  }
}

async function respondCrisis() {
  const text = crisisInput.value.trim();
  if (!text || !crisisCurrent) return;
  crisisInput.value = '';
  crisisBubble('teacher', text);
  const typing = crisisBubble('student', '……');
  typing.querySelector('.bubble-text').textContent = '（AI 教研员正在评估你的应对…）';
  try {
    const r = await post('/api/crisis/respond', { eventId: crisisCurrent.id, response: text });
    typing.remove();
    crisisScores.push(r.score);
    crisisScoreCard(r);
    renderCrisisCurve();
    if (r.score >= 80) unlockBadge('crisis', '控场达人', '💥', '在崩塌模拟中拿到 80+ 控场分');

    if (crisisMode === 'challenge' && chState) {
      chState.scores[chState.level] = r.score;
      if (r.score >= 60) {
        chState.level++;
        renderChallengeHud();
        if (chState.level >= CHALLENGE_LEVELS.length) {
          showChallengeResult(true);
        } else {
          crisisBubble('student', '（这关算你过了——别得意，下一关更难看）');
          crisisNextBtn.hidden = false;
          crisisNextBtn.textContent = '下一关（' + (chState.level + 1) + ' / 6）→';
        }
      } else {
        chState.lives--;
        renderChallengeHud();
        if (chState.lives <= 0) {
          showChallengeResult(false);
        } else {
          crisisBubble('student', '（失守！生命 -1，同一关再给你一次机会）');
          crisisNextBtn.hidden = false;
          crisisNextBtn.textContent = '重试第 ' + (chState.level + 1) + ' 关 →';
        }
      }
      return;
    }

    crisisNextBtn.hidden = false;
  } catch (e) {
    typing.querySelector('.bubble-text').textContent = '（评估失败：' + (e.message || '网络异常') + '，可重新应对）';
  }
}

/* ---------- 演练录像 + 回放（MediaRecorder） ---------- */
let recStream = null;
let recObj = null;
let recChunks = [];
let recStartAt = 0;

async function startRecord() {
  if (recObj && recObj.state === 'recording') return;
  try {
    // 优先录屏幕+声音；不支持则退化为麦克风
    let stream;
    if (navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    } else {
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    }
    recStream = stream;
    recChunks = [];
    recObj = new MediaRecorder(stream);
    recObj.ondataavailable = (e) => { if (e.data && e.data.size) recChunks.push(e.data); };
    recObj.onstop = () => {
      const blob = new Blob(recChunks, { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      crisisReplay.src = url;
      crisisReplay.hidden = false;
      const sec = Math.round((Date.now() - recStartAt) / 1000);
      crisisRecTip.hidden = false;
      crisisRecTip.innerHTML = '录制完成（' + sec + ' 秒）· 可在下方回放，或 ' +
        '<a download="讲台求生-演练-' + Date.now() + '.webm" href="' + url + '" style="color:var(--brand,#4F46E5)">下载视频</a>';
      if (recStream) recStream.getTracks().forEach((t) => t.stop());
      crisisRecBtn.textContent = '● 录制我的演练';
    };
    recObj.start();
    recStartAt = Date.now();
    crisisRecBtn.textContent = '■ 停止录制';
    crisisRecTip.hidden = false;
    crisisRecTip.textContent = '● 正在录制…（屏幕 + 声音）';
  } catch (e) {
    setErr('无法开始录制：' + (e.message || '需要授权屏幕/摄像头权限'));
  }
}

function stopRecord() {
  if (recObj && recObj.state === 'recording') recObj.stop();
  else if (recStream) { recStream.getTracks().forEach((t) => t.stop()); crisisRecBtn.textContent = '● 录制我的演练'; }
}

if (crisisRecBtn) {
  crisisRecBtn.addEventListener('click', () => {
    if (recObj && recObj.state === 'recording') stopRecord(); else startRecord();
  });
}

function resetCrisis() {
  crisisCurrent = null;
  crisisScores = [];
  crisisRound = 0;
  crisisLastId = null;
  crisisBody.hidden = true;
  crisisEmpty.hidden = false;
  if (recObj && recObj.state === 'recording') stopRecord();
  const hud = $('challengeHud');
  if (hud) hud.hidden = true;
  const res = $('chResult');
  if (res) res.hidden = true;
}

/* 累计控场曲线（手写 SVG 折线，随轮次增长） */
function renderCrisisCurve() {
  let box = document.getElementById('crisisCurve');
  if (!box) {
    box = document.createElement('div');
    box.id = 'crisisCurve';
    box.style.cssText = 'margin:0 0 12px';
    crisisEventCard.parentNode.insertBefore(box, crisisEventCard);
  }
  if (crisisScores.length < 1) { box.innerHTML = ''; return; }
  const W = 600, H = 70, pl = 28, pr = 10, pt = 10, pb = 16;
  const n = crisisScores.length;
  const x = (i) => pl + (i * (W - pl - pr)) / Math.max(1, n - 1 || 1);
  const y = (v) => pt + (1 - v / 100) * (H - pt - pb);
  let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%">';
  s += '<line x1="' + pl + '" y1="' + y(60) + '" x2="' + (W - pr) + '" y2="' + y(60) + '" stroke="#f59e0b" stroke-dasharray="4 3" stroke-width="1"/>';
  s += '<text x="' + (pl - 4) + '" y="' + (y(60) + 3) + '" text-anchor="end" font-size="9" fill="#d97706">及格</text>';
  const pts = crisisScores.map((v, i) => x(i).toFixed(1) + ',' + y(v).toFixed(1));
  if (n === 1) pts.push((pl + 24) + ',' + y(crisisScores[0]).toFixed(1)); // 单点画成短线
  s += '<polyline points="' + pts.join(' ') + '" fill="none" stroke="#4F46E5" stroke-width="2"/>';
  crisisScores.forEach((v, i) => {
    s += '<circle cx="' + x(i).toFixed(1) + '" cy="' + y(v).toFixed(1) + '" r="3.5" fill="' + (v >= 80 ? '#16a34a' : v >= 65 ? '#d97706' : '#dc2626') + '"/>';
    s += '<text x="' + x(i).toFixed(1) + '" y="' + (y(v) - 7).toFixed(1) + '" text-anchor="middle" font-size="10" font-weight="700" fill="#475569">' + v + '</text>';
  });
  const avg = Math.round(crisisScores.reduce((a, b) => a + b, 0) / n);
  s += '<text x="' + (W - pr) + '" y="' + (H - 3) + '" text-anchor="end" font-size="10" fill="#64748b">累计控场曲线 · 平均 ' + avg + ' 分</text>';
  s += '</svg>';
  box.innerHTML = s;
}

if (crisisStartBtn) crisisStartBtn.addEventListener('click', startCrisis);
if (crisisNextBtn) crisisNextBtn.addEventListener('click', startCrisis);
if (crisisResetBtn) crisisResetBtn.addEventListener('click', resetCrisis);
if (crisisForm) crisisForm.addEventListener('submit', (e) => { e.preventDefault(); respondCrisis(); });

/* ==================================================================
   🔭 六视角全景透视
   ================================================================== */
const panoEmpty = $('panoEmpty');
const panoBody = $('panoBody');
const panoBtn = $('panoBtn');
const panoRadar = $('panoRadar');
const panoAvg = $('panoAvg');
const panoViews = $('panoViews');

async function runPanorama() {
  if (!lastAnalysis) {
    setErr('请先在左侧提交讲稿完成 AI 分析，六视角透视基于分析结果运行');
    return;
  }
  panoBtn.disabled = true;
  panoBtn.textContent = '六位 AI 正在会诊…（约 10-20 秒）';
  panoEmpty.hidden = true;
  panoBody.hidden = false;
  panoViews.innerHTML = '<p style="color:#64748B">六位 AI 正在分别生成报告…</p>';
  panoRadar.innerHTML = '';
  try {
    const data = await post('/api/panorama', {
      subject: lastSubject,
      transcript: lastScript,
      analysis: lastAnalysis,
    });
    renderRadar(data.views);
    const avg = data.average;
    panoAvg.textContent = '六视角平均分：' + avg + ' 分（' + (avg >= 80 ? '整体优秀' : avg >= 65 ? '整体合格' : '分歧较大，重点看低分视角') + '）';
    const panoEngineTag = sourceTagSpan(data.engine, data.fallback_reason);
    panoViews.innerHTML =
      (panoEngineTag ? '<div style="margin:0 0 8px">' + panoEngineTag + '</div>' : '') +
      data.views.map((v) => {
      const color = v.score >= 80 ? '#16a34a' : v.score >= 65 ? '#d97706' : '#dc2626';
      return '<div class="pano-card" style="border:1px solid var(--line,#e2e8f0);border-radius:12px;padding:14px 16px;margin-bottom:10px">' +
        '<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">' +
        '<span style="font-size:20px">' + v.icon + '</span>' +
        '<b>' + escapeHtml(v.label) + '</b>' +
        '<span style="font-size:20px;font-weight:800;color:' + color + ';margin-left:auto">' + v.score + '</span>' +
        '</div>' +
        '<p style="margin:0 0 6px;font-size:13px;color:#475569">' + escapeHtml(v.comment) + '</p>' +
        '<p style="margin:0;font-size:13px;color:#64748b">💡 ' + escapeHtml(v.advice) + '</p>' +
        '</div>';
    }).join('');
  } catch (e) {
    panoViews.innerHTML = '<p style="color:#dc2626">生成失败：' + escapeHtml(e.message || '') + '</p>';
  } finally {
    panoBtn.disabled = false;
    panoBtn.textContent = '重新生成六视角报告';
  }
}

/* 手写 SVG 雷达图（零依赖） */
function renderRadar(views) {
  if (!panoRadar) return;
  const cx = 160, cy = 150, R = 105, n = views.length;
  const pt = (i, r) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  };
  let s = '<svg viewBox="0 0 320 300" style="width:100%;max-width:340px;display:block;margin:0 auto">';
  for (const frac of [0.25, 0.5, 0.75, 1]) {
    s += '<polygon points="' + views.map((_, i) => pt(i, R * frac).map((x) => x.toFixed(1)).join(',')).join(' ') +
      '" fill="none" stroke="#cbd5e1" stroke-width="1"/>';
  }
  for (let i = 0; i < n; i++) {
    const [x, y] = pt(i, R);
    s += '<line x1="' + cx + '" y1="' + cy + '" x2="' + x.toFixed(1) + '" y2="' + y.toFixed(1) + '" stroke="#cbd5e1" stroke-width="1"/>';
  }
  const poly = views.map((v, i) => pt(i, R * Math.max(0.05, (v.score || 0) / 100)).map((x) => x.toFixed(1)).join(',')).join(' ');
  // 入场动画：先收缩到中心，再弹开到真实值
  const polyZero = views.map((_, i) => pt(i, R * 0.05).map((x) => x.toFixed(1)).join(',')).join(' ');
  s += '<polygon id="panoPoly" points="' + polyZero + '" fill="rgba(79,70,229,.25)" stroke="#4F46E5" stroke-width="2" style="transition:all .9s cubic-bezier(.34,1.56,.64,1)"/>';
  views.forEach((v, i) => {
    const [x, y] = pt(i, R + 26);
    s += '<text x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" text-anchor="middle" font-size="11" fill="#475569">' +
      v.icon + v.label.replace('AI ', '') + '</text>';
  });
  s += '</svg>';
  panoRadar.innerHTML = s;
  // 双 rAF 触发过渡动画
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const p = document.getElementById('panoPoly');
    if (p) p.setAttribute('points', poly);
  }));
}

if (panoBtn) panoBtn.addEventListener('click', runPanorama);

/* ---------- 导出 PDF（走后端 /api/export，新窗口打开自动触发打印） ---------- */
(function () {
  const btn = document.getElementById('exportBtn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    if (!lastAnalysis) return;
    const payload = {
      report: lastAnalysis,
      meta: {
        subject: lastSubject,
        grade: gradeInput.value.trim(),
        transcript: lastScript,
      },
    };
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = '/api/export';
    form.target = '_blank';
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = 'json';
    input.value = JSON.stringify(payload);
    form.appendChild(input);
    document.body.appendChild(form);
    form.submit();
    form.remove();
  });
})();

fillSampleBtn.addEventListener('click', () => {
  scriptInput.value = SAMPLE;
  charHint.textContent = scriptInput.value.replace(/\s/g, '').length + ' 字';
  setErr('');
});

scriptInput.addEventListener('input', () => {
  charHint.textContent = scriptInput.value.replace(/\s/g, '').length + ' 字';
});

improveBtn.addEventListener('click', runImprove);

personaBar.addEventListener('click', (e) => {
  const btn = e.target.closest('.persona');
  if (!btn) return;
  personaBar.querySelectorAll('.persona').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  currentPersona = btn.getAttribute('data-p') || 'naughty';
  resetSoloStudent(); // 台上换成这个学生（立绘 / 名字 / 卡片一起换）
  resetChat(); // 换了学生，重新开始
});

/* 自定义人设改了 → 卡片上的名字与状态原因跟着变（学生模型里的字段，不是另写的文案） */
const customPersonaInput = $('customPersona');
if (customPersonaInput) {
  customPersonaInput.addEventListener('change', resetSoloStudent);
  customPersonaInput.addEventListener('blur', resetSoloStudent);
}

askBtn.addEventListener('click', callStudent);

clearChatBtn.addEventListener('click', resetChat);

chatForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;
  chatInput.value = '';
  messages.push({ role: 'teacher', content: text });
  addBubble('teacher', text, '你（老师）');
  // 老师说话时学生在听：闭嘴、放下手（状态同样来自学生模型）
  setSoloState({ hand_raise: false, speaking: false });
  await callStudent(); // 老师回答后，学生继续追问
});


/* ==================================================================
   🎬 路演 3 分钟动线（D）：分镜 + 倒计时 + 逐字稿 + 一键执行
   ================================================================== */
const ROADSHOW_STEPS = [
  {
    at: '0:00',
    title: '开场：把痛点说到人心里',
    say: '每个师范生都要试讲，但试讲之前没人告诉你——哪句话会让学生走神、哪个问题抛出去会冷场。我们做了一个 AI 试讲教练：讲一次，当场告诉你哪里会翻车。',
    action: 'none',
  },
  {
    at: '0:20',
    title: '粘一段讲稿，AI 当场复盘',
    say: '这是一个真实的新手讲稿，我直接粘进去点分析。（等分数出来）52 分——危险瞬间、口头禅、提问等待全都被抓出来了。',
    action: 'analyze',
  },
  {
    at: '0:50',
    title: '专业度：等待热力图 + 时间分配',
    say: '红色是推断提问后留白不到 1 秒，疑似自问自答。一节课 40 分钟，老师讲了 24 分钟，学生只说了 6 分钟——这就是"假互动"。这些秒数由讲稿文本推断，不是音频时间戳实测。',
    action: 'heatmap',
  },
  {
    at: '1:20',
    title: '高光：AI 学生当场拆台',
    say: '更狠的是，AI 会扮演你班上的学生。一个抬杠、一个追问原理、一个走神，压力条在涨——这就是真实课堂的压迫感。',
    action: 'students',
  },
  {
    at: '1:50',
    title: '危机：课堂崩塌与控场评分',
    say: '后排突然炸锅了。（展开事件卡）你的每一句回应都有控场得分，答不好就社死结局。这个环节学生最愿意反复玩。',
    action: 'crisis',
  },
  {
    at: '2:20',
    title: '收尾：情感 + 传播 + 团队',
    say: '练砸了还有匿名树洞，AI 先接住情绪再给一个 30 秒能做的小动作；分数进校内榜、战队榜，一等奖海报一键发朋友圈。让"不敢讲"变成"想再讲一次"。',
    action: 'hollow',
  },
];

let rsTimer = null;
let rsLeft = 180;
let rsRunning = false;

function rsFmt(sec) {
  const m = Math.floor(Math.max(0, sec) / 60);
  const s = Math.max(0, sec) % 60;
  return m + ':' + String(s).padStart(2, '0');
}

function renderRoadshowSteps() {
  const box = $('rsSteps');
  if (!box) return;
  box.innerHTML = ROADSHOW_STEPS.map((st, i) =>
    '<div class="rs-step' + (st.done ? ' done' : '') + '" data-i="' + i + '">' +
    '<div class="rs-at">' + st.at + '</div>' +
    '<div class="rs-main">' +
    '<div class="rs-title">' + (i + 1) + '. ' + escapeHtml(st.title) + '</div>' +
    '<div class="rs-say">' + escapeHtml(st.say) + '</div>' +
    '</div>' +
    '<button class="rs-run" data-run="' + i + '" type="button">' + (st.done ? '重跑' : '执行') + '</button>' +
    '</div>'
  ).join('');
  box.querySelectorAll('.rs-run').forEach((b) => {
    b.addEventListener('click', () => runRoadshowStep(Number(b.getAttribute('data-run'))));
  });
}

async function runRoadshowStep(i) {
  const st = ROADSHOW_STEPS[i];
  if (!st) return;
  const tip = $('rsTip');
  const say = (t) => { if (tip) tip.textContent = t; };
  try {
    if (st.action === 'analyze') {
      say('执行中：填入示例讲稿并分析…');
      if (scriptInput) scriptInput.value = SAMPLE;
      if (charHint) charHint.textContent = String(SAMPLE).replace(/\s/g, '').length + ' 字';
      await runAnalyze();
      // 分析完先把镜头拉回报告顶部：录屏里观众要从「总分」开始看
      switchTab('report');
      await demoScrollTo($('pane-report'), 900);
      say('完成：报告已生成');
    } else if (st.action === 'heatmap') {
      say('执行中：定位到提问等待热力图…');
      switchTab('report');
      await demoWait(400);
      const box = $('heatmapBox');
      if (box) await demoScrollTo(box, 900);
      say('完成：热力图 + 时间分配可见');
    } else if (st.action === 'students') {
      say('执行中：AI 学生开始拆台…');
      switchTab('chat');
      // 录屏必须进「三学生课堂」才是高光：单人问答在镜头里信息量太小
      const classBtn = document.querySelector('#chatModeBar .msw[data-mode="class"]');
      if (classBtn) classBtn.click();
      await demoWait(600);
      await classNextRound();
      await demoScrollTo($('classStudents') || $('pane-chat'), 900);
      say('完成：三位学生已发难，压力条更新');
    } else if (st.action === 'crisis') {
      say('执行中：制造一次课堂事故…');
      switchTab('crisis');
      await demoWait(400);
      await startCrisis();
      await demoWait(1200);
      await demoScrollTo($('pane-crisis'), 900);
      say('完成：事件卡已展开，等你回应');
    } else if (st.action === 'hollow') {
      say('执行中：打开成长档案（树洞 / 榜单 / 海报）…');
      switchTab('growth');
      renderGrowth();
      loadLeaderboard(lbCurrent);
      await loadHollow();
      await demoScrollTo($('pane-growth'), 900);
      say('完成：树洞与榜单已就绪');
    } else {
      say('开场无需操作，直接讲这一段');
    }
    st.done = true;
    renderRoadshowSteps();
  } catch (e) {
    say('这步失败了（' + (e && e.message ? e.message : '网络') + '），可重试或跳过');
  }
}

function rsTick() {
  rsLeft -= 1;
  const clock = $('rsClock');
  if (clock) {
    clock.textContent = rsFmt(rsLeft);
    clock.classList.toggle('warn', rsLeft <= 30);
  }
  if (rsLeft <= 0) {
    rsStop();
    const tip = $('rsTip');
    if (tip) tip.textContent = '时间到，收尾：一句话价值升华 + 邀请评委扫码。';
  }
}

function rsStart() {
  if (rsRunning) return;
  rsRunning = true;
  const btn = $('rsStart');
  if (btn) btn.textContent = '计时中…';
  rsTimer = setInterval(rsTick, 1000);
}

function rsStop() {
  rsRunning = false;
  if (rsTimer) { clearInterval(rsTimer); rsTimer = null; }
  const btn = $('rsStart');
  if (btn) btn.textContent = '继续计时';
}

function rsReset() {
  rsStop();
  rsLeft = 180;
  const clock = $('rsClock');
  if (clock) { clock.textContent = '3:00'; clock.classList.remove('warn'); }
  ROADSHOW_STEPS.forEach((st) => { st.done = false; });
  renderRoadshowSteps();
  const tip = $('rsTip');
  if (tip) tip.textContent = '';
  const btn = $('rsStart');
  if (btn) btn.textContent = '开始计时';
}

function openRoadshow() {
  const ov = $('roadshowOverlay');
  if (!ov) return;
  ov.hidden = false;
  renderRoadshowSteps();
  if (!rsRunning && rsLeft === 180) rsStart(); // 打开即开始，符合现场节奏
}

function closeRoadshow() {
  const ov = $('roadshowOverlay');
  if (ov) ov.hidden = true;
  rsStop();
}

/* 录制整场（A）：自动跑完 6 步 + 屏幕录制，结束自动下载 webm
 * 节奏说明：快剪档原来是 [6,14,12,12,12,14]（合计 70 秒），
 * 分镜里的分数、热力图、压力条还没看明白就切走了。
 * 现在快剪档拉到 2 分钟档，镜头也跟着内容慢滚（见 runRoadshowStep）。 */
const RS_HOLD_STD = [18, 32, 30, 32, 30, 38];  // 合计 180 秒
const RS_HOLD_FAST = [10, 24, 20, 20, 20, 22];  // 合计 116 秒

let rsRecording = false;

async function recordRoadshow() {
  if (rsRecording) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
    setErr('当前浏览器不支持屏幕录制，请用 Chrome / Edge，或改用系统录屏（见 docs/roadshow-record-guide.md）');
    return;
  }
  const paceSel = $('rsPace');
  const fast = paceSel && paceSel.value === 'fast';
  const holds = fast ? RS_HOLD_FAST : RS_HOLD_STD;
  const tip = $('rsTip');
  const btn = $('rsRec');

  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true });
  } catch (e) {
    if (tip) tip.textContent = '已取消录制（未授权屏幕共享）';
    return;
  }

  const mimeCandidates = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  const mime = mimeCandidates.filter((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m))[0] || '';
  let rec;
  try {
    rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  } catch (e) {
    stream.getTracks().forEach((t) => t.stop());
    setErr('无法启动录制：' + (e.message || 'MediaRecorder 不可用'));
    return;
  }

  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  const finished = new Promise((resolve) => {
    rec.onstop = () => {
      const blob = new Blob(chunks, { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      const name = '讲台求生-路演-' + (fast ? '2min' : '3min') + '-' + Date.now() + '.webm';
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      resolve(name);
    };
  });

  rsRecording = true;
  if (btn) btn.textContent = '● 录制中…';
  rec.start(1000);
  rsReset();
  rsStart();

  try {
    for (let i = 0; i < ROADSHOW_STEPS.length; i++) {
      if (tip) tip.textContent = '录制中：第 ' + (i + 1) + '/6 步 · ' + ROADSHOW_STEPS[i].title;
      await runRoadshowStep(i);
      await sleep(holds[i] * 1000);
    }
  } finally {
    if (rec.state !== 'inactive') rec.stop();
    stream.getTracks().forEach((t) => t.stop());
    rsStop();
    const name = await finished;
    rsRecording = false;
    if (btn) btn.textContent = '◉ 录制整场';
    if (tip) tip.textContent = '录制完成，已自动下载：' + name + '（可直接上传或剪辑）';
  }
}

(function initRoadshow() {
  const btn = $('roadshowBtn');
  if (btn) btn.addEventListener('click', openRoadshow);
  const close = $('rsClose');
  if (close) close.addEventListener('click', closeRoadshow);
  const start = $('rsStart');
  if (start) start.addEventListener('click', rsStart);
  const reset = $('rsReset');
  if (reset) reset.addEventListener('click', rsReset);
  const rec = $('rsRec');
  if (rec) rec.addEventListener('click', recordRoadshow);
})();

/* ---------- 视频上传 + 自动转写 ---------- */
function setUploadTip(msg) {
  if (uploadTip) uploadTip.textContent = msg;
}

if (uploadBtn && videoFile) {
  uploadBtn.addEventListener('click', () => videoFile.click());
  videoFile.addEventListener('change', async () => {
    const file = videoFile.files && videoFile.files[0];
    if (!file) return;
    setUploadTip('正在转写，请稍候（首次运行需下载模型）…');
    uploadBtn.disabled = true;
    setErr('');
    try {
      const form = new FormData();
      form.append('file', file, file.name);
      const sc = currentShareCode();
      const theaders = {};
      if (sc) theaders['X-Share-Code'] = sc;
      const res = await fetch('/api/transcribe', { method: 'POST', body: form, headers: theaders });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || '上传失败');
      if (json.transcribed === true && json.transcript) {
        scriptInput.value = json.transcript;
        if (json.durationSec) {
          durationInput.value = json.durationSec;
          // 明确区分时长来源：这是从媒体文件读取的，不是用户填写的。
          markDurationSource('media', '时长来自所选媒体文件（约 ' + json.durationSec + ' 秒），可手动改成试讲实际总时长。');
        }
        charHint.textContent = scriptInput.value.replace(/\s/g, '').length + ' 字';
        setUploadTip('转写完成 · 来源 ' + (json.source || '本地') + ' · 时长 ' + json.durationSec + ' 秒');
        lastSegments = json.segments || [];
      } else {
        setUploadTip('环境暂不支持自动转写');
        setErr('无法自动转写：' + (json.reason || '未知原因') + '。可直接粘贴讲稿继续，其余功能完全相同。');
      }
    } catch (e) {
      setUploadTip('上传失败');
      setErr(e.message || '上传过程出错');
    } finally {
      uploadBtn.disabled = false;
      videoFile.value = '';
    }
  });
}

/* ---------- 语速曲线（手写 SVG，零依赖） ---------- */
function renderCurve(report) {
  if (!curveBox) return;
  const rhythm = report && report.rhythm;

  // 有真实时间戳：画语速随时间变化的折线
  if (Array.isArray(rhythm) && rhythm.length >= 2) {
    const W = 640, H = 180, pl = 40, pr = 14, pt = 16, pb = 28;
    const rates = rhythm.map((p) => p.rate);
    const top = Math.max(200, Math.ceil(Math.max.apply(null, rates) / 20) * 20);
    const x = (i) => pl + (W - pl - pr) * (i / (rhythm.length - 1));
    const y = (v) => pt + (H - pt - pb) * (1 - v / top);

    let line = '';
    rhythm.forEach((p, i) => { line += (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p.rate).toFixed(1) + ' '; });
    const area = line + 'L' + x(rhythm.length - 1).toFixed(1) + ' ' + y(0) + ' L' + x(0).toFixed(1) + ' ' + y(0) + ' Z';

    let dots = '', labels = '';
    rhythm.forEach((p, i) => {
      dots += '<circle cx="' + x(i).toFixed(1) + '" cy="' + y(p.rate).toFixed(1) + '" r="3.4" fill="#4F46E5"/>';
      if (i % 2 === 0 || i === rhythm.length - 1) {
        labels += '<text x="' + x(i).toFixed(1) + '" y="' + (H - 9) + '" font-size="10" fill="#94A3B8" text-anchor="middle">' + p.at + 's</text>';
      }
    });
    const y150 = y(150), y120 = y(120);

    curveBox.innerHTML =
      '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto" role="img" aria-label="语速随时间变化曲线">' +
      '<rect x="' + pl + '" y="' + y150 + '" width="' + (W - pl - pr) + '" height="' + (y120 - y150) + '" fill="#DCFCE7"/>' +
      '<path d="' + area + '" fill="#EEF2FF"/>' +
      '<path d="' + line + '" fill="none" stroke="#4F46E5" stroke-width="2" stroke-linejoin="round"/>' +
      dots +
      '<text x="8" y="' + (y150 - 3) + '" font-size="10" fill="#15803D">150</text>' +
      '<text x="8" y="' + (y120 + 10) + '" font-size="10" fill="#15803D">120</text>' +
      labels + '</svg>' +
      '<p class="curve-note">绿色带为适中区间 120–150 字/分。曲线依据真实转写时间戳计算，掉出绿色带就是讲快或讲慢的地方。</p>';
    return;
  }

  // 没有时间戳：退化为「逐句字数分布」，同样能反映信息密度
  const sentences = String(lastScript || '')
    .split(/[。！？；\n]+/)
    .filter((s) => s.trim().length > 0)
    .slice(0, 26);
  if (sentences.length === 0) {
    curveBox.innerHTML = '<p class="curve-note">暂无足够数据。</p>';
    return;
  }
  const lens = sentences.map((s) => s.replace(/\s/g, '').length);
  const max = Math.max.apply(null, lens) || 1;
  let bars = '';
  lens.forEach((n, i) => {
    bars += '<div class="cbar" style="height:' + Math.max(4, Math.round((n / max) * 100)) + '%" title="第' + (i + 1) + '句 ' + n + '字"></div>';
  });
  curveBox.innerHTML =
    '<div class="cbars">' + bars + '</div>' +
    '<p class="curve-note">这是「逐句字数分布」：柱子越高表示这一句越长，学生越难一次听懂。上传视频可获得基于真实时间戳的语速曲线。</p>';
}

/* ---------- 语音朗读（Web Speech API，浏览器原生） ---------- */
/* 语音朗读：scene='class' 走三学生课堂开关，'chat' 走单学生开关
 * 不调用 cancel()——否则每位学生开口都会打断上一位，实测听感是「半句话」
 * pitch/rate 区分学生音色，三位学生能听出不同人 */
function ttsOn(scene) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return false;
  const el = scene === 'class' ? $('classSpeakToggle') : speakToggle;
  return !!(el && el.checked);
}

const TTS_VOICE = {
  naughty: { pitch: 1.18, rate: 1.08 }, // 小皮：语速快、音调高
  geek: { pitch: 0.95, rate: 1.02 },    // 小霸：低沉、稳
  drift: { pitch: 0.85, rate: 0.92 },   // 小走：慢、没精神
};

function speak(text, opts) {
  const o = opts || {};
  if (!ttsOn(o.scene)) return;
  try {
    const v = TTS_VOICE[o.key] || {};
    const utter = new SpeechSynthesisUtterance(String(text || ''));
    utter.lang = 'zh-CN';
    utter.rate = o.rate || v.rate || 1.05;
    utter.pitch = o.pitch || v.pitch || 1;
    utter.volume = 1;
    window.speechSynthesis.speak(utter); // 入队播放，不打断
  } catch (e) {
    /* 浏览器不支持时静默降级，不影响其余功能 */
  }
}

/* 全局静音：随时打断（现场救场用） */
function stopSpeak() {
  try { window.speechSynthesis.cancel(); } catch (e) { /* 忽略 */ }
}

/* ---------- 回到顶部（单列长页面必备） ---------- */
(function initToTop() {
  const btn = $('toTopBtn');
  if (!btn) return;
  const onScroll = () => btn.classList.toggle('show', window.scrollY > 620);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  btn.addEventListener('click', () => {
    try { window.scrollTo({ top: 0, behavior: 'smooth' }); }
    catch (e) { window.scrollTo(0, 0); }
  });
})();

/* ---------- 介绍页链接：透传 sharecode，避免线上 403 ---------- */
(function fixLandingLink() {
  try {
    const a = $('landingLink');
    const sc = new URLSearchParams(location.search).get('sharecode');
    if (a && sc) a.href = 'landing.html?sharecode=' + encodeURIComponent(sc);
  } catch (e) { /* 忽略 */ }
})();

/* ---------- 外部入口：?demo=1 自动跑演示（主页 CTA 用） ---------- */
(function autoDemoFromQuery() {
  try {
    const q = new URLSearchParams(location.search);
    if (q.get('demo') !== '1') return;
    const btn = $('autoDemoBtn');
    if (!btn) return;
    // 等首屏与模型探测完成，避免抢跑
    setTimeout(() => { if (!autoRunning) btn.click(); }, 1200);
  } catch (e) { /* 老浏览器忽略 */ }
})();

/* ---------- 深色 / 浅色主题 ---------- */
const THEME_KEY = 'jiangtai_theme';
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  try { localStorage.setItem(THEME_KEY, t); } catch (e) { /* 隐私模式下忽略 */ }
}
if (themeBtn) {
  themeBtn.addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme');
    applyTheme(cur === 'dark' ? 'light' : 'dark');
  });
}

/* ---------- 一键自动演示（现场 Plan B，无需录屏） ----------
 * 为什么重写节奏：旧版每步只停 0.5–2.6 秒，分数还没看完画面就切走了，
 * 评委视角下等于「闪了一下」，看不出产品到底做了什么。
 *
 * 现在的四条约定（改动前请先读）：
 *   1. 一步只讲一件事，单步停留 7–9 秒；想加速按底部「下一步 ⏭」即可，不用改代码。
 *   2. 每步配一条底部字幕：第几步 / 这一步该看哪里（评委不用猜）。
 *   3. 七个 Tab 全走到：报告 → 改进 → 单人拆台 → 三学生课堂 → 专项练习
 *      → 崩塌模拟 → 六视角 → 成长档案（共 8 步，功能一个不落）。
 *   4. 切 Tab 后用自定义缓动滚动把目标区域送进视线（原生 smooth 太快、没节奏感）；
 *      单步失败只提示、不中止——现场不允许一个接口挂了就断演。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let autoRunning = false;

/* 演示控制器：暂停 / 跳过 / 退出，全部由底部字幕条驱动 */
const demoCtl = { paused: false, skip: false, aborted: false };

const PREFERS_REDUCE = (() => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (e) {
    return false;
  }
})();

function demoHudEls() {
  return {
    hud: $('demoHud'),
    step: $('dhStep'),
    title: $('dhTitle'),
    tip: $('dhTip'),
    bar: $('dhBar'),
    pause: $('dhPause')
  };
}

function demoHudShow(show) {
  const { hud } = demoHudEls();
  if (hud) hud.hidden = !show;
  // 字幕条是固定定位，会压住页面底部内容；演示期间给 body 留出同等高度
  if (document.body) {
    document.body.classList.toggle('is-demo-running', !!show);
  }
}

function demoHudProgress(ratio) {
  const { bar } = demoHudEls();
  if (!bar) return;
  const pct = Math.round(Math.max(0, Math.min(1, ratio)) * 100);
  bar.style.width = pct + '%';
}

function demoHudSet(index, total, title, tip) {
  const e = demoHudEls();
  if (e.step) e.step.textContent = (index + 1) + ' / ' + total;
  if (e.title) e.title.textContent = title;
  if (e.tip) e.tip.textContent = tip;
  demoHudProgress(0);
}

(function bindDemoHud() {
  const e = demoHudEls();
  if (e.pause) {
    e.pause.addEventListener('click', () => {
      demoCtl.paused = !demoCtl.paused;
      e.pause.textContent = demoCtl.paused ? '▶ 继续' : '⏸ 暂停';
      const { hud } = demoHudEls();
      if (hud) hud.classList.toggle('is-paused', demoCtl.paused);
    });
  }
  const skip = $('dhSkip');
  if (skip) {
    skip.addEventListener('click', () => {
      // 跳过只作用于「当前这一步」的停留，不影响后面的节奏
      demoCtl.skip = true;
      demoCtl.paused = false;
      if (e.pause) e.pause.textContent = '⏸ 暂停';
      const { hud } = demoHudEls();
      if (hud) hud.classList.remove('is-paused');
    });
  }
  const exit = $('dhExit');
  if (exit) {
    exit.addEventListener('click', () => {
      demoCtl.aborted = true;
      demoCtl.paused = false;
      demoCtl.skip = true;
    });
  }
})();

/**
 * 演示专用等待：可暂停、可跳过。
 * 不能用裸 setTimeout —— 暂停键按下去计时还在走，就不叫暂停了。
 */
function demoWait(ms) {
  const total = Math.max(200, Number(ms) || 0);
  return new Promise((resolve) => {
    let left = total;
    const tick = 50;
    const id = setInterval(() => {
      if (demoCtl.aborted || demoCtl.skip) {
        clearInterval(id);
        demoCtl.skip = false;
        demoHudProgress(1);
        resolve();
        return;
      }
      // 暂停时既不推进进度，也不结束——画面就停在评委正在看的地方
      if (demoCtl.paused) return;
      left -= tick;
      demoHudProgress(1 - left / total);
      if (left <= 0) {
        clearInterval(id);
        resolve();
      }
    }, tick);
  });
}

/** 轮询等待某个条件成立（等接口返回后渲染出来的东西），超时不抛错。 */
async function demoWaitFor(check, timeout) {
  const limit = Number(timeout) || 10000;
  const start = Date.now();
  while (Date.now() - start < limit) {
    let ok = false;
    try {
      ok = !!check();
    } catch (e) {
      ok = false;
    }
    if (ok) return true;
    await sleep(120);
  }
  return false;
}

/**
 * 演示专用滚动：easeInOutCubic，默认 800ms。
 * window.scrollTo({behavior:'smooth'}) 在不同浏览器速度不一致（Chrome 约 300ms），
 * 放在讲稿页上就是「唰」一下，评委根本跟不上视线。
 */
function demoScrollTo(el, duration) {
  const ms = duration == null ? 800 : duration;
  if (!el || !el.getBoundingClientRect) return Promise.resolve();

  const rect = el.getBoundingClientRect();
  const to = Math.max(0, window.scrollY + rect.top - 96);
  const from = window.scrollY;

  if (PREFERS_REDUCE || ms <= 0 || Math.abs(to - from) < 8) {
    window.scrollTo(0, to);
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const t0 = performance.now();
    const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    const frame = (now) => {
      if (demoCtl.aborted) {
        resolve();
        return;
      }
      const k = Math.min(1, (now - t0) / ms);
      window.scrollTo(0, from + (to - from) * ease(k));
      if (k < 1) requestAnimationFrame(frame);
      else resolve();
    };
    requestAnimationFrame(frame);
  });
}

/* 专项练习的演示文本：必须 >30 字，否则 drillSubmit() 会判「内容太短」直接拦下 */
const DEMO_DRILL_TEXT =
  '同学们先别急着看答案。谁能用自己的话说说，刚才我们为什么要在斜边上画这个正方形？' +
  '想一想，如果换成直角边，面积关系还成立吗？请第三排这位同学先说说你的思路，' +
  '其他同学听完再补充——不着急，我们给他十秒钟。';

/* 演示分镜：顺序即页面顺序，hold＝这一步停留多久（毫秒）。
 * 停留值的依据：一屏指标卡 / 一段逐字稿扫读 + 评委反应时间，低于 6 秒看不清。 */
const DEMO_STEPS = [
  {
    key: 'report',
    title: '复盘报告：一眼看见哪句话会翻车',
    tip: '总分、危险瞬间、口头禅、提问等待都在这一屏。红色方块＝提问后不到 1 秒的追问，属于「假互动」。',
    hold: 7000,
    run: async () => {
      await runAnalyze();
      if (!lastAnalysis || lastAnalysis.engine !== 'offline-demo') {
        throw new Error('示例报告未能生成，请检查内置演示数据。');
      }
      // 镜头要对准「总分环」：pane-report 的顶部已是指标卡，从那里开场会漏掉总分
      await demoScrollTo($('scoreRing') || $('pane-report'), 900);
    }
  },
  {
    key: 'improve',
    title: '改进建议：把讲稿改成能照着念的版本',
    tip: '左边是逐句改写后的逐字稿，右边标出每一处为什么要改；照着念一遍就知道顺不顺。',
    hold: 7000,
    run: async () => {
      switchTab('improve');
      await demoWait(500);
      await runImprove();
      await demoScrollTo($('pane-improve'), 900);
    }
  },
  {
    key: 'chat-solo',
    title: 'AI 学生拆台：先让一个学生发难',
    tip: '调皮型学生基于你刚才的讲稿提问；下方输入框可以当场作答，它会继续追问。',
    hold: 7500,
    run: async () => {
      switchTab('chat');
      await demoWait(400);
      // 与手动操作走同一条路径：点模式按钮，不另开旁路
      const soloBtn = document.querySelector('#chatModeBar .msw[data-mode="solo"]');
      if (soloBtn) soloBtn.click();
      await demoWait(400);
      await callStudent();
      await demoScrollTo($('chatLog'), 800);
    }
  },
  {
    key: 'chat-class',
    title: '三学生课堂：路演高光，压力条会涨',
    tip: '三个学生同时在线：一个抬杠、一个追问原理、一个走神。看压力条与「节奏 / 张力 / 参与度」三个仪表。',
    hold: 8500,
    run: async () => {
      switchTab('chat');
      await demoWait(300);
      const classBtn = document.querySelector('#chatModeBar .msw[data-mode="class"]');
      if (classBtn) classBtn.click();
      await demoWait(800);
      await classNextRound();
      await demoScrollTo($('classStudents') || $('pane-chat'), 800);
    }
  },
  {
    key: 'drill',
    title: '3 分钟专项练习：只练一个动作，当场打分',
    tip: '挑手感最差的一项技能单独练；提交后给出这一项的分数和一条能立刻照着做的改进动作。',
    hold: 9000,
    run: async () => {
      switchTab('drill');
      await demoWait(500);
      const card = document.querySelector('#drillSkillCards .drill-skill-card');
      if (card) card.click();
      await demoWait(700);

      const ta = $('drillTranscript');
      if (ta) {
        ta.value = DEMO_DRILL_TEXT;
        const hint = $('drillCharHint');
        if (hint) {
          hint.textContent = '已输入 ' + ta.value.replace(/\s/g, '').length + ' 字';
        }
      }
      await demoWait(900);

      const submit = $('drillSubmitBtn');
      if (submit) submit.click();
      await demoWaitFor(() => {
        const box = $('drillResult');
        return box && !box.hidden;
      }, 12000);
      await demoScrollTo($('drillResult'), 900);
    }
  },
  {
    key: 'crisis',
    title: '课堂崩塌模拟：事故来了怎么接',
    tip: '随机触发一次真实课堂事故，你当场回应；控场分太低会走向「社死结局」，这是学生最愿意反复练的环节。',
    hold: 9000,
    run: async () => {
      switchTab('crisis');
      await demoWait(400);
      await startCrisis();
      // 先让评委把事件卡读完，再替老师作答
      await demoWait(3200);
      if (crisisCurrent) {
        crisisInput.value =
          '大家先别急着抬头，我们把黑板上这一步走完。第三排的同学，你来说说刚才我们推到哪一步了？' +
          '其他同学跟着他的思路一起看，我们接着往下推。';
        await demoWait(1200);
        await respondCrisis();
      }
      await demoScrollTo($('pane-crisis'), 800);
    }
  },
  {
    key: 'pano',
    title: '六视角透视：一节课的互动矩阵',
    tip: '自研 iFIAS 把整节课编码成 12×12 矩阵：稳态格、内容十字区、师生话语比一眼可见。',
    hold: 7500,
    run: async () => {
      switchTab('pano');
      await demoWait(400);
      await runPanorama();
      await demoScrollTo($('pane-pano'), 800);
    }
  },
  {
    key: 'growth',
    title: '成长档案：练过的每一次都算数',
    tip: '得分曲线、校内榜 / 战队榜、匿名树洞都在这里——把「练一次」变成「想再练一次」。',
    hold: 7500,
    run: async () => {
      switchTab('growth');
      await demoWait(400);
      renderGrowth();
      try {
        loadLeaderboard(lbCurrent);
      } catch (e) { /* 榜单失败不影响演示 */ }
      try {
        await loadHollow();
      } catch (e) { /* 树洞失败不影响演示 */ }
      await demoScrollTo($('pane-growth'), 800);
    }
  }
];

async function autoDemo() {
  if (!JTQ_DEMO_PAGE) {
    const demoUrl = new URL(window.location.href);
    demoUrl.searchParams.set('jtq-demo', '1');

    // 保留原站点的 sharecode 等参数。
    window.open(demoUrl.href, '_blank', 'noopener,noreferrer');

    setErr(
      '固定示例将在新标签页打开；若浏览器拦截，请允许弹出窗口。当前讲稿不会被覆盖。'
    );
    return;
  }

  if (autoRunning) return;

  autoRunning = true;
  demoCtl.paused = false;
  demoCtl.skip = false;
  demoCtl.aborted = false;

  const advanced = $('trainingAdvanced');
  if (advanced) advanced.open = true;

  const originalButtonText = autoDemoBtn
    ? autoDemoBtn.textContent
    : '▷ 自动演示';

  if (autoDemoBtn) {
    autoDemoBtn.disabled = true;
    autoDemoBtn.textContent = '● 演示中…';
  }

  demoHudShow(true);
  demoHudSet(
    0,
    DEMO_STEPS.length,
    '准备：填入示例讲稿',
    '固定示例「勾股定理 · 初中八年级」，全程用内置数据，断网也能跑；随时可以暂停或跳到下一步。'
  );

  try {
    setErr('');

    // 固定示例必须与示例课题一致。
    subjectInput.value = '勾股定理';
    gradeInput.value = '初中八年级';

    if (subjectKeyInput) subjectKeyInput.value = 'math';

    // 避免用户此前开启的对比配置影响固定演示。
    if (compareToggle) {
      compareToggle.value = 'off';
      compareToggle.dispatchEvent(
        new Event('change', { bubbles: true })
      );
    }

    scriptInput.value = SAMPLE;
    charHint.textContent =
      scriptInput.value.replace(/\s/g, '').length + ' 字';

    // 开演前留一拍：先让评委看清「贴进去的是什么讲稿」，再开始分析
    window.scrollTo(0, 0);
    await demoWait(1800);

    for (let i = 0; i < DEMO_STEPS.length; i++) {
      if (demoCtl.aborted) break;

      const step = DEMO_STEPS[i];
      demoHudSet(i, DEMO_STEPS.length, step.title, step.tip);

      try {
        await step.run();
      } catch (e) {
        // 单步失败不断演：现场还有一张嘴可以解释，比整场黑屏强
        console.warn('[demo] 步骤失败：' + step.title, e);
        const tipEl = $('dhTip');
        if (tipEl) {
          tipEl.textContent =
            '这一步没跑通（' +
            (e && e.message ? e.message : '网络') +
            '），已跳过，继续下一步。';
        }
        await demoWait(1600);
      }

      if (demoCtl.aborted) break;
      await demoWait(step.hold);
    }

    if (demoCtl.aborted) {
      setErr('演示已退出，可以继续手动操作。');
      demoHudShow(false);
    } else {
      demoHudSet(
        DEMO_STEPS.length - 1,
        DEMO_STEPS.length,
        '✓ 演示完成：' + DEMO_STEPS.length + ' 步、七个功能区全部走完',
        '要重播点右上角「▷ 自动演示」；也可以直接上手操作任意功能。'
      );
      demoHudProgress(1);
      await demoWait(4500);
      demoHudShow(false);
    }
  } catch (error) {
    setErr(
      '示例播放中断：' +
      (error && error.message ? error.message : '请稍后重试')
    );
    demoHudShow(false);
  } finally {
    autoRunning = false;
    demoCtl.paused = false;
    demoCtl.skip = false;

    const pauseBtn = $('dhPause');
    if (pauseBtn) pauseBtn.textContent = '⏸ 暂停';
    const hud = $('demoHud');
    if (hud) hud.classList.remove('is-paused');

    if (autoDemoBtn) {
      autoDemoBtn.disabled = false;
      autoDemoBtn.textContent = originalButtonText;
    }
  }
}
function startDemoFromWorkspace() {
  // 演示页内部的高级设置展开由 autoDemo() 自己负责；
  // 正常训练页点击时只是在新标签页打开固定演示，不改动当前页面状态。
  return autoDemo();
}

if (autoDemoBtn) {
  autoDemoBtn.addEventListener('click', startDemoFromWorkspace);
}

// hero 按钮 = 同一个自动演示（路演入口）
const heroDemoBtn = document.getElementById('heroDemoBtn');
if (heroDemoBtn) {
  heroDemoBtn.addEventListener('click', startDemoFromWorkspace);
}

/* ---------- 启动 ---------- */
let lastSegments = [];

/* 顶栏「⋯ 更多」抽屉：模型名、主题、介绍、Codex、路演全收在这里。
 * 首屏第一行只留给「这是什么」——「模型: deepseek-chat」是诊断信息，
 * 不该占据陌生人对这个产品的第一印象。 */
(function initTopMore() {
  const btn = $('topMoreBtn');
  const panel = $('topMorePanel');
  if (!btn || !panel) return;

  const close = () => {
    if (panel.hidden) return;
    panel.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
  };
  const open = () => {
    panel.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
  };

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (panel.hidden) open();
    else close();
  });

  // 抽屉里点按钮（主题 / 路演）→ 执行完就收起；点链接 → 跳走，不用管
  panel.addEventListener('click', (e) => {
    const hit = e.target && e.target.closest ? e.target.closest('button') : null;
    if (hit) close();
  });

  document.addEventListener('click', (e) => {
    if (panel.hidden) return;
    if (panel.contains(e.target) || btn.contains(e.target)) return;
    close();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
})();

/* 首屏课堂片段里的人物：跟课堂用同一份立绘。
 * HTML 里刻意不写立绘的相对路径 —— build-standalone.js 会断言产物中
 * 不含该前缀（离线版必须走 data URI），写死路径会直接把构建卡住。
 * 所以路径只有一个来源：jtqStudentArt.srcOf()。 */
(function hydrateArtImages() {
  const nodes = document.querySelectorAll('[data-art-key]');
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const key = node.getAttribute('data-art-key');
    if (!hasClassKey(key)) continue;
    const src = (window.jtqStudentArt && window.jtqStudentArt.srcOf)
      ? window.jtqStudentArt.srcOf(key, node.getAttribute('data-art-state') || 'default')
      : '';
    if (!src) continue;
    // 已经有占位 img 的（首屏片段）直接填 src，不再插第二个；
    // 没有的（其他位置）补一个。
    const slot = node.querySelector('img[data-fill]');
    const img = slot || document.createElement('img');
    img.alt = '';
    img.decoding = 'async';
    img.onerror = function () { this.remove(); };
    img.src = src;
    if (!slot) node.insertBefore(img, node.firstChild);
  }
})();

(function initTheme() {
  let saved = 'light';
  try { saved = localStorage.getItem(THEME_KEY) || ''; } catch (e) { /* ignore */ }
  if (!saved) {
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    saved = prefersDark ? 'dark' : 'light';
  }
  applyTheme(saved);
})();

charHint.textContent = '0 字';
switchTab('report');
loadHealth();

/* ---------- 固定演示页面提示 ---------- */
(function initDemoPageNotice() {
  if (!JTQ_DEMO_PAGE) return;

  document.title = '固定示例演示 · 讲台求生';

  const main = document.querySelector('main.layout');
  if (!main || $('jtqDemoPageNotice')) return;

  const notice = document.createElement('aside');
  notice.id = 'jtqDemoPageNotice';
  notice.setAttribute('aria-label', '固定演示说明');

  const heading = document.createElement('strong');
  heading.textContent = '固定示例演示 · 不代表你的试讲表现';

  const description = document.createElement('p');
  description.textContent =
    '本页分析与问答使用内置示例，不计入主复盘档案、排行榜和成就。' +
    '此模式未隔离账户、树洞等其他云功能，请勿在本页提交个人内容。';

  const normalUrl = new URL(window.location.href);
  normalUrl.searchParams.delete('jtq-demo');

  const exitLink = document.createElement('a');
  exitLink.className = 'link';
  exitLink.href = normalUrl.href;
  exitLink.textContent = '退出示例，进入正常训练 →';

  notice.append(heading, description, exitLink);
  main.before(notice);

  // 只在脚本初始化完成后开始播放。
  // 不自动开启麦克风或朗读。
  setTimeout(() => {
    autoDemo();
  }, 0);
})();

/* ==================================================================
   增量 E / A / B
   ------------------------------------------------------------------
   E 教学任务与学情配置（details#teachingConfig）
   A 学情驱动 AI 学生（pane-chat 内的学情提示 + profile 透传）
   B 3 分钟专项技能练习（pane-drill）

   契约真源：docs/site-spec-eab.md（§1.2 DOM id 表 / §2 数据结构 /
   §3 接口契约 / §5.5 演示数据 key）。本段只消费契约，不自造字段。
   ================================================================== */

/* ---------- Profile 镜像常量（规格 §2.2 / §2.3 / §2.4） ---------- */

const JTQ_PROFILE_DEFAULTS = {
  version: 1,
  task: {
    topic: '',
    lessonType: 'new',
    objectives: [],
    keyPoints: [],
    difficulties: [],
    assessment: 'formative',
    durationMin: 0,
  },
  class: {
    level: 'good',
    priorKnowledge: [],
    commonErrors: [],
    size: 45,
    activity: 'mid',
  },
  updatedAt: 0,
};

// 枚举中文映射（规格 §2.4）
const JTQ_PROFILE_LABELS = {
  lessonType: {
    new: '新授课',
    review: '复习课',
    exercise: '习题课',
    lab: '实验课',
    assessment: '讲评课',
    public: '公开课',
  },
  assessment: {
    formative: '形成性评价',
    summative: '终结性评价',
    both: '两者兼有',
    none: '不评价',
  },
  level: {
    weak: '基础薄弱',
    basic: '中等偏弱',
    good: '中等',
    excellent: '优秀',
  },
  activity: {
    low: '偏低',
    mid: '一般',
    high: '较高',
  },
};

// 前端仅用于展示的难度映射（规格 §2.5 的 level→difficulty 列）。
// 真正生效的难度以后端返回的 difficulty 字段为准。
const JTQ_LEVEL_DIFFICULTY = {
  weak: 'basic',
  basic: 'basic',
  good: 'core',
  excellent: 'advanced',
};

if (typeof window !== 'undefined') {
  window.JTQ_PROFILE_DEFAULTS = JTQ_PROFILE_DEFAULTS;
  window.JTQ_PROFILE_LABELS = JTQ_PROFILE_LABELS;
}

const PROFILE_KEY = 'jtq_profile';          // 规格 §3.1 / §4
const DRILL_RECORDS_KEY = 'jtq_drill_records'; // 规格 §4

/* ---------- Profile 归一化（与后端 normalizeProfile 同构） ---------- */

function cfgClipList(value) {
  let arr = Array.isArray(value) ? value : [];
  if (typeof value === 'string') {
    arr = value.split('\n');
  }
  return arr
    .map((x) => String(x == null ? '' : x).trim())
    .filter((x) => x.length > 0)
    .slice(0, 5)
    .map((x) => x.slice(0, 60));
}

function cfgClipInt(value, min, max, fallback) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function cfgEnum(value, map, fallback) {
  const key = String(value == null ? '' : value);
  return Object.prototype.hasOwnProperty.call(map, key) ? key : fallback;
}

// 输入任意形状的对象，输出符合规格 §2.1–2.3 的 Profile。
function cfgNormalizeProfile(input) {
  const src = input && typeof input === 'object' ? input : {};
  const task = src.task && typeof src.task === 'object' ? src.task : {};
  const cls = src.class && typeof src.class === 'object' ? src.class : {};
  const d = JTQ_PROFILE_DEFAULTS;

  return {
    version: 1,
    task: {
      topic: String(task.topic == null ? '' : task.topic).trim().slice(0, 40),
      lessonType: cfgEnum(task.lessonType, JTQ_PROFILE_LABELS.lessonType, d.task.lessonType),
      objectives: cfgClipList(task.objectives),
      keyPoints: cfgClipList(task.keyPoints),
      difficulties: cfgClipList(task.difficulties),
      assessment: cfgEnum(task.assessment, JTQ_PROFILE_LABELS.assessment, d.task.assessment),
      durationMin: cfgClipInt(task.durationMin, 0, 180, d.task.durationMin),
    },
    class: {
      level: cfgEnum(cls.level, JTQ_PROFILE_LABELS.level, d.class.level),
      priorKnowledge: cfgClipList(cls.priorKnowledge),
      commonErrors: cfgClipList(cls.commonErrors),
      size: cfgClipInt(cls.size, 1, 80, d.class.size),
      activity: cfgEnum(cls.activity, JTQ_PROFILE_LABELS.activity, d.class.activity),
    },
    updatedAt: Number(src.updatedAt) > 0 ? Number(src.updatedAt) : 0,
  };
}

/* ---------- Profile 存储（只存本机；演示模式不落盘） ---------- */

function cfgReadProfile() {
  const raw = lsObj(PROFILE_KEY);
  if (!raw || !Object.keys(raw).length) return null;
  return cfgNormalizeProfile(raw);
}

// 返回当前生效的 Profile：已保存则返回归一化后的对象，否则 null（走默认班级画像）。
// 演示模式只用内存对象，绝不读写 localStorage（规格 §5.5 硬约束）。
function cfgActiveProfile() {
  if (JTQ_DEMO_PAGE) return cfgMemoryProfile;
  return cfgReadProfile();
}

function cfgSaveProfile(profile) {
  const normalized = cfgNormalizeProfile(profile);
  normalized.updatedAt = Date.now();

  if (JTQ_DEMO_PAGE) {
    // 演示模式只更新内存对象，不写 localStorage（规格 §5.5 硬约束）。
    cfgMemoryProfile = normalized;
    return normalized;
  }

  lsSave(PROFILE_KEY, normalized);
  cfgMemoryProfile = normalized;
  return normalized;
}

function cfgClearProfile() {
  cfgMemoryProfile = null;
  // 演示模式不碰本机存储（硬护栏：演示模式不得写入/清理用户真实档案）。
  if (JTQ_DEMO_PAGE) return;
  try {
    localStorage.removeItem(PROFILE_KEY);
  } catch (e) { /* 隐私模式 */ }
}

let cfgMemoryProfile = null;

/* ---------- Profile 表单读写 ---------- */

const CFG_LIST_IDS = {
  objectives: 'cfgObjectives',
  keyPoints: 'cfgKeyPoints',
  difficulties: 'cfgDifficulties',
  priorKnowledge: 'cfgPriorKnowledge',
  commonErrors: 'cfgCommonErrors',
};

function cfgTextToList(text) {
  return String(text == null ? '' : text)
    .split('\n')
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

function cfgFormToProfile() {
  const val = (id) => {
    const el = $(id);
    return el ? el.value : '';
  };

  const profile = {
    version: 1,
    task: {
      topic: val('cfgTopic').trim(),
      lessonType: val('cfgLessonType'),
      objectives: cfgTextToList(val('cfgObjectives')),
      keyPoints: cfgTextToList(val('cfgKeyPoints')),
      difficulties: cfgTextToList(val('cfgDifficulties')),
      assessment: val('cfgAssessment'),
      durationMin: Number(val('cfgDurationMin')) || 0,
    },
    class: {
      level: val('cfgClassLevel'),
      priorKnowledge: cfgTextToList(val('cfgPriorKnowledge')),
      commonErrors: cfgTextToList(val('cfgCommonErrors')),
      size: Number(val('cfgClassSize')) || JTQ_PROFILE_DEFAULTS.class.size,
      activity: val('cfgActivity'),
    },
    updatedAt: Date.now(),
  };

  return cfgNormalizeProfile(profile);
}

function cfgProfileToForm(profile) {
  const p = cfgNormalizeProfile(profile);
  const setVal = (id, value) => {
    const el = $(id);
    if (el) el.value = value;
  };

  setVal('cfgTopic', p.task.topic);
  setVal('cfgLessonType', p.task.lessonType);
  setVal('cfgObjectives', p.task.objectives.join('\n'));
  setVal('cfgKeyPoints', p.task.keyPoints.join('\n'));
  setVal('cfgDifficulties', p.task.difficulties.join('\n'));
  setVal('cfgAssessment', p.task.assessment);
  setVal('cfgDurationMin', String(p.task.durationMin));

  setVal('cfgClassLevel', p.class.level);
  setVal('cfgPriorKnowledge', p.class.priorKnowledge.join('\n'));
  setVal('cfgCommonErrors', p.class.commonErrors.join('\n'));
  setVal('cfgClassSize', String(p.class.size));
  setVal('cfgActivity', p.class.activity);
}

function cfgResetForm() {
  cfgProfileToForm(JTQ_PROFILE_DEFAULTS);
}

/* ---------- Profile 摘要 chip ---------- */

function cfgTopicLabel(profile) {
  const topic = (profile && profile.task.topic) || '';
  if (topic) return topic;
  const fallback = subjectInput ? subjectInput.value.trim() : '';
  return fallback || '未填课题';
}

function cfgRenderSummaryChip() {
  const chip = $('cfgSummaryChip');
  if (!chip) return;

  const profile = cfgActiveProfile();

  if (!profile) {
    chip.hidden = false;
    chip.textContent = '未配置学情（使用默认班级画像）';
    chip.className = 'cfg-chip off';
    return;
  }

  const lesson = JTQ_PROFILE_LABELS.lessonType[profile.task.lessonType] || profile.task.lessonType;
  const level = JTQ_PROFILE_LABELS.level[profile.class.level] || profile.class.level;
  chip.hidden = false;
  chip.className = 'cfg-chip on';
  chip.textContent = '已配置：' + cfgTopicLabel(profile) + '、' + lesson + '、' + level;
}

/* ---------- E：表单事件 ---------- */

function cfgSetStatus(msg, isError) {
  const tip = $('cfgStatusTip');
  if (!tip) return;
  tip.textContent = msg || '';
  tip.className = isError ? 'tip err' : 'tip';
}

function cfgApplyProfile(profile) {
  cfgProfileToForm(profile);
  cfgRenderSummaryChip();
  cfgRenderProfileUI();
}

function cfgSave() {
  const profile = cfgFormToProfile();
  cfgSaveProfile(profile);
  cfgProfileToForm(profile);
  cfgRenderSummaryChip();
  cfgRenderProfileUI();

  if (JTQ_DEMO_PAGE) {
    cfgSetStatus('演示模式不保存配置到本机。');
    return;
  }
  cfgSetStatus('已保存配置，本机立即生效。');
}

// 即时保存（规格 §6 步骤②）：字段变更即写入，不设「提交」必经关。
function cfgAutoSave() {
  if (JTQ_DEMO_PAGE) {
    cfgMemoryProfile = cfgFormToProfile();
    cfgRenderSummaryChip();
    cfgRenderProfileUI();
    cfgSetStatus('演示模式不保存配置到本机。');
    return;
  }
  cfgSaveProfile(cfgFormToProfile());
  cfgRenderSummaryChip();
  cfgRenderProfileUI();
}

function cfgReset() {
  cfgClearProfile();
  cfgResetForm();
  cfgRenderSummaryChip();
  cfgRenderProfileUI();
  cfgSetStatus('已清空配置，回到未配置状态。');
}

function cfgSkip() {
  cfgClearProfile();
  cfgResetForm();
  cfgRenderSummaryChip();
  cfgRenderProfileUI();
  cfgSetStatus('已跳过此步，学情回落到默认班级画像。');
}

function cfgGotoConfig() {
  const details = $('teachingConfig');
  if (details) {
    details.open = true;
    details.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const first = $('cfgTopic');
    if (first) first.focus({ preventScroll: true });
  }
}

/* ---------- A：学情提示条 ---------- */

// 后端回报的学情结论优先于前端本地推断：
// difficulty / profile_summary / profile_effect 都是后端算出来的真实结果。
function cfgApplyBackendProfile(info) {
  if (!info) return;
  const soloNote = $('soloProfileNote');
  const classText = $('classProfileText');
  const classTag = $('classProfileTag');
  const diffLabel = { basic: '基础', core: '常规', advanced: '进阶' };
  const diff = diffLabel[info.difficulty] || info.difficulty || '';

  if (soloNote && info.profile_applied) {
    const parts = [];
    if (diff) parts.push('提问难度基线：' + diff);
    if (info.profile_summary) parts.push(info.profile_summary);
    if (parts.length) soloNote.textContent = parts.join(' · ');
  }

  if (classText && info.profile_applied) {
    const parts = [];
    if (diff) parts.push('提问难度 ' + diff);
    if (info.profile_effect) parts.push(info.profile_effect);
    if (parts.length) classText.textContent = parts.join(' · ');
  }

  if (classTag && info.profile_applied) {
    classTag.textContent = '学情已生效';
    classTag.className = 'profile-tag on';
  }
}

function cfgCurrentProfilePayload() {
  const profile = cfgActiveProfile();
  if (!profile) return null;
  return profile;
}

function cfgDifficultyLabel(profile) {
  if (!profile) return 'core';
  return JTQ_LEVEL_DIFFICULTY[profile.class.level] || 'core';
}

// 学生最可能卡住的点：优先用「常见错误」，其次用「前置知识」，都没有就退回默认表述。
function cfgStuckPoint(profile) {
  if (!profile) return '概念和前置知识';
  const errors = profile.class.commonErrors || [];
  if (errors.length) return errors[0];
  const prior = profile.class.priorKnowledge || [];
  if (prior.length) return prior[0];
  return '概念和前置知识';
}

function cfgRenderProfileUI() {
  const profile = cfgActiveProfile();
  const bar = $('profileBar');
  const barText = $('profileBarText');
  const editBtn = $('profileBarEditBtn');
  const soloNote = $('soloProfileNote');
  const classNote = $('classProfileNote');
  const classTag = $('classProfileTag');
  const classText = $('classProfileText');

  if (bar) bar.classList.toggle('on', Boolean(profile));

  if (barText) {
    if (profile) {
      const level = JTQ_PROFILE_LABELS.level[profile.class.level] || profile.class.level;
      barText.textContent =
        '学情已生效：学生按「' + level + '」提问，卡在' + cfgStuckPoint(profile) + '上。';
    } else {
      barText.textContent =
        '未配置学情，使用默认班级画像（中等水平、活跃度一般）。';
    }
  }

  if (editBtn) {
    editBtn.hidden = !profile;
  }

  if (soloNote) {
    if (profile) {
      soloNote.textContent =
        '提问难度基线：' + cfgDifficultyLabel(profile) +
        '，学生更可能卡在：' + cfgStuckPoint(profile);
    } else {
      soloNote.textContent =
        '你还没填学情，AI 学生先按默认班级画像提问。想更贴近你的班，可在上方补一条。';
    }
  }

  if (classTag) {
    classTag.textContent = profile ? '学情已生效' : '默认学情';
    classTag.className = 'profile-tag' + (profile ? ' on' : '');
  }

  if (classText) {
    if (profile) {
      const level = JTQ_PROFILE_LABELS.level[profile.class.level] || profile.class.level;
      classText.textContent =
        '本班按「' + level + '」画像提问：' + cfgStuckPoint(profile) +
        '，提问难度基线 ' + cfgDifficultyLabel(profile) + '。';
    } else {
      classText.textContent =
        '未配置学情，使用默认班级画像（中等水平、活跃度一般）。';
    }
  }

  const demoNote = $('profileDemoNote');
  if (demoNote) demoNote.hidden = !JTQ_DEMO_PAGE;
}

/* ---------- B：3 分钟专项练习 ---------- */

const DRILL_DURATION_SEC = 180;

const DRILL_FALLBACK_SKILLS = {
  skills: [
    {
      key: 'question_wait',
      label: '提问与等待',
      focus: '把封闭式提问换成真提问，并真的留白',
      brief: '问完给学生的空档够不够长。',
      checklist: ['至少 1 个开放性提问', '提问后真的留白', '不出现自问自答'],
      starter: '同学们先自己想一想，我数三秒，等你们开口。',
    },
    {
      key: 'pace_filler',
      label: '语速与口头禅',
      focus: '控速、去掉口头禅',
      brief: '语速稳不稳，「然后」「嗯」多不多。',
      checklist: ['语速落在可跟读区间', '口头禅明显减少', '用停顿替代填充词'],
      starter: '这一段我讲慢一点，你们边听边记。',
    },
    {
      key: 'board_structure',
      label: '板书结构',
      focus: '让板书承担结构（课题→推导→结论）',
      brief: '主线、层次、落点是否清楚。',
      checklist: ['板书有主线', '推导分步编号', '结论单独落点'],
      starter: '这一条我写在黑板上，我们一起看。',
    },
    {
      key: 'intro_design',
      label: '导入设计',
      focus: '用情境/冲突/复习衔接开场，再自然进入新课（按语义切分导入段）',
      brief: '开头能不能把学生拽进来。',
      checklist: ['开头有具体情境', '先问后给概念', '衔接上节课'],
      starter: '先看一个例子，再问你们一个问题。',
    },
    {
      key: 'transition',
      label: '过渡衔接',
      focus: '环节之间有过渡句，小节收口',
      brief: '环节之间接得上还是断的。',
      checklist: ['环节之间有承接句', '小结收口清楚', '收尾给出下一步'],
      starter: '刚才那一步我们看完了，接下来看下一步。',
    },
  ],
  default_skill: 'question_wait',
  duration_sec: DRILL_DURATION_SEC,
  engine: 'rule',
};

let drillSkills = null;      // 当前技能清单
let drillCurrent = null;     // 当前选中的技能
let drillTimerId = null;
let drillStartedAt = 0;      // Date.now() 起点（规格 §6 步骤⑥：用差值，不数 tick）
let drillElapsed = 0;        // 已用秒数
let drillSettled = false;    // 是否已结算
let drillPickedManually = false; // 用户是否手动选过技能
let drillSubmitted = false;     // 是否已经提交过一次（用于「再练一次」）
let drillStarted = false;    // 是否已进入练习（进入后收起空态入口）

async function apiGet(url) {
  if (JTQ_DEMO_PAGE) {
    const example = offlineFallback(url, {});
    if (example == null) throw new Error('该功能尚未提供固定演示数据：' + url);
    const cloned = JSON.parse(JSON.stringify(example));
    cloned.engine = 'offline-demo';
    return cloned;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });

    let json;
    try {
      json = await response.json();
    } catch (error) {
      throw new Error('服务端返回了非 JSON 内容，请检查后端或代理配置。');
    }

    if (!response.ok) {
      throw new Error(
        json && typeof json.error === 'string'
          ? json.error
          : '请求失败，HTTP ' + response.status
      );
    }

    if (!json || json.ok !== true || json.data == null) {
      throw new Error('服务端响应格式不正确，请检查接口返回内容。');
    }

    return json.data;
  } finally {
    clearTimeout(timer);
  }
}

function drillSetTip(msg, isError) {
  const tip = document.querySelector('#drillTaskBox .drill-tip');
  if (!tip) return;
  tip.textContent = msg || '';
  tip.className = isError ? 'tip err drill-tip' : 'tip drill-tip';
}

function drillFormatClock(sec) {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return (m < 10 ? '0' : '') + m + ':' + (r < 10 ? '0' : '') + r;
}

// 文案 §3.3：剩余 2 分 14 秒
function drillFormatRemaining(sec) {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return '剩余 ' + m + ' 分 ' + r + ' 秒';
}

function drillFormatDuration(sec) {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return '本次用时 ' + m + ' 分 ' + r + ' 秒';
}

function drillRenderTimer() {
  const remain = Math.max(0, DRILL_DURATION_SEC - drillElapsed);
  const clock = $('drillTimer');
  const text = document.querySelector('#drillTaskBox .drill-timer-text');

  // 规格 §1.2：drillTimer 显示 mm:ss，归零后显示「时间到」并允许提交。
  if (clock) clock.textContent = remain > 0 ? drillFormatClock(remain) : '时间到';
  // 文案 §3.3：计时中提示「剩余 2 分 14 秒」。
  if (text) text.textContent = remain > 0 ? drillFormatRemaining(remain) : '时间到';
}

function drillTick() {
  if (!drillStartedAt) return;
  drillElapsed = Math.floor((Date.now() - drillStartedAt) / 1000);

  if (drillElapsed >= DRILL_DURATION_SEC) {
    drillElapsed = DRILL_DURATION_SEC;
    drillRenderTimer();
    drillStopTimer();
    // 到时未点提交也自动结算（文案 §4）
    drillSettle(true);
    return;
  }
  drillRenderTimer();
}

function drillStartTimer() {
  if (!drillCurrent) return;
  drillStarted = true;
  drillRenderEntry();
  drillStartedAt = Date.now();
  drillElapsed = 0;
  drillSettled = false;
  drillRenderTimer();

  if (drillTimerId) clearInterval(drillTimerId);
  drillTimerId = setInterval(drillTick, 500);

  const startBtn = $('drillTimerStartBtn');
  const stopBtn = $('drillTimerStopBtn');
  if (startBtn) startBtn.disabled = true;
  if (stopBtn) stopBtn.disabled = false;
}

function drillStopTimer() {
  if (drillTimerId) {
    clearInterval(drillTimerId);
    drillTimerId = null;
  }
  const startBtn = $('drillTimerStartBtn');
  const stopBtn = $('drillTimerStopBtn');
  if (startBtn) startBtn.disabled = false;
  if (stopBtn) stopBtn.disabled = true;
}

function drillSelectSkill(skill, manual) {
  drillCurrent = skill;
  if (manual) drillPickedManually = true;
  drillSettled = false;
  drillElapsed = 0;
  drillStartedAt = 0;
  drillStopTimer();

  const taskBox = $('drillTaskBox');
  const empty = $('drillEmpty');
  const title = taskBox ? taskBox.querySelector('.drill-task-title') : null;
  const brief = taskBox ? taskBox.querySelector('.drill-task-brief') : null;
  const checklist = taskBox ? taskBox.querySelector('.drill-checklist') : null;
  const starter = taskBox ? taskBox.querySelector('.drill-starter') : null;

  if (taskBox) taskBox.hidden = false;
  if (empty) empty.hidden = true;
  if (title) title.textContent = skill.label;
  if (brief) brief.textContent = skill.brief || skill.focus || '';
  if (checklist) {
    checklist.innerHTML = (skill.checklist || [])
      .map((x) => '<li>' + escapeHtml(x) + '</li>')
      .join('');
  }
  if (starter) starter.textContent = skill.starter ? '起手句：' + skill.starter : '';

  drillRenderTimer();
  drillSetTip('');

  const startBtn = $('drillTimerStartBtn');
  if (startBtn) {
    startBtn.textContent = '开始练习';
    startBtn.disabled = false;
  }

  const cards = document.querySelectorAll('#drillSkillCards .drill-skill-card');
  cards.forEach((c) => {
    const on = c.getAttribute('data-skill') === skill.key;
    c.classList.toggle('selected', on);
    c.setAttribute('aria-pressed', String(on));
  });

  drillRenderEntry();
}

// 入口区（文案 §3.1）：主按钮「开始练习」，次按钮「选一项再开始」无技能选中时置灰。
function drillRenderEntry() {
  const empty = $('drillEmpty');
  const startBtn = document.querySelector('.drill-entry-start');
  const pickBtn = document.querySelector('.drill-pick-btn');

  if (empty) empty.hidden = drillStarted;
  if (startBtn) startBtn.disabled = !drillCurrent;
  if (pickBtn) pickBtn.disabled = !drillPickedManually;
}

function drillRenderSkills() {
  const box = $('drillSkillCards');
  if (!box) return;

  const list = (drillSkills && drillSkills.skills) || DRILL_FALLBACK_SKILLS.skills;

  box.innerHTML = list
    .map((s) => {
      const points = (s.checklist || [])
        .map((x) => '<li>' + escapeHtml(x) + '</li>')
        .join('');
      return '<button class="drill-skill-card" type="button" data-skill="' + escapeHtml(s.key) + '" aria-pressed="false">' +
        '<b>' + escapeHtml(s.label) + '</b>' +
        '<span class="drill-skill-focus">' + escapeHtml(s.focus || '') + '</span>' +
        '<span class="drill-skill-brief">' + escapeHtml(s.brief || '') + '</span>' +
        (points ? '<ul class="drill-skill-points">' + points + '</ul>' : '') +
        '</button>';
    })
    .join('');

  box.querySelectorAll('.drill-skill-card').forEach((card) => {
    card.addEventListener('click', () => {
      const key = card.getAttribute('data-skill');
      const found = list.find((s) => s.key === key);
      if (found) drillSelectSkill(found, true);
    });
  });
}

async function drillLoadSkills() {
  try {
    const data = await apiGet('/api/drill/skills');
    if (data && Array.isArray(data.skills) && data.skills.length) {
      drillSkills = data;
    }
  } catch (e) {
    // 取技能清单失败时用内置五项兜底（规格 §2.7）。
    drillSkills = DRILL_FALLBACK_SKILLS;
    drillSetTip('技能清单暂时取不到，先用内置的五项练习。');
  }

  drillRenderSkills();

  const defaultKey =
    (drillSkills && drillSkills.default_skill) || DRILL_FALLBACK_SKILLS.default_skill;
  const list = (drillSkills && drillSkills.skills) || DRILL_FALLBACK_SKILLS.skills;
  const initial = list.find((s) => s.key === defaultKey) || list[0];
  if (initial) drillSelectSkill(initial);
}

/* ---------- B：结果渲染 ---------- */

function drillEngineTagText(engine, fallbackReason) {
  if (engine === 'llm') return 'LLM 实时分析';
  if (engine === 'offline-demo') return '演示数据';
  // 降级原因与主报告用同一套措辞：说清楚是规则判定，再说明为什么降级。
  return '本地规则判定' + degradedSuffix(fallbackReason);
}

function drillRenderResult(data) {
  const box = $('drillResult');
  if (!box) return;

  const score = Number(data.score) || 0;
  const label = data.skill_label || (drillCurrent && drillCurrent.label) || '';

  const head = box.querySelector('.drill-result-head');
  if (head) head.textContent = label + ' · ' + score + ' 分';
  const titleEl = box.querySelector('.drill-result-title');
  if (titleEl) titleEl.textContent = '本项评分';

  const scoreEl = $('drillScore');
  if (scoreEl) scoreEl.textContent = String(score);

  const gradeEl = $('drillGrade');
  if (gradeEl) gradeEl.textContent = data.grade || '';

  const tagEl = $('drillEngineTag');
  if (tagEl) {
    const engine = data.engine || 'rule';
    tagEl.textContent = drillEngineTagText(engine, data.fallback_reason);
    tagEl.className =
      'engine-tag ' + sourceTagClassName(engine, data.fallback_reason);
  }

  const sumEl = $('drillSummary');
  if (sumEl) sumEl.textContent = data.summary || '';

  const durEl = box.querySelector('.drill-duration');
  if (durEl) {
    durEl.textContent = drillFormatDuration(
      data.duration_sec != null ? data.duration_sec : drillElapsed || DRILL_DURATION_SEC
    );
  }

  const dimsEl = $('drillDims');
  if (dimsEl) {
    const dims = Array.isArray(data.dimensions) ? data.dimensions : [];
    dimsEl.innerHTML = dims.length
      ? dims
          .map(
            (d) =>
              '<div class="drill-dim">' +
              '<div class="drill-dim-head"><b>' + escapeHtml(d.label || '') + '</b>' +
              '<span>' + escapeHtml(String(d.score != null ? d.score : 0)) + ' 分</span></div>' +
              (d.evidence ? '<p class="drill-dim-ev">依据：' + escapeHtml(d.evidence) + '</p>' : '') +
              (d.fix ? '<p class="drill-dim-fix">改进动作：' + escapeHtml(d.fix) + '</p>' : '') +
              '</div>'
          )
          .join('')
      : '<p class="tip">这次没有产出评分，重新练一次即可。</p>';
  }

  const evEl = $('drillEvidence');
  if (evEl) {
    const list = Array.isArray(data.evidence) ? data.evidence : [];
    evEl.innerHTML = list.length
      ? list
          .map(
            (e) =>
              '<li><q>' + escapeHtml(e.quote || '') + '</q>' +
              (e.reason ? '<span>' + escapeHtml(e.reason) + '</span>' : '') +
              (e.fix ? '<span>' + escapeHtml(e.fix) + '</span>' : '') +
              '</li>'
          )
          .join('')
      : '<li class="tip">本次未取到可定位的原句。</li>';
  }

  const sugEl = $('drillSuggestions');
  if (sugEl) {
    const list = Array.isArray(data.suggestions) ? data.suggestions : [];
    sugEl.innerHTML = list.length
      ? list
          .map(
            (s) =>
              '<li><b>' + escapeHtml(s.title || '') + '</b>' +
              '<span>' + escapeHtml(s.detail || '') + '</span></li>'
          )
          .join('')
      : '<li class="tip">这次没有产出评分，重新练一次即可。</li>';
  }

  const nextTip = box.querySelector('.drill-next');
  if (nextTip) {
    const next = data.next_drill || {};
    nextTip.textContent = next.reason
      ? '把这一项练到 85 分以上，再回到整堂试讲。（下一项建议：' + next.reason + '）'
      : '把这一项练到 85 分以上，再回到整堂试讲。';
  }

  box.hidden = false;
}

/* ---------- B：历史记录（只写本机） ---------- */

function drillReadRecords() {
  return lsArr(DRILL_RECORDS_KEY);
}

function drillWriteRecord(record) {
  if (JTQ_DEMO_PAGE) return; // 演示模式不写入本机记录
  const list = drillReadRecords();
  list.push(record);
  lsSave(DRILL_RECORDS_KEY, list.slice(-50));
}

function drillRenderHistory() {
  const countEl = $('drillHistoryCount');
  const listEl = $('drillHistoryList');
  const list = drillReadRecords();

  if (countEl) countEl.textContent = list.length + ' 次';

  if (!listEl) return;

  if (!list.length) {
    const demo = JTQ_DEMO_PAGE && window.JTQDemo && window.JTQDemo.DEMO_DRILL_RESULT;
    if (demo) {
      listEl.innerHTML =
        '<div class="drill-history-item demo"><b>演示数据</b>' +
        '<span>' + escapeHtml(demo.skill_label || '') + ' · ' + escapeHtml(String(demo.score)) + ' 分</span></div>';
      return;
    }
    listEl.innerHTML = '<p class="tip">还没有练习记录。选一项技能，练 3 分钟就有第一条。</p>';
    return;
  }

  const bySkill = {};
  list.forEach((r) => {
    const key = r.skill || 'unknown';
    if (!bySkill[key]) {
      bySkill[key] = { label: r.skillLabel || key, count: 0, best: 0 };
    }
    bySkill[key].count += 1;
    bySkill[key].best = Math.max(bySkill[key].best, Number(r.score) || 0);
  });

  listEl.innerHTML = Object.keys(bySkill)
    .map((key) => {
      const g = bySkill[key];
      return '<div class="drill-history-item"><b>' + escapeHtml(g.label) + '</b>' +
        '<span>练过 ' + g.count + ' 次，最好 ' + g.best + ' 分</span></div>';
    })
    .join('');
}

/* ---------- B：提交评分 ---------- */

async function drillSubmit(settledByTimeout) {
  if (!drillCurrent) {
    drillSetTip('选一项技能，开始 3 分钟练习', true);
    return;
  }

  const transcriptEl = $('drillTranscript');
  const transcript = transcriptEl ? transcriptEl.value.trim() : '';

  if (transcript.replace(/\s/g, '').length < 30) {
    drillSetTip('练习内容太短（至少 30 字）：这段内容偏短，评分可能不稳。补几句再提交，结果会更准。', true);
    return;
  }

  const submitBtn = $('drillSubmitBtn');
  const restore = busy(submitBtn, '正在评分…', '提交本次练习');

  try {
    const durationSec = Math.min(600, Math.max(1, drillElapsed || DRILL_DURATION_SEC));
    const data = await post('/api/drill', {
      skill: drillCurrent.key,
      transcript: transcript,
      durationSec: durationSec,
      task: drillCurrent.brief || '',
      profile: cfgCurrentProfilePayload(),
      subject: lastSubject || (subjectInput ? subjectInput.value.trim() : ''),
      subjectKey: subjectKeyInput ? subjectKeyInput.value : 'auto',
      grade: gradeInput ? gradeInput.value.trim() : '',
    });

    if (!data || data.score == null) {
      drillSetTip('这次没有产出评分，重新练一次即可。', true);
      return;
    }

    drillRenderResult(data);

    const profile = cfgActiveProfile();
    drillWriteRecord({
      id: 'drill_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      skill: data.skill || drillCurrent.key,
      skillLabel: data.skill_label || drillCurrent.label,
      score: Number(data.score) || 0,
      grade: data.grade || '',
      createdAt: Date.now(),
      durationSec: durationSec,
      transcript: transcript.slice(0, 5000),
      dimensions: Array.isArray(data.dimensions) ? data.dimensions : [],
      suggestions: Array.isArray(data.suggestions) ? data.suggestions : [],
      engine: data.engine || 'rule',
      profileSnapshot: profile
        ? { level: profile.class.level, lessonType: profile.task.lessonType }
        : { level: 'good', lessonType: 'new' },
    });

    drillRenderHistory();

    if (settledByTimeout) {
      drillSetTip('时间到了，这次练习已按当前内容结算。可以再练一次。');
    } else if (data.engine === 'rule') {
      drillSetTip('当前是离线规则模式，评分由本地规则给出，参考范围比在线分析窄。');
    } else {
      drillSetTip('');
    }

    drillSettled = true;
    drillSubmitted = true;
  } catch (e) {
    drillSetTip(e.message || '提交失败，请稍后重试。', true);
  } finally {
    restore();
    // busy() 的 restore() 会把按钮文案恢复成传入的原文，
    // 所以提交成功后的「再练一次」必须在 restore() 之后再设一次。
    const submitLabel = $('drillSubmitBtn');
    if (submitLabel) {
      submitLabel.textContent = drillSubmitted ? '再练一次' : '提交本次练习';
    }
  }
}

// 计时归零后的自动结算（规格 §8：归零后仍可提交）
function drillSettle(autoTimeout) {
  if (drillSettled) return;
  drillSettled = true;
  drillSubmit(autoTimeout);
}

/* ---------- B：事件绑定 ---------- */

function drillBind() {
  const entryStart = document.querySelector('.drill-entry-start');
  const entryPick = document.querySelector('.drill-pick-btn');

  if (entryStart) {
    entryStart.addEventListener('click', () => {
      if (!drillCurrent) {
        drillSetTip('选一项再开始', true);
        return;
      }
      drillStarted = true;
      drillRenderEntry();
      drillStartTimer();
      const transcript = $('drillTranscript');
      if (transcript) transcript.focus({ preventScroll: true });
    });
  }

  if (entryPick) {
    entryPick.addEventListener('click', () => {
      const cards = document.querySelectorAll('#drillSkillCards .drill-skill-card');
      if (!cards.length) return;
      const list = (drillSkills && drillSkills.skills) || DRILL_FALLBACK_SKILLS.skills;
      const currentKey = drillCurrent ? drillCurrent.key : '';
      const others = list.filter((s) => s.key !== currentKey);
      const pool = others.length ? others : list;
      const pick = pool[Math.floor(Math.random() * pool.length)];
      drillSelectSkill(pick, true);
      drillSetTip('这次练「' + pick.label + '」。');
    });
  }

  const startBtn = $('drillTimerStartBtn');
  const stopBtn = $('drillTimerStopBtn');
  const submitBtn = $('drillSubmitBtn');
  const nextBtn = $('drillNextBtn');
  const clearBtn = $('drillClearHistoryBtn');
  const transcript = $('drillTranscript');
  const charHint = $('drillCharHint');

  if (startBtn) {
    startBtn.addEventListener('click', () => {
      if (!drillCurrent) {
        drillSetTip('选一项再开始', true);
        return;
      }
      drillStartTimer();
    });
  }

  if (stopBtn) {
    stopBtn.addEventListener('click', () => {
      if (!drillStartedAt) return;
      drillElapsed = Math.max(1, Math.min(600, Math.floor((Date.now() - drillStartedAt) / 1000)));
      drillStopTimer();
      drillSettle(false);
    });
  }

  if (submitBtn) {
    submitBtn.addEventListener('click', () => {
      if (drillSubmitted) {
        // 「再练一次」：清空结果，重置计时，允许再练同一项。
        const resultBox = $('drillResult');
        if (resultBox) resultBox.hidden = true;
        const transcriptEl = $('drillTranscript');
        if (transcriptEl) transcriptEl.value = '';
        if (charHint) charHint.textContent = '已输入 0 字';
        drillElapsed = 0;
        drillStartedAt = 0;
        drillSettled = false;
        drillSubmitted = false;
        drillRenderTimer();
        drillSetTip('');
        submitBtn.textContent = '提交本次练习';
        return;
      }
      drillSubmit(false);
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      const list = (drillSkills && drillSkills.skills) || DRILL_FALLBACK_SKILLS.skills;
      if (!list.length) return;
      const currentKey = drillCurrent ? drillCurrent.key : '';
      const others = list.filter((s) => s.key !== currentKey);
      const pool = others.length ? others : list;
      const pick = pool[Math.floor(Math.random() * pool.length)];
      drillSelectSkill(pick, true);
      drillSubmitted = false;
      const resultBox = $('drillResult');
      if (resultBox) resultBox.hidden = true;
      const submitEl = $('drillSubmitBtn');
      if (submitEl) submitEl.textContent = '提交本次练习';
      drillSetTip('这次练「' + pick.label + '」。');
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      if (JTQ_DEMO_PAGE) {
        drillSetTip('演示模式不保存练习记录到本机。');
        return;
      }
      lsSave(DRILL_RECORDS_KEY, []);
      drillRenderHistory();
      drillSetTip('已清空本机练习记录。');
    });
  }

  if (transcript) {
    transcript.addEventListener('input', () => {
      const n = transcript.value.replace(/\s/g, '').length;
      if (charHint) charHint.textContent = '已输入 ' + n + ' 字';
    });
  }

  const demoNote = $('drillDemoNote');
  if (demoNote) demoNote.hidden = !JTQ_DEMO_PAGE;
}

/* ---------- 启动：Profile 表单 + 学情提示 + 专项练习 ---------- */

(function initProfileAndDrill() {
  // 演示模式不读取本机既有配置，避免污染用户真实档案；
  // 改用 DEMO_PROFILE 作为「只在内存里」的初值，让新功能在演示模式下有数据。
  const saved = JTQ_DEMO_PAGE
    ? cfgNormalizeProfile((window.JTQDemo && window.JTQDemo.DEMO_PROFILE) || JTQ_PROFILE_DEFAULTS)
    : cfgReadProfile();
  if (saved) {
    cfgMemoryProfile = saved;
    cfgProfileToForm(saved);
  } else {
    // 没有已存配置时，表单也显示与后端 DEFAULT_PROFILE 一致的默认值。
    cfgProfileToForm(JTQ_PROFILE_DEFAULTS);
  }

  cfgRenderSummaryChip();
  cfgRenderProfileUI();
  drillRenderHistory();

  // E 区块：字段变更即时保存（规格 §6 步骤②）
  const cfgPanel = $('cfgPanel');
  if (cfgPanel) {
    cfgPanel.addEventListener('change', () => {
      cfgAutoSave();
    });
  }

  const saveBtn = $('cfgSaveBtn');
  if (saveBtn) saveBtn.addEventListener('click', cfgSave);

  const resetBtn = $('cfgResetBtn');
  if (resetBtn) resetBtn.addEventListener('click', cfgReset);

  const skipBtn = $('cfgSkipBtn');
  if (skipBtn) skipBtn.addEventListener('click', cfgSkip);

  const editBtn = $('profileBarEditBtn');
  if (editBtn) editBtn.addEventListener('click', cfgGotoConfig);

  drillBind();
  drillLoadSkills();
})();
