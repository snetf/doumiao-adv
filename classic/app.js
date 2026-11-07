/* =========================================================
 * app.js —— 前端逻辑
 *   1. ADV 剧情引擎（打字机 + 分支选项 + 时间轴点亮）
 *   2. 术语高亮 → tips 弹窗 → 上报服务器 → 知识库深读
 *   3. 豆苗成长（收集数驱动等级）
 *   4. 水之子聊天（AI 在线则用 AI，离线走本地兜底）
 * ========================================================= */

// ---------- 状态 ----------
const state = {
  nodeId: STORY.start,
  typing: false,
  typeTimer: null,
  collected: JSON.parse(localStorage.getItem('adv_tips') || '[]'), // 本地缓存（服务器为主）
  visited: new Set(),
  dimensions: {},            // 本章维度画像：{ 怀疑精神: 3, 同理心: 1 ... }，进入新章节时清空
  history: [],               // 本章互动对话（喂给 AI 做上下文）
  memory: {},                // 对话记忆：{ topic, pending, openQuestion } —— 跨节拍承接上一轮的话题
  chapter: '',               // 当前章节名，用于检测章节切换
  deviation: { count: 0, last: 0 },  // 连续偏离计数 + 上一拍偏差值（deviation-guard）
  traceTurns: [],            // 多Agent 协作面板：最近几拍的调用流水
  orchSeen: false,           // 首次出现流水时自动亮一次面板
  dialogLog: [],             // 对话回溯：所有已播台词（人狼村之谜式ログ）
  mode: localStorage.getItem('adv_mode') === 'swarm' ? 'swarm' : 'pipeline',  // 后端编排模式
  typeNode: null,            // 正在打字的那一拍（点一下 / 空格 补全时要用）
  typeRaw: '',               // 这一拍的完整台词
  skipTyping: null,          // AI 回复打字时的收尾钩子（要 resolve 外面的 Promise）
};

const $ = (id) => document.getElementById(id);

/* 导航序号：每次跳章/点继续都会 +1，让还在排队的老动画（章节卡、淡出）自动作废，
   避免快速连点 / 章节卡播放中再跳章时，旧章节把新章节顶掉 */
let navSeq = 0;

/* ---------- 后端地址 ----------
   默认同源：server.js 同时托管页面和 /api 接口，直接可用。
   如果后端单独部署（比如同学的电脑上），把 config.js 里的 window.API_BASE
   改成 http://192.168.1.8:3002 这样的地址即可，所有请求都会自动带上它。 */
const API_BASE = String(window.API_BASE || '').replace(/\/$/, '');
const api = (p) => API_BASE + p;

/* ---------- 可靠的 JSON 请求 ----------
   云端（FC）会有冷启动、偶发 502 和网络抖动，单个 fetch 失败就会显示「连接不上」。
   这里统一做：超时中断 + 自动重试 + 禁用缓存，失败才向上抛。 */
async function fetchJson(path, opt = {}) {
  const { timeout = 9000, retry = 2, method = 'GET', body, headers } = opt;
  let lastErr;
  for (let attempt = 0; attempt <= retry; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const init = { method, signal: ctrl.signal, cache: 'no-store' };
      if (body !== undefined) {
        init.body = body;
        init.headers = headers || { 'Content-Type': 'application/json' };
      } else if (headers) {
        init.headers = headers;
      }
      const r = await fetch(api(path), init);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const data = await r.json();
      clearTimeout(timer);
      return data;
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
      if (attempt < retry) {
        await new Promise((res) => setTimeout(res, 600 * (attempt + 1)));
      }
    }
  }
  throw lastErr;
}

/* ---------- 说话人头像（剧情互动可视化） ---------- */
const SPEAKER_AVATAR = {
  '旁白':   { emoji: '📜', bg: '#eef2f7' },
  '水之子': { img: '../assets/shuizhizi_cut.webp' },
  '小豆苗': { emoji: '🌱', bg: '#eef7e8' },
  '图灵':   { emoji: '🏃', bg: '#e9f3fa' },
  '麦卡锡': { emoji: '🖋️', bg: '#eef7e8' },
  '香农':   { emoji: '🤹', bg: '#fdf3e3' },
  '辛顿':   { emoji: '🔥', bg: '#fdeeee' },
  '明斯基': { emoji: '🦉', bg: '#f0eefb' },
  '老医生': { emoji: '🩺', bg: '#eef7e8' },
  '费根鲍姆': { emoji: '📚', bg: '#fdf3e3' },
  '布坎南': { emoji: '⚗️', bg: '#eef7e8' },
  '肖特利夫': { emoji: '🩻', bg: '#e9f3fa' },
  '许峰雄': { emoji: '🎩', bg: '#fdf3e3' },
  '坎贝尔': { emoji: '♟️', bg: '#eef7e8' },
  '李飞飞': { emoji: '👩‍🔬', bg: '#fdeeee' },
  '亚历克斯': { emoji: '🎮', bg: '#e9f3fa' },
  '吴恩达': { emoji: '🧠', bg: '#fdf3e3' },
  '黄士杰': { emoji: '💻', bg: '#e9f3fa' },
  '樊麾': { emoji: '⚫', bg: '#f0eefb' },
  '李世石': { emoji: '🏆', bg: '#fdf3e3' },
  '工程师': { emoji: '🔧', bg: '#e9f3fa' },
  '瓦斯瓦尼': { emoji: '👓', bg: '#f0eefb' },
  '苏茨克维': { emoji: '🔬', bg: '#fdeeee' },
};
function avatarHtml(name) {
  const a = SPEAKER_AVATAR[name] || SPEAKER_AVATAR['旁白'];
  return a.img
    ? `<span class="sp-av"><img src="${a.img}" alt="${name}"></span>`
    : `<span class="sp-av" style="background:${a.bg}">${a.emoji}</span>`;
}
/* 说话人标签：头像 + 名字 */
function setSpeaker(name) {
  $('speaker').innerHTML = `${avatarHtml(name)}<span class="sp-name">${name}</span>`;
}
/* 在场角色条：node.cast = ['麦卡锡','香农'] 时显示「在场：香农」，
   只列「除了发言者之外」的人，避免和左边的说话人标签重复 */
