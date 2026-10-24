'use strict';

/**
 * 离线演示数据（路演保命）
 * ------------------------------------------------------------------
 * 黑客松现场可能断网 / Key 没钱 / 接口超时。
 * 这份数据是"整场演示"的兜底剧本：autoDemo 检测到后端不可用时，
 * 直接用这里的固定内容走完全流程，界面表现与联网时一致。
 */

const DEMO_ANALYSIS = {
  overall_score: 72,
  summary: '讲解清晰但语速偏快，提问等待不足，口头禅较多，探究深度不够。',
  engine: 'offline-demo',
  speech_rate: { chars_per_min: 168, judge: '偏快' },
  pauses: { count_gt_2s: 3, longest_sec: 2.8 },
  filler_words: { total: 12, detail: { 那个: 4, 然后: 5, 就是: 3 } },
  questions: { asked: 2, avg_wait_sec: 1.1, genuine_questions: 0, total: 2, authentic: 0 },
  knowledge: { covered: ['勾股定理公式', '勾三股四弦五'], missing: ['公式推导过程', '逆定理'], cover_percent: 65 },
  suggestions: [
    { title: '放慢语速到 150 字/分', detail: '当前 168 字/分，重点讲授段建议降到 130 并配合板书停顿。' },
    { title: '把伪提问改成真提问', detail: '"这公式大家能理解吗"是伪提问，改成点名 + 明确等待 3 秒。' },
    { title: '补充公式推导', detail: '用面积法拼图演示 a²+b²=c²，让结论"看得见"。' },
    { title: '减少口头禅', detail: '"然后/那个"共出现 9 次，写逐字稿时刻意删除，用停顿代替。' },
  ],
};

const DEMO_IMPROVE = {
  key_changes: ['删除全部口头禅', '封闭式提问改为点名 + 等待', '补入面积法推导', '增加变式练习'],
  improved_script:
    '同学们好，今天我们学习勾股定理。（板书课题）\n\n先看大屏幕——这个直角三角形里，两条直角边是 a 和 b，斜边是 c。\n' +
    '早在西周，商高就发现了「勾三股四弦五」。（停顿 2 秒）\n\n那么 a²+b²=c² 是怎么来的？我们用四个全等的直角三角形拼一个大正方形——\n' +
    '中间空出的小正方形面积正好是 c²，而四个三角形面积是 2ab，总正方形面积是 (a+b)²。\n' +
    '列式：(a+b)² = c² + 2ab，展开后 a²+2ab+b² = c²+2ab，两边消去 2ab——\n' +
    '得到 a²+b²=c²。（板书完整推导）\n\n李同学，你来说说这个推导里最关键的一步是什么？【等待 3 秒】\n' +
    '很好，他抓住了"消去 2ab"。这正是我们要的数学思维。\n\n练习：直角边 5 和 12，求斜边？（停顿巡視）王同学上台板演。\n' +
    '【变式】如果只知道斜边 13 和一条边 5，另一条边怎么求？这节课后 whose desk? 我们下节课讲逆定理。\n\n作业：基础题 1-3，提高题 4，拓展——量一量教室地砖对角线验证。下课。',
  blackboard_design: {
    layout: '左 2/3 主板书（课题→推导→结论框）；右 1/3 副板书（演算、学生回答、易错点）',
    key_points: ['课题：勾股定理', '直角三角形边长标记', '面积法拼图草图', 'a²+b²=c²（加框）'],
  },
  layered_homework: {
    basic: '课本 P52 练习 1-3（直接代入公式）',
    advanced: 'P52 第 4 题：已知两边求第三边，含分类讨论',
    extended: '实地测量：用卷尺验证教室地砖的对角线长度',
  },
  next_focus: '下一次练习时，把"提问后沉默 3 秒"作为一个硬性动作练到位。',
  engine: 'offline-demo',
};

const DEMO_CRISIS = {
  event: { id: 'power', title: '⚡ 投影仪突然断电', desc: '你正讲到关键推导，教室投影「啪」一声黑了，PPT 全没了。学生开始骚动。', hint: '考察：临场应变 / 是否还能脱离课件继续讲课' },
  student_say: '老师！黑屏了！这节课是不是不用上了？',
  engine: 'offline-demo',
};

