// 临时验证脚本：跑一遍「一键自动演示」，记录每步的字幕文本、停留时长与截图。
// 用法：node scripts/_verify-demo.js <url> <outDir>
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const url = process.argv[2] || 'http://127.0.0.1:3000/?jtq-demo=1';
const outDir = process.argv[3] || path.join(__dirname, '..', '..', '视觉验证截图');

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
  fs.mkdirSync(outDir, { recursive: true });
  const port = 9800 + Math.floor(Math.random() * 180);
  const userDir = path.join(process.env.TEMP || '.', 'edge-demo-' + port);
  const child = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars',
    '--remote-debugging-port=' + port,
    '--user-data-dir=' + userDir,
    '--window-size=1400,900',
    url,
  ], { stdio: 'ignore' });

  let wsUrl = null;
  for (let i = 0; i < 60 && !wsUrl; i++) {
    await sleep(250);
    try {
      const list = await getJSON(port, '/json/list');
      const page = list.find((t) => t.type === 'page' && t.url.indexOf('http') === 0 || t.url.indexOf('file') === 0);
      if (page) wsUrl = page.webSocketDebuggerUrl;
    } catch (e) { /* 浏览器还没起来 */ }
  }
  if (!wsUrl) { console.log('NO TARGET'); child.kill(); process.exit(1); }

  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error('ws error'));
  });

  let id = 0;
  const pending = new Map();
  const logs = [];

  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
      return;
    }
    const params = msg.params || {};
    if (msg.method === 'Runtime.consoleAPICalled') {
      logs.push('[console.' + params.type + '] ' + params.args
        .map((a) => (a.value !== undefined ? String(a.value) : (a.description || a.type))).join(' '));
    } else if (msg.method === 'Runtime.exceptionThrown') {
      const d = params.exceptionDetails || {};
      const desc = d.exception && d.exception.description ? d.exception.description : d.text;
      logs.push('[EXCEPTION] ' + desc);
    }
  };

  const send = (method, params) => new Promise((resolve) => {
    const mid = ++id;
    pending.set(mid, resolve);
    ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
  });

  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    return r.result && r.result.result ? r.result.result.value : undefined;
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await sleep(3200);

  // 可选：指定主题后重载，用来对比浅色 / 深色下的可读性
  const theme = process.argv[4];
  if (theme === 'light' || theme === 'dark') {
    await evalJs(`try{localStorage.setItem('jiangtai_theme','${theme}')}catch(e){}; 'set'`);
    send('Page.reload', {});
    await sleep(4000);
  }

  const mode = await evalJs('window.JTQ_DEMO_PAGE === true ? "demo" : "normal"');
  console.log('页面模式：' + mode + ' / 主题：' + (theme || '跟随系统'));

  const started = Date.now();
  await evalJs('document.getElementById("autoDemoBtn").click(); "ok"');

  const timeline = [];
  let lastStep = '';
  let shotIndex = 0;
  let pausedOnce = false;
  let midAt = 0;
  let midShot = false;

  for (let i = 0; i < 90; i++) {
    await sleep(1200);
    const snap = await evalJs(`(function(){
      const hud = document.getElementById('demoHud');
      const bar = document.getElementById('dhBar');
      const dr = document.getElementById('drillResult');
      const gc = document.getElementById('growthCurve');
      const active = document.querySelector('.tabs .tab.active');
      return JSON.stringify({
        hudHidden: hud ? hud.hidden : null,
        paused: hud ? hud.classList.contains('is-paused') : null,
        step: (document.getElementById('dhStep')||{}).textContent,
        title: (document.getElementById('dhTitle')||{}).textContent,
        tip: (document.getElementById('dhTip')||{}).textContent,
        bar: bar ? bar.style.width : '',
        tab: active ? active.dataset.tab : '',
        scroll: Math.round(window.scrollY),
        drillShown: dr ? !dr.hidden : null,
        drillScore: (document.getElementById('drillScore')||{}).textContent,
        drillText: ((document.getElementById('drillTranscript')||{}).value||'').length,
        chatMsgs: document.querySelectorAll('#chatLog .msg').length,
        classMsgs: document.querySelectorAll('#classLog .msg').length,
        growthNodes: gc ? gc.innerHTML.length : 0,
        running: document.getElementById('autoDemoBtn').disabled
      });
    })()`).catch(() => null);

    let s = null;
    try { s = JSON.parse(snap); } catch (e) { s = null; }
    if (!s) continue;

    const t = ((Date.now() - started) / 1000).toFixed(1);
    const key = s.step + '|' + s.title;
    if (key !== lastStep) {
      lastStep = key;
      midShot = false;
      midAt = Date.now() + 4500;
      timeline.push(`${t}s\t${s.step}\t${s.title}\t[tab]${s.tab}\tscroll=${s.scroll}`);
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      if (shot.result && shot.result.data) {
        const f = path.join(outDir, 'demo-' + String(++shotIndex).padStart(2, '0') + '-start.png');
        fs.writeFileSync(f, Buffer.from(shot.result.data, 'base64'));
      }
    } else if (!midShot && Date.now() >= midAt) {
      // 步骤中段再拍一张：这一刻内容应该已经渲染完（分数、学生发言、曲线）
      midShot = true;
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      if (shot.result && shot.result.data) {
        const f = path.join(outDir, 'demo-' + String(shotIndex).padStart(2, '0') + '-mid.png');
        fs.writeFileSync(f, Buffer.from(shot.result.data, 'base64'));
      }
      timeline.push(
        `        ↳ 中段状态：drill分数=${s.drillScore} 结果可见=${s.drillShown} 练习字数=${s.drillText} ` +
        `单人对话=${s.chatMsgs} 课堂对话=${s.classMsgs} 曲线长度=${s.growthNodes} 滚动=${s.scroll}`
      );
    }

    // 第 4 步测一次暂停：进度条应该停住
    if (!pausedOnce && s.step && s.step.indexOf('4 /') === 0) {
      pausedOnce = true;
      await evalJs('document.getElementById("dhPause").click(); "ok"');
      const w1 = await evalJs('document.getElementById("dhBar").style.width');
      await sleep(1600);
      const w2 = await evalJs('document.getElementById("dhBar").style.width');
      timeline.push(`        ↳ 暂停测试：${w1} → ${w2} ${w1 === w2 ? '✓ 已停住' : '✗ 仍在走'}`);
      await evalJs('document.getElementById("dhPause").click(); "ok"');
    }

    if (!s.running && i > 6) {
      timeline.push(`结束于 ${t}s（hudHidden=${s.hudHidden}）`);
      break;
    }
  }

  const total = ((Date.now() - started) / 1000).toFixed(1);
  console.log('\n--- 时间线 ---');
  console.log(timeline.join('\n'));
  console.log('\n总耗时：' + total + 's');
  console.log('\n--- console ---');
  console.log(logs.join('\n') || '(无输出)');

  try { ws.close(); } catch (e) { /* ignore */ }
  child.kill();
  process.exit(0);
})().catch((e) => { console.log('ERR ' + e.message); process.exit(1); });
