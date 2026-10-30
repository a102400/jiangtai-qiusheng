// 点名功能端到端验证（两段）
//   段 1：真后端 + 真模型 —— 点卡片，验证「卡片可点 → 请求 → 第一人称回应 → 状态/压力更新」
//   段 2：?jtq-demo=1 演示页 —— 点画布上的学生，验证「画布命中 → 点名 → 离线兜底话术」
// 用法：node scripts/e2e-callon.js [baseUrl]
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const ARGS = process.argv.slice(2).filter((a) => a.indexOf("--") !== 0);
const FLAGS = process.argv.slice(2).filter((a) => a.indexOf("--") === 0);
const STAGE2_ONLY = FLAGS.indexOf("--stage2") !== -1;
const BASE = ARGS[0] || 'http://127.0.0.1:3000';

function getJSON(port, p) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: p }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.setTimeout(2500, () => reject(new Error('timeout')));
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const port = 9900 + Math.floor(Math.random() * 400);
  const userDir = path.join(process.env.TEMP || '.', 'edge-callon-' + port);
  const child = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars',
    '--remote-debugging-port=' + port,
    '--user-data-dir=' + userDir,
    '--window-size=1280,1000',
    BASE + '/?v=e2e-callon',
  ], { stdio: 'ignore' });

  let wsUrl = null;
  for (let i = 0; i < 60 && !wsUrl; i++) {
    await sleep(250);
    try {
      const list = await getJSON(port, '/json/list');
      const page = list.find((t) => t.type === 'page' && t.url.indexOf('http') === 0);
      if (page) wsUrl = page.webSocketDebuggerUrl;
    } catch (e) { /* 还没起来 */ }
  }
  if (!wsUrl) { console.log(JSON.stringify({ error: 'NO_TARGET' })); child.kill(); process.exit(1); }

  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws error')); });

  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  };
  function send(method, params) {
    return new Promise((resolve) => {
      const i = ++id;
      pending.set(i, resolve);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  }
  async function evaluate(expr) {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result && r.result.exceptionDetails) return { __error: r.result.exceptionDetails.text };
    return r.result && r.result.result ? r.result.result.value : null;
  }

  await send('Runtime.enable');
  await send('Page.enable');

  /* ---------------- 段 1：真后端，点卡片 ---------------- */
  let before = null, after = null;
  if (!STAGE2_ONLY) {
  await sleep(2500);
  await evaluate("document.querySelector('.tab[data-tab=\"chat\"]').click()");
  await sleep(400);
  await evaluate("document.querySelector('#chatModeBar .msw[data-mode=\"class\"]').click()");
  await sleep(600);

  before = await evaluate(`(() => {
    const card = document.querySelector('.cs-card[data-k="drift"]');
    return {
      cardExists: !!card,
      role: card && card.getAttribute('role'),
      tabindex: card && card.getAttribute('tabindex'),
      aria: card && card.getAttribute('aria-label'),
      pressure: document.getElementById('pressureNum').textContent,
      bubbles: document.querySelectorAll('#classLog .msg.stu').length,
      resultBodyDisplay: getComputedStyle(document.getElementById('resultBody')).display,
    };
  })()`);

  await evaluate(`(() => {
    const card = document.querySelector('.cs-card[data-k="drift"]');
    card.dispatchEvent(new PointerEvent('click', { bubbles: true, cancelable: true }));
    return true;
  })()`);

  for (let i = 0; i < 40; i++) {
    await sleep(800);
    after = await evaluate(`(() => {
      const card = document.querySelector('.cs-card[data-k="drift"]');
      const b = document.querySelectorAll('#classLog .msg.stu');
      const last = b.length ? b[b.length - 1] : null;
      return {
        bubbles: b.length,
        lastBubble: last ? last.textContent.trim().slice(0, 100) : '',
        speakingNow: card.classList.contains('speaking'),
        attention: card.querySelector('.cs-bar b') ? card.querySelector('.cs-bar b').textContent : '',
        pressure: document.getElementById('pressureNum').textContent,
        err: (document.getElementById('err') || {}).textContent || '',
      };
    })()`);
    if (after && after.bubbles > before.bubbles && after.speakingNow === false) break;
  }

  } // end stage1

  /* ---------------- 段 2：演示页，点画布 ---------------- */
  await send('Page.navigate', { url: BASE + '/?jtq-demo=1&v=e2e-canvas' });
  await sleep(3000);
  await evaluate("document.querySelector('.tab[data-tab=\"chat\"]').click()");
  await sleep(400);
  await evaluate("document.querySelector('#chatModeBar .msw[data-mode=\"class\"]').click()");
  // 演示页不会自动展开结果区（要「提交讲稿」才有），这里强制显示只为测几何与接线
  await evaluate(`(() => {
    document.getElementById('resultBody').style.display = 'block';
    document.getElementById('trainingResults').style.opacity = '1';
    renderClassStudents();
    drawClassScene();
    const c0 = document.getElementById("classSceneCanvas").getBoundingClientRect();
    window.__probe = { href: location.href, demo: String(window.JTQ_DEMO_PAGE), rbHidden: document.getElementById("resultBody").hidden, rbDisplay: getComputedStyle(document.getElementById("resultBody")).display, rectNow: { w: Math.round(c0.width), h: Math.round(c0.height) } };
    return true;
  })()`);
  await sleep(500);

  const geom = await evaluate(`(() => {
    const c = document.getElementById('classSceneCanvas');
    const r = c.getBoundingClientRect();
    return {
      canvasRect: { w: Math.round(r.width), h: Math.round(r.height), left: Math.round(r.left), top: Math.round(r.top) },
      probe: window.__probe || null,
      rbNow: { hidden: document.getElementById("resultBody").hidden, display: getComputedStyle(document.getElementById("resultBody")).display },
      slots: lastClassSlots.map((s) => ({ key: s.key, cx: Math.round(s.cx), cy: Math.round(s.cy), w: Math.round(s.w) })),
      gapHit: (() => {
        if (lastClassSlots.length < 2) return 'need-2';
        const mid = (lastClassSlots[0].right + lastClassSlots[1].left) / 2;
        const s = sceneHitTest(lastClassSlots, mid, lastClassSlots[0].cy, 0);
        return s ? s.key : null;
      })(),
    };
  })()`);

  const canvasClick = await evaluate(`(() => {
    const c = document.getElementById('classSceneCanvas');
    const r = c.getBoundingClientRect();
    const mid = lastClassSlots[Math.floor(lastClassSlots.length / 2)];
    if (!mid) return { ok: false };
    const x = r.left + mid.cx;
    const y = r.top + mid.cy;
    const before = document.querySelectorAll('#classLog .msg.stu').length;
    c.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
    return { ok: true, targetKey: mid.key, x: Math.round(x), y: Math.round(y), before };
  })()`);

  let canvasAfter = null;
  for (let i = 0; i < 12; i++) {
    await sleep(600);
    canvasAfter = await evaluate(`(() => {
      const b = document.querySelectorAll('#classLog .msg.stu');
      const last = b.length ? b[b.length - 1] : null;
      return { bubbles: b.length, lastBubble: last ? last.textContent.trim().slice(0, 100) : '' };
    })()`);
    if (canvasAfter && canvasClick && canvasAfter.bubbles > canvasClick.before) break;
  }

  console.log(JSON.stringify({ stage1: { before, after }, stage2: { geom, canvasClick, canvasAfter } }, null, 1));
  child.kill();
  process.exit(0);
})().catch((e) => { console.log(JSON.stringify({ error: e.message })); process.exit(1); });
