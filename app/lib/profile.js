'use strict';

/**
 * 学情（Profile）权威定义
 * ------------------------------------------------------------------
 * 这里是「教学任务 + 学情」的唯一真源（前端在 public/app.js 里镜像一份同构常量）。
 * 规格来源：docs/site-spec-eab.md §2.1 / §2.2 / §2.3 / §2.4 / §2.5。
 *
 * 两条铁律：
 *   1. 一切入参都要走 normalizeProfile()：非法枚举回落默认、数值裁剪到区间、
 *      数组裁剪到 0–5 条、每条文本裁到 ≤ 60 字。永远不抛错。
 *   2. 一切派生态（难度、举手率、基线偏移）都从 deriveLevelParams() 出，
 *      禁止在别处另写一份系数。
 */

const PROFILE_LABELS = {
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

const DEFAULT_PROFILE = {
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

/* ---------------- 基础裁剪工具 ---------------- */

function clampInt(v, min, max, fallback) {
  const n = Math.round(Number(v));
  if (!isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function clampText(v, max) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
}

function clampList(v, maxItems, maxLen) {
  if (!Array.isArray(v)) return [];
  const out = [];
  for (let i = 0; i < v.length && out.length < maxItems; i++) {
    const t = clampText(v[i], maxLen);
    if (t) out.push(t);
  }
  return out;
}

function enumOr(value, dict, fallback) {
  const k = String(value == null ? '' : value);
  return Object.prototype.hasOwnProperty.call(dict, k) ? k : fallback;
}

/**
 * 归一化一份 Profile（永不抛错）
 * @param {object} input 任意来源的 profile（可能缺字段 / 字段非法）
 * @returns {object} 结构完整、取值合法的 Profile
 */
function normalizeProfile(input) {
  const src = input && typeof input === 'object' ? input : {};
  const task = src.task && typeof src.task === 'object' ? src.task : {};
  const cls = src.class && typeof src.class === 'object' ? src.class : {};

  return {
    version: 1,
    task: {
      topic: clampText(task.topic, 40),
      lessonType: enumOr(task.lessonType, PROFILE_LABELS.lessonType, DEFAULT_PROFILE.task.lessonType),
      objectives: clampList(task.objectives, 5, 60),
      keyPoints: clampList(task.keyPoints, 5, 60),
      difficulties: clampList(task.difficulties, 5, 60),
      assessment: enumOr(task.assessment, PROFILE_LABELS.assessment, DEFAULT_PROFILE.task.assessment),
      durationMin: clampInt(task.durationMin, 0, 180, DEFAULT_PROFILE.task.durationMin),
    },
    class: {
      level: enumOr(cls.level, PROFILE_LABELS.level, DEFAULT_PROFILE.class.level),
      priorKnowledge: clampList(cls.priorKnowledge, 5, 60),
      commonErrors: clampList(cls.commonErrors, 5, 60),
      size: clampInt(cls.size, 1, 80, DEFAULT_PROFILE.class.size),
      activity: enumOr(cls.activity, PROFILE_LABELS.activity, DEFAULT_PROFILE.class.activity),
    },
    updatedAt: Date.now(),
  };
}

/* ---------------- 派生参数（规格 §2.5） ---------------- */

const LEVEL_PARAMS = {
  weak: {
    difficulty: 'basic',
    askDepth: 1,
    handRaiseRate: 0.25,
    baseAttentionDelta: -8,
    baseComprehensionDelta: -12,
    respondStyle: '迟疑、需点名才答',
  },
  basic: {
    difficulty: 'basic',
    askDepth: 1,
    handRaiseRate: 0.4,
    baseAttentionDelta: -4,
    baseComprehensionDelta: -6,
    respondStyle: '犹豫、答一半',
  },
  good: {
    difficulty: 'core',
    askDepth: 2,
    handRaiseRate: 0.55,
    baseAttentionDelta: 0,
    baseComprehensionDelta: 0,
    respondStyle: '正常应答',
  },
  excellent: {
    difficulty: 'advanced',
    askDepth: 3,
    handRaiseRate: 0.7,
    baseAttentionDelta: 6,
    baseComprehensionDelta: 6,
    respondStyle: '主动追问原理/变式',
  },
};

const ACTIVITY_FACTOR = { low: 0.85, mid: 1.0, high: 1.15 };

/* 偏移量上限（规格 §7.3 R6）：防止极端学情把基线打崩或爆表 */
const ATTENTION_DELTA_LIMIT = [-12, 8];
const COMPREHENSION_DELTA_LIMIT = [-15, 8];

/* 班级规模达到该人数时，走神学生的专注基线再 −2（不低于 5，由 clampPct 兜底） */
const SIZE_EFFECT_THRESHOLD = 50;
const SIZE_EFFECT_DELTA = -2;

/* 水平档位的基线上限：学情是「整个班」的水平，
 * 因此弱档班级里三名学生的基线都受同一上限约束（锚点为该档「普通学生」的基线）。
 * 来源：规格 §8 验收「带 profile.level='weak' → 三个学生 base_state.attention 均 ≤ 44、comprehension 均 ≤ 50」。 */
const LEVEL_BASE_CAP = {
  weak: { attention: 44, comprehension: 50 },
};

/**
 * 由学情推导学生的行为参数
 * @param {string} level   weak|basic|good|excellent
 * @param {string} activity low|mid|high
 * @param {number} size    班级人数 1–80
 */
function deriveLevelParams(level, activity, size) {
  const lv = Object.prototype.hasOwnProperty.call(LEVEL_PARAMS, level) ? level : DEFAULT_PROFILE.class.level;
  const ac = Object.prototype.hasOwnProperty.call(ACTIVITY_FACTOR, activity) ? activity : DEFAULT_PROFILE.class.activity;
  const n = clampInt(size, 1, 80, DEFAULT_PROFILE.class.size);
  const base = LEVEL_PARAMS[lv];

  const attDelta = Math.max(
    ATTENTION_DELTA_LIMIT[0],
    Math.min(ATTENTION_DELTA_LIMIT[1], base.baseAttentionDelta)
  );
  const cmpDelta = Math.max(
    COMPREHENSION_DELTA_LIMIT[0],
    Math.min(COMPREHENSION_DELTA_LIMIT[1], base.baseComprehensionDelta)
  );

  const handRaiseRate = Math.min(0.9, base.handRaiseRate * ACTIVITY_FACTOR[ac]);
  const sizeEffect = n >= SIZE_EFFECT_THRESHOLD ? SIZE_EFFECT_DELTA : 0;

  return {
    level: lv,
    difficulty: base.difficulty,
    askDepth: base.askDepth,
    handRaiseRate: Number(handRaiseRate.toFixed(4)),
    baseAttentionDelta: attDelta,
    baseComprehensionDelta: cmpDelta,
    // 走神学生（小走）的额外偏移：班级越大越容易走神；下限 5 由 clampPct 保证
    driftAttentionDelta: Math.max(-12, attDelta + sizeEffect),
    respondStyle: base.respondStyle,
    activityFactor: ACTIVITY_FACTOR[ac],
    size: n,
  };
}

/* ---------------- 学情摘要（UI 用，一句话） ---------------- */

function profileSummary(profile) {
  const p = profile && profile.class ? profile : DEFAULT_PROFILE;
  const label = PROFILE_LABELS.level[p.class.level] || PROFILE_LABELS.level.good;
  const focus =
    p.class.level === 'weak' || p.class.level === 'basic'
      ? '提问聚焦基础概念'
      : p.class.level === 'excellent'
        ? '提问偏向原理与变式'
        : '提问难度适中';
  return `学情：${label} · ${focus}`;
}

function profileEffectText(profile) {
  const p = profile && profile.class ? profile : DEFAULT_PROFILE;
  const d = deriveLevelParams(p.class.level, p.class.activity, p.class.size);
  const label = PROFILE_LABELS.level[p.class.level] || PROFILE_LABELS.level.good;
  const att = d.baseAttentionDelta >= 0 ? `+${d.baseAttentionDelta}` : `${d.baseAttentionDelta}`;
  const cmp = d.baseComprehensionDelta >= 0 ? `+${d.baseComprehensionDelta}` : `${d.baseComprehensionDelta}`;
  const tail =
    p.class.level === 'excellent'
      ? '提问更可能追到原理与变式'
      : p.class.level === 'weak' || p.class.level === 'basic'
        ? '提问更可能停在基础概念'
        : '提问难度按中等班基线';
  return `学情${label}：基线专注 ${att} / 理解 ${cmp}，${tail}`.slice(0, 50);
}

/* ---------------- 规则兜底下的提问选词（规格 §5.3） ---------------- */

/* 指向基础概念的句子（weak/basic 优先） */
const BASIC_HINT = ['什么意思', '怎么算', '为什么', '没跟上', '不懂', '怎么来的', '为什么要'];
/* 追问原理/变式/边界的句子（excellent 优先） */
const DEEP_HINT = ['如果', '反过来', '还成立吗', '本质', '证明', '逆命题', '通式', '为什么'];

/**
 * 按学情给候选提问池重新排序（不改变集合，只改顺序）
 * @param {string[]} pool  候选句子
 * @param {string}   level weak|basic|good|excellent
 * @returns {string[]} 排好序的句子（good 维持原顺序）
 */
function pickAskForLevel(pool, level) {
  const arr = Array.isArray(pool) ? pool.slice() : [];
  if (!arr.length) return arr;
  const lv = Object.prototype.hasOwnProperty.call(LEVEL_PARAMS, level) ? level : 'good';
  if (lv === 'good') return arr;

  const countHits = (text, words) => words.reduce((n, w) => (text.indexOf(w) !== -1 ? n + 1 : n), 0);

  const scored = arr.map((text, idx) => {
    const basic = countHits(text, BASIC_HINT);
    const deep = countHits(text, DEEP_HINT);
    let score = 0;
    if (lv === 'weak' || lv === 'basic') {
      score = basic * 10 - deep * 6; // 基础概念优先，原理/变式排到最后
    } else {
      score = deep * 10 - basic * 4; // 原理/变式优先
    }
    return { text, idx, score };
  });

  // 稳定排序：同分保持原顺序
  scored.sort((a, b) => (b.score - a.score) || (a.idx - b.idx));
  return scored.map((s) => s.text);
}

module.exports = {
  PROFILE_LABELS,
  DEFAULT_PROFILE,
  LEVEL_PARAMS,
  LEVEL_BASE_CAP,
  normalizeProfile,
  deriveLevelParams,
  profileSummary,
  profileEffectText,
  pickAskForLevel,
};
