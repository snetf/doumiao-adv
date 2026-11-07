/* =====================================================================
   switch.js —— 乐园探索版（/）与经典馆藏版（/classic/）之间的切换键
   用法：<script src="/switch.js?v=1" data-version="park|classic"></script>
   ===================================================================== */
(function () {
  'use strict';

  var script = document.currentScript;
  var current = (script && script.dataset.version === 'classic') ? 'classic' : 'park';
  /* 相对路径：本地（/、/classic/）与 GitHub Pages（/仓库名/…）都能用 */
  var HREF = current === 'classic'
    ? { park: '../', classic: './' }
    : { park: './', classic: 'classic/' };
  var NAME = { park: '乐园探索版', classic: '经典馆藏版' };

  /* 统一两个版本的浏览器标签图标，切换时品牌感连续 */
  if (!document.querySelector('link[rel="icon"]')) {
    var icon = document.createElement('link');
    icon.rel = 'icon';
    icon.href = 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🌱</text></svg>';
    document.head.appendChild(icon);
  }

  function mountSwitch() {
    var host = document.querySelector('.top-actions') || document.querySelector('.topbar');
    if (!host || document.querySelector('.ver-switch')) return;

    var box = document.createElement('nav');
    box.className = 'ver-switch';
    box.setAttribute('aria-label', '作品版本切换');
    box.title = '两个版本随时切换，进度各自保留';
    box.innerHTML =
      '<a class="vs-item' + (current === 'park' ? ' is-on' : '') + '" href="/" data-v="park"' +
      (current === 'park' ? ' aria-current="page"' : '') + '><span class="vs-emoji">🌿</span>乐园版</a>' +
      '<a class="vs-item' + (current === 'classic' ? ' is-on' : '') + '" href="/classic/" data-v="classic"' +
      (current === 'classic' ? ' aria-current="page"' : '') + '><span class="vs-emoji">🏛️</span>经典版</a>';
    host.appendChild(box);

    box.addEventListener('click', function (e) {
      var a = e.target.closest ? e.target.closest('a[data-v]') : null;
      if (!a) return;
      var to = a.dataset.v;
      e.preventDefault();
      if (to === current) return;

      /* 从经典馆藏版回到乐园版时：若用户没主动选过昼夜，默认白天。
         白天版是奶油纸底 + 墨蓝 + 阳光黄，和经典版配色同源，切换不跳色。 */
      if (to === 'park') {
        try { if (!localStorage.getItem('dm-theme')) localStorage.setItem('dm-theme', 'day'); } catch (err) {}
      }
      go(to);
    });
  }

  /* 全屏过渡幕：米白纸底 + 豆苗，两版共用同一视觉语言 */
  function curtain(text) {
    var c = document.createElement('div');
    c.className = 'vs-curtain';
    c.innerHTML =
      '<div class="vs-box">' +
        '<div class="vs-logo">🌱</div>' +
        '<div class="vs-brand">豆苗时光机</div>' +
        '<div class="vs-line">' + text + '</div>' +
        '<div class="vs-bar"><i></i></div>' +
      '</div>';
    document.body.appendChild(c);
    return c;
  }

  function go(to) {
    var c = curtain('正在前往 · ' + NAME[to]);
    try { sessionStorage.setItem('vs-hop', '1'); } catch (err) {}
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        c.classList.add('is-in');
        setTimeout(function () { location.href = HREF[to]; }, 320);
      });
    });
  }

  /* 到达新版本后：过渡幕淡出，避免硬切 */
  function playEnter() {
    var hopped = false;
    try {
      hopped = sessionStorage.getItem('vs-hop') === '1';
      sessionStorage.removeItem('vs-hop');
    } catch (err) {}
    if (!hopped) return;

    var c = curtain('欢迎来到 · ' + NAME[current]);
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        c.classList.add('is-in');
        setTimeout(function () {
          c.classList.remove('is-in');
          setTimeout(function () { c.remove(); }, 380);
        }, 140);
      });
    });
  }

  function boot() { mountSwitch(); playEnter(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