function renderCast(node) {
  const bar = $('castBar');
  if (!bar) return;
  const cast = node.cast;
  if (!cast || !cast.length) { bar.classList.remove('show'); bar.innerHTML = ''; return; }
  const others = cast.filter((name) => name !== node.speaker);
  if (!others.length) { bar.classList.remove('show'); bar.innerHTML = ''; return; }
  bar.innerHTML = '<span class="cm-label">在场</span>' + others.map((name) => {
    const a = SPEAKER_AVATAR[name] || SPEAKER_AVATAR['旁白'];
    const av = a.img
      ? `<div class="cm-av"><img src="${a.img}" alt="${name}"></div>`
      : `<div class="cm-av" style="background:${a.bg}">${a.emoji}</div>`;
    return `<div class="cast-member">${av}<div class="cm-name">${name}</div></div>`;
  }).join('');
  bar.classList.add('show');
}

// ---------- 视图切换 ----------
function switchView(name) {
  document.querySelectorAll('.tab-btn').forEach((b) =>
    b.classList.toggle('active', b.dataset.view === name));
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  $('view-' + name).classList.add('active');
  if (name === 'story') renderTimeline();
  if (name === 'tips') {
    renderTipsGrid();
    window.ChapterGame?.renderShelf();   // 手账顶部：冒险贴纸架
  }
  if (name === 'kb') renderKbList();
  if (name === 'spot') window.SpotDiff?.mount();
  if (name === 'graph') renderGraph();
  // 「AGENT 协作」是剧情页的工具，别的板块收起来，别挡内容
  $('orchFab')?.classList.toggle('is-away', name === 'spot');
}
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
});

/* ---------- 窄屏导航列表：≤1024 顶栏只留「目录」，点开后是整页列表 ---------- */
const navSheetEl = $('navSheet');
const navToggleEl = $('navToggle');
function setNavSheet(open) {
  if (!navSheetEl) return;
  navSheetEl.hidden = !open;
  document.body.classList.toggle('nav-open', open);
  if (navToggleEl) navToggleEl.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (!open) return;
  const apiItem = navSheetEl.querySelector('[data-api]');
  const apiBtnEl = $('apiBtn');
  if (apiItem && apiBtnEl) apiItem.hidden = apiBtnEl.style.display === 'none';
  const cur = navSheetEl.querySelector('.tab-btn.active');
  if (cur) cur.focus({ preventScroll: true });
}
if (navToggleEl) {
  navToggleEl.addEventListener('click', () => setNavSheet(navSheetEl.hidden));
}
if (navSheetEl) {
  const navCloseBtn = $('navClose');
  if (navCloseBtn) navCloseBtn.addEventListener('click', () => setNavSheet(false));
  navSheetEl.addEventListener('click', (e) => {
    if (e.target === navSheetEl) return setNavSheet(false);
    if (e.target.closest('[data-api]')) {
      setNavSheet(false);
      if ($('apiBtn')) $('apiBtn').click();
      return;
    }
    if (e.target.closest('.tab-btn')) setNavSheet(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !navSheetEl.hidden) setNavSheet(false);
  });
}
// 首屏 CTA 也走同一套视图切换
document.querySelectorAll('.hero-actions [data-view]').forEach((btn) => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
});
// 大门卡片跳转（仅开放板块）
document.querySelectorAll('.gate-card.open').forEach((card) => {
  card.addEventListener('click', () => switchView(card.dataset.goto));
});
switchView('gate');   // 默认落在大门

// ---------- 时间轴 ----------
/* 点亮规则：去过的章节点亮（按章记，跳章也能保住），当前所在章加深。
   点任意年份 = 跳到那一章的开头。 */
function renderTimeline() {
  const seenChapters = getVisitedChapters();
  const inStory = $('view-story').classList.contains('active');
  $('timeline').innerHTML = TIMELINE.map((t) => {
    const chapter = STORY.nodes[t.nodeId] ? STORY.nodes[t.nodeId].chapter : '';
    const lit = state.visited.has(t.nodeId) || seenChapters.includes(chapter);
    const current = inStory && chapter && chapter === state.chapter;
    return `
    <button type="button" class="tl-node ${lit ? 'lit' : ''} ${current ? 'current' : ''}"
      data-node="${t.nodeId}" title="跳到 ${t.year} · ${t.label}">
      <span class="tl-year">${t.year}</span>${t.label}
    </button>`;
  }).join('');
}

// ---------- 章节选择 ----------
/* 每一章都可以直接进入：卡片上的名字必须和 story.js 里的 chapter 完全一致，
   用来判断「你在这里」和「去过」。所有章节都可选，不做解锁限制。 */
