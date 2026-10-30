// 无头 Edge 抓取页面控制台错误 + 截图（用 Node 22 内置 WebSocket，无第三方依赖）
// 用法：node scripts/headless-check.js <url> <outPng> [waitMs]
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const url = process.argv[2];
const out = process.argv[3];
const waitMs = Number(process.argv[4] || 8000);

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

(async () => {
  const port = 9200 + Math.floor(Math.random() * 600);
  const userDir = path.join(process.env.TEMP || '.', 'edge-verify-' + port);
  const child = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars',
    '--remote-debugging-port=' + port,
    '--user-data-dir=' + userDir,
    '--window-size=1160,1560',
    url,
  ], { stdio: 'ignore' });

  let wsUrl = null;
  for (let i = 0; i < 60 && !wsUrl; i++) {
    await new Promise((r) => setTimeout(r, 250));
    try {
      const list = await getJSON(port, '/json/list');
      const page = list.find((t) => t.type === 'page' && t.url.indexOf('http') === 0);
      if (page) wsUrl = page.webSocketDebuggerUrl;
    } catch (e) { /* 浏览器还没起来 */ }
  }
  if (!wsUrl) { console.log('NO TARGET'); child.kill(); process.exit(1); }

  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = (e) => reject(new Error('ws error'));
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
    const method = msg.method;
    const params = msg.params || {};
    if (method === 'Runtime.consoleAPICalled') {
      logs.push('[console.' + params.type + '] ' + params.args
        .map((a) => a.value !== undefined ? String(a.value) : (a.description || a.type)).join(' '));
    } else if (method === 'Runtime.exceptionThrown') {
      const d = params.exceptionDetails || {};
      const desc = d.exception && d.exception.description ? d.exception.description : d.text;
      logs.push('[EXCEPTION] ' + desc + ' @' + (d.url || '') + ':' + (d.lineNumber || ''));
    } else if (method === 'Log.entryAdded') {
      const e = params.entry || {};
      logs.push('[log.' + e.level + '] ' + e.text + ' @' + (e.url || ''));
    }
  };

  const send = (method, params) => new Promise((resolve) => {
    const mid = ++id;
    pending.set(mid, resolve);
    ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
  });

  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  await new Promise((r) => setTimeout(r, waitMs));

  const ready = await send('Runtime.evaluate', {
    expression: 'document.body.getAttribute("data-ready")',
    returnByValue: true,
  });
  logs.push('[ready attr] ' + JSON.stringify(ready.result?.result?.value));

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  if (shot.result?.data) {
    fs.writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
    console.log('SHOT OK: ' + out);
  } else {
    console.log('SHOT FAILED');
  }
  console.log('--- console ---');
  console.log(logs.join('\n') || '(无输出)');

  try { ws.close(); } catch (e) { /* ignore */ }
  child.kill();
  process.exit(0);
})().catch((e) => { console.log('ERR ' + e.message); process.exit(1); });
