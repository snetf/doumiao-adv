/* =========================================================
 * app.js —— 前端逻辑
 *   1. ADV 剧情引擎（打字机 + 分支选项 + 时间轴点亮）
 *   2. 术语高亮 → tips 弹窗 → 上报服务器 → 知识库深读
 *   3. 豆苗成长（收集数驱动等级）
 *   4. 水之子聊天（AI 在线则用 AI，离线走本地兜底）
 * ========================================================= */

// ---------- 后端地址 ----------
/* 默认与页面同源（本地 3002 或云端同一个函数）。
 * 如果页面放在别处（OSS、本地单文件），用 ?api=https://你的FC域名 指向云端后端，
 * 地址会记在浏览器里，之后再打开也不用重新带参数。 */
const API_BASE = (() => {
  try {
    const q = new URLSearchParams(location.search).get('api');
    if (q) {
      const v = q.replace(/\/$/, '');
      localStorage.setItem('adv_api_base', v);
      return v;
    }
    return localStorage.getItem('adv_api_base') || '';
  } catch { return ''; }
})();
const apiUrl = (path) => API_BASE + path;

// ---------- 状态 ----------
const state = {
  nodeId: STORY.start,
  typing: false,
  typeTimer: null,
  collected: JSON.parse(localStorage.getItem('adv_tips') || '[]'), // 本地缓存（服务器为主）
  visited: new Set(JSON.parse(localStorage.getItem('adv_visited_v1') || '[]')),  // 已访问节点（跨刷新保留，时间轴可跳章）
  dimensions: {},            // 本章维度画像：{ 怀疑精神: 3, 同理心: 1 ... }，进入新章节时清空
  history: [],               // 本章互动对话（喂给 AI 做上下文）
  memory: {},                // 对话记忆：{ topic, pending, openQuestion } —— 跨节拍承接上一轮的话题
  chapter: '',               // 当前章节名，用于检测章节切换
  deviation: { count: 0, last: 0 },  // 连续偏离计数 + 上一拍偏差值（deviation-guard）
  traceTurns: [],            // AI 小工坊面板：最近几拍的调用流水
  orchSeen: false,           // 首次出现流水时自动亮一次面板
  dialogLog: [],             // 对话回溯：所有已播台词（人狼村之谜式ログ）
  conclusions: JSON.parse(localStorage.getItem('adv_conclusions') || '[]'),  // 每章一句「带得走的结论」
  claims: JSON.parse(localStorage.getItem('adv_claims_v1') || '{}'),        // 孩子自己写的「科学主张」（每章一句）
  dimsTotal: JSON.parse(localStorage.getItem('adv_dims_v1') || '{}'),       // 跨章累计的五维总分（成长观察页用）
  stats: Object.assign(
    { chats: 0, hintChips: 0, petL1: 0, petL2: 0, petL3: 0, guideHints: 0 },
    JSON.parse(localStorage.getItem('adv_stats_v1') || '{}')),             // 提示使用计数（只存本机）
  sceneLock: false,
  turnLock: false,
  hallEntryNode: null,   // 从画廊推门进入的目标节点（命中后不再回走廊）
  auto: { mode: 'idle', timer: null },
};

/* ---------- 成长观察：五维定义 + 持久化 ----------
 * 只统计维度分数、提示次数、结论卡与术语数量；不落任何对话原文或昵称。 */
const GROW_DIMS = [
  { key: '怀疑精神', desc: '追问事实、提出质疑' },
  { key: '同理心',   desc: '关心他人感受' },
  { key: '创造力',   desc: '想象、比喻、怪问题' },
  { key: '严谨度',   desc: '有条理、给观点配理由' },
  { key: '勇气',     desc: '敢表达和大人不一样的看法' },
];
function addDims(dims) {
  for (const [k, v] of Object.entries(dims || {})) {
    const n = Number(v);
    if (!n) continue;
    state.dimsTotal[k] = (state.dimsTotal[k] || 0) + n;
  }
  localStorage.setItem('adv_dims_v1', JSON.stringify(state.dimsTotal));
}
function bumpStat(key, n = 1) {
  state.stats[key] = (state.stats[key] || 0) + n;
  localStorage.setItem('adv_stats_v1', JSON.stringify(state.stats));
}

/* ---------- 玩家档案（localStorage 常驻：名字跨章、跨刷新都不丢） ----------
 * 章节切换会清空 state.memory / state.history，所以名字不能只存在内存里。 */
const PLAYER_KEY = 'adv_player_v1';
state.player = Object.assign(
  { name: '', met: {}, createdAt: Date.now() },
  JSON.parse(localStorage.getItem(PLAYER_KEY) || '{}'));

function savePlayer(patch) {
  Object.assign(state.player, patch);
  localStorage.setItem(PLAYER_KEY, JSON.stringify(state.player));
}
function playerName() { return state.player.name || '小豆苗'; }   // 全站唯一称呼出口

/* 从孩子那句话里认出名字；认不出就静默返回，不追问、不打断剧情 */
function captureName(msg) {
  let name = '';
  const m = String(msg).match(/(?:我叫|我是|叫我|名字是|名字叫)\s*([^\s，。！？,.!?；;：:]{2,12})/);
  if (m) name = m[1];
  else {
    const s = String(msg).trim();
    if (s.length <= 8 && !/[，。！？,.!?；;：:]/.test(s)) name = s;
  }
  if (!name) return;
  savePlayer({ name: name.slice(0, 12) });
}

/* 文案模板：story.js 里写 {{name}}，播放前替换成孩子自己的名字 */
function fillTemplate(text) {
  return String(text || '').replace(/\{\{name\}\}/g, playerName());
}

const $ = (id) => document.getElementById(id);

/* ---------- 说话人头像（剧情互动可视化） ---------- */
/* 立绘与头像走同一套 ASCII slug：assets/characters/<slug>.webp（1024×1365 带 alpha）
 * 与 assets/characters/av/<slug>.webp（220×220 方形头像）。emoji/bg 保留作兜底。 */
const PORTRAIT_VER = '2';
const PORTRAIT = (s) => ({ img: `assets/characters/${s}.webp?v=${PORTRAIT_VER}`, av: `assets/characters/av/${s}.webp?v=${PORTRAIT_VER}` });
const SPEAKER_AVATAR = {
  '旁白':   { emoji: '📜', bg: '#eef2f7' },
  '水之子': { img: 'assets/shuizhizi_cut.png', av: 'assets/shuizhizi_cut.png' },
  '小豆苗': { emoji: '🌱', bg: '#eef7e8' },
  '图灵':   { ...PORTRAIT('turing'),     emoji: '🏃', bg: '#e9f3fa' },
  '麦卡锡': { ...PORTRAIT('mccarthy'),   emoji: '🖋️', bg: '#eef7e8' },
  '香农':   { ...PORTRAIT('shannon'),    emoji: '🤹', bg: '#fdf3e3' },
  '辛顿':   { ...PORTRAIT('hinton'),     emoji: '🔥', bg: '#fdeeee' },
  '明斯基': { ...PORTRAIT('minsky'),     emoji: '🦉', bg: '#f0eefb' },
  '老医生': { ...PORTRAIT('olddoctor'), emoji: '🩺', bg: '#eef7e8' },
  '费根鲍姆': { ...PORTRAIT('feigenbaum'), emoji: '📚', bg: '#fdf3e3' },
  '布坎南': { ...PORTRAIT('buchanan'),   emoji: '⚗️', bg: '#eef7e8' },
  '肖特利夫': { ...PORTRAIT('shortliffe'), emoji: '🩻', bg: '#e9f3fa' },
  '许峰雄': { ...PORTRAIT('hsu'),        emoji: '🎩', bg: '#fdf3e3' },
  '坎贝尔': { ...PORTRAIT('campbell'),   emoji: '♟️', bg: '#eef7e8' },
  '李飞飞': { ...PORTRAIT('lifeifei'),   emoji: '👩‍🔬', bg: '#fdeeee' },
  '亚历克斯': { ...PORTRAIT('alex'), emoji: '🎮', bg: '#e9f3fa' },
  '吴恩达': { ...PORTRAIT('andrewng'), emoji: '🧠', bg: '#fdf3e3' },
  '黄士杰': { ...PORTRAIT('huang'),      emoji: '💻', bg: '#e9f3fa' },
  '樊麾':   { ...PORTRAIT('fanhui'),     emoji: '⚫', bg: '#f0eefb' },
  '李世石': { ...PORTRAIT('leesedol'),   emoji: '🏆', bg: '#fdf3e3' },
  '工程师': { ...PORTRAIT('engineer'), emoji: '🔧', bg: '#e9f3fa' },
  '瓦斯瓦尼': { ...PORTRAIT('vaswani'),  emoji: '👓', bg: '#f0eefb' },
  '苏茨克维': { ...PORTRAIT('sutskever'), emoji: '🔬', bg: '#fdeeee' },
};
function avatarHtml(name) {
  const a = SPEAKER_AVATAR[name] || SPEAKER_AVATAR['旁白'];
  const src = a.av || a.img;
  return src
    ? `<span class="sp-av"><img src="${src}" alt="${name}"></span>`
    : `<span class="sp-av" style="background:${a.bg}">${a.emoji}</span>`;
}
/* 说话人标签：头像 + 名字（live=true 时标出这句是 AI 现写的） */
function setSpeaker(name, live) {
  $('speaker').innerHTML = `${avatarHtml(name)}<span class="sp-name">${name}</span>${live ? '<span class="sp-live">AI 即兴</span>' : ''}`;
}
/* 在场角色条：node.cast = ['麦卡锡','香农'] 时显示一排头像，发言者高亮 */
function renderCast(node) {
  const bar = $('castBar');
  if (!bar) return;
  const cast = node.cast;
  if (!cast || cast.length < 2) { bar.classList.remove('show'); bar.innerHTML = ''; return; }
  bar.innerHTML = cast.map((name) => {
    const a = SPEAKER_AVATAR[name] || SPEAKER_AVATAR['旁白'];
    const src = a.av || a.img;
    const av = src
      ? `<div class="cm-av"><img src="${src}" alt="${name}"></div>`
      : `<div class="cm-av" style="background:${a.bg}">${a.emoji}</div>`;
    return `<div class="cast-member${name === node.speaker ? ' active' : ''}">${av}<div class="cm-name">${name}</div></div>`;
  }).join('');
  bar.classList.add('show');
}

/* ---------- 立绘层（方案二 §4）：场景层里的「谁站在台上」 ----------
 * 模式 A（默认）：只显示当前说话人，换人时旧人淡出、新人淡入（≤400ms）。
 * 模式 B（stage:'group'，仅 cast≥3 的群戏节点）：说话者前景最大，其余后景缩小半透明。
 * 素材未齐前用 SPEAKER_AVATAR 的 emoji 占位；assets/characters/<id>.webp 入库后换图。
 * 整层 pointer-events:none，永不吞点击；窄屏塌缩回 .cast-bar 头像条。 */
const CAST_NO_SHOW = ['旁白', '小豆苗'];   // 旁白无脸、小豆苗是玩家自己，不上台
let castLock = false;                      // 380ms 防重入：快速点继续不会叠出两个 lead

function actorHtmlFor(name) {
  const a = SPEAKER_AVATAR[name] || SPEAKER_AVATAR['旁白'];
  return a.img
    ? `<img src="${a.img}" alt="${name}" loading="lazy" decoding="async">`
    : `<span class="actor-emoji" style="background:${a.bg}">${a.emoji}</span>`;
}

function renderCastStage(node) {
  const stage = $('castStage');
  if (!stage) return;
  if (castLock) {                          // 锁定期间不丢状态：解锁后按当前节点重排一次
    setTimeout(() => {
      const cur = STORY.nodes[state.nodeId];
      if (cur) renderCastStage(cur);
    }, 400);
    return;
  }
  const speaker = node.speaker;
  const group = node.stage === 'group' && Array.isArray(node.cast) && node.cast.length >= 3;
  const cast = group ? node.cast.slice(0, 3)
    : (!speaker || CAST_NO_SHOW.includes(speaker)) ? [] : [speaker];
  const sig = (group ? 'g:' : 'a:') + cast.join('|');

  // 签名没变（同人同场）：只换 lead 角色，不动 DOM，切人最顺
  if (stage.dataset.sig === sig) {
    stage.querySelectorAll('.actor').forEach((el) => {
      el.dataset.role = el.dataset.name === speaker ? 'lead' : 'side';
    });
    return;
  }

  castLock = true;
  setTimeout(() => { castLock = false; }, 380);

  // 旧人退场：180ms 下沉淡出后移除（退场期间不改 z-index，不钻到新人前面）
  const old = [...stage.querySelectorAll('.actor')];
  old.forEach((el) => { el.classList.remove('entering'); el.classList.add('leaving'); });
  setTimeout(() => old.forEach((el) => el.remove()), 190);

  stage.dataset.sig = sig;
  stage.dataset.mode = group ? 'group' : 'a';
  if (!cast.length) return;

  cast.forEach((name, i) => {
    const el = document.createElement('div');
    el.className = 'actor entering';
    el.dataset.name = name;
    el.dataset.slot = String(i + 1);
    el.dataset.role = name === speaker ? 'lead' : 'side';
    el.innerHTML = actorHtmlFor(name);
    stage.appendChild(el);
    // 双帧切换：先渲染 entering（透明+位移），下一帧再去掉，避免 opacity 被合并「闪一下」
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('entering')));
  });
}

// ---------- 视图切换 ----------
function switchView(name, opts) {
  document.querySelectorAll('.tab-btn').forEach((b) =>
    b.classList.toggle('active', b.dataset.view === name));
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  $('view-' + name).classList.add('active');
  document.body.classList.toggle('on-story', name === 'story');
  document.body.classList.toggle('on-gate', name === 'gate');
  // 切到别的视图时自动暂停 AUTO
  if (state.auto.mode !== 'idle') autoPause('view');
  if (name === 'tips') renderTipsGrid();
  if (name === 'kb') renderKbList();
  if (name === 'graph') renderGraph();
  if (name === 'grow') renderGrow();
  if (name === 'spot' && window.SpotDiff) window.SpotDiff.mount();
  if (name === 'games') {
    document.querySelectorAll('.game-card[data-goto]').forEach((card) => {
      card.onclick = () => switchView(card.dataset.goto);
    });
    document.querySelectorAll('.game-play[data-goto]').forEach((btn) => {
      btn.onclick = (e) => { e.stopPropagation(); switchView(btn.dataset.goto); };
    });
  }
  if (name === 'story' && !(opts && opts.skipHall) && window.AdvHall && window.AdvHall.show) window.AdvHall.show();
}
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
});
// 大门卡片跳转（仅开放板块）
document.querySelectorAll('.gate-card.open').forEach((card) => {
  card.addEventListener('click', () => switchView(card.dataset.goto));
});
// 封面 CTA 按钮跳转
document.querySelectorAll('.hero-btn[data-goto]').forEach((btn) => {
  btn.addEventListener('click', () => switchView(btn.dataset.goto));
});
switchView('gate');   // 默认落在封面大门（首页）

/* ----- 对话框整框推进委托 ----- */
document.addEventListener('click', (e) => {
  if (state.sceneLock || state.turnLock) return;
  const box = $('dialogueBox');
  if (!box || !box.classList.contains('show')) return;
  if (!box.contains(e.target)) return;
  if (!window.getSelection().isCollapsed) return;
  if (isInteractiveClick(e)) return;
  const s = boxAdvanceState();
  if (s === 'skip') { finishTyping(state.typeNode || null, state.typeRaw || ''); return; }
  if (s === 'ready') advanceStory();
});

/* ----- AUTO 自动播放按钮 ----- */
const AUTO_STOP = new Set(['input', 'pick', 'match', 'sort', 'tap']);
function autoPause(reason) {
  clearTimeout(state.auto.timer);
  const blocked = AUTO_STOP.has(reason);
  state.auto.mode = blocked ? 'blocked' : 'paused';
  $('autoBtn').classList.remove('auto-on');
  $('autoBtn').setAttribute('aria-pressed', 'false');
  $('autoBtn').textContent = blocked ? '该你啦' : '继续';
  if (reason === 'view') return;
  showAutoStatus(blocked ? '自动已暂停：轮到你选择/回答' : '自动已暂停');
}
function autoResume() {
  clearTimeout(state.auto.timer);
  const node = STORY.nodes[state.nodeId];
  const needBlock = node.choices || AUTO_STOP.has(node.type);
  if (needBlock) {
    // 当前节点需要交互，但仍显示 auto-on，等用户处理完自动续上
    state.auto.mode = 'running';
    $('autoBtn').classList.add('auto-on');
    $('autoBtn').setAttribute('aria-pressed', 'true');
    $('autoBtn').textContent = '暂停';
    return;
  }
  state.auto.mode = 'running';
  $('autoBtn').classList.add('auto-on');
  $('autoBtn').setAttribute('aria-pressed', 'true');
  $('autoBtn').textContent = '暂停';
  autoSchedule(node, state.typeRaw || '');
}
function autoSchedule(node, raw) {
  clearTimeout(state.auto.timer);
  if (state.auto.mode !== 'running') return;
  if (!node.next || node.choices || AUTO_STOP.has(node.type)) return;
  if (state.typing) { setTimeout(() => autoSchedule(node, raw), 200); return; }
  const gap = Math.min(3600, Math.max(1800, 1400 + raw.length * 10));
  state.auto.timer = setTimeout(() => {
    if (state.auto.mode === 'running' && !state.typing) fadeThenGo(node.next);
  }, gap);
}
let autoStatusTimer = null;
function showAutoStatus(msg) {
  const el = $('autoStatus');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(autoStatusTimer);
  autoStatusTimer = setTimeout(() => el.classList.remove('show'), 4000);
}
const autoBtn = $('autoBtn');
if (autoBtn) {
  autoBtn.onclick = () => {
    if (state.auto.mode === 'running') autoPause('user');
    else if (state.auto.mode === 'paused' || state.auto.mode === 'blocked') autoResume();
    else autoResume();
  };
}
document.addEventListener('keydown', (e) => {
  if (state.sceneLock && (e.key === 'Escape' || e.key === ' ' || e.key === 'Enter')) { finishDoorNow(); return; }
  if (e.key === 'Escape' && state.auto.mode === 'running') autoPause('user');
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && state.auto.mode === 'running') autoPause('hidden');
});