const CHAPTERS = [
  { id: 'p0', no: '序章', name: '博物馆之夜', year: '现在', icon: '🏛️', color: '#f6c64a', hook: '闭馆后的博物馆，时光机第一次通电。' },
  { id: 'a0', no: '第一章', name: '模仿游戏', year: '1950', icon: '🧩', color: '#8fc5ff', hook: '图灵摆出模仿游戏：你能分清人和机器吗？' },
  { id: 'b0', no: '第二章', name: '给新学科起名字', year: '1956', icon: '✏️', color: '#ffc48f', hook: '十位科学家，给一门新学科起了名字。' },
  { id: 'c0', no: '第三章', name: '漫长的冬天', year: '1974', icon: '❄️', color: '#a8d7ff', hook: '钱花完了，AI 迎来第一次寒冬。' },
  { id: 'd0', no: '第四章', name: '会请教专家的电脑', year: '1975', icon: '🩺', color: '#9fe0c4', hook: '把医生经验写成规则，电脑当专家。' },
  { id: 'e0', no: '第五章', name: '棋盘上的深蓝', year: '1997', icon: '♟️', color: '#9fb6ff', hook: '深蓝挑战棋王：机器能不能赢？' },
  { id: 'f0', no: '第六章', name: '认出猫的神经网络', year: '2012', icon: '🐱', color: '#ffb0a0', hook: '在照片墙找出猫，看机器第一次「看见」。' },
  { id: 'g0', no: '第七章', name: '神之一手', year: '2016', icon: '⚫', color: '#c6b2ff', hook: 'AlphaGo 下出那步「神之一手」。' },
  { id: 'h0', no: '第八章', name: '会说话的大模型', year: '2017—2022', icon: '💬', color: '#8fe0b4', hook: '和词语做朋友的大模型，学会说话。' },
  { id: 'z0', no: '尾声', name: '小豆苗发芽了', year: '现在', icon: '🌱', color: '#8fe0b4', hook: '你走过的七十年，长成一棵小树。' },
].map((c) => ({ ...c, chapter: `${c.no} · ${c.name}` }));

const CHAPTER_KEY = 'adv_chapters';