const DEMO_CRISIS_SCORE = {
  score: 82,
  grade: '优秀',
  dimension: '临场应变',
  feedback: '好在先稳住了情绪（"不要慌"），并顺势把 PPT 依赖转成板书推导，属于 FIAS 的「强化」区——把事故变成了教学资源。',
  model_answer: '别慌，正好检验真功夫！投影黑了咱们就用黑板，谁记得上一步推到哪了？来，一起接着推。',
  engine: 'offline-demo',
};

const DEMO_PANORAMA = {
  average: 68,
  views: [
    { key: 'supervisor', label: 'AI 督导', icon: '🎓', score: 72, comment: '教学基本功尚可，但互动深度和应变仍有空间。', advice: '把每 8 分钟一次的互动变成固定设计。' },
    { key: 'struggler', label: 'AI 学困生', icon: '🧒', score: 35, comment: '中间讲公式那段完全懵了，老师讲太快没反应过来。', advice: '先举个最简单的例子再讲公式。' },
    { key: 'parent', label: 'AI 家长', icon: '👨‍👩‍👧', score: 70, comment: '有点照本宣科，我家孩子坐不住的可能跟不上。', advice: '多关注中等偏下的孩子，别只顾推进度。' },
    { key: 'peer', label: 'AI 同行教师', icon: '🤝', score: 78, comment: '导入环节的情境设计很自然，提问铺垫有层次。', advice: '把好的提问写进教案固定下来。' },
    { key: 'director', label: 'AI 教研组长', icon: '📐', score: 68, comment: '讲授占比过高，探究环节形同虚设。', advice: '压缩讲授到 15 分钟，改成小组探究。' },
    { key: 'analyst', label: 'AI 学情分析师', icon: '📊', score: 65, comment: '预计两极分化，后进率约 30%。', advice: '下节课前 5 分钟做上节小测。' },
  ],
  engine: 'offline-demo',
};

const DEMO_CLASSROOM = {
  students: [
    {
      key: 'naughty', name: '小皮', avatar: '😈', mood: '😤',
      line: '老师，那要是斜边是负数还算得出吗？', hand_raise: true,
      attention: 52, comprehension: 62,
      difficulty: 'core',
      base_state: { attention: 52, comprehension: 62 },
    },
    {
      key: 'geek', name: '小霸', avatar: '🤓', mood: '🤔',
      line: '老师，这个能用坐标法再证一遍吗？', hand_raise: true,
      attention: 88, comprehension: 90,
      difficulty: 'core',
      base_state: { attention: 88, comprehension: 90 },
    },
    {
      key: 'drift', name: '小走', avatar: '😵', mood: '😴',
      line: '啊？刚才那个 a 和 b 谁大谁小啊……', hand_raise: false,
      attention: 42, comprehension: 35,
      difficulty: 'core',
      base_state: { attention: 42, comprehension: 35 },
    },
  ],
  backchannel: null,
  pressure_delta: 12,
  pressure_reason: '离线演示：三个学生同时发难',
  verdict: '',
  engine: 'offline-demo',
  profile_applied: false,
  profile_effect: '',
};

const DEMO_DANGER = {
  moments: [
    { type: '伪提问', quote: '「这公式大家能理解吗？」', reason: '提问后未等待也未点名，属于自问自答', fix: '改成「李XX，你说说这一步为什么这么设」并等 3 秒' },
    { type: '口头禅扎堆', quote: '「然后……然后……就是……」', reason: '连续填充词会让学生抓不住重点', fix: '用停顿代替，把「然后」删掉后句子反而更清楚' },
    { type: '逻辑跳跃', quote: '「大家记住这个结论就可以了」', reason: '跳过推导直接给结论，学生只能死记', fix: '补一句「我们看看这个结论是怎么来的」再进推导' },
  ],
  engine: 'offline-demo',
};