/* ----- 悬浮微粒子初始化 ----- */
(function initDust() {
  const N = 14;
  for (let i = 0; i < N; i++) {
    const d = document.createElement('div');
    d.className = 'floating-dust';
    const size = 2 + Math.random() * 3;
    const dur = 14 + Math.random() * 18;
    const delay = Math.random() * -30;
    d.style.cssText = `left:${Math.random()*100}vw;bottom:${-Math.random()*20}vh;width:${size}px;height:${size}px;animation-duration:${dur}s;animation-delay:${delay}s;opacity:${.15+Math.random()*.25}`;
    document.body.appendChild(d);
  }
})();

/* ----- 光标跟随粒子（暖金，低饱和，去霓虹） ----- */
(function initCursorParticles() {
  let canSpawn = true;
  document.addEventListener('mousemove', (e) => {
    if (!canSpawn) return;
    canSpawn = false;
    requestAnimationFrame(() => {
      canSpawn = true;
      const p = document.createElement('div');
      p.className = 'cursor-pt';
      const size = 4 + Math.random() * 5;
      const dx = (Math.random() - .5) * 28;
      const dy = (Math.random() - .5) * 28 - 8;
      p.style.cssText = `left:${e.clientX - size/2}px;top:${e.clientY - size/2}px;width:${size}px;height:${size}px;--dx:${dx}px;--dy:${dy}px;opacity:${.4 + Math.random()*.3}`;
      document.body.appendChild(p);
      setTimeout(() => p.remove(), 520);
    });
  }, { passive: true });
  // 移动端：点击时吐粒子
  document.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    if (!t) return;
    for (let i = 0; i < 5; i++) {
      const p = document.createElement('div');
      p.className = 'cursor-pt';
      const size = 4 + Math.random() * 5;
      p.style.cssText = `left:${t.clientX - size/2}px;top:${t.clientY - size/2}px;width:${size}px;height:${size}px;--dx:${(Math.random()-.5)*30}px;--dy:${(Math.random()-.5)*30-10}px;opacity:${.4+Math.random()*.3}`;
      document.body.appendChild(p);
      setTimeout(() => p.remove(), 520);
    }
  }, { passive: true });
})();

/* ---------- 铺满 / 窗口 开关（方案二 · 画面铺满） ----------
 * localStorage 键 adv_ui_mode，默认 full；样式全部挂在 body.ui-full / ui-window 上，
 * 且只在剧情视图（body.on-story）生效，其他视图不受影响。不做真实 Fullscreen API。 */
const UI_MODE_KEY = 'adv_ui_mode';
function applyUiMode(mode) {
  const m = mode === 'window' ? 'window' : 'full';
  document.body.classList.toggle('ui-full', m === 'full');
  document.body.classList.toggle('ui-window', m === 'window');
  localStorage.setItem(UI_MODE_KEY, m);
  const btn = $('uiModeBtn');
  if (btn) btn.textContent = m === 'full' ? '🗗 窗口' : '🗖 铺满';
}
applyUiMode(localStorage.getItem(UI_MODE_KEY) || 'full');
if ($('uiModeBtn')) $('uiModeBtn').addEventListener('click', () => {
  applyUiMode(document.body.classList.contains('ui-full') ? 'window' : 'full');
});

/* 实测顶栏与对话框高度：HUD 与章节标题避开顶栏（--topbar-h），
 * 桌宠站在对话框上沿之外（--dlg-h）。高度一变就同步，切视图/换台词都覆盖到。 */
if (window.ResizeObserver) {
  const hudSync = new ResizeObserver(() => {
    const tb = document.querySelector('.topbar');
    if (tb) document.documentElement.style.setProperty('--topbar-h', tb.offsetHeight + 'px');
    const st = document.querySelector('.stage');
    const db = $('dialogueBox');
    if (st && db) st.style.setProperty('--dlg-h', db.offsetHeight + 'px');
  });
  const _tb = document.querySelector('.topbar');
  if (_tb) hudSync.observe(_tb);
  if ($('dialogueBox')) hudSync.observe($('dialogueBox'));
}

// ---------- 时间轴 ----------
function renderTimeline() {
  $('timeline').innerHTML = TIMELINE.map((t) => `
    <div class="tl-node ${state.visited.has(t.nodeId) ? 'lit' : ''} ${t.nodeId === state.nodeId ? 'current' : ''}" data-node="${t.nodeId}">
      <span class="tl-year">${t.year}</span>${t.label}
    </div>`).join('');
  // 跳章只对已访问的节点开放；未点亮的时间轴点了不动
  $('timeline').querySelectorAll('.tl-node.lit').forEach((el) =>
    el.addEventListener('click', () => {
      const id = el.dataset.node;
      if (id && id !== state.nodeId) renderNode(id);
    }));
}

// ---------- 剧情引擎 ----------
/* 章节 → 画廊门：每章结束后回到走廊，镜头停在这一章的门前。 */
const CHAPTER_DOOR = {
  '第一章': 'a0', '第二章': 'b0', '第三章': 'c0', '第四章': 'd0',
  '第五章': 'e0', '第六章': 'f0', '第七章': 'g0', '第八章': 'h0',
};
function chapterKey(chapter) { return String(chapter || '').split(' · ')[0]; }

/* ----- 对话框整框推进 ----- */
function boxAdvanceState() {
  if (state.sceneLock || state.turnLock) return 'blocked';
  if (!$('dialogueBox').classList.contains('show')) return 'blocked';
  if (state.typing) return 'skip';
  if ($('nextBtn').classList.contains('hidden')) return 'blocked';
  const input = $('advInput');
  if (input && !input.disabled) return 'blocked';
  return 'ready';
}
function isInteractiveClick(e) {
  const hit = e.target.closest(
    'button, a, input, textarea, select, label, ' +
    '.choice-btn, .pick-card, .board-point, .hint-chip, .cn-term, .cn-proof, ' +
    '.adv-skip, .lg-close, [data-copy], .copy-btn'
  );
  return !!hit;
}
function advanceStory() {
  const node = STORY.nodes[state.nodeId];
  if (!node || !node.next || state.turnLock) return;
  autoPause('manual');
  fadeThenGo(node.next);
}

function renderNode(id) {
  if (id === 'END_GALLERY') {
    switchView('story', { skipHall: true });
    if (window.AdvHall && window.AdvHall.showAtDoor) window.AdvHall.showAtDoor('h0');
    return;
  }
  const node = STORY.nodes[id];
  if (!node) return;
  // 章节切换：上一章内容清零 + 回溯加分隔线；然后回走廊停在下一章门前，由玩家推门进入
  if (node.chapter !== state.chapter) {
    const fromHall = (state.hallEntryNode === id);
    if (fromHall) state.hallEntryNode = null;
    closeSideQuiz();   // 旁支小测只对当章有效：换章就收起
    if (state.chapter) {
      // 回溯分隔线：新旧章节之间划一道
      state.dialogLog.push({ divider: true, chapter: node.chapter });
    }
    state.chapter = node.chapter;
    if (window.AdvHall && window.AdvHall.onChapter) window.AdvHall.onChapter(node.chapter);
    state.dimensions = {};
    state.history = [];
    state.memory = {};
    state.deviation = { count: 0, last: 0 };
    // 旧章节内容全部撤下：对话框收起、打字机停掉、选项清空
    clearInterval(state.typeTimer);
    state.typing = false;
    $('dialogueBox').classList.remove('show');
    $('choices').innerHTML = '';
    $('storyText').innerHTML = '';
    $('nextBtn').classList.add('hidden');

    const doorNode = CHAPTER_DOOR[chapterKey(node.chapter)];
    // 剧情自然推进到新章节 → 回走廊，镜头自动停在下一章的门前
    if (!fromHall && doorNode && window.AdvHall && window.AdvHall.showAtDoor) {
      switchView('story', { skipHall: true });
      window.AdvHall.showAtDoor(doorNode);
      return;
    }
    renderNodeBody(id);
    return;
  }
  renderNodeBody(id);
}

/* 场景层：章节默认 CG（story.js 的 CHAPTER_BG）+ 节点 bg 覆盖。
 * 换图时新图叠在旧图上淡入，旧图 0.6 秒后移除，避免闪白。 */
let sceneBgSrc = '';
function renderScene(node) {
  const box = $('stageScene');
  if (!box) return;
  const bg = node.bg || (typeof CHAPTER_BG !== 'undefined' ? CHAPTER_BG[node.chapter] : null);
  const src = bg && bg.src;
  if (!src || src === sceneBgSrc) return;
  sceneBgSrc = src;
  box.classList.add('has-cg');
  const old = box.querySelector('.scene-img');
  const img = document.createElement('img');
  img.className = 'scene-img';
  img.alt = bg.alt || '';
  img.decoding = 'async';
  img.onload = () => img.classList.add('on');
  img.src = src;
  box.insertBefore(img, box.firstChild);
  if (old) setTimeout(() => old.remove(), 600);
}

function renderNodeBody(id) {
  // 推进剧情时收起聊天面板，避免遮挡（同时让桌宠回落）
  $('chatPanel').classList.remove('show');
  if ($('pet')) $('pet').classList.remove('above-chat');
  const node = STORY.nodes[id];
  if (!node) return;
  state.nodeId = id;
  state.visited.add(id);
  localStorage.setItem('adv_visited_v1', JSON.stringify([...state.visited]));
  savePlayer({ lastNode: id });          // 续玩：刷新后能从上次这一拍接上
  renderTimeline();
  stopPetHints();          // 离开上一拍，作废它的桌宠计时器

  // 记住「见过谁」：真实人物首次登场即写入档案，后续对话可据此判断首见/再见
  const sp = node.speaker;
  if (sp && SPEAKER_AVATAR[sp] && sp !== '小豆苗' && sp !== '旁白' && !state.player.met[sp]) {
    state.player.met[sp] = 1;
    savePlayer({ met: state.player.met });
  }

  $('chapterTitle').textContent = node.chapter;
  $('chapterTime').textContent = node.time;
  setSpeaker(node.speaker);
  renderCast(node);
  renderScene(node);       // 场景层：章节 CG（先于立绘，压在更底层）
  renderCastStage(node);   // 立绘层：模式 A/B 由 node.stage 决定
  $('choices').innerHTML = '';
  $('nextBtn').classList.add('hidden');

  // 对话框淡入：上一拍点继续后已移除 .show（淡出），这里加回 .show 触发淡入
  const dlgBox = $('dialogueBox');
  dlgBox.classList.add('show');

  // AI 生成节拍：auto=章节总结（维度画像生成）；react=人物对刚才的对话做即时反应
  if (node.type === 'auto' || node.type === 'react') { renderAuto(node); return; }

  // 打字机效果输出正文
  clearInterval(state.typeTimer);
  state.typing = true;
  const raw = fillTemplate(node.text);
  let i = 0;
  $('storyText').innerHTML = '';
  state.typeTimer = setInterval(() => {
    i += 2;                                  // 一次吐两字，更流畅
    if (i >= raw.length) { i = raw.length; finishTyping(node, raw); }
    $('storyText').innerHTML = decorate(raw.slice(0, i));
  }, 20);

  // 点击对话框可跳过打字机
  $('dialogueBox').onclick = () => { if (state.typing) finishTyping(node, raw); };
}

/* AI 现场生成节拍：
 *   auto  —— 章节总结：AI 按本章维度画像生成，开发者不预知台词
 *   react —— 人物对刚才的互动做即时反应：reactPrompt 是现场导演指示，
 *            history 提供对话上下文（哪句是机器说的、哪句是图灵说的）
 * 降级链：AI 生成 → 节点预写 text → 固定兜底，剧情永不断 */

// 偏离回归与承接指令已收编到后端导演/记忆板块（agents/director.js、agents/memory.js）：
// 前端只传 state.deviation 与 state.memory，不再自己拼 prompt——所有提示词策略集中在后端，便于统一维护。

async function renderAuto(node) {
  const isReact = node.type === 'react';
  const thinking = node.thinking || `（${node.speaker}看着你这一章的表现，若有所思……）`;
  $('storyText').innerHTML = `<span class="adv-thinking">${thinking}</span>`;
  let out;
  try {
    const player = { name: state.player.name, met: Object.keys(state.player.met) };
    const body = isReact
      ? { beatId: node.beatId, message: node.reactPrompt, history: state.history, memory: state.memory, deviation: state.deviation, player }
      : { beatId: node.beatId, message: '本章总结', dimensions: state.dimensions, player };  // auto 占位，后端改用维度画像
    const r = await fetch(apiUrl('/api/adv/respond'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    out = await r.json();
  } catch {
    out = { reply: '', source: 'fallback' };
  }
  // 协作流水：把这一拍的步骤送进 AI 小工坊
  pushTrace(out, {
    title: isReact ? '现场反应' : '章节总结',
    speaker: node.speaker,
    error: !out.trace,
    aiText: out.source === 'ai' ? (out.reply || '') : '',
    fallbackText: fillTemplate(node.text || ''),
  });
  if (isReact) state.deviation.count = 0;   // 回归节拍已触发，清零连续偏离计数器
  let raw = out.reply || '';
  if (isReact && out.source === 'fallback' && node.text) raw = fillTemplate(node.text);   // react 退回预写台词，保证连贯
  if (!raw) raw = fillTemplate(node.text) || (isReact ? '（没有回应……）' : '（信号断了……但图灵朝你竖起了大拇指。）');
  // react 反应记入历史：后续节拍知道图灵刚才说过什么，不会各说各话
  if (isReact) {
    state.history.push({ role: 'assistant', content: `${out.speaker || node.speaker}：${raw}` });
    state.history = state.history.slice(-12);
    // 承接完就清账：pending / openQuestion 已经在本轮兑现了
    if (out.memory) state.memory = { ...out.memory, turns: 0 };
  }
  // 沿用打字机播放生成结果
  clearInterval(state.typeTimer);
  state.typing = true;
  let i = 0;
  $('storyText').innerHTML = '';
  state.typeTimer = setInterval(() => {
    i += 2;
    if (i >= raw.length) { i = raw.length; finishTyping({ ...node, text: raw }, raw); }
    $('storyText').innerHTML = decorate(raw.slice(0, i));
  }, 20);
  $('dialogueBox').onclick = () => { if (state.typing) finishTyping({ ...node, text: raw }, raw); };
}

/* 水之子显性引导：偏差度=2 时在桌宠气泡里给出方向提示 */
let guideTimer = null;
function showGuideHint(hint) {
  if (!hint) return;
  bumpStat('guideHints');
  const bubble = $('petBubble');
  bubble.textContent = playerName() + '，我有个主意——' + hint;
  bubble.classList.add('guide-hint');
  clearTimeout(guideTimer);
  guideTimer = setTimeout(() => {
    bubble.classList.remove('guide-hint');
    bubble.textContent = '鼠标靠近我，有问题随时问～';
  }, 8000);
}

/* ---------- 桌宠分级提示（本地 node.hints，断网/无 Key 也有效） ----------
 * L1 暗示 12s → L2 半答案 30s → L3 直接指路 45s；打字机播放期间不弹，
 * 孩子一旦开始输入就整组作废（不打断正在认真想的人）。 */
let petHintState = null;
function stopPetHints() {
  if (!petHintState) return;
  petHintState.timers.forEach(clearTimeout);
  petHintState = null;
}
function startPetHints(node) {
  stopPetHints();
  if (!node.hints || !node.hints.length) return;
  petHintState = { timers: [] };
  petHintState.timers.push(setTimeout(() => petHint(0, node), 12000));
  petHintState.timers.push(setTimeout(() => petHint(1, node), 30000));
  petHintState.timers.push(setTimeout(() => petHint(2, node), 45000));
}
function petHint(level, node) {
  if (state.typing) return;                    // 打字机播放中不打断观感
  const hint = node.hints[Math.min(level, node.hints.length - 1)];
  if (!hint) return;
  const bubble = $('petBubble');
  if (!bubble) return;
  bumpStat(`petL${Math.min(level + 1, 3)}`);
  clearTimeout(guideTimer);
  bubble.classList.add('guide-hint');
  // 气泡在桌宠身上，点击会冒泡到 #pet 把聊天面板打开——这里截住，只让气泡自己处理
  bubble.onclick = (e) => e.stopPropagation();
  if (level >= 2) {
    // L3：直接指路，并给一个一键填入的按钮（只填不发，孩子仍可改）
    bubble.innerHTML = `${escapeHtml(hint.slice(0, 28))}<button class="pet-fill" id="petHintFill">填进输入框</button>`;
    const btn = $('petHintFill');
    if (btn) btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const input = $('advInput');
      if (input && !input.disabled) { input.value = hint; input.focus(); }
      resetPetBubble();
    });
  } else {
    bubble.textContent = hint.slice(0, 28);
  }
  guideTimer = setTimeout(resetPetBubble, level >= 2 ? 30000 : 10000);
  pushTrace({ trace: [{ agent: '桌宠', action: `L${level + 1} 提示`, detail: `来自本地 node.hints[${level}]`, ms: 0, status: 'ok' }] }, { title: '桌宠提示' });
}
function resetPetBubble() {
  const bubble = $('petBubble');
  if (!bubble) return;
  bubble.classList.remove('guide-hint');
  bubble.textContent = '鼠标靠近我，有问题随时问～';
  bubble.onclick = null;
}