function getVisitedChapters() {
  try {
    const list = JSON.parse(localStorage.getItem(CHAPTER_KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}
function markChapterVisited(chapter) {
  if (!chapter) return;
  const list = getVisitedChapters();
  if (list.includes(chapter)) return;
  list.push(chapter);
  try { localStorage.setItem(CHAPTER_KEY, JSON.stringify(list)); } catch { /* 隐身模式忽略 */ }
}

function renderChapterPicker() {
  const visited = getVisitedChapters();
  const done = CHAPTERS.filter((c) => visited.includes(c.chapter)).length;
  const pct = Math.round((done / CHAPTERS.length) * 100);
  const inStory = $('view-story').classList.contains('active');   // 在大门页打开时不标「你在这里」
  $('chapterProgress').innerHTML = `
    <span>已探索 <b>${done}</b> / ${CHAPTERS.length} 章</span>
    <i class="cp-bar"><em style="width:${pct}%"></em></i>`;
  $('chapterList').innerHTML = CHAPTERS.map((c) => {
    const isCurrent = inStory && c.chapter === state.chapter;
    const seen = visited.includes(c.chapter);
    return `<button type="button" class="cp-item${isCurrent ? ' is-current' : ''}${seen ? ' is-visited' : ''}"
      data-node="${c.id}" style="--cp:${c.color}">
      <span class="cp-top">
        <span class="cp-no">${c.no}</span>
        <span class="cp-year">${c.year}</span>
        <span class="cp-icon" aria-hidden="true">${c.icon}</span>
      </span>
      <strong class="cp-name">${c.name}</strong>
      <span class="cp-hook">${c.hook}</span>
      <span class="cp-state">${isCurrent ? '📍 你在这里' : seen ? '✓ 去过 · 可重看' : '▶ 开始这一章'}</span>
    </button>`;
  }).join('');
}

function openChapterPicker() {
  renderChapterPicker();
  $('chapterModal').classList.add('show');
}
function closeChapterPicker() {
  $('chapterModal').classList.remove('show');
}

/* 跳到某一章的开头：强制重播章节标题卡，清空本章互动状态，
   但保留已点亮的术语、时间轴和探索记录 */
function jumpToChapter(id) {
  const node = STORY.nodes[id];
  if (!node) return;
  closeChapterPicker();
  navSeq += 1;                 // 作废还在排队的旧章节卡 / 淡出
  window.ChapterGame?.stop();
  clearInterval(state.typeTimer);
  state.typing = false;
  if (state.chapter && state.chapter !== node.chapter) {
    state.dialogLog.push({ divider: true, chapter: node.chapter });
  }
  state.chapter = '';          // 置空 = 让 renderNode 当作「换章」处理
  switchView('story');
  renderNode(id);
}

document.querySelectorAll('[data-chapter-picker]').forEach((btn) => {
  btn.addEventListener('click', openChapterPicker);
});
$('chapterCloseBtn').addEventListener('click', closeChapterPicker);
$('chapterBackBtn').addEventListener('click', closeChapterPicker);
$('chapterModal').addEventListener('click', (e) => { if (e.target.id === 'chapterModal') closeChapterPicker(); });
$('chapterList').addEventListener('click', (e) => {
  const item = e.target.closest('.cp-item');
  if (item && item.dataset.node) jumpToChapter(item.dataset.node);
});
// 顶部时间轴也可以直接跳章
$('timeline').addEventListener('click', (e) => {
  const tl = e.target.closest('.tl-node');
  if (tl && tl.dataset.node) jumpToChapter(tl.dataset.node);
});


// ---------- 剧情引擎 ----------
/* 章节衔接：切换章节时先播黑场标题卡，旧章节内容全部撤下，再进入新章节第一句 */
function showChapterCard(chapter, time, done) {
  const card = $('chapterCard');
  const seq = navSeq;          // 记录这次章节卡属于哪一次导航
  $('ccTitle').textContent = chapter;
  $('ccTime').textContent = time || '';
  // 重播条目入场动画
  card.querySelectorAll('.cc-kicker,.cc-title,.cc-time').forEach((el) => {
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = '';
  });
  card.classList.add('show');
  setTimeout(() => {
    if (seq !== navSeq) return;          // 期间又跳章了，这次作废
    card.classList.remove('show');
    setTimeout(() => { if (seq === navSeq) done(); }, 350);   // 等卡片淡出完再进新章节
  }, 1400);
}

function renderNode(id) {
  if (id === 'END_GALLERY') {
    document.querySelector('[data-view="tips"]').click();
    return;
  }
  const node = STORY.nodes[id];
  if (!node) return;
  // 章节切换：上一章内容清零 + 回溯里加分隔线 + 播章节卡，然后才真正渲染新节点
  if (node.chapter !== state.chapter) {
    if (state.chapter) {
      // 回溯分隔线：新旧章节之间划一道
      state.dialogLog.push({ divider: true, chapter: node.chapter });
    }
    state.chapter = node.chapter;
    markChapterVisited(node.chapter);   // 章节选择器：标记「去过」，不解锁、不限制
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
    showChapterCard(node.chapter, node.time, () => renderNodeBody(id));
    return;
  }
  renderNodeBody(id);
}

function renderNodeBody(id) {
  // 推进剧情时收起聊天面板，避免遮挡
  $('chatPanel').classList.remove('show');
  const node = STORY.nodes[id];
  if (!node) return;
  state.nodeId = id;
  state.visited.add(id);
  renderTimeline();
  // 上一拍若还在小任务里，先收掉任务条与照片墙的监听，避免残留状态带进下一拍
  window.ChapterGame?.stop();
  // 视觉层：按章节切换 CG 影像 / 环境色调（fx.js 未加载时静默跳过）
  window.SceneFX?.setNode(node);

  $('chapterTitle').textContent = node.chapter;
  $('chapterTime').textContent = node.time;
  setSpeaker(node.speaker);
  renderCast(node);
  $('choices').innerHTML = '';
  $('nextBtn').classList.add('hidden');
  $('nextBtn').onclick = null;     // 清掉上一拍的推进函数，避免空格/点击误推进旧节点

  // 对话框淡入：上一拍点继续后已移除 .show（淡出），这里加回 .show 触发淡入
  const dlgBox = $('dialogueBox');
  dlgBox.classList.add('show');

  // AI 生成节拍：auto=章节总结（维度画像生成）；react=人物对刚才的对话做即时反应
  if (node.type === 'auto' || node.type === 'react') { renderAuto(node); return; }

  // 打字机效果输出正文
  clearInterval(state.typeTimer);
  state.typing = true;
  state.skipTyping = null;
  state.typeNode = node;
  const raw = node.text;
  state.typeRaw = raw;
  let i = 0;
  $('storyText').innerHTML = '';
  state.typeTimer = setInterval(() => {
    i += 2;                                  // 一次吐两字，更流畅
    if (i >= raw.length) { i = raw.length; finishTyping(node, raw); }
    $('storyText').innerHTML = decorate(raw.slice(0, i));
  }, 20);

  // 点一下 / 空格：先在 advanceStory() 里补全这句，再按一次才往下走（见文件下方）
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
    const body = isReact
      ? { beatId: node.beatId, message: node.reactPrompt, history: state.history, memory: state.memory, deviation: state.deviation, mode: state.mode }
      : { beatId: node.beatId, message: '本章总结', dimensions: state.dimensions, mode: state.mode };  // auto 占位，后端改用维度画像
    const r = await fetch(api('/api/adv/respond'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    out = await r.json();
  } catch {
    out = { reply: '', source: 'fallback' };
  }
  // 协作流水：把这一拍的多 Agent 步骤送进面板
  pushTrace(out, {
    title: isReact ? '现场反应' : '章节总结',
    speaker: node.speaker,
    error: !out.trace,
  });
  if (isReact) state.deviation.count = 0;   // 回归节拍已触发，清零连续偏离计数器
  let raw = out.reply || '';
  if (isReact && out.source === 'fallback' && node.text) raw = node.text;   // react 退回预写台词，保证连贯
  if (!raw) raw = node.text || (isReact ? '（没有回应……）' : '（信号断了……但图灵朝你竖起了大拇指。）');
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
  state.skipTyping = null;
  state.typeNode = { ...node, text: raw };   // 生成台词不是 node.text，用新的这份补全
  state.typeRaw = raw;
  let i = 0;
  $('storyText').innerHTML = '';
  state.typeTimer = setInterval(() => {
    i += 2;
    if (i >= raw.length) { i = raw.length; finishTyping({ ...node, text: raw }, raw); }
    $('storyText').innerHTML = decorate(raw.slice(0, i));
  }, 20);
}

/* 水之子显性引导：偏差度=2 时在桌宠气泡里给出方向提示 */
let guideTimer = null;
function showGuideHint(hint) {
  if (!hint) return;
  const bubble = $('petBubble');
  bubble.textContent = '小豆苗，我有个主意——' + hint;
  bubble.classList.add('guide-hint');
  clearTimeout(guideTimer);
  guideTimer = setTimeout(() => {
    bubble.classList.remove('guide-hint');
    bubble.textContent = '鼠标靠近我，有问题随时问～';
  }, 8000);
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
  const seq = ++navSeq;
  box.classList.remove('show');
  setTimeout(() => { if (seq === navSeq) renderNode(nextId); }, 220);
}

/* 补全正在打字的这句台词：
 *   普通剧情拍 → finishTyping 补全并弹出选项 / 小游戏
 *   AI 回复     → 走它自己的 skipTyping 钩子（要把 await 的 Promise 收尾） */
function skipTypingOnce() {
  if (!state.typing) return false;
  if (state.skipTyping) { state.skipTyping(); return true; }
  if (!state.typeNode) return false;
  finishTyping(state.typeNode, state.typeRaw || state.typeNode.text || '');
  return true;
}

/* 空格 / 回车 / 点对话框 = 「往下走」的一步：
 *   还在打字 → 先把这句补全；已经播完 → 点「继续」进入下一拍。
 *   选项 / 小游戏 / 提问拍没有可点的「继续」，所以不会误触推进。 */
function advanceStory() {
  if (!$('view-story').classList.contains('active')) return false;
  // 弹窗（术语 / 知识库 / 选章 / API / 回溯）打开时，空格只归它用，剧情不偷偷往下走
  if (document.querySelector('.modal-mask.show, .log-modal.show')) return false;
  const box = $('dialogueBox');
  if (!box || !box.classList.contains('show')) return false;   // 章节卡 / 淡出过场中不响应
  if (skipTypingOnce()) return true;
  const btn = $('nextBtn');
  if (!btn || btn.classList.contains('hidden') || !btn.onclick) return false;
  btn.click();
  return true;
}

/* 点对话框空白处 = 空格：只绑一次，换拍不用反复重绑；
   点术语、按钮、输入框时交给它们自己处理，不会误推进 */
$('dialogueBox').addEventListener('click', (e) => {
  if (e.target.closest('.term, button, input, textarea, select, a')) return;
  advanceStory();
});

/* 「往下走」按钮不再千篇一律写「继续」：
 *   先看下一拍会是什么（换章 / 选择 / 小任务 / 提问 / 旁白 / 人物说话），
 *   再从同一组说法里按节点 id 取一个固定的词——同一拍每次看到的一样，不会乱跳 */
const NEXT_WORD = {
  narr: ['往下看 ▼', '接着看 ▼', '再看看 ▼'],
  talk: ['听下去 ▼', '接着听 ▼', '再听一句 ▼'],
  calm: ['再走一步 ▼', '往前走 ▼'],
};
function nextWord(list, seed) {
  let h = 0;
  for (const ch of String(seed)) h = (h * 31 + ch.charCodeAt(0)) % 100003;
  return list[h % list.length];
}
function nextLabel(node, custom) {
  if (custom) return custom;
  if (!node || !node.next) return nextWord(NEXT_WORD.calm, node && node.chapter);
  if (node.next === 'END_GALLERY') return '翻翻手账 📖';
  const nx = STORY.nodes[node.next];
  if (nx && nx.chapter && nx.chapter !== node.chapter) return '去下一章 →';
  if (nx && nx.choices) return '轮到你选 ▼';
  if (nx && nx.game) return '来做小任务 ▼';
  if (nx && nx.type === 'input') return '轮到你问 ▼';
  const talk = nx && nx.speaker && nx.speaker !== '旁白';
  return nextWord(talk ? NEXT_WORD.talk : NEXT_WORD.narr, node.next);
}
function showNext(node, custom) {
  const btn = $('nextBtn');
  btn.textContent = nextLabel(node, custom);
  btn.classList.remove('hidden');
  btn.onclick = () => fadeThenGo(node.next);
}

/* 行动卡（选项 / 提问）弹出时，若被挤到屏幕外，轻轻把它滚进来
   （底部留 56px，避开左下角的 AGENT 协作按钮） */
function revealDeck() {
  const deck = $('choices');
  if (!deck || !deck.children.length) return;
  const r = deck.getBoundingClientRect();
  const gap = 56;
  if (r.top < window.innerHeight && r.bottom > window.innerHeight - gap) {
    window.scrollBy({ top: r.bottom - window.innerHeight + gap, behavior: 'smooth' });
  }
}

function finishTyping(node, raw) {
  if (!state.typing) return;   // 防重入：打字机播完瞬间点击跳过会双触发，第二次直接丢弃
  clearInterval(state.typeTimer);
  state.typing = false;
  $('storyText').innerHTML = decorate(raw);
  // 这句台词播完，记入回溯
  logDialog(node.speaker || '旁白', raw);

  // 贴纸奖励：分支台词播完就收进手账，选择有看得见的后果
  if (node.sticker) window.ChapterGame?.awardSticker(node.sticker);

  // 自由输入互动节点
  if (node.type === 'input') {
    renderInput(node);
    return;
  }

  // 章内小任务（如第六章找猫）：任务卡显示在对话框下方，完成后才露出「继续」
  if (node.game && window.ChapterGame) {
    $('nextBtn').classList.add('hidden');
    window.ChapterGame.start(node.game, node, () => showNext(node, '接着走 👣'));
    return;
  }

  if (node.choices) {
    // 选项也搬到对话框外：一张「行动卡」+ 两张并排的选项牌
    $('choices').innerHTML = `
      <span class="deck-kicker">这一步，你来选</span>
      <div class="choice-row">
        ${node.choices.map((c, i) => `<button class="choice-btn" data-next="${c.next}"><span class="c-key">${'AB'[i] || i + 1}</span>${c.text}</button>`).join('')}
      </div>`;
    document.querySelectorAll('.choice-btn').forEach((b) =>
      b.addEventListener('click', () => fadeThenGo(b.dataset.next)));
    revealDeck();
  } else {
    showNext(node);
  }
}

/* 自由输入互动：提交 → 调 AI（合并JSON：台词+偏差度+维度+对话记忆）→ 累计维度 → 继续主线
 * 同一拍允许最多 3 轮对话（「再聊一句」）：人物能把话说完整，不必每轮都硬推剧情 */
const MAX_CHAT_TURNS = 3;

function renderInput(node) {
  const usedQs = [];                          // 用过的快捷问题不再出现，避免重复问同一句

  // 快捷问题：想不出问什么 / 不想打字的孩子，点一下就把这句问出去
  const chipsHtml = () => {
    const left = (node.suggest || []).filter((q) => !usedQs.includes(q));
    if (!left.length) return '';
    return `<div class="ask-chips">${left.map((q) =>
      `<button type="button" class="ask-chip">${escapeHtml(q)}</button>`).join('')}</div>`;
  };

  let turns = 0;          // 本拍已聊轮数
  let busy = false;

  // 每轮回复后输入框都会重建，绑定要现场做
  function bindDeck() {
    $('choices').querySelectorAll('.ask-chip').forEach((b) => {
      b.addEventListener('click', () => {
        const input = $('advInput');
        if (!input || busy) return;
        usedQs.push(b.textContent);
        input.value = b.textContent;   // 填进去再走正常的提交流程
        submit();
      });
    });
    const ni = $('advInput'), nb = $('advSendBtn');
    if (!ni || !nb) return;
    nb.addEventListener('click', submit);
    ni.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  }

  $('choices').innerHTML = `
    <span class="deck-kicker">🎤 这一拍，你来问 · 想不出就点一句</span>
    ${chipsHtml()}
    <div class="adv-input">
      <input id="advInput" class="adv-text" placeholder="${node.placeholder || '输入…'}" maxlength="200">
      <button class="primary-btn adv-send" id="advSendBtn">发送</button>
    </div>`;
  $('nextBtn').classList.add('hidden');
  bindDeck();
  $('advInput')?.focus();

  async function submit() {
    // 每轮回复后输入框是重建的，必须现场按 id 取，不能闭包抓旧元素
    const input = $('advInput');
    const btn = $('advSendBtn');
    if (!input || !btn) return;
    const msg = input.value.trim();
    if (!msg || busy) return;
    busy = true;
    input.disabled = true;
    btn.disabled = true;
    btn.textContent = '思考中…';

    let out;
    try {
      const r = await fetch(api('/api/adv/respond'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          beatId: node.beatId,
          message: msg,
          history: state.history,
          dimensions: state.dimensions,
          memory: { ...state.memory, turns: turns + 1 },
          mode: state.mode,
        }),
      });
      out = await r.json();
    } catch {
      out = { reply: '（信号断了，请继续……）', dimensions: {}, deviation: 0, guideHint: '' };
    }
    // 协作流水：这一轮对话的多 Agent 步骤
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
        turns: turns >= MAX_CHAT_TURNS ? turns : 0,
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
    setSpeaker(who);
    renderCast({ cast: node.cast, speaker: who });
    $('choices').innerHTML = '';          // 播放期间隐藏输入框
    clearInterval(state.typeTimer);
    state.typing = true;
    state.typeNode = null;          // AI 回复不是剧情节点，补全时只把这句话一次显示完
    state.typeRaw = reply;
    let ti = 0;
    $('storyText').innerHTML = '';
    await new Promise((resolve) => {
      // 打字期间点一下 / 空格可跳过（由 advanceStory → skipTyping 统一触发）
      state.skipTyping = () => {
        clearInterval(state.typeTimer);
        state.typing = false;
        state.skipTyping = null;
        $('storyText').innerHTML = decorate(reply);
        resolve();
      };
      state.typeTimer = setInterval(() => {
        ti += 2;
        if (ti >= reply.length) {
          ti = reply.length;
          clearInterval(state.typeTimer);
          state.typing = false;
          state.skipTyping = null;
          resolve();
        }
        $('storyText').innerHTML = decorate(reply.slice(0, ti));
      }, 20);
    });

    // 偏差度=2：孩子跑题了，水之子出面给方向（显性引导，不强制打断）
    if (out.guideHint) showGuideHint(out.guideHint);

    // 维度标签：回复播完后短暂展示在输入框上方，让孩子看到「AI 看懂了你的思路」
    const dimTags = Object.keys(out.dimensions || {})
      .map((k) => `<span class="dim-tag">✦ ${k}</span>`).join('');

    // 还有聊天额度 → 恢复输入框 + 剩下的快捷问题；聊够了就只留「回到故事」
    input.value = '';
    const more = turns < MAX_CHAT_TURNS;
    $('choices').innerHTML = `
      <span class="deck-kicker">🎤 这一拍，你来问</span>
      ${dimTags ? `<div class="adv-dims">${dimTags}</div>` : ''}
      ${more ? chipsHtml() : ''}
      <div class="adv-input">
        <input id="advInput" class="adv-text" maxlength="200"
          placeholder="${more ? '还想说点什么？' : '这一拍聊够啦，点「回到故事」往下走'}"
          ${more ? '' : 'disabled'}>
        <button class="primary-btn adv-send" id="advSendBtn" ${more ? '' : 'disabled'}>${more ? '再聊一句' : '聊够啦'}</button>
      </div>`;
    if (more) {
      busy = false;
      bindDeck();
      $('advInput')?.focus();
    } else {
      $('nextBtn').focus();
    }
    showNext(node, '回到故事 ▼');
  }
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
    try { await fetch(api('/api/tips'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ term }), keepalive: true }); }
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
    const r = await fetch(api('/api/knowledge/') + encodeURIComponent(term));
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
let kbRetryTimer = null, kbRetryCount = 0;
async function renderKbList() {
  const box = $('kbList');
  if (!KB_CACHE) box.innerHTML = '<p class="empty-hint">加载中……</p>';
  let list = KB_CACHE;
  if (!list) {
    try {
      list = await fetchJson('/api/knowledge', { timeout: 12000 });
      if (!Array.isArray(list) || !list.length) throw new Error('知识库返回异常');
      KB_CACHE = list;
      kbRetryCount = 0;
    } catch {
      // 云端冷启动 / 抖动：本地词条先顶上，3 秒后还在知识库页就再试一次（最多 3 次）
      list = Object.entries(TERMS).filter(([t]) => t !== '豆苗')
        .map(([t, v]) => ({ term: t, brief: v.brief, category: '基础概念', year: '-', age: '' }));
      if (!kbRetryTimer && kbRetryCount < 3) {
        kbRetryTimer = setTimeout(() => {
          kbRetryTimer = null;
          kbRetryCount++;
          if ($('view-kb').classList.contains('active')) renderKbList();
        }, 3000);
      }
    }
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
  '基础概念': '#60a5fa', 'AI的出生': '#f59e0b', '第一次热潮': '#ef4444',
  '换个思路': '#10b981', '蓄势待发': '#8b5cf6', '深度学习革命': '#ec4899',
  'AI新时代': '#06b6d4', '学习方法': '#84cc16', '模型架构': '#f97316',
  '应用方向': '#3b82f6', 'AI伦理': '#a855f7',
};
const SVG_NS = 'http://www.w3.org/2000/svg';
let _graphData = null;        // Map: term -> {category, related}
let _focus = '人工智能';      // 当前聚焦的中心概念
let _nodeEls = new Map();     // term -> <g> 元素（用于平滑过渡）
let _edgeLayer = null, _nodeLayer = null;

async function renderGraph() {
  const svg = $('graphSvg');
  if (!svg) return;
  let list;
  try { list = await (await fetch(api('/api/knowledge'))).json(); }
  catch {
    list = Object.entries(TERMS).filter(([t]) => t !== '豆苗').map(([t, v]) => ({
      term: t, category: v.category || '基础概念', related: v.related || [],
    }));
  }
  // 全量数据，related 只保留确实存在的词条（兼容新旧格式）
  const all = new Set(list.map((k) => k.term));
  _graphData = new Map(list.map((k) => [
    k.term, {
      category: k.category,
      related: (k.related || [])
        .map((r) => typeof r === 'string' ? { term: r, rel: '' } : r)
        .filter((r) => all.has(r.term)),
    },
  ]));

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


// ---------- 手账 ----------
async function renderTipsGrid() {
  // 服务器为准，本地为兜底
  let serverTips = {};
  try {
    const d = await fetchJson('/api/tips');
    if (d && typeof d === 'object' && !Array.isArray(d)) serverTips = d;
  } catch { /* 离线：只用本地已收集的词条 */ }
  const terms = [...new Set([...Object.keys(serverTips), ...state.collected])];
  $('tipsBadge').textContent = terms.length;
  $('tipsEmpty').style.display = terms.length ? 'none' : 'block';
  $('tipsGrid').innerHTML = terms.map((t) => `
    <div class="tip-card" data-term="${t}">
      <h4>${t}</h4>
      <p>${TERMS[t]?.brief || ''}</p>
      <span class="tip-count">已点亮${serverTips[t] ? ' · 看过 ' + serverTips[t].count + ' 次' : ''}</span>
    </div>`).join('');
  $('tipsGrid').querySelectorAll('.tip-card').forEach((c) =>
    c.addEventListener('click', () => openKb(c.dataset.term)));
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
    if (!$('chatBody').children.length) {
      addMsg('ai', '你好呀小豆苗！我是水之子💧 冒险里有任何看不懂的地方，都可以问我哦！');
    }
  }
}
function scheduleHideChat() {
  if (chatPinned) return;
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    if (!chatPinned) $('chatPanel').classList.remove('show');
  }, 600);
}