const DEMO_HEATMAP = {
  wait_moments: [
    { quote: '好，我问大家一个问题，这公式大家能理解吗？', wait_sec: 0.5, reaction: '离线演示：没等人反应过来就进了下一句' },
    { quote: '然后我们来看一下这个公式', wait_sec: 0.8, reaction: '离线演示：学生还在抄，已经翻页' },
    { quote: '李XX，你说说这一步为什么这么设？', wait_sec: 3, reaction: '离线演示：李同学答出了关键思路' },
    { quote: '这个结论考试可能会考，大家记住了吗？', wait_sec: 0.5, reaction: '离线演示：齐声敷衍"记住了"' },
  ],
  time_allocation: { teacher: 26, student: 4, interaction: 6, transition: 4 },
  segments: [
    {
      phase: '导入',
      script: '同学们好！上课前先看大屏幕——这把三角尺，直角边 3 和 4，斜边正好 5。（停顿 1 秒）古人叫它"勾三股四弦五"，今天我们就来研究它背后的规律。',
      notes: ['删掉"那个/然后"，开场更利落', '用实物三角尺制造认知冲突'],
    },
    {
      phase: '新授',
      script: '两条直角边记作 a 和 b，斜边记作 c。（板书）商高发现的只是特例，a²+b²=c² 对任意直角三角形都成立吗？我们用四个全等的直角三角形拼成一个大正方形——边长是 a+b，面积是 (a+b)²；它又等于 c² 加上四个三角形的面积……',
      notes: ['补上卡壳处的面积法推导', '把"记住结论"改成"看见结论"'],
    },
    {
      phase: '互动',
      script: '王同学，你来说说展开之后哪一项两边都有？（等待 3 秒）很好，是 2ab！两边同时消去它，剩下的就是 a²+b²=c²。（板书完整推导）现在同桌互相讲一遍这个思路，1 分钟。',
      notes: ['伪提问改成点名 + 3 秒等待', '加入同桌互讲，把课堂还给学生'],
    },
    {
      phase: '小结',
      script: '这节课我们从"勾三股四弦五"出发，用面积法证明了 a²+b²=c²。作业：基础 1-3 必做；拓展——用卷尺量一块地砖的对角线，验证它是不是边长的 √2 倍。下课。',
      notes: ['小结由"考试要考"改为"知识从哪里来"', '作业分层：基础 / 拓展'],
    },
  ],
  engine: 'offline-demo',
};

const DEMO_LESSONPLAN = {
  coverage: [
    { point: '勾股定理的表述与条件', status: '讲透了', evidence: '讲了 a²+b²=c² 及直角条件' },
    { point: '面积法验证过程', status: '讲透了', evidence: '拼图推导完整呈现' },
    { point: '勾三股四弦五特例', status: '提到了', evidence: '导入提了一句，未展开' },
    { point: '逆定理', status: '漏讲', evidence: '逐字稿中未出现' },
    { point: '简单实际应用', status: '提到了', evidence: '只报了例题，未练习' },
  ],
  missing: ['逆定理'],
  verdict: '离线演示：覆盖 4/5，核心推导讲透了，建议补逆定理铺垫。',
  suggestions: ['逆定理可在小结前用 30 秒做铺垫', '实际应用增加一个学生板演环节'],
  engine: 'offline-demo',
};

const DEMO_CURRICULUM = {
  label: '数学课程标准（2022 年版）',
  standards: [
    { code: 'M1', dim: '探究实践', desc: '经历勾股定理及其逆定理的探究过程，体会数形结合思想', achieved: '部分达成', evidence: '离线演示：直接给出公式，缺少探究过程' },
    { code: 'M2', dim: '知识技能', desc: '掌握勾股定理及其逆定理，能运用它们解决简单的实际问题', achieved: '达成', evidence: '离线演示：公式讲解清晰，有例题' },
    { code: 'M4', dim: '数学抽象', desc: '在具体情境中抽象出数学概念，会用数学的语言表达现实世界', achieved: '部分达成', evidence: '离线演示：有情境导入，抽象过程略快' },
    { code: 'M5', dim: '逻辑推理', desc: '掌握推理的基本方法，能有条理地表述论证过程', achieved: '未达成', evidence: '离线演示：无推导，直接给结论' },
  ],
  summary: '离线演示：知识与技能达标，但探究与推理两条素养线未达成——试讲沦为「报答案」。',
  engine: 'offline-demo',
};

/* 检测后端是否可用（用于决定是否走离线剧本） */
async function probeBackend() {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch('/api/health', { signal: ctrl.signal });
    clearTimeout(timer);
    return res.ok;
  } catch (e) {
    return false;
  }
}


