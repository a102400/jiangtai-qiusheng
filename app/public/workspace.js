'use strict';

/*
 * JTQ 工作台导航
 * 使用普通脚本加载，必须放在 app.js 之后。
 * 保留原有页面结构，仅提供快捷导航和结果可用状态。
 */
(function initWorkspaceNavigation() {
  const inputPanel = document.getElementById('trainingInput');
  const resultsPanel = document.getElementById('trainingResults');
  const resultBody = document.getElementById('resultBody');

  if (!inputPanel || !resultsPanel || !resultBody) {
    console.warn(
      '[JTQ Workspace] 缺少训练区域标记，请先应用 HTML 结构补丁。'
    );
    return;
  }

  if (document.getElementById('workspaceNavigation')) return;

  const tabBar = resultBody.querySelector('.tabs');
  if (!tabBar) return;

  const nav = document.createElement('nav');
  nav.id = 'workspaceNavigation';
  nav.className = 'workspace-navigation';
  nav.setAttribute('aria-label', '训练工作台快捷导航');

  const entries = [
    {
      key: 'prepare',
      number: '01',
      label: '准备试讲'
    },
    {
      key: 'review',
      number: '02',
      label: '复盘与演练'
    },
    {
      key: 'growth',
      number: '03',
      label: '成长档案'
    }
  ];

  const buttons = new Map();
  let currentSection = 'prepare';
  let previouslyAvailable = false;

  const list = document.createElement('div');
  list.className = 'workspace-navigation-list';

  entries.forEach((entry) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'workspace-navigation-button';
    button.dataset.workspaceSection = entry.key;

    const number = document.createElement('span');
    number.className = 'workspace-navigation-number';
    number.textContent = entry.number;
    number.setAttribute('aria-hidden', 'true');

    const label = document.createElement('span');
    label.textContent = entry.label;

    button.append(number, label);
    list.appendChild(button);
    buttons.set(entry.key, button);
  });

  const status = document.createElement('p');
  status.id = 'workspaceNavigationStatus';
  status.className = 'workspace-navigation-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.setAttribute('aria-atomic', 'true');

  nav.append(list, status);
  inputPanel.before(nav);

  function resultsAvailable() {
    return !resultBody.hidden &&
      getComputedStyle(resultBody).display !== 'none' &&
      getComputedStyle(resultsPanel).display !== 'none';
  }

  function updateCurrent(section) {
    currentSection = section;

    buttons.forEach((button, key) => {
      const selected = key === section;
      button.classList.toggle('is-current', selected);

      if (selected) {
        button.setAttribute('aria-current', 'location');
      } else {
        button.removeAttribute('aria-current');
      }
    });
  }

  function refreshAvailability() {
    const available = resultsAvailable();

    buttons.get('review').disabled = !available;
    buttons.get('growth').disabled = !available;

    if (!available) {
      status.textContent = '先提交试讲内容，完成分析后进入复盘与成长档案。';
      updateCurrent('prepare');
    } else {
      status.textContent =
        '结果区域已打开；查看结论前，请核对结果来源与适用范围。';

      if (!previouslyAvailable && currentSection === 'prepare') {
        updateCurrent('review');
      }
    }

    previouslyAvailable = available;
  }

  function scrollAndFocus(panel, headingId) {
    const heading = document.getElementById(headingId);
    const target = heading || panel;

    target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });

    const reduceMotion = window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    panel.scrollIntoView({
      behavior: reduceMotion ? 'auto' : 'smooth',
      block: 'start'
    });
  }

  function activateResultTab(name) {
    const tab = tabBar.querySelector(
      '.tab[data-tab="' + name + '"]'
    );

    if (!tab) return false;

    // 走原按钮事件，保留成长页的业务加载。
    tab.click();
    return true;
  }

  buttons.get('prepare').addEventListener('click', () => {
    updateCurrent('prepare');
    scrollAndFocus(inputPanel, 'trainingInputHeading');
  });

  buttons.get('review').addEventListener('click', () => {
    if (!resultsAvailable()) return;
    if (!activateResultTab('report')) return;

    updateCurrent('review');
    scrollAndFocus(resultsPanel, 'trainingResultsHeading');
  });

  buttons.get('growth').addEventListener('click', () => {
    if (!resultsAvailable()) return;
    if (!activateResultTab('growth')) return;

    updateCurrent('growth');
    scrollAndFocus(resultsPanel, 'trainingResultsHeading');
  });

  document.addEventListener('jtq:tabchange', (event) => {
    if (!resultsAvailable()) return;

    const name = event.detail && event.detail.name;
    if (!name) return;

    updateCurrent(name === 'growth' ? 'growth' : 'review');
  });

  const observer = new MutationObserver(refreshAvailability);

  // 只观察可见性属性，不观察聊天和报告正文。
  [resultBody, resultsPanel].forEach((element) => {
    observer.observe(element, {
      attributes: true,
      attributeFilter: ['hidden', 'style', 'class']
    });
  });

  refreshAvailability();
})();