// 点击小头像：展开完整形象 + 打开聊天；再点收起
$('pet').addEventListener('click', () => {
  const pet = $('pet');
  const expanded = pet.classList.toggle('expanded');
  if (expanded) { chatPinned = true; showChat(); $('chatInput').focus(); }
  else { chatPinned = false; $('chatPanel').classList.remove('show'); }
});
$('chatPanel').addEventListener('mouseenter', () => clearTimeout(hideTimer));
$('chatPanel').addEventListener('mouseleave', scheduleHideChat);
$('chatInput').addEventListener('focus', () => { chatPinned = true; });
// 关闭聊天时同步收起立绘形象
$('chatCloseBtn').onclick = () => {
  chatPinned = false;
  $('chatPanel').classList.remove('show');
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
  const thinking = addMsg('ai', '水之子思考中……');

  try {
    const r = await fetch(api('/api/chat'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text }),
    });
    const d = await r.json();
    if (d.fallback || !d.reply) {
      thinking.textContent = localReply(text);
      $('chatStatus').textContent = '本地演示模式（AI未连接，回答来自内置知识）';
    } else {
      thinking.textContent = d.reply;
      $('chatStatus').textContent = 'AI 实时回答';
    }
  } catch {
    thinking.textContent = localReply(text);
    $('chatStatus').textContent = '本地演示模式（服务未连接）';
  }
}
$('chatSendBtn').onclick = sendChat;
$('chatInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });

// ---------- API Key 设置（别人可填入自己的 Key） ----------
const SOURCE_TEXT = { saved: '本机保存', env: '.env 默认', none: '未配置' };

function paintApiConfig(c) {
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
    paintApiConfig(await fetchJson('/api/config'));
  } catch {
    $('apiStatus').className = 'api-status off';
    $('apiStatus').textContent = '后端未连接（已自动重试 3 次），稍后点「API」再试一次';
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
    const r = await fetch(api('/api/config'), {
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
    const d = await fetchJson('/api/config/test', { method: 'POST', timeout: 25000, retry: 0 });
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
    const d = await (await fetch(api('/api/config'), { method: 'DELETE' })).json();
    paintApiConfig(d);
    $('apiKeyInput').value = '';
    $('apiModelInput').value = '';
    apiTip('已清除本机 Key，回到 .env 默认配置（如果有）。', 'ok');
  } catch {
    apiTip('清除失败：后端没连上', 'err');
  }
};

// ---------- 多 Agent 协作面板（横向接力管道 + 详情卡片，浅色清新风） ----------
const ORCH_AGENT_CLASS = {
  导演: 'dir', 人物: 'who', 守门: 'guard', 记忆: 'mem',
  判定: 'cls', 向导: 'guide', 调度: 'sys', 汇总: 'sum',
};
const ORCH_STATUS_CLASS = { warn: 'st-warn', block: 'st-block', retry: 'st-retry', fail: 'st-fail' };
/* 管道上的固定顺序：导演 → 记忆 → 判定 → 人物 → 守门 → 汇总
 * 一眼看懂"六个 Agent 接力完成一句话" */
const ORCH_ORDER = ['导演', '记忆', '判定', '人物', '守门', '汇总'];
const SLOT_STATUS = { ok: 'st-ok', warn: 'st-warn', fail: 'st-fail', idle: 'st-idle' };
/* 每个 Agent 的小图标（stroke 用 currentColor，跟着状态色走） */
const ORCH_ICON = {
  导演: `<svg viewBox="0 0 24 24"><path d="M3 5l2-2h3l2 2M9 5l2-2h3l2 2M5 5h14M4 5v14h16V5"/></svg>`,
  记忆: `<svg viewBox="0 0 24 24"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.6.6 1 1.4 1 2.5h6c0-1.1.4-1.9 1-2.5A6 6 0 0 0 12 3z"/></svg>`,
  判定: `<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>`,
  人物: `<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 20a8 8 0 0 1 16 0"/></svg>`,
  守门: `<svg viewBox="0 0 24 24"><path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6l7-3z"/></svg>`,
  汇总: `<svg viewBox="0 0 24 24"><path d="M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5M3 17l9 5 9-5"/></svg>`,
};
function slotStatus(steps) {
  if (steps.some((s) => s.status === 'fail' || s.status === 'block')) return 'fail';
  if (steps.some((s) => s.status === 'retry' || s.status === 'warn')) return 'warn';
  return steps.length ? 'ok' : 'idle';
}
/* 把一拍里每个 Agent 的步骤收拢到管道对应槽位上，没出现就是 idle */
function pipeline(turn) {
  return ORCH_ORDER.map((name) => {
    const steps = turn.steps.filter((s) => s.agent === name);
    return { name, steps, status: slotStatus(steps), ms: steps.reduce((a, s) => a + (s.ms || 0), 0) };
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
  if (!state.orchSeen) {
    state.orchSeen = true;
    // 流水线面板不再自动弹出（它会盖住对话框和行动卡），
    // 只在按钮上亮一个小绿点，想看流程时点左下角「流水线」自己打开
    $('orchFab')?.classList.add('has-data');
  }
}

function renderOrch() {
  const box = $('orchBody');
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
      <span class="orch-agent ${ORCH_AGENT_CLASS[s.agent] || 'sys'}">${escapeHtml(s.agent)}</span>
      <span class="orch-act">${escapeHtml(s.action)}</span>
      <span class="orch-detail">${escapeHtml(s.detail || '')}</span>
      <span class="orch-ms">${s.ms ? s.ms + 'ms' : ''}</span>
    </div>`).join('');
  const prevHtml = state.traceTurns.slice(1).map((t) => `
    <div class="orch-prev">
      <span class="orch-prev-title">${escapeHtml(t.title)}${t.speaker ? ' · ' + escapeHtml(t.speaker) : ''}</span>
      <span class="orch-prev-meta">${t.source === 'ai' ? 'AI' : '兜底'} · ${t.meta.ms}ms · ${t.meta.calls} 次</span>
    </div>`).join('');

  box.innerHTML = `
    <div class="orch-turn fresh">
      <div class="orch-turn-head">
        <span class="orch-turn-title">${escapeHtml(latest.title)}${latest.speaker ? ' · ' + escapeHtml(latest.speaker) : ''}</span>
        <span class="orch-turn-meta">
          <span class="orch-mode ${latest.meta.mode === 'swarm' ? 'swarm' : ''}">${latest.meta.mode === 'swarm' ? '🐝 Swarm' : '流水线'}</span>
          <span class="orch-src ${latest.source === 'ai' ? 'ai' : 'fb'}">${latest.source === 'ai' ? 'AI 实时生成' : '本地兜底'}</span>
          ${latest.meta.ms}ms · ${latest.meta.calls} 次调用
        </span>
      </div>
      ${pipeHtml}
      <div class="orch-steps">${stepsHtml}</div>
      ${prevHtml ? `<div class="orch-prev-list">${prevHtml}</div>` : ''}
    </div>`;

  const sub = $('orchSub');
  if (sub) sub.textContent = `${latest.title}${latest.speaker ? ' · ' + latest.speaker : ''} · ${latest.source === 'ai' ? '实时生成' : '本地兜底'}`;
  const calls = state.traceTurns.reduce((s, t) => s + (t.meta.calls || 0), 0);
  const stat = $('orchStat');
  if (stat) stat.textContent = `近 ${state.traceTurns.length} 拍 · 主调用 ${calls} 次 · 最近一拍 ${latest.meta.ms}ms`;
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

/* ---------- 编排模式切换（流水线 / Swarm） ---------- */
const MODE_TEXT = { pipeline: '⚙️ 流水线', swarm: '🐝 Swarm' };
function applyMode(m) {
  state.mode = m === 'swarm' ? 'swarm' : 'pipeline';
  localStorage.setItem('adv_mode', state.mode);
  const btn = $('modeBtn');
  if (btn) {
    btn.textContent = MODE_TEXT[state.mode];
    btn.classList.toggle('swarm', state.mode === 'swarm');
  }
}
applyMode(state.mode);
const modeBtn0 = $('modeBtn');
if (modeBtn0) modeBtn0.onclick = () => applyMode(state.mode === 'swarm' ? 'pipeline' : 'swarm');

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

  // 空格 / 回车：跳过打字 or 进入下一拍（和点对话框同一个动作）
  if (e.key === ' ' || e.key === 'Spacebar' || e.code === 'Space' || e.key === 'Enter') {
    const ae = document.activeElement;
    // 焦点在按钮/链接上时，交给它们自己的默认行为，避免一次按键推进两拍
    if (ae && ae !== document.body && /BUTTON|A/.test(ae.tagName)) return;
    if (advanceStory()) e.preventDefault();
    return;
  }

  if (e.key === 'Escape' && $('chapterModal').classList.contains('show')) {
    e.preventDefault();
    closeChapterPicker();
    return;
  }
  if (e.key === '`') {
    e.preventDefault();
    setOrch(!$('orchPanel').classList.contains('show'));
  } else if (e.key === 'l' || e.key === 'L') {
    e.preventDefault();
    toggleLog();
  }
});

// ---------- 启动 ----------
updateBadge();
updatePet();
renderTimeline();
renderNode(STORY.start);
loadApiConfig();
/* 页面打开就把模型连接焐热（只花 1 个 token），避免第一次对话吃冷启动的 1~2 秒 */
fetch(api('/api/warm')).catch(() => {});