const DEMO_IFIAS = {"engine": "offline-demo", "total_units": 23, "codes": [{"i": 1, "text": "同学们好，请看大屏幕上的这道题。", "code": "13", "label": "教师操纵技术", "reason": "技术操作"}, {"i": 2, "text": "一个直角三角形，两条直角边是3和4，斜边是多少？", "code": "4.2", "label": "提问封闭性问题", "reason": "封闭性提问"}, {"i": 3, "text": "大家先自己算一算。", "code": "6", "label": "教师指令", "reason": "教师指令"}, {"i": 4, "text": "谁来说说你的答案？", "code": "4.2", "label": "提问封闭性问题", "reason": "封闭性提问"}, {"i": 5, "text": "李同学你来说。", "code": "4.2", "label": "提问封闭性问题", "reason": "封闭性提问"}, {"i": 6, "text": "对，是5。", "code": "5", "label": "教师讲授", "reason": "教师讲授"}, {"i": 7, "text": "很好，请坐。", "code": "2", "label": "教师表扬或鼓励", "reason": "表扬鼓励"}, {"i": 8, "text": "那为什么是5呢？", "code": "4.1", "label": "提问开放性问题", "reason": "开放性提问"}, {"i": 9, "text": "大家想一想，能不能用面积来解释？", "code": "4.1", "label": "提问开放性问题", "reason": "开放性提问"}, {"i": 10, "text": "我们一起来看黑板上的推导。", "code": "6", "label": "教师指令", "reason": "教师指令"}, {"i": 11, "text": "第一步，把四个直角三角形拼成一个边长为a加b的大正方形。", "code": "5", "label": "教师讲授", "reason": "教师讲授"}, {"i": 12, "text": "第二步，中间空出来的是边长为c的正方形。", "code": "5", "label": "教师讲授", "reason": "教师讲授"}], "matrix": {"labels": ["接受情感", "表扬鼓励", "采纳观点", "教师提问", "教师讲授", "教师指令", "批评权威", "学生应答", "学生提问", "同伴讨论", "沉寂混乱", "技术操作"], "data": [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 1], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 1, 0, 2, 1, 2, 0, 0, 0, 0, 0, 0], [0, 1, 0, 0, 4, 1, 0, 0, 0, 0, 0, 0], [0, 1, 0, 1, 1, 0, 0, 0, 0, 1, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0]]}, "matrix_raw": {"labels": ["1", "2", "3", "4.1", "4.2", "5", "6", "7", "8", "9.1", "9.2", "10", "11", "12", "13", "14"], "data": [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 1, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 1, 0, 0, 0, 4, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]], "size": 16}, "steady_cells": [{"code": "5", "label": "教师讲授", "count": 4}], "content_cross": 31.8, "vector": [0.87, 0.043, 0, 0.087, 0.333, 0.45, 0.924], "ratios": {"total": 23, "teacher_pct": 87, "student_pct": 4.3, "silence_pct": 0, "tech_pct": 8.7, "indirect_pct": 45, "direct_pct": 55, "indirect_direct": 0.82, "positive_negative": 0.75, "open_close": 0.5, "question_pct": 30, "active_passive": null, "counts": {"1": 0, "2": 3, "3": 0, "5": 7, "6": 4, "7": 0, "8": 0, "10": 1, "11": 0, "12": 0, "13": 2, "14": 0, "4.1": 2, "4.2": 4, "9.1": 0, "9.2": 0}}, "episodes": [{"start": 1, "end": 6, "cluster": 0, "x": -0.206, "y": 0.198}, {"start": 4, "end": 9, "cluster": -1, "x": 0.381, "y": 0.2}, {"start": 7, "end": 12, "cluster": -1, "x": 0.722, "y": -0.233}, {"start": 10, "end": 15, "cluster": 1, "x": -0.37, "y": -0.412}, {"start": 13, "end": 18, "cluster": 1, "x": -0.344, "y": -0.159}, {"start": 16, "end": 21, "cluster": 0, "x": -0.182, "y": 0.405}], "clusters": [{"id": 0, "size": 2, "name": "主导讲授", "avg": [0.75, 0.08, 0, 0.17, 0, 0.68, 0.93], "dominant": "编码多样性"}, {"id": 1, "size": 2, "name": "主导讲授 Ⅱ", "avg": [0.92, 0, 0, 0.08, 0, 0.1, 0.94], "dominant": "编码多样性"}], "explained": [64, 31.6], "eps": 0.39, "min_pts": 2, "cluster_note": "", "verdict": "教师语言占比 87%，课堂以讲授为主；开放/封闭提问比 0.5，仍略偏封闭，可再增加「为什么/还能怎么想」；检出 2 个低密度片段（互动结构与整体差异较大的时段，不等于教学事故）；课堂结构可归为 2 类：主导讲授、主导讲授 Ⅱ。", "code_table": [{"code": "1", "label": "教师接受情感", "group": "teacher"}, {"code": "2", "label": "教师表扬或鼓励", "group": "teacher"}, {"code": "3", "label": "教师采纳学生观点", "group": "teacher"}, {"code": "4.1", "label": "提问开放性问题", "group": "teacher"}, {"code": "4.2", "label": "提问封闭性问题", "group": "teacher"}, {"code": "5", "label": "教师讲授", "group": "teacher"}, {"code": "6", "label": "教师指令", "group": "teacher"}, {"code": "7", "label": "教师批评或维护权威", "group": "teacher"}, {"code": "8", "label": "学生被动应答", "group": "student"}, {"code": "9.1", "label": "学生主动应答", "group": "student"}, {"code": "9.2", "label": "学生主动提问", "group": "student"}, {"code": "10", "label": "学生与同伴讨论", "group": "student"}, {"code": "11", "label": "无助于教学的混乱", "group": "silence"}, {"code": "12", "label": "有益于教学的沉寂", "group": "silence"}, {"code": "13", "label": "教师操纵技术", "group": "tech"}, {"code": "14", "label": "学生操纵技术", "group": "tech"}]};

