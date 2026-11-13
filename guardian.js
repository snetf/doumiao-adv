/* =====================================================================
 * guardian.js —— 家长 / 教师只读入口
 *   用法：/?guardian=1  （可选 &pin=自定义口令，默认 2468）
 *   进入后先验证口令，通过后只显示「成长观察」视图，隐藏游戏入口。
 *   说明：口令仅用于防止孩子误入，不是账号体系；数据仍是匿名设备记录。
 * ===================================================================== */
(function () {
  const q = new URLSearchParams(location.search);
  if (q.get('guardian') !== '1') return;
  const PIN = (q.get('pin') || '2468').slice(0, 6);

  const style = document.createElement('style');
  style.textContent = `
    body.guardian-mode .tabs,
    body.guardian-mode .tab-bar,
    body.guardian-mode .tab-btn:not([data-view="grow"]),
    body.guardian-mode .nav-item:not([data-view="grow"]),
    body.guardian-mode .api-entry,
    body.guardian-mode #csEntry,
    body.guardian-mode #navToggle,
    body.guardian-mode .ver-switch,
    body.guardian-mode .nav-sheet,
    body.guardian-mode #themeFab,
    body.guardian-mode #aiFab,
    body.guardian-mode #orchFab { display: none !important; }
    body.guardian-mode .view:not(#view-grow) { display: none !important; }
    body.guardian-mode #view-grow { display: block !important; padding-bottom: 96px; }
    body.guardian-mode #view-grow .view-title small { color: #6d767c; }
    #gxGate { position: fixed; inset: 0; z-index: 99999; background: #f6f2e7;
      display: flex; align-items: center; justify-content: center;
      font-family: "PingFang SC", "Microsoft YaHei", sans-serif; }
    .gx-card { width: min(420px, 86vw); text-align: center; }
    .gx-tag { margin: 0; font: 11px/1 Consolas, monospace; letter-spacing: .3em; color: #8b8577; text-transform: uppercase; }
    .gx-title { margin: 18px 0 10px; font-family: "Songti SC", "SimSun", serif; font-size: 34px; letter-spacing: .1em; color: #16211c; }
    .gx-sub { margin: 0 0 30px; font-size: 14px; line-height: 1.95; color: #6d767c; }
    .gx-input { width: 100%; height: 64px; text-align: center; font: 28px/64px Consolas, monospace;
      letter-spacing: .6em; border: 1px solid #d9d9d0; background: #fff; color: #16211c; outline: none; box-sizing: border-box; }
    .gx-input:focus { border-color: #1e3a8a; }
    .gx-btn { margin-top: 16px; width: 100%; height: 52px; border: 1px solid #1e3a8a;
      background: #1e3a8a; color: #fff; font-size: 15px; letter-spacing: .24em; cursor: pointer; }
    .gx-err { margin: 12px 0 0; height: 18px; font-size: 13px; color: #a8442a; }
    .gx-hint { margin: 26px 0 0; font-size: 11px; line-height: 1.8; color: #a9a396; letter-spacing: .04em; }
    .gx-exit { position: fixed; right: 20px; top: 13px; z-index: 9999; padding: 9px 15px;
      border: 1px solid #d9d9d0; background: #fff; color: #6d767c;
      font-size: 12px; letter-spacing: .1em; cursor: pointer; }
  `;
  document.head.appendChild(style);

  const gate = document.createElement('div');
  gate.id = 'gxGate';
  gate.innerHTML =
    '<div class="gx-card">' +
    '<p class="gx-tag">Guardian View</p>' +
    '<h1 class="gx-title">成长观察</h1>' +
    '<p class="gx-sub">请输入 4 位口令。<br>这里只读展示行为维度与结论，不显示对话原文。</p>' +
    '<input class="gx-input" id="gxPin" inputmode="numeric" maxlength="6" autocomplete="off" placeholder="····">' +
    '<button class="gx-btn" id="gxGo">进入</button>' +
    '<p class="gx-err" id="gxErr"></p>' +
    '<p class="gx-hint">默认口令 2468<br>可在链接后加 &amp;pin=你的口令 自定义</p>' +
    '</div>';
  document.body.appendChild(gate);

  const input = document.getElementById('gxPin');
  const err = document.getElementById('gxErr');
  setTimeout(function () { try { input.focus(); } catch (e) {} }, 100);

  function pass() {
    gate.remove();
    document.body.classList.add('guardian-mode');
    const tab = document.querySelector('[data-view="grow"]');
    if (tab) tab.click();
    const exit = document.createElement('button');
    exit.className = 'gx-exit';
    exit.textContent = '退出家长视图';
    exit.onclick = function () { location.href = location.pathname; };
    document.body.appendChild(exit);
  }

  function submit() {
    if (input.value.trim() === PIN) { pass(); return; }
    err.textContent = '口令不正确';
    input.value = '';
    input.focus();
  }

  document.getElementById('gxGo').onclick = submit;
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
})();
