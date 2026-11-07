/* =========================================================
 * spot.js —— 找茬馆
 *
 * 后端 /api/spotdiff/random 每次随机抽一幅场景图（固定题库），
 * 前端把图铺进舞台，再按题库给的百分比坐标叠一层透明点击热区。
 *
 * 为了解决「换一幅」时图片缓冲慢的问题，这里做了两件事：
 *   1) 图片已转成 WebP（36–108 KB / 张，比 JPG 小约 75%）
 *   2) 后台预取队列：当前题一显示，就悄悄再拉 2 道题并把图加载进内存缓存。
 *      这样点「换一幅」时大概率命中缓存，秒出图，不需要等网络。
 * ========================================================= */
(function () {
  const $ = (id) => document.getElementById(id);
  const stage = $('spotStage');
  if (!stage) return;

  let level = null;
  let found = new Set();
  let hints = 0;
  let startedAt = 0;
  let mounted = false;
  let busy = false;
  let solved = false;

  /* ---------- 后台预取队列 ----------
   * pending: 已经从服务器拉好、只差显示的关卡（含完整 errors 坐标）
   * imgLoaded: 该关卡的图是否已经解码完成（命中则秒出） */
  const pending = new Map();   // id -> level
  const imgLoaded = new Set(); // id
  const PREFETCH = 2;          // 始终保持 2 道题在后台待命

  function preloadImage(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = img.onerror = () => resolve(img);
      img.src = src;
    });
  }

  /* 从服务器拉一道题（排除当前 + 已缓存的），并存入 pending */
  async function fetchOneLevel(excludeIds) {
    const qs = new URLSearchParams({ t: String(Date.now()) });
    excludeIds.forEach((id) => qs.append('exclude', id));
    const res = await fetch(apiUrl('/api/spotdiff/random?' + qs.toString()), { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  }

  /* 后台补充预取队列到 PREFETCH 道 */
  async function refillCache() {
    const excludeIds = [level && level.id, ...pending.keys()].filter(Boolean);
    while (pending.size < PREFETCH) {
      try {
        const lv = await fetchOneLevel(excludeIds);
        if (!lv || pending.has(lv.id)) break;
        pending.set(lv.id, lv);
        excludeIds.push(lv.id);
        // 图片异步解码，不阻塞
        preloadImage(lv.image).then(() => imgLoaded.add(lv.id));
      } catch { break; }
    }
  }

  /* ---------- 取题 ---------- */
  async function load(exclude) {
    if (busy) return;
    busy = true;
    stage.classList.add('is-busy');

    try {
      // 优先用后台预取好的题（秒出图）
      let nextId = null;
      for (const id of pending.keys()) {
        if (id !== exclude) { nextId = id; break; }
      }
      if (nextId) {
        level = pending.get(nextId);
        pending.delete(nextId);
        if (imgLoaded.has(nextId)) imgLoaded.delete(nextId);
      } else {
        const qs = new URLSearchParams({ t: String(Date.now()) });
        if (exclude) qs.set('exclude', exclude);
        const res = await fetch(apiUrl('/api/spotdiff/random?' + qs.toString()), { cache: 'no-store' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        level = await res.json();
      }

      $('spotNote').textContent = `题库 ${level.total} 幅 · 随机抽题`;
      if (!imgLoaded.has(level.id)) await preloadImage(level.image);
      render();
    } catch (e) {
      stage.innerHTML = '<p class="spot-err">题库没加载出来，点「换一幅」再试试。</p>';
    }

    busy = false;
    stage.classList.remove('is-busy');
    // 显示完后，后台继续补题
    refillCache();
  }

  /* ---------- 铺图 ---------- */
  function render() {
    solved = false;
    found = new Set();
    hints = 0;
    startedAt = Date.now();

    $('spotTitle').textContent = level.title;
    $('spotSub').textContent = level.subtitle;
    $('spotDiffTag').textContent = level.difficulty;
    $('spotTotal').textContent = level.errors.length;
    $('spotFound').textContent = '0';
    $('spotResult').innerHTML = '';

    const hits = level.errors.map((e, i) => `
      <button type="button" class="sd-hit" data-i="${i}"
        style="left:${e.x}%;top:${e.y}%;--d:${e.r * 2}%"
        aria-label="可疑的地方 ${i + 1}"></button>`).join('');

    stage.innerHTML = `
      <img class="spot-img" src="${level.image}" alt="${level.title}" draggable="false">
      <div class="sd-layer">
        <div class="sd-marks"></div>
        ${hits}
      </div>
      <span class="spot-brand">豆苗时光机 · 找茬馆</span>`;

    stage.querySelector('.sd-layer').addEventListener('click', onHit);
    renderDots();
    updateTip();
  }

  /* ---------- 点中 / 点空 ---------- */
  function onHit(ev) {
    const hit = ev.target.closest('.sd-hit');
    if (!hit || solved) return;
    ev.stopPropagation();
    const i = Number(hit.dataset.i);
    if (found.has(i)) return;

    found.add(i);
    hit.classList.add('is-done');
    addMark(level.errors[i]);
    $('spotFound').textContent = found.size;
    renderDots();

    if (found.size === level.errors.length) finish();
    else updateTip(`找到一处：${level.errors[i].label}`);
  }

  function addMark(e) {
    const mark = document.createElement('div');
    mark.className = 'sd-mark';
    mark.style.left = e.x + '%';
    mark.style.top = e.y + '%';
    mark.style.setProperty('--d', e.r * 2 + '%');
    mark.innerHTML = '<i class="sd-ring"></i><b class="sd-check">✓</b>';
    stage.querySelector('.sd-marks').appendChild(mark);
  }

  stage.addEventListener('click', (ev) => {
    if (solved || !level) return;
    if (ev.target.closest('.sd-hit')) return;
    stage.classList.add('is-wrong');
    setTimeout(() => stage.classList.remove('is-wrong'), 520);
    updateTip('这里好像没问题，再仔细看看别处～');
    setTimeout(() => { if (!solved) updateTip(); }, 1800);
  });

  /* ---------- 提示 ---------- */
  function useHint() {
    if (!level || solved) return;
    const remain = level.errors.map((_, i) => i).filter((i) => !found.has(i));
    if (!remain.length) return;
    const i = remain[Math.floor(Math.random() * remain.length)];
    const e = level.errors[i];
    hints += 1;

    const flash = document.createElement('div');
    flash.className = 'sd-flash';
    flash.style.left = e.x + '%';
    flash.style.top = e.y + '%';
    flash.style.setProperty('--d', (e.r * 2 + 6) + '%');
    stage.querySelector('.sd-marks').appendChild(flash);
    setTimeout(() => flash.remove(), 2800);

    updateTip(`提示：${e.label} —— 正在闪的地方就是它`);
  }

  /* ---------- 收尾 ---------- */
  function finish() {
    solved = true;
    const secs = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
    const mm = Math.floor(secs / 60);
    const ss = String(secs % 60).padStart(2, '0');
    const hintText = hints ? `提示 ${hints} 次` : '一次提示都没用';
    $('spotResult').innerHTML = `
      <div class="spot-win">
        <span class="spot-win-icon">🔍</span>
        <div class="spot-win-copy">
          <b>${level.errors.length} 处全找到啦！</b>
          <p>用时 ${mm}:${ss} · ${hintText}</p>
        </div>
        <div class="spot-win-actions">
          <button class="spot-btn" id="spotReplay">再找一次</button>
          <button class="spot-btn primary" id="spotNextWin">下一幅 →</button>
        </div>
      </div>`;
    $('spotReplay').addEventListener('click', () => render());
    $('spotNextWin').addEventListener('click', () => load(level.id));
    updateTip('全部找到啦，换一幅再试试？');
    setTimeout(() => $('spotResult').scrollIntoView({ block: 'center', behavior: 'smooth' }), 80);
  }

  /* ---------- 小零件 ---------- */
  function renderDots() {
    const box = $('spotDots');
    box.innerHTML = '';
    level.errors.forEach((_, i) => {
      const d = document.createElement('span');
      d.className = 'spot-dot' + (found.has(i) ? ' on' : '');
      box.appendChild(d);
    });
  }

  function updateTip(msg) {
    const tip = $('spotTip');
    if (msg) {
      tip.textContent = msg;
      tip.classList.add('is-active');
    } else if (level) {
      tip.textContent = `画里有 ${level.errors.length} 处和现实不符，点它们找出来。`;
      tip.classList.remove('is-active');
    }
  }

  /* ---------- 绑定按钮 ---------- */
  $('spotHint').addEventListener('click', useHint);
  $('spotNext').addEventListener('click', () => load(level && level.id));

  window.SpotDiff = {
    mount() {
      if (mounted) return;
      mounted = true;
      load();
    },
  };
})();
