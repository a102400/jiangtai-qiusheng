'use strict';
/* 一次性冒烟测试：用最小假 DOM 在 Node 里真实加载 question-drill.js，
   验证① 普通闭环（选目标→2轮→本地评价→写入 localStorage）
   ② Bug1（演示态不读真实草稿/清空面板）
   ③ Bug2（学生回应失败时教师气泡不重复、文本回输入框）。 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

function makeHarness({ demo = false, demoPage = false, seed = null } = {}) {
  const registry = {};
  class El {
    constructor(tag) {
      this.tagName = tag; this.children = []; this.attributes = {};
      this.listeners = {}; this._text = ''; this.value = ''; this.hidden = false;
      this.disabled = false; this.className = ''; this.style = {}; this._id = '';
    }
    set id(v) { this._id = v; registry[v] = this; }
    get id() { return this._id; }
    set textContent(v) { this._text = v; }
    get textContent() { return this._text; }
    set innerHTML(v) { this._html = v; this.children = []; }
    get innerHTML() { return this._html; }
    append(...n) { n.forEach((x) => this.appendChild(x)); }
    appendChild(n) { if (n) { n.parent = this; this.children.push(n); } return n; }
    insertBefore(n, ref) {
      const i = this.children.indexOf(ref);
      if (i < 0) this.appendChild(n); else this.children.splice(i, 0, n);
      return n;
    }
    replaceChildren(...n) { this.children.forEach((c) => (c.parent = null)); this.children = n; n.forEach((c) => (c.parent = this)); }
    setAttribute(k, v) { this.attributes[k] = v; }
    getAttribute(k) { return this.attributes[k]; }
    addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
    removeEventListener() {}
    remove() { if (this.parent) { const i = this.parent.children.indexOf(this); if (i >= 0) this.parent.children.splice(i, 1); } }
    focus() {}
    get firstElementChild() { return this.children[0] || null; }
  }

  const docListeners = {};
  const document = {
    getElementById: (id) => registry[id] || null,
    createElement: (tag) => new El(tag),
    addEventListener: (t, fn) => { (docListeners[t] = docListeners[t] || []).push(fn); },
    dispatchEvent: (ev) => { (docListeners[ev.type] || []).forEach((fn) => fn(ev)); },
    querySelector: () => new El('button'),
  };

  // 预注册真实 HTML 中已有的静态元素
  ['trainingInput', 'pane-chat', 'analyzeBtn', 'questionDrillQuote', 'questionDrillStart',
   'questionDrillStatus', 'questionDrillConversation', 'questionDrillForm',
   'questionDrillTeacherInput', 'questionDrillFinish', 'questionDrillRoundInfo',
   'questionDrillReport'].forEach((id) => { const e = new El('div'); e.id = id; });

  const store = seed ? Object.assign({}, seed) : {};
  const localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };

  let postImpl = async () => ({ reply: '模拟学生：我不太确定，能再说一遍吗？', engine: 'llm' });

  const sandbox = {
    document,
    localStorage,
    location: { search: demoPage ? '?jtq-demo=1' : '' },
    JTQ_DEMO_PAGE: demo,
    console,
    JSON,
    URLSearchParams,
    Promise,
    Date,
    Math,
    window: { crypto: { randomUUID: () => 'uuid-' + Math.random().toString(16).slice(2) } },
    post: (...a) => postImpl(...a),
    CustomEvent:
      typeof CustomEvent !== 'undefined'
        ? CustomEvent
        : class { constructor(t, o) { this.type = t; this.detail = o && o.detail; } },
  };
  vm.createContext(sandbox);

  // 量规已抽成纯函数文件，必须与浏览器里的顺序一致：rules → question-drill
  const rulesCode = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'question-drill-rules.js'),
    'utf8'
  );
  vm.runInContext(rulesCode, sandbox, { filename: 'question-drill-rules.js' });

  const code = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'question-drill.js'),
    'utf8'
  );
  vm.runInContext(code, sandbox, { filename: 'question-drill.js' });

  return { registry, document, sandbox, localStorage: store, setPost: (fn) => (postImpl = fn) };
}

function assert(cond, msg) {
  if (!cond) { console.error('FAIL: ' + msg); process.exitCode = 1; }
  else console.log('ok  - ' + msg);
}

function countTeacher(reg) {
  return reg.questionDrillConversation.children.filter((c) => (c.className || '').includes('teacher')).length;
}

/* 假 DOM 的 textContent 只存自身文本，取整段文字要递归。 */
function collectText(node) {
  let out = typeof node.textContent === 'string' ? node.textContent : '';
  (node.children || []).forEach((c) => { out += ' ' + collectText(c); });
  return out;
}