/* 对话回溯：记录每一句已播台词，供回溯面板查看（人狼村之谜式ログ） */
function logDialog(speaker, text) {
  if (!text) return;
  // 相邻同句不重复记：打字机结尾点击跳过可能引发双触发，这里兜底
  const last = state.dialogLog[state.dialogLog.length - 1];
  if (last && last.speaker === speaker && last.text === text) return;
  state.dialogLog.push({ speaker, text, chapter: state.chapter, ts: Date.now() });
  if (state.dialogLog.length > 200) state.dialogLog.shift();   // 最多保留 200 条，够用且不卡
}

/* 点继续/选项：对话框先淡出（移除 .show），再进入下一节点（标准 ADV 过场呼吸） */
function fadeThenGo(nextId) {
  const box = $('dialogueBox');
  box.classList.remove('show');
  setTimeout(() => renderNode(nextId), 220);
}

function finishTyping(node, raw) {
  if (!state.typing) return;   // 防重入：打字机播完瞬间点击跳过会双触发，第二次直接丢弃
  clearInterval(state.typeTimer);
  state.typing = false;
  $('storyText').innerHTML = decorate(raw);
  // 这句台词播完，记入回溯
  logDialog(node.speaker || '旁白', raw);

  // 自由输入互动节点
  if (node.type === 'input') {
    renderInput(node);
    return;
  }

  // 点一下类节点：全屏只有一个可点元素，点完才继续（开场「点水球」）
  if (node.type === 'tap') {
    renderTap(node);
    return;
  }

  // 点选卡互动（pick）：挑一张卡看一句反应就继续，不打字、不调 AI
  if (node.type === 'pick') {
    renderPick(node);
    return;
  }

  // 章末人物配对（match）：3 句台词配 3 个头像
  if (node.type === 'match') {
    renderMatch(node);
    return;
  }

  // 章间时间轴排序（sort）：拖动事件卡排先后，排对才继续
  if (node.type === 'sort') {
    renderSort(node);
    return;
  }

  if (node.choices) {
    // 有代价的抉择（climax）：章内唯一一次二选一，选完另一条路就关上，所以先给一个提示条
    const tag = node.climax ? '<div class="climax-tag">⚖ 抉择 · 选一边，另一条路就关上了</div>' : '';
    $('choices').innerHTML = tag + node.choices
      .map((c) => `<button class="choice-btn${node.climax ? ' is-climax' : ''}" data-next="${c.next}">${c.text}</button>`)
      .join('');
    document.querySelectorAll('.choice-btn').forEach((b) =>
      b.addEventListener('click', () => {
        autoResume();
        fadeThenGo(b.dataset.next);
      }));
  } else {
    $('nextBtn').classList.remove('hidden');
    $('nextBtn').onclick = () => {
      autoResume();
      fadeThenGo(node.next);
    };
  }
  if (node.conclusion) renderConclusion(node);   // 章末结论卡：一句话 + 证据 + 一个带走问题
}

/* 自由输入互动：提交 → 调 AI（合并JSON：台词+偏差度+维度+对话记忆）→ 累计维度 → 继续主线
 * 同一拍允许最多 3 轮对话（「再聊一句」）：人物能把话说完整，不必每轮都硬推剧情 */
const MAX_CHAT_TURNS = 3;

/* 可点提示：hints 来自 story.js 节点，点一下填进输入框（不自动发送，孩子还能改） */
function hintRow(node) {
  if (!node.hints || !node.hints.length) return '';
  return `<div class="adv-hints">${node.hints.map((h) =>
    `<button type="button" class="hint-chip" data-hint="${escapeHtml(fillTemplate(h))}">${escapeHtml(fillTemplate(h))}</button>`).join('')}</div>`;
}
function bindHintChips() {
  document.querySelectorAll('#choices .hint-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const input = $('advInput');
      if (!input || input.disabled) return;
      bumpStat('hintChips');
      input.value = chip.dataset.hint;
      input.focus();
    });
  });
}

/* ---------- 语音输入（Web Speech API，默认关：只有点麦克风才请求权限） ---------- */
let voiceRec = null;
function setVoiceNote(text) {
  const note = $('voiceNote');
  if (!note) return;
  note.textContent = text || '';
  note.classList.toggle('show', !!text);
  if (text) setTimeout(() => {
    if (note.textContent === text) { note.textContent = ''; note.classList.remove('show'); }
  }, 4000);
}
function bindVoiceInput() {
  const btn = $('voiceBtn');
  if (!btn) return;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { btn.style.display = 'none'; return; }
  btn.addEventListener('click', () => {
    if (voiceRec) { try { voiceRec.stop(); } catch { /* 已结束 */ } return; }
    const input = $('advInput');
    if (!input || input.disabled) return;
    const base = input.value;
    const rec = new SR();
    voiceRec = rec;
    rec.lang = 'zh-CN';
    rec.interimResults = true;
    rec.continuous = false;
    const setBtn = (on) => { btn.classList.toggle('listening', on); btn.textContent = on ? '⏹' : '🎤'; };
    rec.onresult = (ev) => {
      let s = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) s += ev.results[i][0].transcript;
      input.value = (base + s).slice(0, 80);   // 只填不发，孩子还能改
    };
    rec.onerror = (ev) => {
      voiceRec = null; setBtn(false);
      setVoiceNote(ev.error === 'not-allowed' ? '麦克风没被允许，请检查浏览器权限' : '没听清，再点一次试试');
    };
    rec.onend = () => {
      if (voiceRec === rec) voiceRec = null;
      setBtn(false);
    };
    setBtn(true);
    setVoiceNote('正在听…说完会自动填进输入框');
    try { rec.start(); } catch { voiceRec = null; setBtn(false); }
  });
}

/* 章末结论卡：一句话（≤18 字）+ 本章术语 + 一个带走的问题。
 * 只在首次见到时写进 adv_conclusions，手账里可回看；「证据」点开是本章原文一小段，不跳走剧情。 */
function renderConclusion(node) {
  const c = node.conclusion;
  if (!c) return;
  const old = state.conclusions.find((x) => x.line === c.line);
  if (!old) {
    state.conclusions.push({ chapter: node.chapter || '', line: c.line, term: c.term, ts: Date.now() });
    localStorage.setItem('adv_conclusions', JSON.stringify(state.conclusions));
  }
  const proof = STORY.nodes[c.proofNode];
  const quote = proof ? String(proof.text || '').replace(/\[\[|\]\]/g, '').slice(0, 70) + '…' : '';
  const card = document.createElement('div');
  card.className = 'conclusion-card';
  card.innerHTML = `
    <div class="cn-line">${escapeHtml(fillTemplate(c.line))}</div>
    <div class="cn-meta">
      <span class="cn-term">${escapeHtml(c.term)}</span>
      <span class="cn-proof">证据 · 展开</span>
    </div>
    <div class="cn-quote">${escapeHtml(quote)}</div>
    <div class="cn-ask">带走一个问题：${escapeHtml(c.ask || '')}</div>`;
  card.querySelector('.cn-term').addEventListener('click', () => openKb(c.term));
  card.querySelector('.cn-proof').addEventListener('click', () => card.classList.toggle('open'));
  $('choices').appendChild(card);
}


function renderTap(node) {
  $('choices').innerHTML = `<button class="tap-ball" id="tapBall">💧 ${escapeHtml(node.tapText || '点一下')}</button>`;
  $('nextBtn').classList.add('hidden');
  const ball = $('tapBall');
  if (!ball) return;
  ball.addEventListener('click', () => {
    ball.classList.add('ripple');
    ball.disabled = true;
    setTimeout(() => fadeThenGo(node.next), 420);
  }, { once: true });
  ball.focus();
}

/* 点选卡互动（pick）：孩子挑一张卡，立即看到一句反应，不调 AI、零失败率。
 * 结果只加维度、不改剧情分支；6 秒不点由桌宠出 L2 提示（只提示，不代点）。 */
/* pick 的棋盘变体：node.board = { size, stones:[{x,y,c}], cells:[{x,y,label,reply,dim}] }
 * 候选点画成带编号发光的交叉点，图例与点位共用同一套点击（data-no）。 */
function pickBoardHtml(node) {
  const b = node.board;
  const n = b.size || 8;
  const hot = new Map((b.cells || []).map((c, i) => [`${c.x},${c.y}`, { ...c, no: i + 1 }]));
  const stones = new Map((b.stones || []).map((s) => [`${s.x},${s.y}`, s.c]));
  let grid = '';
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const h = hot.get(`${x},${y}`);
      const st = stones.get(`${x},${y}`);
      const edge = `border-right:${x === n - 1 ? '0' : '1px solid #bb9d6b'};border-bottom:${y === n - 1 ? '0' : '1px solid #bb9d6b'}`;
      grid += `<button type="button" class="board-point${h ? ' hot' : ''}"${h ? ` data-no="${h.no}"` : ' aria-hidden="true" tabindex="-1"'} style="${edge}">`
        + (st ? `<span class="stone ${st}"></span>` : '')
        + (h ? `<span class="bp-num">${h.no}</span>` : '')
        + '</button>';
    }
  }
  const legend = (b.cells || []).map((c, i) =>
    `<button type="button" class="pick-card" data-no="${i + 1}">${i + 1}. ${escapeHtml(fillTemplate(c.label))}</button>`).join('');
  return `<div class="pick-board" style="--n:${n}">${grid}</div><div class="board-legend">${legend}</div>`;
}

/* pick 的认图变体：node.photos = [{src, alt}]——交给孩子一叠待标照片，第一张是本题对象。 */
function pickPhotosHtml(node) {
  if (!node.photos || !node.photos.length) return '';
  return `<div class="pick-photos">${node.photos.map((p, i) => `
    <figure class="pick-photo${i === 0 ? ' on' : ''}">
      <img src="${p.src}" alt="${escapeHtml(p.alt || '')}" loading="lazy">
      <figcaption>${escapeHtml(p.alt || '')}</figcaption>
    </figure>`).join('')}</div>`;
}

function renderPick(node) {
  const cards = node.board ? (node.board.cells || []) : (node.cards || []);
  $('choices').innerHTML = (node.photos ? pickPhotosHtml(node) : '')
    + (node.board ? pickBoardHtml(node) : cards.map((c, i) =>
      `<button class="pick-card${node.variant === 'yesno' ? ' yesno' : ''}" data-no="${i + 1}">${escapeHtml(fillTemplate(c.label))}</button>`).join(''));
  $('nextBtn').classList.add('hidden');
  if (node.hints && node.hints.length) {
    stopPetHints();
    petHintState = { timers: [setTimeout(() => petHint(1, node), 6000)] };
  }
  let picked = false;
  $('choices').querySelectorAll('[data-no]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (picked) return;
      picked = true;
      stopPetHints();
      const c = cards[+btn.dataset.no - 1] || {};
      if (c.dim) addDims({ [c.dim[0]]: c.dim[1] });
      btn.classList.add('picked');
      const extra = [c.reply, node.reveal].filter(Boolean)
        .map((t) => `<p class="pick-reveal">${escapeHtml(fillTemplate(t))}</p>`).join('');
      if (extra) $('storyText').insertAdjacentHTML('beforeend', extra);
      $('choices').innerHTML = '';
      $('nextBtn').classList.remove('hidden');
      $('nextBtn').focus();
      $('nextBtn').onclick = () => fadeThenGo(node.next || node.fallbackNext);
    });
  });
}

/* 章末人物配对（match）：3 句本章台词 × 3 个头像，点一下即判，答完解锁小传再继续。
 * 不做失败重试：配对与否都直接揭示正确的人 + 小传，只记录对错，不影响主线。 */
function renderMatch(node) {
  const rounds = node.rounds || [];
  const choices = node.choices || [];
  const av = (who) => {
    const a = SPEAKER_AVATAR[who];
    const src = a && (a.av || a.img);
    return src ? `<img class="match-av" src="${src}" alt="" loading="lazy">` : '';
  };
  $('choices').innerHTML = `<div class="match-list">${rounds.map((r, i) => `
    <div class="match-row" data-i="${i}">
      <p class="match-say">「${escapeHtml(fillTemplate(r.say))}」</p>
      <div class="match-opts">${choices.map((w) => `
        <button class="match-opt" data-i="${i}" data-who="${escapeHtml(w)}">${av(w)}<span>${escapeHtml(w)}</span></button>`).join('')}</div>
      <p class="match-res"></p>
    </div>`).join('')}</div>`;
  $('nextBtn').classList.add('hidden');

  let done = 0;
  $('choices').querySelectorAll('.match-opt').forEach((btn) => {
    btn.addEventListener('click', () => {
      const row = btn.closest('.match-row');
      if (!row || row.classList.contains('answered')) return;
      row.classList.add('answered');
      const r = rounds[+row.dataset.i] || {};
      const right = btn.dataset.who === r.who;
      btn.classList.add(right ? 'right' : 'wrong');
      if (!right) {
        const correct = row.querySelector(`.match-opt[data-who="${r.who}"]`);
        if (correct) correct.classList.add('right');
      }
      row.querySelector('.match-res').innerHTML =
        `<span class="mr-mark">${right ? '✓' : '✗'}</span>`
        + (right ? `正是${escapeHtml(r.who)}。` : `这句其实是${escapeHtml(r.who)}说的。`)
        + `<span class="mr-bio">🔓 ${escapeHtml(r.bio || '')}</span>`;
      if (++done === rounds.length) {
        if (node.reveal) {
          $('storyText').insertAdjacentHTML('beforeend',
            `<p class="pick-reveal">${escapeHtml(fillTemplate(node.reveal))}</p>`);
        }
        $('nextBtn').classList.remove('hidden');
        $('nextBtn').focus();
        $('nextBtn').onclick = () => fadeThenGo(node.next || node.fallbackNext);
      }
    });
  });
}

/* 章间时间轴排序（sort）：把事件卡拖成正确年代顺序。
 * 用 pointer 事件而不是 HTML5 drag：触屏也能拖，指针越过相邻卡中线就换位。
 * 卡面不显示年份（否则等于送答案），排对后才翻出年份。 */
function renderSort(node) {
  const items = node.items || [];
  const start = Array.isArray(node.start) && node.start.length === items.length
    ? node.start : items.map((_, i) => i);
  $('choices').innerHTML = `
    <div class="sort-list" id="sortList">${start.map((k) => {
      const it = items[k] || {};
      return `<div class="sort-item" data-k="${k}">
        <span class="sort-handle" aria-hidden="true">⠿</span>
        <span class="sort-body">
          <span class="sort-label">${escapeHtml(it.label || '')}</span>
          <span class="sort-hint">${escapeHtml(it.hint || '')} <span class="sort-year">${it.year || ''}</span></span>
        </span>
        <span class="sort-mark"></span>
      </div>`;
    }).join('')}</div>
    <div class="sort-actions"><button class="primary-btn" id="sortCheck">看看排对了没</button></div>
    <p class="sort-feedback" id="sortFeedback"></p>`;
  $('nextBtn').classList.add('hidden');

  const list = $('sortList');
  bindSortDrag(list);

  $('sortCheck').addEventListener('click', () => {
    const right = items.map((_, i) => i).sort((a, b) => items[a].year - items[b].year);
    let ok = true;
    [...list.querySelectorAll('.sort-item')].forEach((el, i) => {
      const good = Number(el.dataset.k) === right[i];
      el.classList.toggle('ok', good);
      el.classList.toggle('bad', !good);
      el.querySelector('.sort-mark').textContent = good ? '✓' : '✗';
      if (!good) ok = false;
    });
    const fb = $('sortFeedback');
    if (!ok) {
      fb.textContent = '还有几张没放对，再拖一拖。';
      fb.className = 'sort-feedback show no';
      return;
    }
    list.classList.add('show-years', 'locked');
    fb.textContent = '全对！';
    fb.className = 'sort-feedback show ok';
    if (node.reveal) {
      $('storyText').insertAdjacentHTML('beforeend',
        `<p class="pick-reveal">${escapeHtml(fillTemplate(node.reveal))}</p>`);
    }
    $('nextBtn').classList.remove('hidden');
    $('nextBtn').focus();
    $('nextBtn').onclick = () => fadeThenGo(node.next || node.fallbackNext);
  });
}

