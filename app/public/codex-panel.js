/* codex-panel.js — 应用内「Codex 教学教练」面板（形态 B）
 * 主题无关：只操作固定 ID 的 DOM 节点，CSS 由各页面自行提供。
 * 自动从 URL 读取 ?sharecode= 透传给服务端（部署环境必需）；
 * 若页面另含 #codex-sc 输入框（本地调试用），则优先取其值。
 * 后端：POST /api/codex —— 配了 CODEX_* 走 Codex（Azure OpenAI Responses API），
 *       否则或调用失败自动降级 DeepSeek。密钥只在服务端，前端只发 prompt 与上下文。
 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var sendBtn = $('codex-send');
  if (!sendBtn) return; // 本页未挂载面板，直接退出，零副作用

  var promptEl = $('codex-prompt');
  var ctxEl = $('codex-ctx');
  var outEl = $('codex-out');
  var badgesEl = $('codex-badges');

  // 快捷提问按钮：把预设问题填入输入框
  var quick = document.querySelectorAll('.codex-quick');
  Array.prototype.forEach.call(quick, function (b) {
    b.addEventListener('click', function () {
      if (promptEl) {
        promptEl.value = b.getAttribute('data-q') || b.textContent;
        promptEl.focus();
      }
    });
  });

  function shareCode() {
    var fromUrl = new URLSearchParams(location.search).get('sharecode');
    if (fromUrl) return fromUrl.trim();
    var inp = $('codex-sc');
    return inp ? inp.value.trim() : '';
  }

  function post(url, body, sc) {
    var headers = { 'Content-Type': 'application/json' };
    if (sc) headers['x-share-code'] = sc;
    return fetch(url + (sc ? ('?sharecode=' + encodeURIComponent(sc)) : ''), {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(body)
    });
  }

  function setBadges(html) { if (badgesEl) badgesEl.innerHTML = html; }
  function setOut(text) { if (outEl) outEl.textContent = text; }

  sendBtn.addEventListener('click', function () {
    var prompt = promptEl ? promptEl.value.trim() : '';
    if (!prompt) { setOut('请先填写需求 / 提问。'); return; }
    var sc = shareCode();

    sendBtn.disabled = true;
    setBadges('<span class="codex-badge">请求中…</span>');
    setOut('正在生成…');

    post('/api/codex', {
      prompt: prompt,
      context: ctxEl ? ctxEl.value.trim() : ''
    }, sc)
      .then(function (res) { return res.json(); })
      .then(function (j) {
        if (!j.ok) {
          setOut('错误：' + (j.error || '未知'));
          setBadges('<span class="codex-badge fb">失败</span>');
          return;
        }
        var d = j.data || {};
        var html;
        if (d.engine === 'codex') {
          html = '<span class="codex-badge codex">Codex · ' + (d.model || '') + '</span>';
        } else {
          html = '<span class="codex-badge fb">DeepSeek 兜底 · ' + (d.model || '') + '</span>';
          if (d.codexFellBack) html += ' <span class="codex-badge fb">Codex 调用失败已降级</span>';
        }
        setBadges(html);
        setOut(d.reply || '（无返回内容）');
      })
      .catch(function (e) {
        setOut('网络/服务错误：' + (e && e.message ? e.message : e));
        setBadges('<span class="codex-badge fb">异常</span>');
      })
      .then(function () { sendBtn.disabled = false; });
  });
})();
