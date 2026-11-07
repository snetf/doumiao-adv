/* =========================================================
 * games.js —— 章内小任务 + 贴纸手账
 *
 *   1. ChapterGame.start(cfg, node, onDone)
 *      章内小游戏，全部排在「选择」之前、找齐/答对后才露出「继续」：
 *        · 第六章「找出 3 只猫」：任务卡放在对话框下方，直接点 #cgMedia 里的照片
 *        · 其余章节用卡片任务卡，五种玩法同一套外壳（都在对话框外的行动区）：
 *          pick（三选一）、tapMany（找出 N 样）、order（按顺序点）、
 *          match（词和意思配对）、trueFalse（真假判断）
 *   2. ChapterGame.awardSticker(sticker)
 *      贴纸存 localStorage（adv_stickers），顶部弹一枚提示
 *   3. ChapterGame.renderShelf()
 *      术语手账页顶部的「冒险贴纸」贴纸架
 *
 * 不改剧情状态：推进仍由 app.js 的 onDone 回调负责。
 * ========================================================= */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const STICKER_KEY = 'adv_stickers';

  let active = null;      // { cfg, onDone, found, need, done, onClick, finishTimer }

  /* ---------- 贴纸存取 ---------- */
  function getStickers() {
    try {
      const list = JSON.parse(localStorage.getItem(STICKER_KEY) || '[]');
      return Array.isArray(list) ? list.filter((s) => s && s.name) : [];
    } catch {
      return [];
    }
  }
  function saveStickers(list) {
    try { localStorage.setItem(STICKER_KEY, JSON.stringify(list)); } catch { /* 隐身模式忽略 */ }
  }

  /* ---------- 顶部提示 ---------- */
  function toastHost() {
    let host = $('stickerToastHost');
    if (!host) {
      host = document.createElement('div');
      host.id = 'stickerToastHost';
      host.className = 'sticker-toast-host';
      document.body.appendChild(host);
    }
    return host;
  }

  function showToast(sticker, again) {
    const toast = document.createElement('div');
    toast.className = 'sticker-toast';
    toast.innerHTML = `
      <span class="st-emoji">${sticker.emoji || '🏅'}</span>
      <span class="st-txt"><b>${again ? '这枚贴纸已在手账里' : '获得贴纸'}</b>${sticker.name}</span>`;
    toastHost().appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 400);
    }, 3200);
  }

  function awardSticker(sticker) {
    if (!sticker || !sticker.name) return;
    const list = getStickers();
    const exists = list.some((s) => s.name === sticker.name);
    if (!exists) {
      list.push({ emoji: sticker.emoji || '🏅', name: sticker.name, at: Date.now() });
      saveStickers(list);
    }
    showToast(sticker, exists);
    renderShelf();
  }

  /* ---------- 手账贴纸架 ---------- */
  /* 一章一章玩下来最多会攒到 42 枚，默认只摊开一排（12 枚），
     余下的点「展开全部」再看，避免手账顶部被贴纸架占满 */
  const SHELF_PREVIEW = 12;
  let shelfOpen = false;

  function renderShelf() {
    const shelf = $('stickerShelf');
    if (!shelf) return;
    const list = getStickers();
    if (!list.length) {
      shelf.hidden = true;
      shelf.innerHTML = '';
      return;
    }
    shelf.hidden = false;
    const shown = shelfOpen ? list : list.slice(0, SHELF_PREVIEW);
    const more = list.length > SHELF_PREVIEW;
    shelf.innerHTML = `
      <div class="sk-head">
        <span class="sk-title">🏅 冒险贴纸</span>
        <span class="sk-count">${list.length} 枚</span>
      </div>
      <div class="sk-row">
        ${shown.map((s) => `<span class="sk-chip"><span class="sk-e">${s.emoji || '🏅'}</span>${s.name}</span>`).join('')}
      </div>
      ${more ? `<button type="button" class="sk-more" data-shelf-toggle>${shelfOpen ? '收起 ▴' : `展开全部 ${list.length} 枚 ▾`}</button>` : ''}`;
  }

  // 展开/收起：元素本身不重建，监听只绑一次
  const shelfEl = $('stickerShelf');
  if (shelfEl) {
    shelfEl.addEventListener('click', (e) => {
      if (!e.target.closest || !e.target.closest('[data-shelf-toggle]')) return;
      shelfOpen = !shelfOpen;
      renderShelf();
    });
  }

  /* ---------- 小游戏共用：提示条 / 进度点 / 照片复位 ---------- */
  function setMsg(text, kind) {
    const msg = $('fgMsg');
    if (!msg) return;
    msg.textContent = text;
    msg.className = 'fg-msg' + (kind ? ' ' + kind : '');
  }

  function updatePips(found, need) {
    const dots = $('fgDots');
    if (!dots) return;
    dots.querySelectorAll('.fg-dot').forEach((d, i) => d.classList.toggle('on', i < found));
    const count = $('fgCount');
    if (count) count.textContent = `${found} / ${need}`;
  }

  function resetPhotos(media) {
    media.querySelectorAll('.pw-photo').forEach((fig) => {
      fig.classList.remove('found', 'wrong');
      const badge = fig.querySelector('.pw-found');
      if (badge) badge.remove();
    });
  }

  function stop() {
    if (!active) return;
    clearTimeout(active.finishTimer);
    if (active.cleanup) active.cleanup();
    $('cgFrame')?.classList.remove('game-on');
    const box = $('choices');
    if (box && box.querySelector('.find-game, .mini-game')) box.innerHTML = '';
    active = null;
  }

  /* =========================================================
   * 卡片式小游戏（第一 / 二 / 三 / 四 / 五 / 七 / 八章）
   * 五种玩法共用一套任务头：pick 三选一 · tapMany 找出 N 样 ·
   * order 按顺序点 · match 配对 · trueFalse 真假判断
   * 全部完成 → 发贴纸 → 自动露出「继续」，与第六章找猫同款节奏
   * ========================================================= */
  function renderPanel(cfg, need) {
    const box = $('choices');
    if (!box) return null;
    const dots = Array.from({ length: need }, () => '<span class="fg-dot"></span>').join('');
    const top = `
        <div class="fg-top">
          <strong class="fg-title">🎮 ${cfg.title || '轮到你了'}</strong>
          <span class="fg-count" id="fgCount">0 / ${need}</span>
        </div>
        <div class="fg-dots" id="fgDots">${dots}</div>`;

    // 判断题：一句判断 + 两个大按钮，不再是一排卡片
    if (cfg.type === 'trueFalse') {
      box.innerHTML = `
      <div class="mini-game" role="group" aria-label="判断题">
        ${top}
        <p class="tf-q">${cfg.question || cfg.title || ''}</p>
        <div class="tf-row" id="tfRow">
          <button type="button" class="tf-btn" data-v="1">✅ 真的</button>
          <button type="button" class="tf-btn" data-v="0">❌ 不是</button>
        </div>
        <p class="fg-msg" id="fgMsg">${cfg.hint || '想一想，再点一个'}</p>
      </div>`;
      return $('tfRow');
    }

    const cards = (cfg.options || []).map((o, i) => `
      <button type="button" class="mg-card" data-i="${i}">
        <span class="mg-e" aria-hidden="true">${o.e || '✦'}</span>
        <span class="mg-t">${o.t}</span>
      </button>`).join('');
    box.innerHTML = `
      <div class="mini-game" role="group" aria-label="${cfg.title || '章内小游戏'}">
        ${top}
        <div class="mg-cards" id="mgCards">${cards}</div>
        <p class="fg-msg" id="fgMsg">${cfg.hint || '点一下卡片试试'}</p>
      </div>`;
    return $('mgCards');
  }

  function shakeCard(card) {
    card.classList.remove('bad');
    void card.offsetWidth;
    card.classList.add('bad');
    if (card.animate) {
      card.animate(
        [{ translate: '0 0' }, { translate: '-5px 0' }, { translate: '5px 0' }, { translate: '-3px 0' }, { translate: '0 0' }],
        { duration: 380, easing: 'ease-in-out' }
      );
    }
    setTimeout(() => card.classList.remove('bad'), 500);
  }

  function startMini(cfg, onDone) {
    const type = cfg.type;
    const options = cfg.options || [];
    const need = type === 'tapMany'
      ? Math.max(1, Number(cfg.need) || options.filter((o) => o.ok).length || 1)
      : type === 'order' ? options.length
      : type === 'match' ? new Set(options.map((o) => o.pair)).size
      : 1;
    const cards = renderPanel(cfg, need);
    if (!cards) return;

    const st = { cfg, onDone, done: false, found: 0, need, finishTimer: null, onClick: null, cleanup: null, sel: null };
    const items = [...cards.querySelectorAll('.mg-card')];
    let nextStep = 1;

    st.onClick = (e) => {
      if (st.done) return;

      // 判断题：两个大按钮
      if (type === 'trueFalse') {
        const tf = e.target.closest && e.target.closest('.tf-btn');
        if (!tf || tf.classList.contains('ok')) return;
        const right = cfg.answer === true || cfg.answer === 'true' || cfg.answer === 1;
        if ((Number(tf.dataset.v) === 1) === right) {
          tf.classList.add('ok');
          st.found = 1;
          updatePips(1, 1);
          finish(cfg.okText || '判断对啦！');
        } else {
          shakeCard(tf);
          setMsg(cfg.badText || '再想想，换个答案试试～', 'err');
        }
        return;
      }

      const btn = e.target.closest && e.target.closest('.mg-card');
      if (!btn || btn.classList.contains('ok')) return;
      const i = Number(btn.dataset.i);

      if (type === 'pick') {
        if (options[i] && options[i].ok) {
          btn.classList.add('ok');
          st.found = 1;
          updatePips(1, 1);
          finish(cfg.okText || '答对啦！');
        } else {
          shakeCard(btn);
          setMsg(cfg.badText || '再想想，换一张试试～', 'err');
        }
        return;
      }

      if (type === 'tapMany') {
        if (options[i] && options[i].ok) {
          btn.classList.add('ok');
          st.found += 1;
          updatePips(st.found, st.need);
          if (st.found >= st.need) {
            finish(cfg.okText || '找齐啦！');
          } else {
            setMsg(`找到一样！还差 ${st.need - st.found} 样`, 'ok');
          }
        } else {
          shakeCard(btn);
          setMsg(cfg.badText || '这个帮不上忙，再找找～', 'err');
        }
        return;
      }

      // match：先点一张，再点它的搭档；配错两张都抖一下
      if (type === 'match') {
        if (btn.classList.contains('sel')) {
          btn.classList.remove('sel');
          st.sel = null;
          setMsg('取消选择，再挑一张', '');
          return;
        }
        if (!st.sel) {
          st.sel = btn;
          btn.classList.add('sel');
          setMsg(`选好「${options[i] ? options[i].t : ''}」，再找它的搭档`, '');
          return;
        }
        const first = st.sel;
        const same = options[Number(first.dataset.i)]?.pair === options[i]?.pair;
        first.classList.remove('sel');
        st.sel = null;
        if (same) {
          first.classList.add('ok');
          btn.classList.add('ok');
          st.found += 1;
          updatePips(st.found, st.need);
          if (st.found >= st.need) {
            finish(cfg.okText || '全配对啦！');
          } else {
            setMsg(`配好一对！还剩 ${st.need - st.found} 对`, 'ok');
          }
        } else {
          shakeCard(first);
          shakeCard(btn);
          setMsg(cfg.badText || '这两个不是一对，再想想～', 'err');
        }
        return;
      }

      // order：必须从第 1 步点到第 3 步，点错就从第一步重来
      if (options[i] && options[i].step === nextStep) {
        btn.classList.add('ok');
        st.found = nextStep;
        nextStep += 1;
        updatePips(st.found, st.need);
        if (st.found >= st.need) {
          finish(cfg.okText || '顺序全对！');
        } else {
          setMsg(`第 ${st.found} 步对啦，下一步呢？`, 'ok');
        }
      } else {
        items.forEach((el) => el.classList.remove('ok'));
        st.found = 0;
        nextStep = 1;
        updatePips(0, st.need);
        shakeCard(btn);
        setMsg(cfg.badText || '顺序反了～从第 1 步重来', 'err');
      }
    };

    function finish(text) {
      st.done = true;
      cards.classList.add('locked');
      if (cfg.sticker) awardSticker(cfg.sticker);
      setMsg(text, 'ok');
      // 停一拍让孩子看清结果，再露出「继续」
      st.finishTimer = setTimeout(() => {
        if (active === st && typeof onDone === 'function') onDone();
      }, 900);
    }

    cards.addEventListener('click', st.onClick);
    st.cleanup = () => cards.removeEventListener('click', st.onClick);
    active = st;
    updatePips(0, need);
    revealDeck();
  }

  /* 任务卡被挤到屏幕外时，轻轻滚进来（找猫不滚：要一直看着照片墙） */
  function revealDeck() {
    const deck = $('choices');
    if (!deck || !deck.children.length) return;
    const r = deck.getBoundingClientRect();
    const gap = 56;
    if (r.top < window.innerHeight && r.bottom > window.innerHeight - gap) {
      window.scrollBy({ top: r.bottom - window.innerHeight + gap, behavior: 'smooth' });
    }
  }

  /* ---------- 找猫小游戏 ---------- */
  function startFindCats(cfg, node, onDone) {
    const box = $('choices');
    const media = $('cgMedia');
    const frame = $('cgFrame');
    if (!box || !media || !frame) return;

    const need = Math.max(1, Number(cfg.need) || 3);
    const dots = Array.from({ length: need }, () => '<span class="fg-dot"></span>').join('');
    box.innerHTML = `
      <div class="find-game" role="group" aria-label="找猫小游戏">
        <div class="fg-top">
          <strong class="fg-title">🐱 ${cfg.title || '找出 ' + need + ' 只猫'}</strong>
          <span class="fg-count" id="fgCount">0 / ${need}</span>
        </div>
        <div class="fg-dots" id="fgDots">${dots}</div>
        <p class="fg-msg" id="fgMsg">${cfg.hint || '点一下照片就能检查'}</p>
      </div>`;

    resetPhotos(media);
    frame.classList.add('game-on');

    const state = { cfg, onDone, found: 0, need, done: false, onClick: null, finishTimer: null };

    state.onClick = (e) => {
      if (state.done) return;
      const fig = e.target.closest && e.target.closest('.pw-photo');
      if (!fig) return;
      // 点空了不算：只在照片上判定
      if (fig.classList.contains('found')) return;

      const isCat = fig.dataset.cat === '1';
      const name = fig.dataset.name || '这张照片';
      if (isCat) {
        fig.classList.add('found');
        const badge = document.createElement('span');
        badge.className = 'pw-found';
        badge.textContent = '✅';
        fig.appendChild(badge);
        state.found += 1;
        updatePips(state.found, state.need);
        setMsg(state.found >= state.need ? '找齐啦！三只猫都被你抓住了～' : `找到一只！还差 ${state.need - state.found} 只`, 'ok');
        if (state.found >= state.need) finish();
      } else {
        fig.classList.remove('wrong');
        void fig.offsetWidth;
        fig.classList.add('wrong');
        // 用 Web Animations 抖一下，不覆盖照片自带的入场动画
        if (fig.animate) {
          fig.animate(
            [{ translate: '0 0' }, { translate: '-6px 0' }, { translate: '6px 0' }, { translate: '-4px 0' }, { translate: '0 0' }],
            { duration: 420, easing: 'ease-in-out' }
          );
        }
        setTimeout(() => fig.classList.remove('wrong'), 600);
        setMsg(`这是${name}，不是猫～再找找`, 'err');
      }
    };

    function finish() {
      state.done = true;
      if (cfg.sticker) awardSticker(cfg.sticker);
      frame.classList.remove('game-on');
      // 找齐后停一拍，让孩子看清结果，再露出「继续」
      state.finishTimer = setTimeout(() => {
        if (active === state && typeof onDone === 'function') onDone();
      }, 900);
    }

    media.addEventListener('click', state.onClick);
    state.cleanup = () => media.removeEventListener('click', state.onClick);
    active = state;
    updatePips(0, need);
  }

  /* ---------- 统一入口：找猫 / 卡片小游戏自动分流 ---------- */
  function start(cfg, node, onDone) {
    stop();
    if (!cfg) return;
    if ((cfg.type || 'find-cats') === 'find-cats') startFindCats(cfg, node, onDone);
    else startMini(cfg, onDone);
  }

  window.ChapterGame = { start, stop, awardSticker, renderShelf, getStickers };

  // 脚本位于 body 末尾，DOM 已就绪：先把已有的贴纸架画出来
  renderShelf();
})();