/* 指针拖拽：按下卡片后，指针越过谁的中线就插到谁前/后（鼠标与触屏同一套） */
function bindSortDrag(list) {
  if (!list) return;
  let drag = null;
  const items = () => [...list.querySelectorAll('.sort-item')];

  list.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('.sort-item');
    if (!el || list.classList.contains('locked')) return;
    drag = el;
    el.classList.add('dragging');
    try { el.setPointerCapture(e.pointerId); } catch { /* 老浏览器忽略 */ }
    // 重新拖时清掉上一次的判定痕迹
    items().forEach((it) => {
      it.classList.remove('ok', 'bad');
      const m = it.querySelector('.sort-mark');
      if (m) m.textContent = '';
    });
    const fb = $('sortFeedback');
    if (fb) { fb.className = 'sort-feedback'; fb.textContent = ''; }
  });

  list.addEventListener('pointermove', (e) => {
    if (!drag) return;
    e.preventDefault();
    const y = e.clientY;
    let target = null;
    for (const it of items()) {
      if (it === drag) continue;
      const r = it.getBoundingClientRect();
      if (y < r.top + r.height / 2) { target = { el: it, before: true }; break; }
      target = { el: it, before: false };
    }
    if (!target) list.appendChild(drag);
    else if (target.before) list.insertBefore(drag, target.el);
    else list.insertBefore(drag, target.el.nextSibling);
  });

  const stop = () => {
    if (!drag) return;
    drag.classList.remove('dragging');
    drag = null;
  };
  list.addEventListener('pointerup', stop);
  list.addEventListener('pointercancel', stop);
}

function renderInput(node) {
  const maxTurns = node.maxTurns || MAX_CHAT_TURNS;   // 轮次按节点可配：核心拍 2-3 轮，其余 1 轮
  $('choices').innerHTML = `
    ${hintRow(node)}
    <div class="adv-input">
      <input id="advInput" class="adv-text" placeholder="${node.placeholder || '输入…'}" maxlength="80">
      <button type="button" class="voice-btn" id="voiceBtn" title="用嘴说（点击后才请求麦克风）">🎤</button>
      <button class="primary-btn adv-send" id="advSendBtn">发送</button>
    </div>
    <p class="voice-note" id="voiceNote"></p>
    ${node.skipTo ? `<button type="button" class="adv-skip" id="advSkip">${escapeHtml(node.skipText || '先跳过')}</button>` : ''}`;
  $('nextBtn').classList.add('hidden');
  bindHintChips();
  bindVoiceInput();
  const skip = $('advSkip');
  if (skip) skip.addEventListener('click', () => fadeThenGo(node.skipTo));   // 跳过也要能继续，不强制填表
  startPetHints(node);     // 孩子卡住时，桌宠按 12s/30s/45s 逐级给提示

  let turns = 0;          // 本拍已聊轮数
  let busy = false;

  async function submit() {
    // 每轮回复后输入框是重建的，必须现场按 id 取，不能闭包抓旧元素
    const input = $('advInput');
    const btn = $('advSendBtn');
    if (!input || !btn) return;
    const msg = input.value.trim();
    if (!msg || busy) return;
    stopPetHints();          // 孩子开始说话了，提示作废
    if (node.capture === 'name') captureName(msg);
    busy = true;
    input.disabled = true;
    btn.disabled = true;
    btn.textContent = '思考中…';

    let out;
    try {
      const r = await fetch(apiUrl('/api/adv/respond'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          beatId: node.beatId,
          message: msg,
          history: state.history,
          dimensions: state.dimensions,
          memory: { ...state.memory, turns: turns + 1 },
          player: { name: state.player.name, met: Object.keys(state.player.met) },
        }),
      });
      out = await r.json();
    } catch {
      out = { reply: '（信号断了，请继续……）', dimensions: {}, deviation: 0, guideHint: '' };
    }
    // 协作流水：这一轮对话的步骤
    pushTrace(out, {
      title: `自由对话 · 第 ${turns + 1} 轮`,
      speaker: node.speaker,
      error: !out.trace,
    });
    turns += 1;
    const reply = out.reply || '（没有回应……）';

    // 记忆更新：人物这轮在聊什么、答应过什么、问过什么——下一拍必须承接
    if (out.memory) {
      state.memory = {
        ...out.memory,
        turns: turns >= maxTurns ? turns : 0,
      };
    }

    // 偏离检测：更新连续偏离计数（回归节拍会消费并清零，参见 deviation-guard skill）
    const dev = [0, 1, 2].includes(out.deviation) ? out.deviation : 0;
    state.deviation.last = dev;
    state.deviation.count = dev >= 1 ? state.deviation.count + 1 : 0;

    // 累计维度画像（AI 判定孩子这轮的表现落在哪些维度）
    for (const [k, v] of Object.entries(out.dimensions || {})) {
      state.dimensions[k] = (state.dimensions[k] || 0) + v;
    }
    addDims(out.dimensions);     // 同时累计到跨章总分（成长观察页）
    bumpStat('chats');
    // 记录互动上下文，供后续节拍参考（带说话人前缀，react 节拍据此分清谁说的）
    const who = out.speaker || node.speaker;
    state.history.push(
      { role: 'user', content: `小豆苗：${msg}` },
      { role: 'assistant', content: `${who}：${reply}` });
    state.history = state.history.slice(-12);
    // 孩子的话和 AI 的回复都记入对话回溯
    logDialog('小豆苗', msg);
    logDialog(who, reply);

    // AI 回复以打字机覆盖播放（标准 ADV 一句一幕，不堆叠气泡块）
    // 孩子的话已记入回溯，对话区只保留最新一句，保持清爽
    setSpeaker(who, out.source !== 'fallback');
    renderCast({ cast: node.cast, speaker: who });
    $('choices').innerHTML = '';          // 播放期间隐藏输入框
    clearInterval(state.typeTimer);
    state.typing = true;
    let ti = 0;
    $('storyText').innerHTML = '';
    await new Promise((resolve) => {
      state.typeTimer = setInterval(() => {
        ti += 2;
        if (ti >= reply.length) {
          ti = reply.length;
          clearInterval(state.typeTimer);
          state.typing = false;
          resolve();
        }
        $('storyText').innerHTML = decorate(reply.slice(0, ti));
      }, 20);
      // 打字期间点对话框可跳过
      $('dialogueBox').onclick = () => {
        if (state.typing) {
          clearInterval(state.typeTimer);
          state.typing = false;
          $('storyText').innerHTML = decorate(reply);
          resolve();
        }
      };
    });

    // 偏差度=2：孩子跑题了，水之子出面给方向（显性引导，不强制打断）
    if (out.guideHint) showGuideHint(out.guideHint);

    // 维度标签：回复播完后短暂展示在输入框上方，让孩子看到「AI 看懂了你的思路」
    const dimTags = Object.keys(out.dimensions || {})
      .map((k) => `<span class="dim-tag">✦ ${k}</span>`).join('');

    // 还有聊天额度 → 恢复输入框；同时始终给「继续剧情」
    input.value = '';
    const more = turns < maxTurns;
    $('choices').innerHTML = `
      ${dimTags ? `<div class="adv-dims">${dimTags}</div>` : ''}
      ${more ? hintRow(node) : ''}
      <div class="adv-input">
        <input id="advInput" class="adv-text" maxlength="80"
          placeholder="${more ? '还想说点什么？（也可以点「继续剧情」）' : '这一拍聊够啦，点「继续剧情」往下走'}"
          ${more ? '' : 'disabled'}>
        <button type="button" class="voice-btn" id="voiceBtn" title="用嘴说（点击后才请求麦克风）" ${more ? '' : 'style="display:none"'}>🎤</button>
        <button class="primary-btn adv-send" id="advSendBtn" ${more ? '' : 'disabled'}>${more ? '再聊一句' : '聊够啦'}</button>
      </div>
      <p class="voice-note" id="voiceNote"></p>`;
    if (more) {
      const ni = $('advInput'), nb = $('advSendBtn');
      nb.addEventListener('click', submit);
      ni.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
      bindHintChips();
      bindVoiceInput();
      ni.focus();
      startPetHints(node);     // 新一轮输入重新计时
      busy = false;
    } else {
      $('nextBtn').focus();
    }
    $('nextBtn').classList.remove('hidden');
    $('nextBtn').textContent = '继续剧情 ▼';
    $('nextBtn').onclick = () => fadeThenGo(node.next);
  }

  $('advSendBtn').addEventListener('click', submit);
  $('advInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  $('advInput').focus();
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// 把 [[词]] 变成可点击高亮术语
function decorate(text) {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/\[\[([^\]]+)\]\]/g, (_, term) => {
      const got = state.collected.includes(term) ? ' collected' : '';
      return `<span class="term${got}" data-term="${term}">${term}</span>`;
    });
}
/* 术语点击：文档级事件委托，只绑一次。
 * 打字机逐字重绘、react/auto 节拍现场生成的台词都会动态插入 .term，
 * 逐元素绑定会漏绑或重复绑定，改用委托后任何位置的高亮词都能点。 */
document.addEventListener('click', (e) => {
  const el = e.target.closest ? e.target.closest('.term') : null;
  if (!el || !el.dataset.term) return;
  showTip(el.dataset.term);
});

// ---------- tips 弹窗 ----------
let currentTipTerm = '';
async function showTip(term) {
  currentTipTerm = term;
  $('tipsTerm').textContent = term;
  $('tipsBrief').textContent = TERMS[term]?.brief || '这个术语的解释正在路上……';
  $('tipsModal').classList.add('show');
  $('swarmFlow').style.visibility = 'visible';

  // 首次点亮：本地缓存 + 上报服务器持久化
  if (!state.collected.includes(term)) {
    state.collected.push(term);
    localStorage.setItem('adv_tips', JSON.stringify(state.collected));
    updateBadge(); updatePet();
    try { await fetch(apiUrl('/api/tips'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ term }), keepalive: true }); }
    catch { /* 服务器没开也不影响游玩 */ }
  }
}
$('tipsCloseBtn').onclick = () => { $('tipsModal').classList.remove('show'); renderNode_refreshTerms(); };
$('tipsModal').addEventListener('click', (e) => { if (e.target.id === 'tipsModal') $('tipsModal').classList.remove('show'); });
$('tipsDeepBtn').onclick = () => { $('tipsModal').classList.remove('show'); openKb(currentTipTerm); };

// 关掉弹窗后刷新术语高亮状态（已收集的变绿）
function renderNode_refreshTerms() {
  document.querySelectorAll('.term').forEach((el) => {
    if (state.collected.includes(el.dataset.term)) el.classList.add('collected');
  });
}

// ---------- 知识库 ----------
async function openKb(term) {
  $('kbTerm').textContent = term;
  $('kbBody').textContent = '加载中……';
  $('kbMeta').textContent = '';
  $('kbExample').textContent = '';
  $('kbModal').classList.add('show');
  try {
    const r = await fetch(apiUrl('/api/knowledge/' + encodeURIComponent(term)));
    if (!r.ok) throw new Error();
    const d = await r.json();
    $('kbMeta').textContent = `${d.category} · ${d.year} · ${d.age || '全龄'}`;
    $('kbBody').textContent = d.article;
    $('kbExample').textContent = '💡 ' + d.example;
    // 相关概念：可点击跳转（知识图谱的入口）。related 可能是新格式 [{term,rel}] 或旧格式 [string]
    const relBox = $('kbRelated');
    if (relBox) {
      const raw = d.related || [];
      const rels = raw
        .map((r) => typeof r === 'string' ? { term: r, rel: '' } : r)   // 兼容旧格式
        .filter((r) => TERMS[r.term] || true);
      relBox.innerHTML = rels.length
        ? rels.map((r) => `<span class="kb-related" data-term="${r.term}">${r.term}${r.rel ? ` <em>${r.rel}</em>` : ''}</span>`).join('')
        : '<span class="kb-related-empty">暂无关联概念</span>';
      relBox.querySelectorAll('.kb-related').forEach((el) =>
        el.addEventListener('click', () => openKb(el.dataset.term)));
    }
  } catch {
    // 离线兜底：至少给出 brief
    $('kbBody').textContent = (TERMS[term]?.brief || '') + '\n\n（知识库服务未启动，仅显示简要内容。启动 node server.js 后可阅读完整文章。）';
  }
}
$('kbCloseBtn').onclick = () => $('kbModal').classList.remove('show');
$('kbModal').addEventListener('click', (e) => { if (e.target.id === 'kbModal') $('kbModal').classList.remove('show'); });

/* 知识库 2.0：独立于 ADV 的体系化阅读——分类分组卡片 + 搜索 + 分类筛选 */
let KB_CACHE = null, KB_CAT = '全部', KB_Q = '';
async function renderKbList() {
  const box = $('kbList');
  if (!KB_CACHE) box.innerHTML = '<p class="empty-hint">加载中……</p>';
  let list = KB_CACHE;
  if (!list) {
    try { list = await (await fetch(apiUrl('/api/knowledge'))).json(); }
    catch {
      // 离线：用本地 TERMS 兜底渲染
      list = Object.entries(TERMS).filter(([t]) => t !== '豆苗')
        .map(([t, v]) => ({ term: t, brief: v.brief, category: '基础概念', year: '-', age: '' }));
    }
    KB_CACHE = list;
  }
  // 词条滚动跑马灯：把所有词条列出来，复制一份无缝循环
  const track = $('kbTermTrack');
  if (track && list.length) {
    const terms = list.map((k) => `<span>${k.term}</span>`);
    const doubled = [...terms, ...terms].join('<i>◆</i>');
    track.innerHTML = doubled;
  }
  // 分类筛选条
  const cats = ['全部', ...new Set(list.map((k) => k.category))];
  if (!cats.includes(KB_CAT)) KB_CAT = '全部';
  $('kbCats').innerHTML = cats.map((c) =>
    `<button class="kb-cat-chip${c === KB_CAT ? ' active' : ''}" data-cat="${c}">${c}</button>`).join('');
  $('kbCats').querySelectorAll('.kb-cat-chip').forEach((b) =>
    b.addEventListener('click', () => { KB_CAT = b.dataset.cat; renderKbList(); }));
  // 过滤 + 分组
  const q = KB_Q.trim();
  const filtered = list.filter((k) =>
    (KB_CAT === '全部' || k.category === KB_CAT) &&
    (!q || k.term.includes(q) || (k.brief || '').includes(q)));
  if (!filtered.length) {
    box.innerHTML = '<p class="empty-hint">没有找到相关词条，换个关键词试试？</p>';
    return;
  }
  const groups = {};
  filtered.forEach((k) => { (groups[k.category] = groups[k.category] || []).push(k); });
  box.innerHTML = Object.entries(groups).map(([cat, items]) => `
    <div class="kb-group">
      <div class="kb-group-head"><span class="kb-group-dot"></span>${cat}<em>${items.length} 条</em></div>
      <div class="kb-cards">
        ${items.map((k, i) => `
          <div class="kb-card2" data-term="${k.term}" style="animation-delay:${Math.min(i, 8) * 60}ms">
            <div class="kb-card2-top">
              <span class="kb-year">${k.year}</span>
              ${k.age ? `<span class="kb-age">${k.age}</span>` : ''}
            </div>
            <h4>${k.term}</h4>
            <p>${k.brief}</p>
            <span class="kb-go">阅读全文 →</span>
          </div>`).join('')}
      </div>
    </div>`).join('');
  box.querySelectorAll('.kb-card2').forEach((r) =>
    r.addEventListener('click', () => openKb(r.dataset.term)));
}
/* 搜索框绑定（一次） */
if ($('kbSearch')) {
  $('kbSearch').addEventListener('input', (e) => { KB_Q = e.target.value; renderKbList(); });
}

// ---------- 知识图谱（聚焦式：以一个概念为中心，只展示强相关邻居，点击邻居平滑展开为新中心） ----------
const GRAPH_COLORS = {
  '基础概念': '#2fbf7f', 'AI的出生': '#3a8f6f', '第一次热潮': '#4a9d7a',
  '换个思路': '#5bbf8f', '蓄势待发': '#6fd4a4', '深度学习革命': '#63e6a4',
  'AI新时代': '#4e9fc4', '学习方法': '#3fae8a', '模型架构': '#2a8f6e',
  '应用方向': '#5aaac0', 'AI伦理': '#7fa898',
};
const SVG_NS = 'http://www.w3.org/2000/svg';
let _graphData = null;        // Map: term -> {category, related}
let _kbIndex = null;          // { list, map }：知识库索引，图谱与旁支小测共用
let _focus = '人工智能';      // 当前聚焦的中心概念
let _nodeEls = new Map();     // term -> <g> 元素（用于平滑过渡）
let _edgeLayer = null, _nodeLayer = null;