(async () => {
  console.log('\n=== 普通闭环（非演示）===');
  const h = makeHarness();
  const reg = h.registry;
  h.document.dispatchEvent(new h.sandbox.CustomEvent('jtq:analysis-complete', {
    detail: {
      report: { engine: 'rule', questions: { asked: 3 } },
      transcript: '同学们好，今天我们讲勾股定理。大家能理解吗？请说说你的思路。',
      subject: '数学', grade: '八年级', isDemo: false,
    },
  }));
  assert(reg.questionDrillQuote.value.includes('能理解吗'), '分析后自动定位提问原句到 quote');
  assert(reg.questionDrillStart.disabled === false, '找到原句后开始按钮可用');

  reg.questionDrillStart.listeners.click[0]();
  assert(reg.questionDrillForm.hidden === false, '开始后表单显示');

  async function turn(text) {
    reg.questionDrillTeacherInput.value = text;
    await reg.questionDrillForm.listeners.submit[0]({ preventDefault() {} });
    await Promise.resolve(); await Promise.resolve();
  }

  await turn('你能说说为什么吗？');
  assert(countTeacher(reg) === 1, '第1轮后对话区有 1 条教师气泡');
  assert(reg.questionDrillRoundInfo.textContent === '教师回应 1 / 3 轮', '轮次信息=1/3');

  // 第二句刻意原样引用模拟学生的用词，用于验证追问线索判定为 observed。
  await turn('你刚才说“我不太确定”，能说说你卡在哪一步吗？');
  assert(countTeacher(reg) === 2, '第2轮后对话区有 2 条教师气泡');
  assert(reg.questionDrillFinish.disabled === false, '满2轮后可结束');

  reg.questionDrillFinish.listeners.click[0]();
  const saved = JSON.parse(h.localStorage['jtq_question_drill_sessions'] || '[]');
  assert(saved.length === 1, '完成会话写入 jtq_question_drill_sessions');
  const ev = saved[0].evaluation;
  assert(ev && ev.dimensions.length === 3, '评价仅含 3 个固定维度');
  assert(ev.evaluation_source === 'local-heuristic', '评价来源标注为 local-heuristic');
  assert(ev.dimensions.every((d) => d.key && 'score' in d && 'evidence_quote' in d), '每维度含 key/score/evidence_quote');
  assert(
    ev.dimensions.every((d) => typeof d.evidence_status === 'string'),
    '每维度带 evidence_status（区分 observed/partial/not-observable/not-found）'
  );
  const follow = ev.dimensions.find((d) => d.key === 'follow_up_adaptation');
  assert(follow.evidence_status === 'observed', '追问引用学生原词 → observed');
  assert(follow.score === 2, '追问引用学生原词 → 2 分');
  assert(
    !('total' in ev) && !('score' in ev),
    '评价不把三项求和成总分'
  );
  assert(
    ev.dimensions.every((d) => d.evidence_quote === '' || saved[0].messages
      .filter((m) => m.role === 'teacher')
      .some((m) => m.content.includes(d.evidence_quote))),
    '每条证据句都出自教师本人发言'
  );
  assert(ev.boundary_note.includes('不代表已经测得学生的真实理解'), '反馈显示“不代表真实理解”边界说明');

  // 会话记录包含要求的字段
  assert(saved[0].goal && saved[0].practice_quote, '记录含训练目标与待练原句');
  assert(saved[0].misconception_label, '记录含模拟误区的固定标签');
  assert(Array.isArray(saved[0].messages) && saved[0].messages.length === 4, '记录含完整对话（2 教 + 2 学）');
  assert(saved[0].evaluation.rubric_version === 'question-drill-v1', '记录含规则版本');

  console.log('\n=== 会话列表：展示 / 查看 / 删除 ===');
  const list = reg.questionDrillHistoryList;
  assert(list && list.children.length === 1, '完成后会话列表出现 1 条记录');
  const item = list.children[0];
  const actions = item.children.find((c) => (c.className || '').includes('actions'));
  const viewBtn = actions.children[0];
  const delBtn = actions.children[1];

  viewBtn.listeners.click[0]();
  const summaryText = JSON.stringify(reg.questionDrillReport.children.map((c) => c.textContent));
  assert(summaryText.includes('训练会话摘要'), '查看摘要渲染到反馈区');
  assert(summaryText.includes('不调用模型'), '摘要标注本地文本规则来源');

  delBtn.listeners.click[0]();
  const afterDel = JSON.parse(h.localStorage['jtq_question_drill_sessions'] || '[]');
  assert(afterDel.length === 0, '删除记录后本机记录为空');

  console.log('\n=== 旧会话（无 evidence_status）不崩且标“结果需核对” ===');
  const hLegacy = makeHarness({
    seed: {
      jtq_question_drill_sessions: JSON.stringify([
        {
          session_id: 'legacy-1',
          goal: { key: 'clear-task', label: '提出明确问题或任务' },
          topic: '旧会话',
          practice_quote: '大家能理解吗？',
          messages: [{ role: 'teacher', content: '大家能理解吗？' }],
          evaluation: {
            dimensions: [
              {
                key: 'clear_question_task',
                score: 2,
                evidence_quote: '大家能理解吗？',
                feedback: '旧版反馈',
              },
            ],
            summary: '旧版摘要',
          },
        },
      ]),
    },
  });
  const rl = hLegacy.registry;
  const legacyItem = rl.questionDrillHistoryList.children[0];
  const legacyActions = legacyItem.children.find((c) => (c.className || '').includes('actions'));
  legacyActions.children[0].listeners.click[0]();
  const legacyText = collectText(rl.questionDrillReport);
  assert(legacyText.includes('结果需核对'), '旧会话显示“结果需核对”而非崩溃');

  console.log('\n=== not-observable 不评 0 分 ===');
  const hNoObs = makeHarness({
    seed: {
      jtq_question_drill_sessions: JSON.stringify([
        {
          session_id: 'no-obs-1',
          goal: { label: '根据学生回应继续追问' },
          topic: '无学生回应',
          practice_quote: '你说说看？',
          messages: [{ role: 'teacher', content: '你说说看？' }],
          evaluation: {
            dimensions: [
              {
                key: 'follow_up_adaptation',
                score: 0,
                evidence_quote: '',
                evidence_status: 'not-observable',
                feedback: '当前对话没有学生回应，无法观察。',
              },
            ],
            summary: '摘要',
          },
        },
      ]),
    },
  });
  const rn = hNoObs.registry;
  const noObsItem = rn.questionDrillHistoryList.children[0];
  const noObsActions = noObsItem.children.find((c) => (c.className || '').includes('actions'));
  noObsActions.children[0].listeners.click[0]();
  const noObsSpans = [];
  (function walk(node) {
    (node.children || []).forEach((c) => {
      if (c.tagName === 'span') noObsSpans.push(c.textContent);
      walk(c);
    });
  })(rn.questionDrillReport);
  assert(noObsSpans.includes('不评分'), 'not-observable 显示“不评分”而不是 0 / 2');
  assert(noObsSpans.includes('0 / 2') === false, 'not-observable 不显示 0 / 2');

  console.log('\n=== Bug2：学生回应失败时教师气泡不重复 ===');
  const h2 = makeHarness();
  const r2 = h2.registry;
  let call = 0;
  h2.setPost(async () => {
    call += 1;
    if (call === 2) throw new Error('网络错误');
    return { reply: '学生：我不太确定。', engine: 'llm' };
  });
  h2.document.dispatchEvent(new h2.sandbox.CustomEvent('jtq:analysis-complete', {
    detail: { report: { engine: 'rule' }, transcript: '今天我们学勾股定理。大家能理解吗？', subject: '数学', grade: '八年级', isDemo: false },
  }));
  r2.questionDrillStart.listeners.click[0]();
  async function turn2(text) {
    r2.questionDrillTeacherInput.value = text;
    await r2.questionDrillForm.listeners.submit[0]({ preventDefault() {} });
    await Promise.resolve(); await Promise.resolve();
  }
  await turn2('先想想看？');
  assert(countTeacher(r2) === 1, 'B2-第1轮: 1 条教师气泡');
  await turn2('那再说说你的理由？');
  assert(countTeacher(r2) === 1, 'B2-失败后教师气泡仍为 1（无重复）');
  assert(r2.questionDrillTeacherInput.value.includes('那再说说你的理由'), 'B2-失败文本已放回输入框');
  assert(r2.questionDrillRoundInfo.textContent === '教师回应 1 / 3 轮', 'B2-轮次回滚为 1/3');
  const sysNodes = r2.questionDrillConversation.children.filter((c) => (c.className || '').includes('system'));
  assert(sysNodes.length === 1, 'B2-显示 1 条失败提示');

  console.log('\n=== Bug1：演示态不读/不显示真实草稿 ===');
  // 先在非演示态造一条草稿
  const h3 = makeHarness();
  const r3 = h3.registry;
  h3.document.dispatchEvent(new h3.sandbox.CustomEvent('jtq:analysis-complete', {
    detail: { report: { engine: 'rule' }, transcript: '今天我们学勾股定理。你能理解吗？', subject: '数学', grade: '八年级', isDemo: false },
  }));
  r3.questionDrillStart.listeners.click[0]();
  r3.questionDrillTeacherInput.value = '说说你的想法？';
  await r3.questionDrillForm.listeners.submit[0]({ preventDefault() {} });
  await Promise.resolve(); await Promise.resolve();
  assert(h3.localStorage['jtq_question_drill_draft'] != null, '非演示态产生草稿');

  // 现在以演示态（JTQ_DEMO_PAGE=true）重新加载模块：不应读取/展示该草稿
  const h4 = makeHarness({ demo: true });
  const r4 = h4.registry;
  // 把 h3 的草稿塞进 h4 的 localStorage，模拟“演示页却本机有真实草稿”
  h4.localStorage['jtq_question_drill_draft'] = h3.localStorage['jtq_question_drill_draft'];
  h4.document.dispatchEvent(new h4.sandbox.CustomEvent('jtq:analysis-complete', {
    detail: { report: { engine: 'offline-demo' }, transcript: 'x', subject: '数学', grade: '八年级', isDemo: true },
  }));
  assert(r4.questionDrillStart.disabled === true, 'B1-演示态开始按钮禁用');
  assert(r4.questionDrillConversation.children.length === 0, 'B1-演示态对话区为空（无真实草稿泄露）');
  assert(r4.questionDrillForm.hidden === true, 'B1-演示态表单隐藏');
  assert(r4.questionDrillReport.children.length === 0, 'B1-演示态反馈区清空');

  // 演示态即使本机存在真实历史记录，也不展示任何一条
  const fakeReal = {
    jtq_question_drill_sessions: JSON.stringify([
      {
        session_id: 'real-1',
        goal: { label: '真实记录' },
        topic: '不该出现的课题',
        practice_quote: '不该出现的原句',
        messages: [],
      },
    ]),
  };
  const h5 = makeHarness({ demoPage: true, seed: fakeReal });
  const r5 = h5.registry;
  const demoHistoryText = JSON.stringify(
    r5.questionDrillHistoryList.children.map((c) => c.textContent)
  );
  assert(!demoHistoryText.includes('不该出现的课题'), 'B1-演示态不渲染真实历史记录');
  assert(demoHistoryText.includes('固定示例页不读取'), 'B1-演示态给出不读取说明');

  console.log('\nDONE');
})();
