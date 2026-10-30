// 单人拆台场景验证：切到「AI 学生拆台」→ 点单人拆台 → 截画布 → 换人设 → 再截
// 用法：node scripts/verify-solo.js [baseUrl]
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = process.argv[2] || 'http://127.0.0.1:3000';
const OUT = path.join(__dirname, '..', '..', '视觉验证截图');

function getJSON(port, p) {
  return new Promise((res, rej) => {
    const r = http.get({ host: '127.0.0.1', port, path: p }, (x) => {
      let d = '';
      x.on('data', (c) => { d += c; });
      x.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
    });
    r.on('error', rej);
    r.setTimeout(2500, () => rej(new Error('timeout')));
  });
}

(async () => {
  const port = 9500 + Math.floor(Math.random() * 400);
  const child = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars',
    '--remote-debugging-port=' + port,
    '--user-data-dir=' + path.join(process.env.TEMP || '.', 'edge-solo-' + port),
    '--window-size=1160,1400',
    BASE + '/index.html?jtq-demo=1',
  ], { stdio: 'ignore' });

  let wsUrl = null;
  for (let i = 0; i < 60 && !wsUrl; i++) {
    await new Promise((r) => setTimeout(r, 250));
    try {
      const l = await getJSON(port, '/json/list');
      const pg = l.find((t) => t.type === 'page' && t.url.indexOf('http') === 0);
      if (pg) wsUrl = pg.webSocketDebuggerUrl;
    } catch (e) { /* 等浏览器 */ }
  }
  if (!wsUrl) { console.log('NO TARGET'); child.kill(); process.exit(1); }

  const sock = new WebSocket(wsUrl);
  await new Promise((res, rej) => { sock.onopen = res; sock.onerror = () => rej(new Error('ws')); });
  let id = 0; const pend = new Map(); const logs = [];
  sock.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails || {};
      logs.push('[EXC] ' + (d.exception && d.exception.description || d.text));
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      logs.push('[err] ' + m.params.args.map((a) => a.value || a.description || '').join(' '));
    }
  };
  const send = (method, params) => new Promise((res) => {
    const mid = ++id; pend.set(mid, res);
    sock.send(JSON.stringify({ id: mid, method, params: params || {} }));
  });
  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    return r.result && r.result.result && r.result.result.value;
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  await send('Runtime.enable');
  await send('Page.enable');
  await sleep(2500);

  // 等演示真正跑出结果（#resultBody 解除隐藏），否则「复盘与演练」整块不可见，
  // 单人画布的 getBoundingClientRect 是 0，drawSoloScene 会直接早退。
  for (let i = 0; i < 120; i++) {
    const ready = await evalJs(`(() => {
      const b = document.getElementById('resultBody');
      return !!(b && !b.hidden);
    })()`);
    if (ready) break;
    await sleep(250);
  }
  // 演示驱动随后会自动滚动并切 Tab，按「暂停」冻住再截图，否则截图永远拍不到这块
  await evalJs(`(() => {
    const p = document.getElementById('dhPause');
    if (p) p.click();
    return true;
  })()`);
  await sleep(400);

  // 切到「复盘与演练 / AI 学生拆台」Tab，再确认单人模式
  await evalJs(`(() => {
    const tab = document.querySelector('.tabs .tab[data-tab="chat"]');
    if (tab) tab.click();
    const solo = document.querySelector('#chatModeBar .msw[data-mode="solo"]');
    if (solo) solo.click();
    return true;
  })()`);
  await sleep(1500);

  // 滚到单人场景，让它进入视口
  await evalJs(`(() => {
    const c = document.getElementById('soloSceneCanvas');
    if (c) c.scrollIntoView({ block: 'center' });
    return true;
  })()`);
  await sleep(800);

  const ensureChat = async () => {
    for (let i = 0; i < 20; i++) {
      await evalJs(`(() => {
        const tab = document.querySelector('.tabs .tab[data-tab="chat"]');
        if (tab && !tab.classList.contains('active')) tab.click();
        const solo = document.querySelector('#chatModeBar .msw[data-mode="solo"]');
        if (solo && !solo.classList.contains('active')) solo.click();
        const c = document.getElementById('soloSceneCanvas');
        if (c) c.scrollIntoView({ block: 'center' });
        return true;
      })()`);
      await sleep(120);
      const w = await evalJs(`(() => {
        const c = document.getElementById('soloSceneCanvas');
        return c ? Math.round(c.getBoundingClientRect().width) : 0;
      })()`);
      if (w > 0) return true;
    }
    return false;
  };

  const shot = async (name, sel) => {
    await ensureChat();
    const box = await evalJs(`(() => {
      const el = document.querySelector(${JSON.stringify(sel)});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x + window.scrollX, y: r.y + window.scrollY, w: r.width, h: r.height };
    })()`);
    if (!box) { console.log('MISS ' + sel); return; }
    console.log('box', JSON.stringify(box));
    const r = await send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip: { x: box.x, y: box.y, width: box.w, height: box.h, scale: 1 },
    });
    if (!r.result) { console.log('capture-fail', JSON.stringify(r)); return; }
    fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.result.data, 'base64'));
    console.log('shot ' + name + ' ' + Math.round(box.w) + 'x' + Math.round(box.h));
  };

  // 画布截图走 toDataURL：Page.captureScreenshot 的 clip 是文档坐标，
  // 元素滚出视口后截出来是空白（踩过）。卡片用视口截图。
  await ensureChat();
  const dataUrl = await evalJs(`(() => {
    const c = document.getElementById('soloSceneCanvas');
    return c ? c.toDataURL('image/png') : '';
  })()`);
  if (dataUrl && dataUrl.indexOf('data:image') === 0) {
    fs.writeFileSync(path.join(OUT, 'solo-scene.png'), Buffer.from(dataUrl.split(',')[1], 'base64'));
    console.log('shot solo-scene (toDataURL)');
  } else {
    console.log('shot solo-scene FAILED');
  }
  const vp = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, 'solo-card.png'), Buffer.from(vp.result.data, 'base64'));
  console.log('shot solo-card (viewport)');

  // 画布像素：确认真的画了东西（不是空白）
  const canvasInfo = await evalJs(`(() => {
    const c = document.getElementById('soloSceneCanvas');
    if (!c) return { ok: false };
    const ctx = c.getContext('2d');
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let painted = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 8) painted++;
    return { ok: true, w: c.width, h: c.height, painted: painted, ratio: painted / (c.width * c.height) };
  })()`);
  console.log('canvas', JSON.stringify(canvasInfo));

  const model = await evalJs(`(() => {
    const card = document.querySelector('#soloStudents .cs-card');
    if (!card) return null;
    return {
      name: (card.querySelector('.cs-nm') || {}).textContent,
      avatar: !!card.querySelector('.cs-av-img'),
      bars: !!card.querySelector('.cs-bars'),
      aria: card.getAttribute('aria-label'),
    };
  })()`);
  console.log('model', JSON.stringify(model));

  // 全页截图（单人模式）
  const full = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, 'solo-mode-chat.png'), Buffer.from(full.result.data, 'base64'));

  // 换人设 → 场景与卡片应同步换人
  await evalJs(`document.querySelector('#personaBar .persona[data-p="geek"]').click()`);
  await sleep(900);
  const model2 = await evalJs(`(() => {
    const card = document.querySelector('#soloStudents .cs-card');
    return card ? { name: (card.querySelector('.cs-nm') || {}).textContent, av: !!(card.querySelector('.cs-av-img')) } : null;
  })()`);
  console.log('after-switch', JSON.stringify(model2));
  const full2 = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, 'solo-mode-geek.png'), Buffer.from(full2.result.data, 'base64'));

  // 真实走一轮「让学生提问」：验状态机（举手→张嘴→闭嘴）、气泡头像、难度标签
  await evalJs(`(() => {
    const b = document.getElementById('askBtn');
    if (b) b.click();
    return true;
  })()`);
  await sleep(300);
  const rais = await evalJs(`(() => {
    const c = document.querySelector('#soloStudents .cs-card');
    return c ? { raise: !!c.querySelector('.cs-raise'), speaking: c.classList.contains('speaking') } : null;
  })()`);
  console.log('state-300ms', JSON.stringify(rais));
  await sleep(900);
  const speak = await evalJs(`(() => {
    const c = document.querySelector('#soloStudents .cs-card');
    return c ? { raise: !!c.querySelector('.cs-raise'), speaking: c.classList.contains('speaking') } : null;
  })()`);
  console.log('state-1.2s', JSON.stringify(speak));
  await sleep(7000);
  const done = await evalJs(`(() => {
    const c = document.querySelector('#soloStudents .cs-card');
    const last = document.querySelectorAll('#chatLog .msg');
    const el = last[last.length - 1];
    return {
      card: c ? { raise: !!c.querySelector('.cs-raise'), speaking: c.classList.contains('speaking'), diff: (c.querySelector('.difficulty-tag') || {}).textContent || '' } : null,
      bubbleAvatar: !!(el && el.querySelector('.av-stu img')),
      bubbleText: el ? (el.textContent || '').slice(0, 60) : '',
    };
  })()`);
  console.log('after-reply', JSON.stringify(done));
  await evalJs(`(() => {
    const c = document.querySelector('#soloStudents');
    if (c) c.scrollIntoView({ block: 'center' });
    return true;
  })()`);
  await sleep(400);
  const vp2 = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, 'solo-after-ask.png'), Buffer.from(vp2.result.data, 'base64'));

  console.log('console/errors:', logs.length ? logs.join(' | ') : 'none');
  sock.close();
  child.kill();
})();