/* 知识库索引只拉一次：服务器在线走 /api/knowledge，离线退回前端 TERMS。
 * related 只保留确实存在的词条（兼容新旧格式），保证连线题不会指向不存在的概念。 */
async function getKbIndex() {
  if (_kbIndex) return _kbIndex;
  let list;
  try { list = await (await fetch(apiUrl('/api/knowledge'))).json(); }
  catch {
    list = Object.entries(TERMS).filter(([t]) => t !== '豆苗').map(([t, v]) => ({
      term: t, category: v.category || '基础概念', related: v.related || [],
    }));
  }
  const all = new Set(list.map((k) => k.term));
  _kbIndex = {
    list,
    map: new Map(list.map((k) => [
      k.term, {
        category: k.category,
        related: (k.related || [])
          .map((r) => typeof r === 'string' ? { term: r, rel: '' } : r)
          .filter((r) => all.has(r.term)),
      },
    ])),
  };
  return _kbIndex;
}

async function renderGraph() {
  const svg = $('graphSvg');
  if (!svg) return;
  const { list, map } = await getKbIndex();
  _graphData = map;

  // 图例
  const cats = [...new Set(list.map((k) => k.category))];
  $('graphLegend').innerHTML = cats.map((c) =>
    `<span class="lg-item"><span class="lg-dot" style="background:${GRAPH_COLORS[c] || '#9ca3af'}"></span>${c}</span>`
  ).join('');

  // 准备图层（边在下，节点在上）+ 绑定交互（仅一次）
  if (!_edgeLayer) {
    _edgeLayer = document.createElementNS(SVG_NS, 'g');
    _nodeLayer = document.createElementNS(SVG_NS, 'g');
    svg.appendChild(_edgeLayer);
    svg.appendChild(_nodeLayer);
    bindGraphEvents();
  }
  _focus = '人工智能';
  drawFocus();
}

function getNeighbors(term) {
  const d = _graphData.get(term);
  return d ? d.related.map((r) => r.term) : [];
}

// 以 _focus 为中心重绘：只显示它和它的直接相关概念
function drawFocus() {
  const svg = $('graphSvg');
  const W = svg.clientWidth || 800, H = svg.clientHeight || 560;
  const cx = W / 2, cy = H / 2;
  const focus = _focus;
  const neighbors = getNeighbors(focus);
  const visible = new Set([focus, ...neighbors]);

  // 布局：中心放 focus，邻居均匀分布在圆周上
  const radius = Math.min(W, H) * 0.33;
  const positions = new Map();
  positions.set(focus, { x: cx, y: cy });
  neighbors.forEach((t, i) => {
    const angle = (i / Math.max(1, neighbors.length)) * Math.PI * 2 - Math.PI / 2;
    positions.set(t, { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius });
  });

  // 1) 更新/退场已有节点
  for (const [term, el] of _nodeEls) {
    if (visible.has(term)) {
      const p = positions.get(term);
      const scale = term === focus ? 1.4 : 1.0;
      el.style.transform = `translate(${p.x}px, ${p.y}px) scale(${scale})`;
      el.style.opacity = 1;
      el.classList.toggle('focus', term === focus);
    } else {
      // 退场：缩回中心、淡出
      el.style.transform = `translate(${cx}px, ${cy}px) scale(0)`;
      el.style.opacity = 0;
      el.classList.remove('focus');
      const termCap = term;
      setTimeout(() => {
        if (_nodeEls.get(termCap) === el) { el.remove(); _nodeEls.delete(termCap); }
      }, 550);
    }
  }

  // 2) 新增节点：从中心放大出现
  for (const term of visible) {
    if (_nodeEls.has(term)) continue;
    const p = positions.get(term);
    const d = _graphData.get(term);
    const g = document.createElementNS(SVG_NS, 'g');
    g.classList.add('node');
    if (term === focus) g.classList.add('focus');
    g.dataset.term = term;
    g.style.transform = `translate(${cx}px, ${cy}px) scale(0)`;
    g.style.opacity = 0;
    g.style.transition = 'transform 0.6s cubic-bezier(.22,1,.36,1), opacity 0.45s';
    const c = document.createElementNS(SVG_NS, 'circle');
    c.setAttribute('r', 20);
    c.setAttribute('fill', GRAPH_COLORS[d.category] || '#9ca3af');
    g.appendChild(c);
    const t = document.createElementNS(SVG_NS, 'text');
    t.setAttribute('dy', 4);
    t.textContent = term.length > 5 ? term.slice(0, 5) : term;
    g.appendChild(t);
    _nodeLayer.appendChild(g);
    _nodeEls.set(term, g);
    requestAnimationFrame(() => {
      const scale = term === focus ? 1.4 : 1.0;
      g.style.transform = `translate(${p.x}px, ${p.y}px) scale(${scale})`;
      g.style.opacity = 1;
    });
  }

  // 3) 重绘连线（只画 focus → 邻居，并标注「相关」）
  drawEdges(focus, neighbors, positions);
}

function drawEdges(focus, neighbors, positions) {
  while (_edgeLayer.firstChild) _edgeLayer.removeChild(_edgeLayer.firstChild);
  const fp = positions.get(focus);
  const focusData = _graphData.get(focus);
  for (const t of neighbors) {
    const p = positions.get(t);
    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('x1', fp.x); line.setAttribute('y1', fp.y);
    line.setAttribute('x2', p.x); line.setAttribute('y2', p.y);
    line.setAttribute('class', 'link');
    line.style.opacity = 0;
    line.style.transition = 'opacity 0.5s';
    _edgeLayer.appendChild(line);
    requestAnimationFrame(() => { line.style.opacity = 1; });
    // 关系标签：从 focus 的 related 数组里找指向 t 的那条，读 rel
    const relEntry = focusData?.related?.find((r) => r.term === t);
    const relText = relEntry?.rel || '相关概念';
    const mx = (fp.x + p.x) / 2, my = (fp.y + p.y) / 2;
    const label = document.createElementNS(SVG_NS, 'text');
    label.setAttribute('x', mx); label.setAttribute('y', my - 5);
    label.setAttribute('class', 'edge-label');
    label.textContent = relText;
    label.style.opacity = 0;
    label.style.transition = 'opacity 0.5s';
    _edgeLayer.appendChild(label);
    requestAnimationFrame(() => { label.style.opacity = 1; });
  }
}

// 交互：单击邻居→设为新中心并展开；单击中心/双击节点→打开知识卡片；双击空白→回到根
function bindGraphEvents() {
  const svg = $('graphSvg');
  let dragNode = null, startX = 0, startY = 0, moved = false, clicks = 0, clickTimer = null;

  svg.addEventListener('mousedown', (e) => {
    const g = e.target.closest('.node');
    dragNode = g ? g.dataset.term : null;
    if (!g) return;
    const rect = svg.getBoundingClientRect();
    startX = (e.clientX - rect.left) * (svg.clientWidth / rect.width);
    startY = (e.clientY - rect.top) * (svg.clientHeight / rect.height);
    moved = false;
  });
  svg.addEventListener('mousemove', (e) => {
    if (!dragNode) return;
    const rect = svg.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (svg.clientWidth / rect.width);
    const y = (e.clientY - rect.top) * (svg.clientHeight / rect.height);
    if (Math.abs(x - startX) > 4 || Math.abs(y - startY) > 4) moved = true;
    if (moved) {
      const el = _nodeEls.get(dragNode);
      if (el) {
        const scale = dragNode === _focus ? 1.4 : 1.0;
        el.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
      }
    }
  });
  // 用标准 click 事件，避免被 preventDefault 阻断
  svg.addEventListener('click', (e) => {
    if (moved || !dragNode) return;
    const term = dragNode;
    dragNode = null;
    // 双击检测：两次单击间隔 < 300ms 视为双击 → 打开卡片
    clicks++;
    if (clicks === 1) {
      clickTimer = setTimeout(() => {
        clicks = 0;
        // 单击：中心→看卡片；邻居→设为新中心
        if (term === _focus) openKb(term);
        else { _focus = term; drawFocus(); }
      }, 280);
    } else {
      clearTimeout(clickTimer);
      clicks = 0;
      openKb(term);   // 双击任意节点 → 直接打开知识卡片
    }
  });
  svg.addEventListener('dblclick', (e) => {
    // 双击空白处 → 回到根
    if (!e.target.closest('.node')) {
      _focus = '人工智能';
      drawFocus();
    }
  });
}

// ---------- 连边小游戏（复用知识图谱的真实 related 数据，不新增任何题目内容） ----------
const LG_ROUNDS = 5;
let lg = null;

function lgShuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* 出一道题：中心词 + 3 个真实邻居 + 3 个「既不是邻居、也不反向指向中心词」的干扰项。
 * 干扰项排除反向边，保证题目只有一个正确答案集合，不靠猜。 */
function lgPickRound() {
  if (!_graphData || !_graphData.size) { lg.cur = null; return; }
  const all = [..._graphData.keys()];
  const neighborsOf = (t) => (_graphData.get(t)?.related || [])
    .filter((r) => _graphData.has(r.term));
  const eligible = all.filter((t) => neighborsOf(t).length >= 3);
  if (!eligible.length) { lg.cur = null; return; }
  let pool = eligible.filter((t) => !lg.used.has(t));
  if (!pool.length) { lg.used.clear(); pool = eligible; }
  const focus = pool[Math.floor(Math.random() * pool.length)];
  lg.used.add(focus);
  const rels = neighborsOf(focus);
  const picked = lgShuffle(rels).slice(0, 3);
  const answers = new Set(picked.map((r) => r.term));
  const relOf = new Map(picked.map((r) => [r.term, r.rel || '相关']));
  const decoys = all.filter((t) =>
    t !== focus && !answers.has(t) &&
    !rels.some((r) => r.term === t) &&
    !neighborsOf(t).some((r) => r.term === focus));
  lg.cur = {
    focus, answers, relOf,
    choices: lgShuffle([...answers, ...lgShuffle(decoys).slice(0, 3)]),
  };
  lg.picked = new Set();
  lg.phase = 'pick';
}

function renderLinkRound() {
  const c = lg.cur;
  $('lgProgress').textContent = `第 ${lg.round} / ${LG_ROUNDS} 题`;
  $('lgScore').textContent = `${lg.score} 分`;
  $('lgQuestionText').innerHTML = `和「<b id="lgTerm">${escapeHtml(c.focus)}</b>」真正相连的概念是？<small>可多选</small>`;
  $('lgChoices').innerHTML = c.choices.map((t) =>
    `<button class="lg-chip" data-term="${escapeHtml(t)}">${escapeHtml(t)}</button>`).join('');
  $('lgChoices').querySelectorAll('.lg-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (lg.phase !== 'pick') return;
      const t = btn.dataset.term;
      if (lg.picked.has(t)) { lg.picked.delete(t); btn.classList.remove('picked'); }
      else { lg.picked.add(t); btn.classList.add('picked'); }
    });
  });
  const fb = $('lgFeedback');
  fb.textContent = '';
  fb.className = 'lg-feedback';
  $('lgSubmit').textContent = '提交答案';
}

function lgSubmitRound() {
  if (!lg || !lg.cur) return;
  if (lg.phase === 'end') { startLinkGame(); return; }
  if (lg.phase === 'show') {
    if (lg.round < LG_ROUNDS) { lg.round += 1; lgPickRound(); renderLinkRound(); }
    else finishLinkGame();
    return;
  }
  // phase === 'pick'
  if (!lg.picked.size) {
    const fb = $('lgFeedback');
    fb.textContent = '先选几个你觉得相连的概念吧。';
    fb.className = 'lg-feedback show';
    return;
  }
  lg.phase = 'show';
  let hit = 0, missed = 0, wrong = 0;
  $('lgChoices').querySelectorAll('.lg-chip').forEach((btn) => {
    const t = btn.dataset.term;
    const isAnswer = lg.cur.answers.has(t);
    const isPicked = lg.picked.has(t);
    btn.disabled = true;
    btn.classList.remove('picked');
    if (isAnswer && isPicked) { btn.classList.add('right'); hit += 1; }
    else if (isAnswer) { btn.classList.add('missed'); missed += 1; }
    else if (isPicked) { btn.classList.add('wrong'); wrong += 1; }
  });
  const perfect = missed === 0 && wrong === 0;
  if (perfect) lg.score += 1;
  const realEdges = [...lg.cur.answers]
    .map((t) => `${lg.cur.focus} → ${t}（${lg.cur.relOf.get(t)}）`).join('；');
  const fb = $('lgFeedback');
  fb.innerHTML = `${perfect ? '✅ 全对！+1 分' : `差一点：漏了 ${missed} 条，多选了 ${wrong} 条`}<span class="lg-answer">真正的连线：${escapeHtml(realEdges)}</span>`;
  fb.className = `lg-feedback show ${perfect ? 'ok' : 'no'}`;
  $('lgScore').textContent = `${lg.score} 分`;
  $('lgSubmit').textContent = lg.round < LG_ROUNDS ? '下一题 ▶' : '看看成绩 ▶';
}

function finishLinkGame() {
  lg.phase = 'end';
  $('lgProgress').textContent = '完成';
  $('lgQuestionText').textContent = '本局结束。';
  $('lgChoices').innerHTML = '';
  const fb = $('lgFeedback');
  fb.innerHTML = `🏁 你连对了 <b>${lg.score}</b> / ${LG_ROUNDS} 组。${lg.score === LG_ROUNDS ? '每一条边都找对了，图谱已经装进脑子里啦！' : '回到图谱里再点一点中心词，看看它真正的邻居是谁。'}`;
  fb.className = 'lg-feedback show';
  $('lgSubmit').textContent = '再来一局';
}

async function startLinkGame() {
  if (!_graphData) await renderGraph();
  const box = $('linkGame');
  if (!box) return;
  box.hidden = false;
  $('linkGameStart') && ($('linkGameStart').textContent = '↻ 重新开始');
  lg = { round: 1, score: 0, used: new Set(), phase: 'pick', cur: null, picked: new Set() };
  lgPickRound();
  if (!lg.cur) {
    $('lgFeedback').textContent = '图谱数据不足，先去知识库看看词条吧。';
    return;
  }
  renderLinkRound();
}

$('linkGameStart') && $('linkGameStart').addEventListener('click', startLinkGame);
$('lgSubmit') && $('lgSubmit').addEventListener('click', lgSubmitRound);
$('lgClose') && $('lgClose').addEventListener('click', () => {
  const box = $('linkGame');
  if (box) box.hidden = true;
  lg = null;
});

// ---------- 旁支小测：章节术语连线（可选，不写剧情状态） ----------
/* 从本章白名单挑一个中心词，用知识库真实 related 出 1 道「6 选 3」。
 * 浮层不暂停剧情、不计分；点「跳过」直接回到当前对话。 */
const sq = { cur: null, choices: [], picked: new Set(), phase: 'pick' };
let sqChapter = '';

function closeSideQuiz() {
  const box = $('sideQuiz');
  if (box) box.classList.add('hidden');
  sq.cur = null;
  sqChapter = '';
}

async function openSideQuiz() {
  const box = $('sideQuiz');
  if (!box) return;
  sqChapter = state.chapter || '';
  $('sqChapter').textContent = sqChapter.split(' · ')[0] || '本章';
  $('sqQuestion').textContent = '正在翻开知识卡片…';
  $('sqChoices').innerHTML = '';
  $('sqFeedback').className = 'lg-feedback';
  $('sqSubmit').hidden = true;
  box.classList.remove('hidden');

  const { map } = await getKbIndex();
  const terms = (typeof CHAPTER_TERMS !== 'undefined' && CHAPTER_TERMS[sqChapter]) || [];
  const nbrs = (t) => (map.get(t)?.related || []).filter((r) => map.has(r.term));
  const eligible = terms.filter((t) => nbrs(t).length >= 3);

  if (!eligible.length) {
    sq.cur = null;
    $('sqQuestion').textContent = '这一章暂时没有可连线的术语，点「跳过」继续剧情吧。';
    $('sqSubmit').hidden = true;
    return;
  }

  const focus = eligible[Math.floor(Math.random() * eligible.length)];
  const rels = nbrs(focus);
  const answers = lgShuffle(rels).slice(0, 3);
  const answerSet = new Set(answers.map((a) => a.term));
  // 干扰项：既不是中心词的邻居，也不反向指向中心词，保证答案唯一
  const decoys = [...map.keys()].filter((t) =>
    t !== focus && !answerSet.has(t) &&
    !(map.get(t)?.related || []).some((r) => r.term === focus));
  sq.cur = {
    focus,
    answerSet,
    relOf: new Map(answers.map((a) => [a.term, a.rel || '相关'])),
  };
  sq.choices = lgShuffle([...answerSet, ...lgShuffle(decoys).slice(0, 3)]);
  sq.picked = new Set();
  sq.phase = 'pick';
  renderSideQuiz();
}

