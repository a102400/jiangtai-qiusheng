'use strict';

/* ==================================================================
 * 提问与追问专项训练闭环（前端）
 * ----------------------------------------------------------------
 * 设计边界（务必遵守）：
 *  - 本模块复用现有 /api/student/chat，不依赖任何专项后端接口。
 *  - 评价（evaluateLocally）是**明确标注的本地启发式规则**，不调用模型，
 *    也不冒充「AI 客观评分」或「教学效果证据」。
 *  - 演示场景（固定示例页 / 离线分析结果）下：不写入真实训练记录、
 *    不读取本机草稿、不展示任何真实会话内容。
 *  - 会话仅存 localStorage（最多 50 条），刷新可恢复未完成草稿。
 * ================================================================== */

(function initQuestionDrill() {
  const inputPanel = document.getElementById('trainingInput');
  const chatPane = document.getElementById('pane-chat');
  const analyzeButton = document.getElementById('analyzeBtn');

  if (!inputPanel || !chatPane || !analyzeButton) {
    console.warn('[JTQ Question Drill] 找不到训练页面容器。');
    return;
  }

  /* ---------------- 演示态判定 ----------------
   * 与 app.js 的口径保持一致：固定演示页（?jtq-demo=1）或 JTQ_DEMO_PAGE 为真，
   * 以及最近一次分析结果是离线示例（detail.isDemo）时，都视为演示。
   * 不要在演示态读写真实训练记录，也不要展示任何真实草稿。
   * 注：JTQ_DEMO_PAGE 是 app.js 顶层 const，classic script 间共享，可直接读取。 */
  const DEMO_URL =
    new URLSearchParams(location.search).get('jtq-demo') === '1';
  let lastAnalysisIsDemo = false;

  function isDemoMode() {
    return Boolean(
      (typeof JTQ_DEMO_PAGE !== 'undefined' && JTQ_DEMO_PAGE) ||
        DEMO_URL ||
        lastAnalysisIsDemo
    );
  }

  const GOALS = [
    {
      key: 'clear-task',
      label: '提出明确问题或任务',
      misconceptionKey: 'fixed_formula',
      misconception: '把结论当成无条件适用的规则',
    },
    {
      key: 'leave-space',
      label: '给学生留下表达思路的空间',
      misconceptionKey: 'memorized_answer',
      misconception: '会记结论，但说不清理由',
    },
    {
      key: 'follow-up',
      label: '根据学生回应继续追问',
      misconceptionKey: 'answer_dependency',
      misconception: '倾向于直接要答案',
    },
  ];

  /* 证据状态的中文口径。旧会话没有 evidence_status 时回落到「结果需核对」。 */
  const EVIDENCE_STATUS_LABEL = {
    observed: '观察到文本线索',
    partial: '部分线索，需核对',
    'not-observable': '本次无法观察',
    'not-found': '规则未找到线索',
  };

  const HISTORY_KEY = 'jtq_question_drill_sessions';
  const DRAFT_KEY = 'jtq_question_drill_draft';

  let activeSession = null;
  let requestPending = false;

  function createId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return 'jtq-' + Date.now() + '-' + Math.random().toString(16).slice(2);
  }

  function readJson(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || 'null');
      return value == null ? fallback : value;
    } catch (_) {
      return fallback;
    }
  }

  function isDemoSession(session) {
    return isDemoMode() || Boolean(session && session.is_demo);
  }

  function saveDraft() {
    if (!activeSession || isDemoSession(activeSession)) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(activeSession));
    } catch (_) {
      setStatus('浏览器未能保存本地草稿。');
    }
  }

  function saveCompletedSession(session) {
    if (isDemoSession(session)) return false;

    try {
      const rows = readJson(HISTORY_KEY, []);
      rows.push(session);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(rows.slice(-50)));
      localStorage.removeItem(DRAFT_KEY);
      return true;
    } catch (_) {
      return false;
    }
  }

  /* ---------------- 本机训练记录（只读本浏览器 localStorage） ----------------
   * 不联网、不同步、删除也只作用于本机。演示态一律不读真实记录。 */

  function buildSessionHistory() {
    if (document.getElementById('questionDrillHistory')) return;

    const panel = document.getElementById('questionDrillPanel');
    if (!panel) return;

    const section = makeElement('section', 'question-drill-history');
    section.id = 'questionDrillHistory';

    const heading = makeElement('h4', '', '本机训练记录');
    const note = makeElement(
      'p',
      'tip',
      '只保存在当前浏览器，不上传、不同步；删除后无法恢复。'
    );

    const list = makeElement('div', 'question-drill-history-list');
    list.id = 'questionDrillHistoryList';

    section.append(heading, note, list);
    panel.appendChild(section);

    renderSessionHistory();
  }

  function renderSessionHistory() {
    const list = document.getElementById('questionDrillHistoryList');
    if (!list) return;

    // 演示态不展示任何真实训练记录。
    if (isDemoMode()) {
      list.replaceChildren(
        makeElement('p', 'tip', '固定示例页不读取本机训练记录。')
      );
      return;
    }

    const sessions = readJson(HISTORY_KEY, []);
    list.replaceChildren();

    if (!Array.isArray(sessions) || sessions.length === 0) {
      list.appendChild(
        makeElement('p', 'tip', '完成专项练习后，记录会保存在此浏览器。')
      );
      return;
    }

    sessions
      .slice()
      .reverse()
      .forEach((session) => {
        if (!session || typeof session !== 'object') return;

        const item = makeElement('article', 'question-drill-history-item');
        const title = makeElement(
          'strong',
          '',
          (session.goal && session.goal.label) || '提问与追问训练'
        );

        const date = session.completed_at
          ? new Date(session.completed_at).toLocaleString()
          : '时间未记录';

        const meta = makeElement(
          'p',
          'tip',
          (session.topic || '未填写课题') + ' · ' + date
        );

        const quote = makeElement(
          'p',
          '',
          session.practice_quote || '未记录待练原句'
        );

        const actions = makeElement('div', 'question-drill-history-actions');

        const view = makeElement('button', 'ghost-btn sm', '查看摘要');
        view.type = 'button';
        view.addEventListener('click', () => renderSavedSession(session));

        const remove = makeElement('button', 'ghost-btn sm', '删除记录');
        remove.type = 'button';
        remove.addEventListener('click', () => {
          // 按 session_id 精确删除；没有 id 的旧记录按对象引用删除，避免误删全部。
          const remaining = readJson(HISTORY_KEY, []).filter((row) => {
            if (!row || typeof row !== 'object') return false;
            if (session.session_id) return row.session_id !== session.session_id;
            return row !== session;
          });

          try {
            localStorage.setItem(HISTORY_KEY, JSON.stringify(remaining));
            renderSessionHistory();
            setStatus('已从本机删除该条训练记录。');
          } catch (_) {
            setStatus('删除失败：浏览器未允许修改本机记录。');
          }
        });

        actions.append(view, remove);
        item.append(title, meta, quote, actions);
        list.appendChild(item);
      });
  }

  function renderSavedSession(session) {
    const report = document.getElementById('questionDrillReport');
    if (!report || !session) return;

    report.replaceChildren();
    report.append(
      makeElement('h4', '', '训练会话摘要'),
      makeElement(
        'p',
        'tip',
        '评价来源：本地文本规则（不调用模型，也不代表教学效果证据）。'
      ),
      makeElement(
        'p',
        '',
        '训练目标：' + ((session.goal && session.goal.label) || '未记录')
      ),
      makeElement('p', '', '课题：' + (session.topic || '未记录')),
      makeElement('p', '', '待练原句：' + (session.practice_quote || '未记录')),
      makeElement(
        'p',
        '',
        '模拟误区：' + (session.misconception_label || '未记录')
      )
    );

    const conversation = makeElement(
      'div',
      'question-drill-saved-conversation'
    );
    (session.messages || []).forEach((message) => {
      if (!message) return;
      conversation.appendChild(
        makeElement(
          'p',
          '',
          (message.role === 'teacher'
            ? '教师：'
            : message.role === 'student'
              ? '模拟学生：'
              : '提示：') + String(message.content || '')
        )
      );
    });
    report.appendChild(conversation);

    const evaluation = session.evaluation;
    if (evaluation && Array.isArray(evaluation.dimensions)) {
      evaluation.dimensions.forEach((dimension) => {
        const status = dimension && dimension.evidence_status;
        const block = makeElement('section', 'question-drill-dimension');
        block.append(
          makeElement('strong', '', dimension.key),
          makeElement(
            'span',
            '',
            status === 'not-observable' ? '不评分' : dimension.score + ' / 2'
          ),
          makeElement(
            'p',
            'tip',
            EVIDENCE_STATUS_LABEL[status] || '结果需核对'
          ),
          makeElement('p', '', dimension.feedback),
          makeElement(
            'blockquote',
            '',
            dimension.evidence_quote
              ? '教师原句：“' + dimension.evidence_quote + '”'
              : '没有可引用的教师原句'
          )
        );
        report.appendChild(block);
      });
    }

    report.appendChild(
      makeElement(
        'p',
        'tip',
        session.boundary_note ||
          '以上仅为文本和对话行为指标，不代表已经测得学生的真实理解。'
      )
    );

    if (report.scrollIntoView) {
      report.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  function makeElement(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function buildGoalControl() {
    if (document.getElementById('questionDrillGoal')) return;

    const field = makeElement('div', 'field jtq-drill-goal');
    const label = makeElement('label', '', '本次提问训练目标');
    label.htmlFor = 'questionDrillGoal';

    const select = document.createElement('select');
    select.id = 'questionDrillGoal';
    select.setAttribute('aria-describedby', 'questionDrillGoalHint');

    GOALS.forEach((goal) => {
      const option = document.createElement('option');
      option.value = goal.key;
      option.textContent = goal.label;
      select.appendChild(option);
    });

    const hint = makeElement(
      'span',
      'up-tip',
      '本轮只练“提问与追问”，不评价学生真实理解。'
    );
    hint.id = 'questionDrillGoalHint';

    field.append(label, select, hint);
    inputPanel.insertBefore(field, analyzeButton);
  }

  function buildPracticePanel() {
    if (document.getElementById('questionDrillPanel')) return;

    const panel = makeElement('section', 'question-drill-panel');
    panel.id = 'questionDrillPanel';
    panel.setAttribute('aria-labelledby', 'questionDrillHeading');

    const heading = makeElement('h3', 'sub', '提问与追问专项练习');
    heading.id = 'questionDrillHeading';

    const intro = makeElement(
      'p',
      'tip',
      '完成基线分析后，从一处原句开始练习。反馈由本地文本规则生成（不调用模型），只依据教师实际说出的文本，不代表教学效果。'
    );

    const quoteLabel = makeElement('label', '', '待练原句');
    quoteLabel.htmlFor = 'questionDrillQuote';

    const quote = document.createElement('textarea');
    quote.id = 'questionDrillQuote';
    quote.rows = 3;
    quote.maxLength = 500;
    quote.placeholder = '分析完成后可自动选取一处提问原句，也可以自行修改';

    const startButton = makeElement('button', 'primary', '开始专项练习');
    startButton.id = 'questionDrillStart';
    startButton.type = 'button';
    startButton.disabled = true;

    const status = makeElement('p', 'tip', '先完成一次非演示分析。');
    status.id = 'questionDrillStatus';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');

    const conversation = makeElement('div', 'question-drill-conversation');
    conversation.id = 'questionDrillConversation';
    conversation.setAttribute('aria-live', 'polite');

    const form = document.createElement('form');
    form.className = 'question-drill-form';
    form.id = 'questionDrillForm';
    form.hidden = true;

    const input = document.createElement('textarea');
    input.id = 'questionDrillTeacherInput';
    input.rows = 3;
    input.maxLength = 1000;
    input.placeholder = '输入你对模拟学生说的话';

    const send = makeElement('button', 'primary', '发送回应');
    send.type = 'submit';

    const finish = makeElement('button', 'ghost-btn', '结束并生成反馈');
    finish.id = 'questionDrillFinish';
    finish.type = 'button';
    finish.disabled = true;

    const roundInfo = makeElement('span', 'tip', '教师回应 0 / 3 轮');
    roundInfo.id = 'questionDrillRoundInfo';

    const controls = makeElement('div', 'question-drill-controls');
    controls.append(roundInfo, finish);
    form.append(input, send, controls);

    const report = makeElement('div', 'question-drill-report');
    report.id = 'questionDrillReport';

    panel.append(
      heading,
      intro,
      quoteLabel,
      quote,
      startButton,
      status,
      conversation,
      form,
      report
    );

    // 专项训练放在 AI 学生页，不替换普通学生聊天。
    const firstChild = chatPane.firstElementChild;
    chatPane.insertBefore(panel, firstChild);
  }

  function setStatus(message) {
    const status = document.getElementById('questionDrillStatus');
    if (status) status.textContent = message;
  }

  function getSelectedGoal() {
    const select = document.getElementById('questionDrillGoal');
    return (
      GOALS.find((goal) => goal.key === (select && select.value)) || GOALS[0]
    );
  }

  function findQuestionQuote(transcript) {
    const units =
      String(transcript || '').match(/[^。！？；!?;\n]+[。！？；!?;]?/g) || [];

    return (
      units
        .map((unit) => unit.trim())
        .find((unit) => /[?？]|(?:吗|么)[。！!；;…]*$/.test(unit)) || ''
    );
  }

  function startFromAnalysis(detail) {
    // 任何情况下都先清空活动会话，避免上一轮（或演示页）的残留泄漏。
    activeSession = null;

    const quote = document.getElementById('questionDrillQuote');
    const startButton = document.getElementById('questionDrillStart');

    // 演示态：绝不展示或读取真实训练草稿，直接清空面板并禁用开始。
    if (isDemoMode() || (detail && detail.isDemo)) {
      if (quote) quote.value = findQuestionQuote(detail && detail.transcript);
      if (startButton) startButton.disabled = true;

      const conversation = document.getElementById('questionDrillConversation');
      if (conversation) conversation.replaceChildren();

      const form = document.getElementById('questionDrillForm');
      if (form) form.hidden = true;

      const report = document.getElementById('questionDrillReport');
      if (report) report.replaceChildren();

      const roundInfo = document.getElementById('questionDrillRoundInfo');
      if (roundInfo) roundInfo.textContent = '教师回应 0 / 3 轮';

      setStatus('固定示例不进入真实训练记录。请退出示例页后再开始训练。');
      return;
    }

    const report = detail && detail.report;
    const goal = getSelectedGoal();
    const selectedQuote = findQuestionQuote(detail.transcript);

    if (quote) quote.value = selectedQuote;

    activeSession = {
      schema_version: 1,
      session_id: createId(),
      created_at: new Date().toISOString(),
      goal: {
        key: goal.key,
        label: goal.label,
      },
      topic: String(detail.subject || '').slice(0, 120),
      grade: String(detail.grade || '').slice(0, 120),
      practice_quote: selectedQuote,
      misconception_key: goal.misconceptionKey,
      misconception_label: goal.misconception,
      baseline: {
        engine: (report && report.engine) || 'unknown',
        analysis_contract_version:
          (report && report.analysis_contract_version) || 'unversioned',
        asked:
          report && report.questions && report.questions.asked != null
            ? report.questions.asked
            : null,
        transcript_source: 'text',
      },
      messages: [],
      teacher_turns: 0,
      status: 'ready',
      evaluation: null,
      is_demo: false,
      boundary_note:
        '以上仅为文本和对话行为指标，不代表已经测得学生的真实理解。',
    };

    if (startButton) startButton.disabled = !selectedQuote;
    setStatus(
      selectedQuote
        ? '已定位一处提问原句。可修改原句后开始专项练习。'
        : '讲稿中未自动找到明确问句。请填写一段待练原句后开始。'
    );
  }

  function appendMessage(role, content) {
    const conversation = document.getElementById('questionDrillConversation');
    if (!conversation) return null;

    const row = makeElement('div', 'question-drill-message ' + role, '');
    const label = makeElement(
      'strong',
      '',
      role === 'teacher' ? '教师回应' : role === 'system' ? '提示' : '模拟学生'
    );
    const text = makeElement('p', '', content);
    row.append(label, text);
    conversation.appendChild(row);
    conversation.scrollTop = conversation.scrollHeight;

    // 模拟学生开口 = 路演高光时刻。只抛事件，特效实现交给 fx.js（未加载时静默跳过）
    if (role !== 'teacher' && role !== 'system') {
      try {
        document.dispatchEvent(new CustomEvent('jtq:student-strike', { detail: { el: row } }));
      } catch (e) { /* 老浏览器不支持 CustomEvent 时忽略，不影响对话 */ }
    }
    return row;
  }

  /* 等待态：模拟学生思考时占位。question-drill.js 原来只有一句
     「模拟学生正在回应…」的状态文字，对话区本身毫无反馈 —— 路演时看不出
     系统在干活。这里补一个三点跳动的占位行，响应回来即消失。
     msg.js 会识别 .msg-typing 并跳过入场动画（占位符自己会跳，不用再弹）。 */
  let typingNode = null;

  function showTyping() {
    hideTyping();
    const conversation = document.getElementById('questionDrillConversation');
    if (!conversation) return;
    const row = makeElement('div', 'question-drill-message student question-drill-typing');
    const dots = makeElement('span', 'msg-typing');
    dots.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 3; i++) dots.appendChild(document.createElement('i'));
    row.appendChild(dots);
    row.setAttribute('aria-label', '模拟学生正在回应');
    conversation.appendChild(row);
    conversation.scrollTop = conversation.scrollHeight;
    typingNode = row;
  }

  function hideTyping() {
    if (typingNode && typingNode.remove) typingNode.remove();
    typingNode = null;
  }

  function saveMessage(role, content) {    activeSession.messages.push({
      role,
      content: String(content || '').slice(0, 1000),
      at: new Date().toISOString(),
    });
    saveDraft();
  }

  function updateRoundInfo() {
    const roundInfo = document.getElementById('questionDrillRoundInfo');
    if (roundInfo) {
      roundInfo.textContent =
        '教师回应 ' + activeSession.teacher_turns + ' / 3 轮';
    }
    const finish = document.getElementById('questionDrillFinish');
    if (finish) finish.disabled = activeSession.teacher_turns < 2;
  }

  async function startPractice() {
    if (!activeSession || isDemoSession(activeSession)) return;

    const quote = document.getElementById('questionDrillQuote').value.trim();
    if (quote.length < 3) {
      setStatus('请填写至少 3 个字的待练原句。');
      return;
    }

    activeSession.practice_quote = quote;
    activeSession.status = 'in-progress';

    document.getElementById('questionDrillConversation').replaceChildren();
    document.getElementById('questionDrillReport').replaceChildren();
    document.getElementById('questionDrillForm').hidden = false;
    document.getElementById('questionDrillTeacherInput').focus();
    document.getElementById('questionDrillFinish').disabled = true;

    saveDraft();
    setStatus('练习开始。请围绕待练原句提出问题或任务。');
  }

  async function submitTeacherTurn(event) {
    event.preventDefault();

    if (
      !activeSession ||
      requestPending ||
      activeSession.status !== 'in-progress'
    ) {
      return;
    }

    const input = document.getElementById('questionDrillTeacherInput');
    const text = input.value.trim();
    if (!text) return;

    if (activeSession.teacher_turns >= 3) {
      setStatus('已达到 3 轮上限，请结束训练并查看反馈。');
      return;
    }

    input.value = '';
    activeSession.teacher_turns += 1;
    saveMessage('teacher', text);
    const teacherNode = appendMessage('teacher', text);
    updateRoundInfo();

    if (activeSession.teacher_turns >= 3) {
      setStatus('已完成 3 轮。可以结束训练并生成反馈。');
    } else {
      setStatus('模拟学生正在回应…');
    }

    requestPending = true;

    const sendButton = document.querySelector(
      '#questionDrillForm button[type="submit"]'
    );
    if (sendButton) sendButton.disabled = true;

    showTyping();

    try {
      let data;

      if (isDemoMode()) {
        // 演示态不调用真实接口，也不写记录；固定一条模拟学生回应。
        data = {
          reply: '我还是不太确定。你能根据我刚才的想法再问我一步吗？',
          engine: 'offline-demo',
        };
      } else {
        data = await post('/api/student/chat', {
          messages: activeSession.messages.map(({ role, content }) => ({
            role,
            content,
          })),
          persona: 'geek',
          customPersona:
            '你是提问专项训练中的模拟学生。固定误区：' +
            activeSession.misconception_label +
            '。请根据老师刚才的话，用学生口语表达不确定、错误理由或不完整想法。' +
            '保留固定误区，不要突然宣称完全理解；不嘲讽、不羞辱、不替老师给答案。' +
            '这只是明确标注的模拟角色，不是真实学生。只输出学生说的话。',
          topic: activeSession.topic,
          transcript: activeSession.practice_quote,
        });
      }

      const reply = String((data && data.reply) || '').trim();
      if (!reply) throw new Error('模拟学生未返回有效回应');

      saveMessage('student', reply);
      appendMessage('student', reply);
      setStatus(
        '模拟学生回应已记录。此回应是训练情境，不是对真实学生理解的测量。'
      );
    } catch (error) {
      // 回滚本轮：只撤销「本轮自己刚写入的那条教师发言」，不动已有历史。
      activeSession.teacher_turns = Math.max(
        0,
        activeSession.teacher_turns - 1
      );

      const lastMessage =
        activeSession.messages[activeSession.messages.length - 1];
      if (
        lastMessage &&
        lastMessage.role === 'teacher' &&
        lastMessage.content === text.slice(0, 1000)
      ) {
        activeSession.messages.pop();
      }

      if (teacherNode && teacherNode.remove) teacherNode.remove();
      updateRoundInfo();

      // 文本放回输入框，可直接修改后重试。
      input.value = text;
      if (input.focus) input.focus();

      appendMessage('system', '学生回应失败：' + (error.message || '请重试'));
      saveDraft();
      setStatus('学生回应失败。你的文本已放回输入框，修改后可以重试。');
    } finally {
      hideTyping();
      requestPending = false;
      if (sendButton) sendButton.disabled = false;
      saveDraft();
    }
  }

  /* ---------------- 本地三维度量规（启发式，不是模型评分） ----------------
   * 三条量规只依据「文本里能不能看到线索」：
   *  - observed      找到可引用的语言线索
   *  - partial       有间接线索，但规则无法确认语义
   *  - not-observable 本次对话没有学生回应，该项根本无法观察（不评 0 分）
   *  - not-found     条件满足但规则没找到线索（可能漏判同义表达）
   * 注意：未识别 ≠ 没发生，也不推断真实学生理解或学习效果。
   *
   * 判定逻辑已抽到 question-drill-rules.js（纯函数，可单测）：
   *  - 那边不碰 DOM / localStorage，只把 session 判成 evaluation；
   *  - 这里只负责取模块，取不到就返回 null 让 finishPractice 明确告知，
   *    绝不自己再算一套（两套规则会漂移）。
   * 返回结构（status / evaluation_source / rubric_version / dimensions /
   * summary / boundary_note）由规则模块保证，与历史版本逐字一致。 */
  function evaluateLocally(session) {
    const rules = window.jtqQuestionDrillRules;
    if (!rules || typeof rules.evaluateLocalRules !== 'function') return null;
    return rules.evaluateLocalRules(session);
  }

  function finishPractice() {
    if (!activeSession || activeSession.teacher_turns < 2 || requestPending)
      return;

    const evaluation = evaluateLocally(activeSession);

    /* 规则文件没加载成功（缓存错位 / 脚本被拦）时，不猜分数、不白屏，
       会话保持未完成，明确告诉用户刷新重试。 */
    if (!evaluation) {
      appendMessage(
        'system',
        '本地文本规则未能加载，本次未生成评价（不猜测分数）。'
      );
      setStatus('本地文本规则未能加载，暂不生成评价。请刷新页面后重试。');
      return;
    }

    activeSession.evaluation = evaluation;
    activeSession.status = 'completed';
    activeSession.completed_at = new Date().toISOString();

    const saved = saveCompletedSession(activeSession);
    renderEvaluation(activeSession.evaluation);
    renderSessionHistory();

    setStatus(
      saved
        ? '训练记录已保存在本机（仅此浏览器）。当前评价来源：本地文本规则。'
        : '训练已完成，但浏览器未能保存记录。请先导出或复制会话摘要。'
    );
  }

  /* 证据状态的中文口径。旧会话没有 evidence_status 时回落到「结果需核对」。 */

  function renderEvaluation(evaluation) {
    const box = document.getElementById('questionDrillReport');
    if (!box) return;

    box.replaceChildren();

    box.append(
      makeElement('h4', '', '专项反馈'),
      makeElement(
        'p',
        'tip',
        '评价来源：本地文本规则（不调用模型，也不代表教学效果证据）。'
      )
    );

    const dimensions = Array.isArray(evaluation && evaluation.dimensions)
      ? evaluation.dimensions
      : [];

    dimensions.forEach((dimension) => {
      const status = dimension && dimension.evidence_status;
      const item = makeElement('section', 'question-drill-dimension');

      item.append(
        makeElement('strong', '', dimension.key),
        // 无法观察的项不评 0 分，直接标「不评分」。
        makeElement('span', '', status === 'not-observable'
          ? '不评分'
          : dimension.score + ' / 2'),
        makeElement(
          'p',
          'tip',
          EVIDENCE_STATUS_LABEL[status] || '结果需核对'
        ),
        makeElement('p', '', dimension.feedback),
        makeElement(
          'blockquote',
          '',
          dimension.evidence_quote
            ? '教师原句：“' + dimension.evidence_quote + '”'
            : '没有可引用的教师原句'
        )
      );
      box.appendChild(item);
    });

    box.append(
      makeElement(
        'p',
        'tip',
        (evaluation && evaluation.summary) || '结果需核对。'
      ),
      makeElement(
        'p',
        'tip',
        (evaluation && evaluation.boundary_note) ||
          '以上仅为文本和对话行为指标，不代表已经测得学生的真实理解。'
      )
    );
  }

  buildGoalControl();
  buildPracticePanel();
  buildSessionHistory();

  document.addEventListener('jtq:analysis-complete', (event) => {
    const detail = (event && event.detail) || {};
    lastAnalysisIsDemo = Boolean(detail.isDemo);
    startFromAnalysis(detail);
  });

  document
    .getElementById('questionDrillStart')
    .addEventListener('click', startPractice);

  document
    .getElementById('questionDrillForm')
    .addEventListener('submit', submitTeacherTurn);

  document
    .getElementById('questionDrillFinish')
    .addEventListener('click', finishPractice);

  // 恢复未完成的本地会话；演示态（含任一演示信号）不恢复、不读取真实草稿。
  if (!isDemoMode()) {
    const draft = readJson(DRAFT_KEY, null);
    if (draft && draft.status === 'in-progress') {
      activeSession = draft;
      document.getElementById('questionDrillQuote').value =
        draft.practice_quote || '';
      document.getElementById('questionDrillForm').hidden = false;
      document.getElementById('questionDrillStart').disabled = false;
      (draft.messages || []).forEach((message) =>
        appendMessage(message.role, message.content)
      );
      updateRoundInfo();
      setStatus('已恢复未完成的本地训练会话。');
    }
  }
})();
