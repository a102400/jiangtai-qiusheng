'use strict';

/*
 * 逐字稿证据定位。
 * 不请求接口，不存储数据，不依赖 app.js 全局状态。
 *
 * 第一版只支持两种匹配：
 *   1. 完整原文匹配；
 *   2. 忽略空白差异的匹配。
 * 不做「语义相似就算原句」的模糊匹配，也不把模型改写过的句子当成原文证据。
 *
 * 实现方式：遍历文本节点并用 Range 包裹目标区间，
 * 而不是重写 innerHTML —— 这样口头禅高亮等已有标签不会被破坏，
 * 也不会把任何内容当 HTML 执行。
 */
(function () {
  const MARK_SELECTOR = 'mark[data-jtq-evidence="true"]';

  /*
   * 只剥离摘录外层成对的引号，不改动内部标点。
   */
  function cleanQuote(value) {
    let text = String(value == null ? '' : value).trim();

    const pairs = [
      ['「', '」'],
      ['『', '』'],
      ['“', '”'],
      ['"', '"']
    ];

    // 最多剥两轮，处理 '""引号""' 这类嵌套写法。
    for (let round = 0; round < 2; round++) {
      const pair = pairs.find(function (item) {
        return text.length > 2 &&
          text.startsWith(item[0]) &&
          text.endsWith(item[1]);
      });

      if (!pair) break;
      text = text.slice(1, -1).trim();
    }

    return text;
  }

  /*
   * 清除上一次定位留下的证据标记，并把被拆开的文本节点合并回去。
   */
  function clear(root) {
    if (!root) return;

    root.querySelectorAll(MARK_SELECTOR).forEach(function (mark) {
      mark.replaceWith.apply(mark, Array.from(mark.childNodes));
    });

    // 合并相邻文本节点，避免多次定位后 DOM 碎片化。
    root.normalize();
  }

  /*
   * 返回去掉空白后的文本，以及每个字符在原文中的位置。
   * 索引采用 UTF-16，与 String#indexOf 和文本节点 offset 一致。
   */
  function compact(text) {
    let value = '';
    const positions = [];

    for (let i = 0; i < text.length; i++) {
      if (/\s/.test(text[i])) continue;
      value += text[i];
      positions.push(i);
    }

    return { value: value, positions: positions };
  }

  function findRange(text, rawQuote) {
    const quote = cleanQuote(rawQuote);
    if (!quote) return null;

    const exactIndex = text.indexOf(quote);

    if (exactIndex !== -1) {
      return {
        start: exactIndex,
        end: exactIndex + quote.length,
        method: 'exact'
      };
    }

    const source = compact(text);
    const target = compact(quote).value;

    if (!target) return null;

    const index = source.value.indexOf(target);
    if (index === -1) return null;

    return {
      start: source.positions[index],
      end: source.positions[index + target.length - 1] + 1,
      method: 'whitespace'
    };
  }

  /*
   * 在 root 内定位 quote 并高亮。
   *
   * 返回：
   *   { found: true,  method: 'exact' | 'whitespace' }
   *   { found: false, reason: 'missing-transcript' | 'not-found' | 'empty-range' }
   */
  function locate(root, quote) {
    if (!root) {
      return { found: false, reason: 'missing-transcript' };
    }

    clear(root);

    const match = findRange(root.textContent || '', quote);

    if (!match) {
      return { found: false, reason: 'not-found' };
    }

    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT,
      null
    );

    const parts = [];
    let offset = 0;
    let node;

    while ((node = walker.nextNode())) {
      const start = offset;
      const end = start + node.data.length;

      if (end > match.start && start < match.end) {
        parts.push({
          node: node,
          start: Math.max(0, match.start - start),
          end: Math.min(node.data.length, match.end - start)
        });
      }

      offset = end;
    }

    // 倒序处理：前面的包裹不会改变后面节点的 offset。
    // 即使原句跨过口头禅 <mark>，也只会拆到文本节点，不会破坏已有标签。
    for (let i = parts.length - 1; i >= 0; i--) {
      const part = parts[i];
      if (part.end <= part.start) continue;

      const range = document.createRange();
      range.setStart(part.node, part.start);
      range.setEnd(part.node, part.end);

      const mark = document.createElement('mark');
      mark.className = 'jtq-evidence-mark';
      mark.setAttribute('data-jtq-evidence', 'true');

      range.surroundContents(mark);
    }

    const first = root.querySelector(MARK_SELECTOR);

    if (!first) {
      return { found: false, reason: 'empty-range' };
    }

    first.tabIndex = -1;
    first.setAttribute('aria-label', '已定位的逐字稿证据');

    first.focus({ preventScroll: true });

    const reducedMotion =
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    first.scrollIntoView({
      behavior: reducedMotion ? 'auto' : 'smooth',
      block: 'center',
      inline: 'nearest'
    });

    return {
      found: true,
      method: match.method
    };
  }

  window.JTQEvidence = Object.freeze({
    clear: clear,
    locate: locate,
    cleanQuote: cleanQuote,
    findRange: findRange
  });
})();