function renderSideQuiz() {
  const c = sq.cur;
  $('sqQuestion').innerHTML =
    `和「<b>${escapeHtml(c.focus)}</b>」真正相连的概念是？<small>可多选 · 挑出 3 个</small>`;
  $('sqChoices').innerHTML = sq.choices.map((t) =>
    `<button class="lg-chip" data-term="${escapeHtml(t)}">${escapeHtml(t)}</button>`).join('');
  $('sqChoices').querySelectorAll('.lg-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (sq.phase !== 'pick') return;
      const t = btn.dataset.term;
      if (sq.picked.has(t)) { sq.picked.delete(t); btn.classList.remove('picked'); }
      else { sq.picked.add(t); btn.classList.add('picked'); }
    });
  });
  $('sqFeedback').textContent = '';
  $('sqFeedback').className = 'lg-feedback';
  $('sqSubmit').hidden = false;
  $('sqSubmit').textContent = '提交答案';
}

function submitSideQuiz() {
  if (!sq.cur) return;
  if (sq.phase === 'show') { openSideQuiz(); return; }   // 再来一题
  if (!sq.picked.size) {
    const fb = $('sqFeedback');
    fb.textContent = '先选几个你觉得相连的概念吧。';
    fb.className = 'lg-feedback show';
    return;
  }
  sq.phase = 'show';
  let missed = 0, wrong = 0;
  $('sqChoices').querySelectorAll('.lg-chip').forEach((btn) => {
    const t = btn.dataset.term;
    const isAnswer = sq.cur.answerSet.has(t);
    const isPicked = sq.picked.has(t);
    btn.disabled = true;
    btn.classList.remove('picked');
    if (isAnswer && isPicked) btn.classList.add('right');
    else if (isAnswer) { btn.classList.add('missed'); missed += 1; }
    else if (isPicked) { btn.classList.add('wrong'); wrong += 1; }
  });
  const perfect = missed === 0 && wrong === 0;
  const edges = [...sq.cur.answerSet]
    .map((t) => `${sq.cur.focus} → ${t}（${sq.cur.relOf.get(t)}）`).join('；');
  const fb = $('sqFeedback');
  fb.innerHTML = (perfect ? '✅ 全对！这一章的术语你接住了。' : `差一点：漏了 ${missed} 条，多选了 ${wrong} 条。`)
    + `<span class="lg-answer">真正的连线：${escapeHtml(edges)}</span>`;
  fb.className = `lg-feedback show ${perfect ? 'ok' : 'no'}`;
  $('sqSubmit').textContent = '再来一题';
}

$('quizBtn') && $('quizBtn').addEventListener('click', () => {
  const box = $('sideQuiz');
  if (box && !box.classList.contains('hidden')) { closeSideQuiz(); return; }
  openSideQuiz();
});
$('sqClose') && $('sqClose').addEventListener('click', closeSideQuiz);
$('sqSubmit') && $('sqSubmit').addEventListener('click', submitSideQuiz);

// ---------- 开发期临时：章节跳转（?dev=1 显示；上线前删除） ----------
const DEV_MODE = new URLSearchParams(location.search).get('dev') === '1'
  || localStorage.getItem('adv_dev') === '1';
const DEV_CHAPTERS = [
  { id: 'p0', label: '序章' },
  ...TIMELINE.map((t) => ({ id: t.nodeId, label: `${t.year} · ${t.label}` })),
  { id: 'sort7', label: '章间 · 时间轴排序' },
  { id: 'z0', label: '尾声' },
];

function renderDevPanel() {
  const box = $('devPanel');
  if (!box) return;
  box.innerHTML = `<div class="dv-top"><b>🛠 章节跳转</b><small>开发期临时入口</small></div>`
    + DEV_CHAPTERS.map((c) => {
      const n = STORY.nodes[c.id];
      return `<button class="dv-item" data-id="${c.id}">${escapeHtml(c.label)}<small>${escapeHtml(n ? n.chapter : '')}</small></button>`;
    }).join('');
  box.querySelectorAll('.dv-item').forEach((btn) => btn.addEventListener('click', () => {
    box.classList.add('hidden');
    renderNode(btn.dataset.id);
  }));
}

if (DEV_MODE) {
  const btn = $('devBtn');
  if (btn) {
    btn.classList.remove('hidden');
    btn.addEventListener('click', () => {
      const box = $('devPanel');
      if (!box) return;
      if (box.classList.contains('hidden')) { renderDevPanel(); box.classList.remove('hidden'); }
      else box.classList.add('hidden');
    });
  }
}

// ---------- 手账 ----------
async function renderTipsGrid() {
  // 服务器为准，本地为兜底
  let serverTips = {};
  try { serverTips = await (await fetch(apiUrl('/api/tips'))).json(); } catch { /* 离线 */ }
  const terms = [...new Set([...Object.keys(serverTips), ...state.collected])];
  $('tipsBadge').textContent = terms.length;
  $('tipsEmpty').style.display = terms.length ? 'none' : 'block';
  $('tipsGrid').innerHTML =
    (state.conclusions.length
      ? state.conclusions.map((c) => `
        <div class="tip-card concl-tip" data-term="${escapeHtml(c.term)}">
          <h4>${escapeHtml(c.term)} · 本章一句话</h4>
          <p>${escapeHtml(c.line)}</p>
          <span class="tip-count">${escapeHtml(c.chapter || '')}</span>
        </div>`).join('')
      : '') +
    terms.map((t) => `
    <div class="tip-card" data-term="${t}">
      <h4>${t}</h4>
      <p>${TERMS[t]?.brief || ''}</p>
      <span class="tip-count">已点亮${serverTips[t] ? ' · 看过 ' + serverTips[t].count + ' 次' : ''}</span>
    </div>`).join('');
  $('tipsGrid').querySelectorAll('.tip-card').forEach((c) =>
    c.addEventListener('click', () => openKb(c.dataset.term)));
  const bn = $('bookName');
  if (bn) bn.textContent = `${playerName()}的小小研究者手账`;
  renderClaims();
}

/* ---------- 我的科学主张：每章一句孩子自己的话，存本地，导出时带上 ---------- */
function saveClaim(chapter, text) {
  state.claims[chapter] = text.slice(0, 40);
  localStorage.setItem('adv_claims_v1', JSON.stringify(state.claims));
}
function renderClaims() {
  const box = $('claimsBox');
  if (!box) return;
  if (!state.conclusions.length) { box.innerHTML = ''; return; }
  const rows = state.conclusions.map((c) => {
    const ch = c.chapter || '';
    return `<div class="claim-row">
      <label class="claim-ch">${escapeHtml(ch.split(' · ')[0])}</label>
      <input class="claim-input" data-ch="${escapeHtml(ch)}" maxlength="40"
        placeholder="这一章，我自己的想法是……" value="${escapeHtml(state.claims[ch] || '')}">
    </div>`;
  }).join('');
  box.innerHTML = `<div class="claims-head">✍️ 我的科学主张 <small>每章写一句自己的话，导出时会一起带上</small></div>${rows}`;
  box.querySelectorAll('.claim-input').forEach((inp) =>
    inp.addEventListener('input', () => saveClaim(inp.dataset.ch, inp.value)));
}

/* 导出「小小研究者手账」：单文件 HTML，离线可开、可打印，不含任何联网资源 */
function exportBook() {
  const name = playerName();
  const chips = state.collected.map((t) => `<span class="chip">${escapeHtml(t)}</span>`).join('');
  const chapters = state.conclusions.map((c) => `
    <div class="ch">
      <div class="ch-name">${escapeHtml(c.chapter || '')}</div>
      <div class="ch-line">${escapeHtml(c.line)}</div>
      <div class="ch-meta">关键词 · ${escapeHtml(c.term)}</div>
      <div class="ch-claim">我自己的想法：<b>${escapeHtml(state.claims[c.chapter] || '（还没写——回到手账补一句吧）')}</b></div>
    </div>`).join('') || '<div class="ch">还没有走完任何一章。</div>';
  const html = `<!doctype html><meta charset="utf-8"><title>${escapeHtml(name)}的小小研究者手账</title>
<style>
body{font-family:"PingFang SC","Microsoft YaHei",sans-serif;background:#f6faf4;color:#3a4a40;max-width:720px;margin:0 auto;padding:32px 24px}
h1{font-size:26px;color:#2f4a38;margin:0 0 6px}p.sub{color:#62796a;margin:0 0 22px;font-size:14px}
.ch{background:#fff;border:1px solid #e0ebdd;border-left:4px solid #8ecf7a;border-radius:14px;padding:14px 16px;margin:0 0 12px}
.ch-name{font-size:13px;color:#5aa75c;letter-spacing:.04em}.ch-line{font-size:19px;font-weight:700;margin:6px 0}
.ch-meta{font-size:13px;color:#d97b2f}.ch-claim{font-size:14px;color:#62796a;margin-top:8px;line-height:1.7}
h2{font-size:16px;margin:26px 0 10px;color:#2f4a38}.chip{display:inline-block;background:#eef7e8;border:1px solid #d6e9cf;border-radius:999px;padding:4px 10px;margin:0 6px 8px 0;font-size:13px}
footer{margin-top:26px;color:#8fa697;font-size:12px}
</style>
<h1>🌱 ${escapeHtml(name)}的小小研究者手账</h1>
<p class="sub">豆苗时光机 · 八章走完，带走八句话 · ${new Date().toLocaleDateString('zh-CN')}</p>
${chapters}
<h2>我点亮的关键词（${state.collected.length} 个）</h2>
<p>${chips || '还没有点亮关键词'}</p>
<footer>这是我在「豆苗时光机」里自己写的手账。每一章的那句话，都可以念给大人听。</footer>`;
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name}-小小研究者手账.html`;
  document.body.appendChild(a);
  const btn = $('exportBookBtn');
  if (btn) {
    btn.textContent = '已导出 ✓';
    setTimeout(() => { btn.textContent = '⬇ 导出我的手账'; }, 1800);
  }
  try { a.click(); } catch { /* 个别浏览器禁止脚本触发下载，手账内容已在页面预览 */ }
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}
$('exportBookBtn').addEventListener('click', exportBook);

// ---------- 成长观察（家长/教师只读页） ----------
/* 只展示：五维累计分、提示使用次数、结论卡是否获得、主张是否写过、术语点亮数。
 * 隐私边界：不显示昵称、聊天原文、时间与任何可识别身份的信息。 */
const DIM_ADVICE = {
  '怀疑精神': '孩子爱追问。可以顺着他问一句「你凭什么这么想？证据呢？」',
  '同理心':   '孩子会照顾人物的感受。可以聊聊「如果换成你，你会怎么做？」',
  '创造力':   '孩子常冒出比喻和怪问题。别急着纠正，问一句「还能怎么比？」',
  '严谨度':   '孩子开始给观点配理由。可以请他把想法讲成「因为……所以……」。',
  '勇气':     '孩子敢说不一样的话。先肯定这份勇气，再一起看看别人为什么不同意。',
};

function drawGrowRadar(vals, ceiling) {
  const svg = $('growRadar');
  if (!svg) return;
  const cx = 170, cy = 152, R = 100, n = GROW_DIMS.length;
  const pt = (v, i) => {
    const a = -Math.PI / 2 + i * Math.PI * 2 / n;
    const r = R * Math.max(0, Math.min(1, v / ceiling));
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  };
  const ringPts = (frac) => GROW_DIMS
    .map((_, i) => pt(ceiling * frac, i).map((x) => x.toFixed(1)).join(','))
    .join(' ');
  const rings = [0.25, 0.5, 0.75, 1]
    .map((f) => `<polygon class="radar-ring" points="${ringPts(f)}"/>`).join('');
  const axes = GROW_DIMS.map((_, i) => {
    const [x, y] = pt(ceiling, i);
    return `<line class="radar-axis" x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"/>`;
  }).join('');
  const dots = vals.map((v, i) => {
    const [x, y] = pt(v, i);
    return `<circle class="radar-dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.2"/>`;
  }).join('');
  const area = vals.some((v) => v > 0)
    ? `<polygon class="radar-area" points="${vals.map((v, i) => pt(v, i).map((x) => x.toFixed(1)).join(',')).join(' ')}"/>`
    : '';
  const labels = GROW_DIMS.map((d, i) => {
    const a = -Math.PI / 2 + i * Math.PI * 2 / n;
    const x = cx + Math.cos(a) * (R + 22);
    const y = cy + Math.sin(a) * (R + 22);
    const anchor = Math.abs(Math.cos(a)) < 0.2 ? 'middle' : (Math.cos(a) > 0 ? 'start' : 'end');
    const dy = Math.sin(a) < -0.5 ? -6 : (Math.sin(a) > 0.5 ? 12 : 4);
    return `<text class="radar-label" x="${x.toFixed(1)}" y="${(y + dy).toFixed(1)}" text-anchor="${anchor}">${d.key}</text>`;
  }).join('');
  svg.innerHTML = `
    <text class="radar-cap" x="332" y="16" text-anchor="end">满分 ${ceiling}</text>
    <g class="radar-grid">${rings}${axes}</g>
    <g class="radar-data">${area}${dots}</g>
    ${labels}`;
}

function renderGrow() {
  const vals = GROW_DIMS.map((d) => Number(state.dimsTotal[d.key]) || 0);
  const maxV = Math.max(0, ...vals);
  const ceiling = Math.max(10, Math.ceil(maxV / 5) * 5);
  const totalDims = vals.reduce((a, b) => a + b, 0);
  drawGrowRadar(vals, ceiling);

  const tag = $('growDataTag');
  if (tag) tag.textContent = totalDims ? `累计 ${totalDims} 分` : '等待互动';

  // 雷达图下的五维明细：分数 + 进度条 + 一句话解释
  $('growDims').innerHTML = GROW_DIMS.map((d, i) => {
    const v = vals[i];
    const pct = ceiling ? Math.min(100, v / ceiling * 100) : 0;
    return `<div class="grow-dim">
      <div class="gd-top"><span class="gd-name">${d.key}</span><span class="gd-num">${v}</span></div>
      <div class="gd-bar"><i style="width:${pct.toFixed(1)}%"></i></div>
      <div class="gd-desc">${d.desc}</div>
    </div>`;
  }).join('');

  const allChapters = [...new Set(Object.values(STORY.nodes).map((n) => n.chapter).filter(Boolean))];
  const visitedChapters = new Set([...state.visited].map((id) => STORY.nodes[id]?.chapter).filter(Boolean));
  const concl = state.conclusions.length;
  const claims = state.conclusions.filter((c) => String(state.claims[c.chapter] || '').trim()).length;
  const termTotal = Object.keys(TERMS).length;
  const hints = ['hintChips', 'petL1', 'petL2', 'petL3', 'guideHints']
    .reduce((a, k) => a + (state.stats[k] || 0), 0);

  $('growStats').innerHTML = [
    { n: visitedChapters.size, d: allChapters.length, label: '走过的章节' },
    { n: concl, d: allChapters.length, label: '获得的结论卡' },
    { n: claims, d: concl, label: '写下的科学主张' },
    { n: state.collected.length, d: termTotal, label: '点亮的术语' },
    { n: state.stats.chats || 0, d: '', label: '自由对话轮数' },
  ].map((s) => `<div class="gs-item">
      <span class="gs-num">${s.n}${s.d ? `<em>/${s.d}</em>` : ''}</span>
      <span class="gs-label">${s.label}</span>
    </div>`).join('');

  $('growHints').innerHTML = [
    ['点提示（输入框上方）', state.stats.hintChips],
    ['桌宠 L1 · 12 秒', state.stats.petL1],
    ['桌宠 L2 · 30 秒', state.stats.petL2],
    ['桌宠 L3 · 45 秒', state.stats.petL3],
    ['AI 方向引导', state.stats.guideHints],
  ].map(([label, n]) => `<div class="gh-row"><span>${label}</span><b>${n || 0}</b></div>`).join('')
    + `<div class="gh-total">合计 <b>${hints}</b> 次 · 提示少不代表孩子差，只说明他更愿意先自己想</div>`;

  // 章末结论卡：显示游戏给的那句话（不是孩子的输入）；主张只显示「写没写」
  const byCh = {};
  state.conclusions.forEach((c) => { if (c.chapter) byCh[c.chapter] = c; });
  $('growConcl').innerHTML = allChapters.map((ch) => {
    const c = byCh[ch];
    const hasClaim = c && String(state.claims[ch] || '').trim();
    return `<div class="gc-row${c ? ' got' : ''}">
      <span class="gc-ch">${escapeHtml(ch.split(' · ')[0])}</span>
      <span class="gc-line">${c ? escapeHtml(c.line) : '未走到本章'}</span>
      <span class="gc-term">${c ? escapeHtml(c.term) : ''}</span>
      <span class="gc-claim">${c ? (hasClaim ? '✍️ 已写主张' : '— 未写主张') : ''}</span>
    </div>`;
  }).join('');

  // 观察建议：按数据给 1~3 条，不评价孩子「好/差」
  const advice = [];
  if (!totalDims && !state.stats.chats) {
    advice.push('还没有足够的互动数据。先陪孩子走完一章，雷达会随他的真实发言慢慢长出来。');
  } else {
    const topIdx = vals.indexOf(maxV);
    if (maxV > 0) advice.push(DIM_ADVICE[GROW_DIMS[topIdx].key]);
    if (hints >= 6 && (state.stats.chats || 0) <= 3) {
      advice.push(`提示合计用了 ${hints} 次。可以先请他自己想 10 秒，再点提示——提示是扶手，不是答案。`);
    }
    if (concl > claims) {
      advice.push(`有 ${concl - claims} 张结论卡还没写「我的主张」。回到手账补一句，导出的手账会更完整。`);
    }
    if (!advice.length) advice.push('互动正在积累。多问一句「为什么」，雷达上的变化会更明显。');
  }
  $('growAdvice').innerHTML = advice.slice(0, 3).map((t) => `<li>${escapeHtml(t)}</li>`).join('');
}