const DEMO_HOLLOW = {
  reply: '讲到一半脑子空白，那种当众失重的感觉，比讲错更难受。可这不是你不会讲，是你把它当成了背诵——背的东西一断就接不上，而讲的东西断了还能绕回来。现在花 30 秒，只给开场那 30 个字写三个关键词，明天开口只说关键词，不许背句子。',
  engine: 'offline-demo',
};


const DEMO_IFIAS_BATCH = {
  points: [
    { label: "第 1 次·勾股定理", at: "2026-10-19T10:00:00.000Z", x: -0.32, y: 0.06, cluster: 0, order: 0 },
    { label: "第 2 次·分数除法", at: "2026-10-20T10:00:00.000Z", x: -0.18, y: -0.04, cluster: 0, order: 1 },
    { label: "第 3 次·一元一次方程", at: "2026-10-21T10:00:00.000Z", x: 0.28, y: 0.11, cluster: 1, order: 2 }
  ],
  clusters: [],
  explained: [81.4, 12.6],
  eps: 0.46,
  min_pts: 2,
  note: "点越靠近说明课堂结构越相似；从 1 到 3 的位移方向，就是你的课堂在变的方向。"
};

/* ==================================================================
   增量 E / A / B 的演示数据（规格 §5.5）
   ------------------------------------------------------------------
   全部标注 engine = 'offline-demo'，界面上必须明确标注「以下为演示数据」。
   ================================================================== */

// 学情 + 教学任务示例（完整可用的 Profile）
// 字段名严格照规格 §2.1–2.3；class 走「默认班级画像」口径（中等 / 45 人 / 活跃度一般 / 无预设条目）。
const DEMO_PROFILE = {
  version: 1,
  task: {
    topic: "勾股定理",
    lessonType: "new",
    objectives: [
      "能说出勾股定理的内容",
      "能用勾股定理解决直角三角形边长问题",
      "能说出勾三股四弦五的来历"
    ],
    keyPoints: ["勾股定理公式", "勾三股四弦五"],
    difficulties: ["公式的推导过程", "逆定理的判定"],
    assessment: "formative",
    durationMin: 45
  },
  class: {
    level: "good",
    priorKnowledge: [],
    commonErrors: [],
    size: 45,
    activity: "mid"
  },
  updatedAt: 0
};