function updateBadge() { $('tipsBadge').textContent = state.collected.length; }

// ---------- 小豆苗成长（玩家进度，收集术语驱动） ----------
const PET_STAGES = [
  { min: 0,  icon: '🌱', name: 'Lv.1 种子' },
  { min: 3,  icon: '🌿', name: 'Lv.2 嫩芽' },
  { min: 6,  icon: '🪴', name: 'Lv.3 小苗' },
  { min: 9,  icon: '🌷', name: 'Lv.4 花苞' },
  { min: 12, icon: '🌻', name: 'Lv.5 绽放' },
];
function updatePet() {
  const n = state.collected.length;
  const stage = [...PET_STAGES].reverse().find((s) => n >= s.min) || PET_STAGES[0];
  $('petLevel').textContent = `${stage.icon} 小豆苗 ${stage.name}`;
}

// ---------- 水之子聊天：悬停显示提示气泡，点击才打开聊天框（避免遮挡剧情） ----------
let chatPinned = false;
let hideTimer = null;

function showChat() {
  clearTimeout(hideTimer);
  if (!$('chatPanel').classList.contains('show')) {
    $('chatPanel').classList.add('show');
    document.documentElement.style.setProperty('--chat-h', ($('chatPanel').offsetHeight + 12) + 'px');
    if (!$('chatBody').children.length) {
      addMsg('ai', '你好呀小豆苗！我是水之子💧 冒险里有任何看不懂的地方，都可以问我哦！');
    }
  }
  $('pet').classList.add('above-chat');   // 碰撞体积：聊天框出现时桌宠上移，不被盖住
}
function hideChat() {
  $('chatPanel').classList.remove('show');
  $('pet').classList.remove('above-chat');
}
function scheduleHideChat() {
  if (chatPinned) return;
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    if (!chatPinned) hideChat();
  }, 600);
}

// 点击小头像：展开完整形象 + 打开聊天；再点收起
$('pet').addEventListener('click', () => {
  const pet = $('pet');
  const expanded = pet.classList.toggle('expanded');
  if (expanded) { chatPinned = true; showChat(); $('chatInput').focus(); }
  else { chatPinned = false; hideChat(); }
});
$('chatPanel').addEventListener('mouseenter', () => clearTimeout(hideTimer));
$('chatPanel').addEventListener('mouseleave', scheduleHideChat);
$('chatInput').addEventListener('focus', () => { chatPinned = true; });
// 关闭聊天时同步收起立绘形象
$('chatCloseBtn').onclick = () => {
  chatPinned = false;
  hideChat();
  $('pet').classList.remove('expanded');
};

function addMsg(who, text) {
  const div = document.createElement('div');
  div.className = 'msg ' + who;
  div.textContent = text;
  $('chatBody').appendChild(div);
  $('chatBody').scrollTop = $('chatBody').scrollHeight;
  return div;
}

// 本地兜底：离线时也能回答术语相关问题
function localReply(q) {
  for (const [term, v] of Object.entries(TERMS)) {
    if (q.includes(term)) return `${term}呀——${v.brief} 想深入的话，去知识库里找它的完整故事吧！`;
  }
  if (/你好|hi|哈喽/i.test(q)) return '你好呀！继续冒险吧，遇到亮闪闪的词记得点开看看～';
  if (/谢谢|感谢/.test(q)) return '不客气！小豆苗今天又变聪明了一点🌱';
  return '这个问题有点难倒我了……要不先去剧情里转转？点亮更多术语卡，我就会越来越聪明的！';
}

async function sendChat() {
  const input = $('chatInput');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  addMsg('me', text);
  const trace = addTrace(text);

  try {
    const r = await fetch(apiUrl('/api/chat'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text }),
    });
    const d = await r.json();
    if (d.fallback || !d.reply) {
      trace.finish(false);
      addMsg('ai', localReply(text));
      $('chatStatus').textContent = '本地演示模式（AI未连接，回答来自内置知识）';
    } else {
      trace.finish(true);
      addMsg('ai', d.reply);
      $('chatStatus').textContent = 'AI 实时回答';
    }
  } catch {
    trace.finish(false);
    addMsg('ai', localReply(text));
    $('chatStatus').textContent = '本地演示模式（服务未连接）';
  }
}

/* 「水之子在想什么」：不照搬 DeepSeek 的推理面板，
 * 做成三颗会依次亮起来的小气泡：听懂 → 翻小本本 → 想好怎么说。
 * 半透明 + 大圆角 + 逐步点亮，白天夜间都跟主题走。 */
function addTrace(question) {
  const body = $('chatBody');
  const hits = Object.keys(TERMS).filter((t) => question.includes(t)).slice(0, 3);

  const el = document.createElement('div');
  el.className = 'think-card';
  el.innerHTML =
    '<div class="think-head"><span class="think-face">💧</span><span class="think-title">水之子在想…</span></div>' +
    '<div class="think-steps">' +
      '<div class="think-step"><span class="think-num">1</span><div class="think-body"><b>听懂你的话</b><span class="think-detail">在找它认识的词…</span></div></div>' +
      '<div class="think-step"><span class="think-num">2</span><div class="think-body"><b>翻一翻小本本</b><span class="think-detail">看看记过什么…</span></div></div>' +
      '<div class="think-step"><span class="think-num">3</span><div class="think-body"><b>想好怎么说</b><span class="think-detail">用你听得懂的话…</span></div></div>' +
    '</div>';
  body.appendChild(el);

  const steps = Array.from(el.querySelectorAll('.think-step'));
  let i = 0;
  const timer = setInterval(() => {
    if (i >= steps.length) { clearInterval(timer); return; }
    steps[i].classList.add('live');
    i += 1;
  }, 420);

  el.finish = (fromAI) => {
    clearInterval(timer);
    steps.forEach((s) => s.classList.add('live'));
    el.classList.add('done');
    el.querySelector('.think-title').textContent = '水之子刚才是这么想的';
    steps[0].querySelector('.think-detail').textContent =
      hits.length ? '认出了：' + hits.join('、') : '没听到特别的词，就顺着你聊';
    steps[1].querySelector('.think-detail').textContent =
      fromAI ? '把相关词条和它的性子一起带上' : '从内置知识里挑最接近的一条';
    steps[2].querySelector('.think-detail').textContent =
      fromAI ? '一句一句，组织成回答' : '用固定句式回答，断网也能玩';
    body.scrollTop = body.scrollHeight;
  };

  body.scrollTop = body.scrollHeight;
  return el;
}
$('chatSendBtn').onclick = sendChat;
$('chatInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });

// ---------- API Key 设置（别人可填入自己的 Key） ----------
const SOURCE_TEXT = { saved: '本机保存', env: '.env 默认', none: '未配置' };

function paintApiConfig(c) {
  // 云端：Key 由管理员在环境变量里配好，访客看不到「接入 AI」入口
  if (c && c.cloud) {
    $('apiBtn').style.display = 'none';
    return;
  }
  const box = $('apiStatus');
  if (!c || !c.hasKey) {
    box.className = 'api-status off';
    box.textContent = '⚠️ 当前没有可用 Key，AI 会静默降级为本地应答（剧情照样能玩完）';
    $('apiBtn').classList.remove('ok');
    return;
  }
  box.className = 'api-status ok';
  box.textContent = `✅ 已接入 · ${c.keyMasked} · ${c.model} · 来源：${SOURCE_TEXT[c.source] || c.source}`;
  $('apiBtn').classList.add('ok');
}

async function loadApiConfig() {
  try {
    paintApiConfig(await (await fetch(apiUrl('/api/config'))).json());
  } catch {
    $('apiStatus').className = 'api-status off';
    $('apiStatus').textContent = '后端未连接，无法读取配置';
  }
}

function apiTip(text, kind) {
  const el = $('apiTip');
  el.className = 'api-tip' + (kind ? ' ' + kind : '');
  el.textContent = text;
}

$('apiBtn').onclick = () => {
  $('apiModal').classList.add('show');
  $('apiKeyInput').value = '';
  $('apiModelInput').value = '';
  apiTip('没有 Key？到阿里云百炼控制台创建一个再粘贴进来；不填也能离线玩完整个冒险。');
  loadApiConfig();
};
$('apiCloseBtn').onclick = () => $('apiModal').classList.remove('show');
$('apiModal').addEventListener('click', (e) => {
  if (e.target.id === 'apiModal') $('apiModal').classList.remove('show');
});

$('apiSaveBtn').onclick = async () => {
  const apiKey = $('apiKeyInput').value.trim();
  const model = $('apiModelInput').value.trim();
  if (!apiKey) return apiTip('请先粘贴 API Key', 'err');
  const btn = $('apiSaveBtn');
  btn.disabled = true; btn.textContent = '保存中…';
  try {
    const r = await fetch(apiUrl('/api/config'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey, model }),
    });
    const d = await r.json();
    if (!r.ok) { apiTip('保存失败：' + (d.error || '未知错误'), 'err'); return; }
    $('apiKeyInput').value = '';
    paintApiConfig(d);
    apiTip('已保存，下一句对话就会用你的 Key，刷新页面也不会丢。', 'ok');
    $('chatStatus').textContent = `已切换到 ${d.model}（${d.keyMasked}）`;
  } catch {
    apiTip('保存失败：后端没连上', 'err');
  } finally {
    btn.disabled = false; btn.textContent = '保存并启用';
  }
};

$('apiTestBtn').onclick = async () => {
  const btn = $('apiTestBtn');
  btn.disabled = true; btn.textContent = '测试中…';
  apiTip('正在用当前 Key 发一条测试请求……');
  try {
    const d = await (await fetch(apiUrl('/api/config/test'), { method: 'POST' })).json();
    apiTip((d.ok ? '✅ ' : '❌ ') + d.message + (d.ms ? `（${d.ms} ms）` : ''), d.ok ? 'ok' : 'err');
  } catch {
    apiTip('测试失败：后端没连上', 'err');
  } finally {
    btn.disabled = false; btn.textContent = '测试连接';
  }
};

$('apiClearBtn').onclick = async () => {
  if (!confirm('确定清除本机保存的 Key？清除后会退回 .env 里的默认 Key（如果配了）。')) return;
  try {
    const d = await (await fetch(apiUrl('/api/config'), { method: 'DELETE' })).json();
    paintApiConfig(d);
    $('apiKeyInput').value = '';
    $('apiModelInput').value = '';
    apiTip('已清除本机 Key，回到 .env 默认配置（如果有）。', 'ok');
  } catch {
    apiTip('清除失败：后端没连上', 'err');
  }
};

// ---------- AI 小工坊面板：把一次回答拆成四步，讲给孩子听 ----------
const ORCH_AGENT_CLASS = {
  导演: 'dir', 人物: 'who', 守门: 'guard', 记忆: 'mem',
  判定: 'cls', 向导: 'guide', 调度: 'sys', 汇总: 'sum',
};
const ORCH_STATUS_CLASS = { warn: 'st-warn', block: 'st-block', retry: 'st-retry', fail: 'st-fail' };
/* 后端的六个 Agent 按语义收进四格：听懂 → 想起 → 开口 → 检查 */
const ORCH_GROUPS = [
  { name: '听懂你的话', icon: '👂', agents: ['判定', '向导'] },
  { name: '想起刚才聊的', icon: '💭', agents: ['导演', '记忆'] },
  { name: '让角色开口', icon: '🎭', agents: ['人物'] },
  { name: '检查再整理', icon: '🔍', agents: ['守门', '汇总', '调度'] },
];
const ORCH_ORDER = ORCH_GROUPS.map((g) => g.name);
const ORCH_ICON = Object.fromEntries(ORCH_GROUPS.map((g) => [g.name, g.icon]));
/* 详情行里的角色名也换成孩子能懂的说法 */
const ORCH_AGENT_LABEL = {
  导演: '安排', 记忆: '回忆', 判定: '理解', 人物: '开口',
  守门: '检查', 汇总: '收尾', 向导: '带路', 调度: '系统',
};
const SLOT_STATUS = { ok: 'st-ok', warn: 'st-warn', fail: 'st-fail', idle: 'st-idle' };
function slotStatus(steps) {
  if (steps.some((s) => s.status === 'fail' || s.status === 'block')) return 'fail';
  if (steps.some((s) => s.status === 'retry' || s.status === 'warn')) return 'warn';
  return steps.length ? 'ok' : 'idle';
}
/* 把一拍里各 Agent 的步骤收拢到四个槽位上，没出现就是 idle */
function pipeline(turn) {
  return ORCH_GROUPS.map((g) => {
    const steps = turn.steps.filter((s) => g.agents.includes(s.agent));
    return { name: g.name, steps, status: slotStatus(steps), ms: steps.reduce((a, s) => a + (s.ms || 0), 0) };
  });
}

/* 记一拍流水：后端返回的 trace 原样展示；没有 trace（如断网）就补一条说明，
 * 保证面板永远有话说，不会突然空白让人以为是坏了 */
function pushTrace(out, ctx = {}) {
  const hasTrace = Array.isArray(out.trace) && out.trace.length;
  const steps = hasTrace ? out.trace : [{
    agent: '调度',
    action: '未收到协作流水',
    detail: ctx.error ? '后端不可达，已切换本地兜底台词' : '本次未产生调用',
    ms: 0,
    status: ctx.error ? 'fail' : 'warn',
  }];
  const turn = {
    title: ctx.title || '互动',
    speaker: out.speaker || ctx.speaker || '',
    source: out.source || 'ai',
    aiText: ctx.aiText || '',
    fallbackText: ctx.fallbackText || '',
    reasoning: out._reasoning || '',
    meta: out.meta || {
      ms: steps.reduce((s, x) => s + (x.ms || 0), 0),
      calls: steps.filter((x) => x.agent === '人物').length,
    },
    steps,
  };
  state.traceTurns.unshift(turn);
  state.traceTurns = state.traceTurns.slice(0, 8);
  // 面板只是展示层：万一 DOM 缺失也不能连累对话流程
  try { renderOrch(); } catch (e) { console.warn('[orch] 渲染失败', e); }
  try { if (typeof swarmFromTrace === 'function') swarmFromTrace(out); } catch (e) { console.warn('[swarm] 触发失败', e); }
  if (!state.orchSeen) { state.orchSeen = true; setOrch(true); }   // 首次自动亮一次，让人看见它在跑
}