// 五个专项练习技能的完整定义（结构同规格 §3.4 的 Skill）
// brief / checklist / starter 与后端 lib/drill.js 的 SKILLS 逐字一致，
// 保证「演示模式看到的技能说明」与「真实模式拿到的技能说明」完全相同。
const DEMO_DRILL_SKILLS = {
  skills: [
    {
      key: "question_wait",
      label: "提问与等待",
      focus: "把封闭式提问换成真提问，并真的留白",
      brief:
        "用 3 分钟讲一小段内容：至少设计 2 个需要学生思考的开放提问，每个问题问完后留出等待（可用「（停顿）」「默数三秒」标注），最后说明学生可能的回答与追问方向。",
      checklist: [
        "有 2 个以上需要思考的开放提问",
        "每个提问后标注了等待",
        "没有「听懂了吗」这类假提问",
        "给出了学生可能的回应",
        "留白位置与提问位置匹配"
      ],
      starter: "同学们，昨天我们学过一个结论。今天我想先问大家一个问题：如果把这个条件换掉，还成立吗？"
    },
    {
      key: "pace_filler",
      label: "语速与口头禅",
      focus: "控速、去掉口头禅",
      brief:
        "用 3 分钟讲清一个知识点：目标语速 120–150 字/分，把「那个」「然后」「就是」这类口头禅清掉，关键结论处留短停顿。",
      checklist: [
        "语速落在 120–150 字/分",
        "口头禅少于 8 处",
        "结论处有短停顿",
        "一句话只带一个信息点",
        "没有连续重复的铺垫"
      ],
      starter: "这个结论其实只有一句话要记：先看条件，再看结论。条件变了，结论就要重新推一遍。"
    },
    {
      key: "board_structure",
      label: "板书结构",
      focus: "让板书承担结构：课题→推导→结论",
      brief:
        "用 3 分钟讲一段推导，并在讲稿里说清板书怎么写：课题写在哪、推导主线分几步、结论落在哪，主板书全程不擦。",
      checklist: [
        "板书有明确分区",
        "写出课题与主线步骤",
        "推导过程留在板上",
        "结论单独占位置",
        "说明哪些内容不擦"
      ],
      starter: "板书分两块：左边主板书写推导主线，右边副板书写例题演算，课题写在正上方。"
    },
    {
      key: "intro_design",
      label: "导入设计",
      focus: "前 15% 讲稿完成情境、冲突或复习衔接",
      brief:
        "用 3 分钟设计并讲解一个导入：从生活情境、旧知复习或一个反常现象切入，导入段落不超过整段讲稿的 15%。",
      checklist: [
        "导入有具体情境或冲突",
        "与旧知或生活经验相连",
        "导入含一个真实问题",
        "导入长度不超过 15%",
        "导入后自然进入新课"
      ],
      starter: "上周有同学问我：一个数到底能开多少次平方才算完？今天我们用这个例子来回答。"
    },
    {
      key: "transition",
      label: "过渡衔接",
      focus: "环节之间有过渡句，小结收口",
      brief:
        "用 3 分钟串起三个教学环节：每个环节之间有过渡句，最后用小结收口并布置作业，让环节之间不跳。",
      checklist: [
        "环节之间有过渡句",
        "过渡句指向明确",
        "覆盖了推导、例题、互动",
        "末尾有小结",
        "有作业或下课收口"
      ],
      starter: "接下来我们把这个结论用到一道例题上；例题讲完，我会用两句话把今天的内容收回来。"
    }
  ],
  default_skill: "question_wait",
  duration_sec: 180,
  engine: "offline-demo"
};

// 一次 3 分钟练习的评分示例（结构同规格 §3.5 的 data）
// 维度 key / label 与后端 lib/drill.js 的规则维度同名，便于前端渲染口径一致。
const DEMO_DRILL_RESULT = {
  skill: "question_wait",
  skill_label: "提问与等待",
  duration_sec: 168,
  score: 78,
  grade: "合格",
  summary: "提问后平均留白约 1.4 秒，学生多数来不及开口。",
  dimensions: [
    { key: "density", label: "有效提问密度", score: 82, weight: 0.35, evidence: "每分钟 1.67 个需要思考的提问", fix: "每分钟至少设计 1 个开放提问，问完留 3 秒" },
    { key: "wait", label: "提问后留白", score: 58, weight: 0.35, evidence: "提问后平均留白约 1.4 秒", fix: "问完在心里默数三下，再开口讲" },
    { key: "marker", label: "等待标记", score: 70, weight: 0.2, evidence: "讲稿里标出等待 1 处", fix: "在提问后写上「（停顿）」，逼自己真的等" },
    { key: "fake", label: "假提问扣分", score: 70, weight: 0.1, evidence: "检测到 2 处封闭式提问", fix: "把「听懂了吗」改成点名 + 「说说你的理由」" }
  ],
  evidence: [
    { quote: "这公式大家能理解吗？", reason: "封闭式提问，问完没有等学生开口", fix: "改成「李同学，你说说这一步为什么这么设」并等 3 秒" },
    { quote: "然后我们来做一道例题", reason: "口头禅承接，缺少过渡句", fix: "把它换成一次停顿" }
  ],
  suggestions: [
    { title: "提问后停满 2 秒", detail: "你平均提问后等了 1.4 秒，学生来不及开口，试着停满 2 秒再点人。" },
    { title: "去掉 1 处伪提问", detail: "「这公式大家能理解吗」是伪提问，改成点名 + 明确等待 3 秒。" }
  ],
  next_drill: { skill: "pace_filler", reason: "提问节奏已经稳住，接着控语速更省力" },
  metrics: {
    chars_per_min: 142,
    filler_total: 5,
    questions_asked: 5,
    genuine_questions: 4,
    fake_questions: 2,
    avg_wait_sec: 1.4,
    cover_percent: 62,
    pause_count: 2,
    matched_markers: 1
  },
  engine: "offline-demo",
  source_note: "演示数据：以下为演示数据，不代表你本次练习的真实表现。"
};