function renderOrch() {
  const box = $('orchFlowContent');
  if (!box || !state.traceTurns.length) return;
  const empty = $('orchEmpty');
  if (empty) empty.style.display = 'none';
  const latest = state.traceTurns[0];
  const slots = pipeline(latest);
  /* 最新一拍：上方一条横向接力管道，节点颜色 = 状态；
   * 下方是这一拍的详细步骤卡片 */
  const pipeHtml = `
    <div class="orch-pipe">
      ${slots.map((slot, i) => `
        <div class="pipe-slot ${SLOT_STATUS[slot.status]}" style="animation-delay:${i * 90}ms">
          <div class="pipe-node">${ORCH_ICON[slot.name] || ''}</div>
          <div class="pipe-name">${slot.name}</div>
          <div class="pipe-ms">${slot.ms ? slot.ms + 'ms' : '—'}</div>
        </div>${i < slots.length - 1 ? '<div class="pipe-arrow"></div>' : ''}`).join('')}
    </div>`;
  const stepsHtml = latest.steps.map((s, si) => `
    <div class="orch-step ${ORCH_STATUS_CLASS[s.status] || ''}" style="animation-delay:${si * 70}ms">
      <span class="orch-agent ${ORCH_AGENT_CLASS[s.agent] || 'sys'}">${escapeHtml(ORCH_AGENT_LABEL[s.agent] || s.agent)}</span>
      <span class="orch-act">${escapeHtml(s.action)}</span>
      <span class="orch-detail">${escapeHtml(s.detail || '')}</span>
      <span class="orch-ms">${s.ms ? s.ms + 'ms' : ''}</span>
    </div>`).join('');
  const prevHtml = state.traceTurns.slice(1).map((t) => `
    <div class="orch-prev">
      <span class="orch-prev-title">${escapeHtml(t.title)}${t.speaker ? ' · ' + escapeHtml(t.speaker) : ''}</span>
      <span class="orch-prev-meta">${t.source === 'ai' ? 'AI' : '兜底'} · ${t.meta.ms}ms · ${t.meta.calls} 次</span>
    </div>`).join('');

  /* 对照卡固定看「最近一次有预写台词的剧情拍」：桌宠提示等界面拍也会进流水，
   * 若直接用 latest，对照卡会被提示拍顶掉，演示时就看不到了 */
  const cmpTurn = latest.fallbackText ? latest : (state.traceTurns.find((t) => t.fallbackText) || null);
  const compareHtml = cmpTurn ? `
    <div class="orch-compare">
      <div class="oc-card oc-ai">
        <div class="oc-head"><span class="oc-tag ai">AI 实时生成</span></div>
        <p class="oc-body">${cmpTurn.aiText ? escapeHtml(cmpTurn.aiText) : '本次未调用模型（断网 / 无 Key），走右栏。'}</p>
      </div>
      <div class="oc-card oc-fb">
        <div class="oc-head"><span class="oc-tag fb">预写兜底</span></div>
        <p class="oc-body">${escapeHtml(cmpTurn.fallbackText)}</p>
      </div>
    </div>
    <p class="oc-note">对照 · ${escapeHtml(cmpTurn.title)}${cmpTurn.speaker ? ' · ' + escapeHtml(cmpTurn.speaker) : ''}：同一拍的两种台词，断掉后端右栏照样把戏演完。</p>` : '';

  box.innerHTML = `
    <div class="orch-turn fresh">
      <div class="orch-turn-head">
        <span class="orch-turn-title">${escapeHtml(latest.title)}${latest.speaker ? ' · ' + escapeHtml(latest.speaker) : ''}</span>
        <span class="orch-turn-meta">
          <span class="orch-mode swarm">✨ 接力完成</span>
          <span class="orch-src ${latest.source === 'ai' ? 'ai' : 'fb'}">${latest.source === 'ai' ? 'AI 现场写的' : '本地兜底'}</span>
          ${latest.meta.ms}ms · ${latest.meta.calls} 次生成
        </span>
      </div>
      ${pipeHtml}
      <div class="orch-steps">${stepsHtml}</div>
      ${compareHtml}
      ${latest.reasoning ? `<details class="orch-reasoning"><summary>💭 它心里的小算盘</summary><p>${escapeHtml(latest.reasoning)}</p></details>` : ''}
      ${prevHtml ? `<div class="orch-prev-list">${prevHtml}</div>` : ''}
    </div>`;

  const sub = $('orchSub');
  if (sub) sub.textContent = `${latest.title}${latest.speaker ? ' · ' + latest.speaker : ''} · ${latest.source === 'ai' ? '实时生成' : '本地兜底'}`;
  const calls = state.traceTurns.reduce((s, t) => s + (t.meta.calls || 0), 0);
  const stat = $('orchStat');
  if (stat) stat.textContent = `最近 ${state.traceTurns.length} 拍 · 生成 ${calls} 次 · 本拍 ${latest.meta.ms}ms`;
  const fab = $('orchFab');
  if (fab) fab.classList.add('has-data');
}

function setOrch(open) {
  const panel = $('orchPanel');
  const fab = $('orchFab');
  if (panel) panel.classList.toggle('show', open);
  if (fab) fab.classList.toggle('active', open);
}
$('orchFab').onclick = () => setOrch(!$('orchPanel').classList.contains('show'));
$('orchCloseBtn').onclick = () => setOrch(false);

/* ---------- 蜂群视图（Swarm 结构实时动画） ---------- */
/* 数据驱动：读取后端 trace 里「调度 / Swarm·X → handoff → Y」事件，
 * 按序在 SVG 图上点亮节点、流动边。面板只是展示层，任何异常都不能影响对话。 */
const SW_NODE_LABEL = { director: '小导演', memory: '小记忆', judge: '小判官', persona: '小演员', gatekeeper: '小守卫', summary: '小管家' };

function swarmEls() {
  const svg = $('swarmSvg');
  if (!svg) return null;
  return {
    nodes: Array.from(svg.querySelectorAll('.sw-node')),
    edges: Array.from(svg.querySelectorAll('.sw-edge')),
  };
}
function swarmReset() {
  const els = swarmEls();
  if (!els) return;
  els.nodes.forEach((n) => n.classList.remove('active', 'done'));
  els.edges.forEach((e) => e.classList.remove('active', 'flow'));
}
function swarmSetCaption(text, playing) {
  const cap = $('swCaption');
  if (!cap) return;
  cap.textContent = text;
  cap.classList.toggle('playing', !!playing);
}
/* 从一拍的 steps 中抽出 handoff 序列：[{from, to}...]；to 为 null 表示终态 */
function swarmExtract(steps) {
  const seq = [];
  (steps || []).forEach((s) => {
    if (s.agent !== '调度' || !/^Swarm·/.test(s.action)) return;
    const from = s.action.replace(/^Swarm·/, '');
    const m = /handoff → (.+)$/.exec(s.detail || '');
    if (!m) return;
    const to = m[1] === '终态' ? null : m[1];
    seq.push({ from, to });
  });
  return seq;
}
/* 播放一串 handoff：节点依次 active→done，边流动 */
function swarmPlay(seq, captionPrefix) {
  const els = swarmEls();
  if (!els || !seq.length) return;
  swarmReset();
  if (state._swarmTimers) state._swarmTimers.forEach(clearTimeout);
  state._swarmTimers = [];
  const STEP_MS = 460;
  seq.forEach((hop, i) => {
    const t = setTimeout(() => {
      // 上一个节点标 done
      if (i > 0) {
        const prev = els.nodes.find((n) => n.dataset.node === seq[i - 1].from);
        if (prev) { prev.classList.remove('active'); prev.classList.add('done'); }
      }
      // 停掉上一条边的流动
      els.edges.forEach((e) => e.classList.remove('flow'));
      // 点亮当前节点
      const cur = els.nodes.find((n) => n.dataset.node === hop.from);
      if (cur) cur.classList.add('active');
      // 流动当前边
      if (hop.to) {
        const edge = els.edges.find((e) => e.dataset.edge === `${hop.from}-${hop.to}`);
        if (edge) edge.classList.add('active', 'flow');
        swarmSetCaption(`${captionPrefix}${SW_NODE_LABEL[hop.from] || hop.from} → ${SW_NODE_LABEL[hop.to] || hop.to}`, true);
      } else {
        swarmSetCaption(`${captionPrefix}${SW_NODE_LABEL[hop.from] || hop.from} → 完成 ✓`, true);
      }
      // 最后一步收尾
      if (i === seq.length - 1) {
        const tEnd = setTimeout(() => {
          const last = els.nodes.find((n) => n.dataset.node === hop.from);
          if (last) { last.classList.remove('active'); last.classList.add('done'); }
          els.edges.forEach((e) => e.classList.remove('flow'));
          swarmSetCaption(`${captionPrefix}本次流转完成 ✓`, false);
        }, STEP_MS);
        state._swarmTimers.push(tEnd);
      }
    }, i * STEP_MS);
    state._swarmTimers.push(t);
  });
}
/* 对话返回后调用：按 trace 播放蜂群流转 */
function swarmFromTrace(out) {
  try {
    if (!out || !out.meta || !out.trace) return;
    const seq = swarmExtract(out.trace);
    if (seq.length) swarmPlay(seq, '');
  } catch (e) { console.warn('[swarm] 播放失败', e); }
}
/* orch 面板内标签切换：蜂群 / 流水 */
function orchTab(tab) {
  const swarm = tab === 'swarm';
  const paneS = $('paneSwarm'), paneF = $('paneFlow');
  const tabS = $('tabSwarm'), tabF = $('tabFlow');
  if (paneS) paneS.classList.toggle('show', swarm);
  if (paneF) paneF.classList.toggle('show', !swarm);
  if (tabS) tabS.classList.toggle('active', swarm);
  if (tabF) tabF.classList.toggle('active', !swarm);
}
const tabSwarmEl = $('tabSwarm');
if (tabSwarmEl) tabSwarmEl.onclick = () => orchTab('swarm');
const tabFlowEl = $('tabFlow');
if (tabFlowEl) tabFlowEl.onclick = () => orchTab('flow');

/* 演示：不走 API，按固定序列播一遍（含一次守门驳回重写，展示 handoff 回环） */
const swarmDemoEl = $('swarmDemoBtn');
if (swarmDemoEl) swarmDemoEl.onclick = () => {
  orchTab('swarm');   // 确保在蜂群标签页
  swarmDemoEl.disabled = true;
  swarmPlay([
    { from: 'director', to: 'memory' },
    { from: 'memory', to: 'judge' },
    { from: 'judge', to: 'persona' },
    { from: 'persona', to: 'gatekeeper' },
    { from: 'gatekeeper', to: 'persona' },   // 驳回重写（虚线回环）
    { from: 'persona', to: 'gatekeeper' },
    { from: 'gatekeeper', to: 'summary' },
    { from: 'summary', to: null },
  ], '演示 · ');
  setTimeout(() => { swarmDemoEl.disabled = false; }, 460 * 8 + 600);
};

// ---------- 对话回溯面板（人狼村之谜式ログ） ----------
function toggleLog() {
  const modal = $('logModal');
  if (modal.classList.contains('show')) closeLog(); else openLog();
}
function openLog() {
  renderLog();
  $('logModal').classList.add('show');
}
function closeLog() {
  $('logModal').classList.remove('show');
}
function renderLog() {
  const list = $('logList');
  const foot = $('logFoot');
  if (!state.dialogLog.length) {
    list.innerHTML = '<p class="empty-hint" style="padding:30px 0">还没有对话记录，先说几句话吧～</p>';
    foot.textContent = '共 0 条';
    return;
  }
  list.innerHTML = state.dialogLog.map((l) => {
    // 章节分隔线：新旧章节的界限一眼可见
    if (l.divider) return `<div class="log-divider">${escapeHtml(l.chapter)}</div>`;
    return `
    <div class="log-item">
      <span class="log-speaker">${escapeHtml(l.speaker)}</span>
      <span class="log-text">${decorate(l.text)}</span>
    </div>`;
  }).join('');
  foot.textContent = `共 ${state.dialogLog.length} 条 · 按 L 关闭`;
  // 滚到最新一条
  requestAnimationFrame(() => { list.scrollTop = list.scrollHeight; });
}
$('logBtn').onclick = openLog;
$('logCloseBtn').onclick = closeLog;
// 点击遮罩空白处关闭
$('logModal').addEventListener('click', (e) => { if (e.target.id === 'logModal') closeLog(); });

document.addEventListener('keydown', (e) => {
  const tag = (e.target && e.target.tagName) || '';
  if (/INPUT|TEXTAREA|SELECT/.test(tag)) return;   // 输入框里不抢快捷键
  if (e.key === '`') {
    e.preventDefault();
    setOrch(!$('orchPanel').classList.contains('show'));
  } else if (e.key === 'l' || e.key === 'L') {
    e.preventDefault();
    toggleLog();
  } else if (e.key === 'm' || e.key === 'M') {
    e.preventDefault();
    switchView('gate');
  }
});

// ---------- 启动 ----------
updateBadge();
updatePet();
renderTimeline();
/* 续玩入口：有上次记录就在左上角给一颗「继续」按钮，不点也不挡路 */
(function initResume() {
  const chip = $('resumeChip');
  const last = state.player.lastNode;
  if (!chip || !last || !STORY.nodes[last] || last === STORY.start) return;
  chip.textContent = `继续上次：${(STORY.nodes[last].chapter || '').split(' · ')[0]}`;
  chip.classList.remove('hidden');
  chip.addEventListener('click', () => {
    chip.classList.add('hidden');
    renderNode(last);
  });
})();
renderNode(STORY.start);
loadApiConfig();
/* 页面打开就把模型连接焐热（只花 1 个 token），避免第一次对话吃冷启动的 1~2 秒 */
fetch(apiUrl('/api/warm')).catch(() => {});

/* =========================================================
 * 主题加餐：三个「看得见 AI」的小互动
 * 1) 同一句话问三次 —— 看见模型的不确定性
 * 2) 喂什么，学什么 —— 看见数据决定它认识什么
 * 3) 安全小测 —— 少年网络安全判断题
 * ========================================================= */

// ---------- 1. 同一句话问三次 ----------
$('chatTryBtn').addEventListener('click', async () => {
  const btn = $('chatTryBtn');
  if (btn.disabled) return;
  const q = $('chatInput').value.trim() || '什么是人工智能？';
  $('chatInput').value = '';
  btn.disabled = true;
  btn.textContent = '正在问…';
  addMsg('me', q + '（同一个问题，连问三次）');
  const answers = [];
  for (let i = 1; i <= 3; i++) {
    const t = addMsg('ai', `第 ${i} 次：思考中…`);
    try {
      const r = await fetch(apiUrl('/api/chat'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: q }),
      });
      const d = await r.json();
      t.textContent = `第 ${i} 次：` + (d.reply || localReply(q));
      answers.push(d.reply || '');
    } catch {
      t.textContent = `第 ${i} 次：` + localReply(q);
      answers.push('');
    }
  }
  const same = answers.every((a) => a === answers[0]);
  addMsg('ai', same
    ? '三次一模一样。现在是离线兜底模式，用的是固定句式；接上模型后，你会看到它每次的措辞都不同。'
    : '看，同一句话，三次措辞都不一样。AI 不是查字典，它是在一个词一个词地「猜」。');
  btn.disabled = false;
  btn.textContent = '同一句话，问三次';
});

// ---------- 2. 喂什么，学什么 ----------
let biasTaught = false;
function openBias() {
  biasTaught = false;
  $('biasSamples').textContent = '🐱 🐱 🐱';
  $('biasRule').textContent = '规则：尖耳朵 + 胡须 + 毛 = 猫';
  $('biasAnswer').textContent = '它说：这是猫。';
  $('biasAnswer').classList.remove('ok');
  $('biasTeachBtn').textContent = '补一张狗的样本';
  $('biasTeachBtn').disabled = false;
  $('biasNote').textContent = '它只见过猫，所以把狗也叫成猫。不是它笨，是我们没教过。';
  $('biasModal').classList.add('show');
}
$('biasTeachBtn').addEventListener('click', () => {
  if (biasTaught) return;
  biasTaught = true;
  $('biasSamples').textContent = '🐱 🐱 🐱  🐶';
  $('biasRule').textContent = '规则更新：尖耳朵 + 胡须 + 毛 = 猫；长嘴 + 垂耳 = 狗';
  $('biasAnswer').textContent = '它说：这是狗。✓';
  $('biasAnswer').classList.add('ok');
  $('biasTeachBtn').textContent = '已补上';
  $('biasTeachBtn').disabled = true;
  $('biasNote').textContent = '只补了一张样本，它就会了。但样本里要是没有黑猫，它可能又不认识——数据里没有的，它看不见。';
});
$('biasCloseBtn').addEventListener('click', () => $('biasModal').classList.remove('show'));
$('biasModal').addEventListener('click', (e) => { if (e.target.id === 'biasModal') $('biasModal').classList.remove('show'); });

// ---------- 3. 安全小测 ----------
const SAFETY_QS = [
  { q: '游戏里有人说：扫码就送你一套免费皮肤。', opts: ['扫一下', '不扫'], right: 1,
    tip: '免费皮肤是最常见的诱饵，二维码可能把你带到假网站。' },
  { q: '一个陌生网站要你输入爸爸手机收到的验证码。', opts: ['给他', '不给'], right: 1,
    tip: '验证码等于家门钥匙，谁要都不给。' },
  { q: '弹窗说你中奖了，让你填家庭住址领奖。', opts: ['填上', '不填'], right: 1,
    tip: '真实活动不会要住址，填了就是把隐私交出去。' },
];
let safetyScore = 0;
function openSafety() {
  safetyScore = 0;
  $('safetyScore').textContent = '0 / 3 题';
  const box = $('safetyList');
  box.innerHTML = '';
  SAFETY_QS.forEach((item, qi) => {
    const card = document.createElement('div');
    card.className = 'safety-item';
    card.innerHTML = `<p class="safety-q">${qi + 1}. ${item.q}</p>`;
    const row = document.createElement('div');
    row.className = 'safety-opts';
    item.opts.forEach((label, oi) => {
      const b = document.createElement('button');
      b.className = 'safety-opt';
      b.textContent = label;
      b.addEventListener('click', () => {
        if (card.classList.contains('done')) return;
        card.classList.add('done');
        const ok = oi === item.right;
        b.classList.add(ok ? 'right' : 'wrong');
        if (!ok) row.children[item.right].classList.add('right');
        const tip = document.createElement('p');
        tip.className = 'safety-tip' + (ok ? ' ok' : '');
        tip.textContent = (ok ? '答对了。' : '再想想。') + item.tip;
        card.appendChild(tip);
        if (ok) safetyScore += 1;
        $('safetyScore').textContent = `${safetyScore} / 3 题`;
      });
      row.appendChild(b);
    });
    card.appendChild(row);
    box.appendChild(card);
  });
  $('safetyModal').classList.add('show');
}
$('safetyCloseBtn').addEventListener('click', () => $('safetyModal').classList.remove('show'));
$('safetyModal').addEventListener('click', (e) => { if (e.target.id === 'safetyModal') $('safetyModal').classList.remove('show'); });

// ---------- 游戏卡片入口 ----------
document.querySelectorAll('[data-open]').forEach((el) => {
  el.addEventListener('click', (e) => {
    e.preventDefault();
    if (el.dataset.open === 'bias') openBias();
    if (el.dataset.open === 'safety') openSafety();
  });
});