// 学情生效后的三学生课堂回合（结构同规格 §3.3 的 data）
const DEMO_CLASSROOM_PROFILE = {
  students: [
    {
      key: "naughty", name: "小皮", avatar: "😈", mood: "😤",
      line: "老师，a 和 b 到底哪个是斜边啊？我老是搞混。",
      hand_raise: true, attention: 52, comprehension: 62,
      state_reason: "基础概念有疑问（学情：中等）",
      difficulty: "core",
      base_state: { attention: 52, comprehension: 62 }
    },
    {
      key: "geek", name: "小霸", avatar: "🤓", mood: "🤔",
      line: "老师，如果不先给公式，能不能用面积拼图推出来？",
      hand_raise: true, attention: 88, comprehension: 90,
      state_reason: "想追问推导过程（学情：中等）",
      difficulty: "core",
      base_state: { attention: 88, comprehension: 90 }
    },
    {
      key: "drift", name: "小走", avatar: "😵", mood: "😴",
      line: "啊？刚才那个 a 的平方是什么意思……",
      hand_raise: false, attention: 42, comprehension: 35,
      state_reason: "走神中（学情：中等）",
      difficulty: "core",
      base_state: { attention: 42, comprehension: 35 }
    }
  ],
  backchannel: null,
  pressure_delta: 0,
  pressure_reason: "学情生效：提问集中在概念理解，课堂节奏不变",
  verdict: "本班按「中等」画像提问，问题落在概念理解与易错点上。",
  engine: "offline-demo",
  profile_applied: true,
  profile_effect: "学情中等：基线不变，提问优先落在概念与常见错误上"
};

// 学情生效后的单人学生发言（结构同规格 §3.2 的 data）
const DEMO_STUDENT_CHAT_PROFILE = {
  reply: "老师，你刚才说 a 的平方加 b 的平方等于 c 的平方，那 a 和 b 到底哪个更长啊？我老是搞混。",
  persona: "naughty",
  label: "AI 学生",
  engine: "offline-demo",
  profile_applied: true,
  difficulty: "core",
  profile_summary: "学情：中等 · 提问聚焦概念与常见错误"
};

const JTQ_DEMO = {
  DEMO_ANALYSIS, DEMO_IMPROVE, DEMO_CRISIS, DEMO_CRISIS_SCORE, DEMO_PANORAMA,
  DEMO_CLASSROOM, DEMO_DANGER, DEMO_HEATMAP, DEMO_LESSONPLAN, DEMO_CURRICULUM, DEMO_HOLLOW, DEMO_IFIAS, DEMO_IFIAS_BATCH,
  DEMO_PROFILE, DEMO_DRILL_SKILLS, DEMO_DRILL_RESULT, DEMO_CLASSROOM_PROFILE, DEMO_STUDENT_CHAT_PROFILE,
  probeBackend,
};

// 浏览器：挂到 window.JTQDemo，供 app.js 的 offlineFallback() 读取。
// 之前只写了 module.exports，导致浏览器里 window.JTQDemo 为 undefined，
// 离线兜底从未真正生效（断网时直接抛错而不是降级到演示数据）。
if (typeof window !== 'undefined') {
  window.JTQDemo = JTQ_DEMO;
}

// Node / CommonJS：保留原有导出，供服务端与测试引用。
if (typeof module !== 'undefined' && module.exports) {
  module.exports = JTQ_DEMO;
}
