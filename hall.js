/* =====================================================================
   hall.js —— 时空画廊（第一人称轨道漫游）
   移植自 10.31 前端：点击前进 / 对准门 / 拖拽环视 / 滚轮微调 / 穿门白场。
   依赖 app.js 暴露的全局：$、state、STORY、renderNode。
   ===================================================================== */
(function () {
  'use strict';

  const HALL_DOORS = [
    { node: 'a0', side: 'left',  year: '1950', icon: '🏃', name: '模仿游戏',  sub: '图灵之问' },
    { node: 'b0', side: 'right', year: '1956', icon: '🖋️', name: 'AI 诞生',   sub: '达特茅斯会议' },
    { node: 'c0', side: 'left',  year: '1974', icon: '❄️', name: '漫长寒冬',  sub: '第一次 AI 低谷' },
    { node: 'd0', side: 'right', year: '1975', icon: '🩺', name: '专家系统',  sub: '会请教专家的电脑' },
    { node: 'e0', side: 'left',  year: '1997', icon: '♟️', name: '深蓝',      sub: '棋盘上的对决' },
    { node: 'f0', side: 'right', year: '2012', icon: '🐱', name: '深度学习',  sub: '认出猫的神经网络' },
    { node: 'g0', side: 'left',  year: '2016', icon: '⚫', name: 'AlphaGo',   sub: '神之一手' },
    { node: 'h0', side: 'right', year: '2022', icon: '💬', name: '大模型',    sub: '会说话的 AI' },
  ];
  const HALL_Z_MAX = 1810;
  const HALL_STEP = 187.5;
  const hallClamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const PASS_KEY = 'adv_pass_prologue_v2';

  let hallBuilt = false;
  let hallBusy = false;
  let hallIdleTimer = 0;
  let hallDrifting = false;
  let hallDragging = false;
  let hovDoor = null;

  const pose = { z: 0, wx: 0, wyaw: 0, yaw: 0, pitch: 0, off: 0 };
  const goal = { z: 0, wx: 0, wyaw: 0, yaw: 0, pitch: 0, off: 0 };
  const CAM_KEYS = ['z', 'wx', 'wyaw', 'yaw', 'pitch', 'off'];
  const camTol = (key) => (key === 'wyaw' || key === 'yaw' || key === 'pitch' ? 0.02 : 0.2);
  let hallProgress = 0;
  let hallAimSide = '';
  let hallHold = false;   // true = 停在某一章门前，不自动漂移（由本章结束回到走廊时设置）
  let camRaf = 0, camLast = 0, camRate = 4.2;

  function applyCam() {
    const el = $('hallCorridor');
    if (!el) return;
    el.style.transform =
      `translate3d(${pose.wx}px, ${-pose.pitch * 9}px, ${pose.z + pose.off}px) rotateY(${pose.wyaw + pose.yaw}deg)`;
  }
  function camLoop(t) {
    const hall = $('hall');
    if (!hall || !hall.classList.contains('show')) { camRaf = 0; return; }
    camRaf = requestAnimationFrame(camLoop);
    const dt = Math.min((t - camLast) / 1000 || 0.016, 0.05);
    camLast = t;
    const k = 1 - Math.exp(-dt * camRate);
    for (const key of CAM_KEYS) {
      const d = goal[key] - pose[key];
      pose[key] = Math.abs(d) < camTol(key) ? goal[key] : pose[key] + d * k;
    }
    if (hallDrifting) driftTick(dt);
    applyCam();
    flushCamWaiters();
  }
  function startCamLoop() {
    if (camRaf) return;
    camLast = performance.now();
    camRaf = requestAnimationFrame(camLoop);
  }

  const camWaiters = [];
  function camSettled() {
    for (const key of CAM_KEYS) if (Math.abs(goal[key] - pose[key]) > camTol(key) * 5) return false;
    return true;
  }
  function whenSettled(maxWait = 3000) {
    return new Promise((res) => {
      const w = { res, until: performance.now() + maxWait };
      camWaiters.push(w);
      setTimeout(() => {
        const i = camWaiters.indexOf(w);
        if (i >= 0) { camWaiters.splice(i, 1); res(); }
      }, maxWait + 120);
    });
  }
  function flushCamWaiters() {
    if (!camWaiters.length) return;
    const now = performance.now(), done = camSettled();
    for (let i = camWaiters.length - 1; i >= 0; i--) {
      if (done || now >= camWaiters[i].until) camWaiters.splice(i, 1)[0].res();
    }
  }

  function resetPose() {
    Object.assign(pose, { z: 0, wx: 0, wyaw: 0, yaw: 0, pitch: 0, off: 0 });
    Object.assign(goal, pose);
    hallProgress = 0;
    hallAimSide = '';
    setAimedDoor(null);
  }
  function doorAimPose(side, depth) {
    const d = depth + 170;
    return side === 'left'
      ? { wx: -d, wyaw: -90, z: -80 }
      : { wx: d, wyaw: 90, z: -80 };
  }

  function stopDrift() { hallDrifting = false; }
  function armHallIdle() {
    clearTimeout(hallIdleTimer);
    stopDrift();
    const hall = $('hall');
    if (!hall || !hall.classList.contains('show') || hallBusy || hallHold) return;
    hallIdleTimer = setTimeout(startDrift, 4000);
  }
  function startDrift() {
    const hall = $('hall');
    if (!hall || !hall.classList.contains('show') || hallBusy || hallDragging || hallHold) return;
    if (hallAimSide === '' && hallProgress >= HALL_Z_MAX) return;
    hallDrifting = true;
  }
  function driftTick(dt) {
    if (goal.wx !== 0 || goal.wyaw !== 0 || goal.yaw !== 0 || goal.pitch !== 0 || goal.off !== 0) {
      goal.wx = 0; goal.wyaw = 0; goal.yaw = 0; goal.pitch = 0; goal.off = 0;
      goal.z = hallProgress;
      hallAimSide = '';
      setAimedDoor(null);
      return;
    }
    if (Math.abs(pose.wx) > 2 || Math.abs(pose.wyaw) > 0.5) return;
    if (hallProgress >= HALL_Z_MAX) { hallDrifting = false; return; }
    hallProgress = Math.min(hallProgress + 50 * dt, HALL_Z_MAX);
    goal.z = hallProgress;
  }

  function setAimedDoor(el) {
    document.querySelectorAll('#hall .d3d.aimed').forEach((d) => { if (d !== el) d.classList.remove('aimed'); });
    if (el) el.classList.add('aimed');
  }

  function turnToNearestDoor(side) {
    const ahead = HALL_DOORS.filter((d) => d.side === side && d.depth > hallProgress + 60);
    const cand = ahead[0] || HALL_DOORS.filter((d) => d.side === side).pop();
    if (!cand) return;
    hallAimSide = side;
    hallProgress = cand.depth;
    setAimedDoor(document.querySelector(`#hall .d3d[data-node="${cand.node}"]`));
    const aim = doorAimPose(side, cand.depth);
    goal.wx = aim.wx; goal.wyaw = aim.wyaw; goal.z = aim.z;
    goal.yaw = 0; goal.pitch = 0; goal.off = 0;
  }
  function advanceCenter() {
    hallAimSide = '';
    setAimedDoor(null);
    goal.wx = 0; goal.wyaw = 0; goal.yaw = 0; goal.pitch = 0; goal.off = 0;
    if (hallProgress < HALL_Z_MAX) hallProgress = Math.min(hallProgress + HALL_STEP, HALL_Z_MAX);
    goal.z = hallProgress;
  }

  function doorAtPoint(x, y) {
    let best = null, bestArea = -1;
    document.querySelectorAll('#hall .d3d, #hallGlow').forEach((el) => {
      if (el.closest('.hall-solo')) return;
      const depth = +(el.dataset.depth || 0);
      if (depth && depth < hallProgress - 120) return;
      if (hallAimSide && el.dataset.side && el.dataset.side !== hallAimSide) return;
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) return;
      if (x < r.left || x > r.right || y < r.top || y > r.bottom) return;
      const area = r.width * r.height;
      if (area > bestArea) { bestArea = area; best = el; }
    });
    return best;
  }

  function setHallHover(el) {
    if (hovDoor === el) return;
    if (hovDoor) hovDoor.classList.remove('hov');
    hovDoor = el;
    if (hovDoor) hovDoor.classList.add('hov');
    const scene = $('hallScene');
    if (scene && !hallDragging) scene.style.cursor = hovDoor ? 'pointer' : 'grab';
  }

  function handleHallClick(e) {
    armHallIdle();
    const door = doorAtPoint(e.clientX, e.clientY);
    if (door) { enterDoor(door.id === 'hallGlow' ? STORY.start : door.dataset.node, door); return; }
    const ratio = e.clientX / window.innerWidth;
    if (ratio < 0.34) turnToNearestDoor('left');
    else if (ratio > 0.66) turnToNearestDoor('right');
    else advanceCenter();
  }

  function bindHallControls() {
    const scene = $('hallScene');
    if (!scene) return;
    let dragMoved = false, dragStartX = 0, dragStartY = 0, dragBaseYaw = 0, dragBasePitch = 0;

    scene.addEventListener('pointerdown', (e) => {
      if (hallBusy) return;
      hallHold = false;   // 玩家一碰画面就解除「停在门前」，恢复自由漫游
      hallDragging = true; dragMoved = false;
      dragStartX = e.clientX; dragStartY = e.clientY;
      dragBaseYaw = pose.yaw; dragBasePitch = pose.pitch;
      try { scene.setPointerCapture(e.pointerId); } catch { /* 容错 */ }
      armHallIdle();
    });
    scene.addEventListener('pointermove', (e) => {
      if (hallBusy) return;
      if (!hallDragging) { setHallHover(doorAtPoint(e.clientX, e.clientY)); return; }
      const dx = e.clientX - dragStartX, dy = e.clientY - dragStartY;
      if (!dragMoved && Math.hypot(dx, dy) < 6) return;
      dragMoved = true;
      scene.classList.add('dragging');
      scene.style.cursor = 'grabbing';
      pose.yaw = goal.yaw = hallClamp(dragBaseYaw - dx * 0.05, -24, 24);
      pose.pitch = goal.pitch = hallClamp(dragBasePitch - dy * 0.045, -13, 13);
      applyCam();
    });
    const endDrag = (e) => {
      if (!hallDragging) return;
      hallDragging = false;
      scene.classList.remove('dragging');
      scene.style.cursor = hovDoor ? 'pointer' : 'grab';
      if (dragMoved) { armHallIdle(); return; }
      if (!hallBusy) handleHallClick(e);
    };
    scene.addEventListener('pointerup', endDrag);
    scene.addEventListener('pointercancel', () => { hallDragging = false; scene.classList.remove('dragging'); });

    scene.addEventListener('wheel', (e) => {
      const hall = $('hall');
      if (!hall || !hall.classList.contains('show') || hallBusy) return;
      e.preventDefault();
      pose.off = goal.off = hallClamp(pose.off - e.deltaY * 0.2, -100, 100);
      applyCam();
      armHallIdle();
    }, { passive: false });
  }

  function passedPrologue() {
    try { return localStorage.getItem(PASS_KEY) === '1'; } catch { return false; }
  }
  function markPassed() {
    try { localStorage.setItem(PASS_KEY, '1'); } catch { /* ignore */ }
  }

  function buildHall() {
    if (hallBuilt) return;
    hallBuilt = true;
    const WALL_HALF = 3600;
    HALL_DOORS.forEach((d, i) => {
      const depth = 450 + i * 380;
      d.depth = depth;
      const el = document.createElement('div');
      el.className = `d3d${d.side === 'right' ? ' rev' : ''}`;
      el.style.left = d.side === 'left' ? `${WALL_HALF + depth}px` : `${WALL_HALF - depth - 340}px`;
      el.dataset.side = d.side;
      el.dataset.depth = depth;
      el.dataset.node = d.node;
      el.innerHTML = `
        <div class="d3d-sign"><b>${d.year}</b><span>${d.name}</span></div>
        <div class="d3d-frame">
          <div class="d3d-light"></div>
          <div class="d3d-panel">
            <div class="d3d-paper">${d.icon}<i>${d.sub}</i></div>
            <span class="d3d-knob"></span>
          </div>
        </div>`;
      $(d.side === 'left' ? 'hallDoorsL' : 'hallDoorsR').appendChild(el);
    });
    const glow = $('hallGlow');
    if (glow) glow.dataset.depth = 3300;

    const resume = $('hallResume');
    if (resume) resume.addEventListener('click', () => {
      clearTimeout(hallIdleTimer);
      stopDrift();
      $('hall').classList.remove('show');
      document.body.classList.remove('hall-on');
    });
    const hallBtn = $('hallBtn');
    if (hallBtn) hallBtn.addEventListener('click', show);
    const solo = $('soloDoor');
    if (solo) solo.addEventListener('click', enterSolo);
    const closeBtn = $('hallClose');
    if (closeBtn) closeBtn.addEventListener('click', () => { hide(); switchView('gate'); });
    bindHallControls();
  }

  function show() {
    buildHall();
    hallHold = false;
    const solo = !passedPrologue();
    const hall = $('hall');
    if (!hall) return;
    hall.classList.toggle('solo', solo);
    const sub = document.querySelector('.hall-sub');
    if (sub) sub.textContent = solo
      ? '博物馆的大门就在面前 —— 推开它，从序章开始这段旅程'
      : '走廊两侧的门，通向不同的年代 —— 推开一扇，去和那个时代的人对话';
    const resume = $('hallResume');
    if (resume) resume.classList.toggle('hidden', !state.visited || state.visited.size === 0 || state.nodeId === STORY.start);
    hall.classList.add('show');
    document.body.classList.add('hall-on');
    if (solo) return;
    applyCam();
    startCamLoop();
    armHallIdle();
  }

  function hide() {
    const hall = $('hall');
    if (hall) hall.classList.remove('show');
    document.body.classList.remove('hall-on');
    clearTimeout(hallIdleTimer);
    stopDrift();
    hallHold = false;
  }

  async function enterSolo() {
    if (hallBusy) return;
    hallBusy = true;
    clearTimeout(hallIdleTimer);
    stopDrift();
    const door = $('soloDoor');
    door.classList.add('opening');
    $('hall').classList.add('solo-entering');
    await new Promise((r) => setTimeout(r, 950));
    $('hallFlash').classList.add('on');
    await new Promise((r) => setTimeout(r, 480));
    $('hall').classList.remove('show', 'solo-entering');
    $('hallFlash').classList.remove('on');
    document.body.classList.remove('hall-on');
    door.classList.remove('opening');
    resetPose();
    hallBusy = false;
    state.hallEntryNode = STORY.start;
    switchView('story', { skipHall: true });
    renderNode(STORY.start);
  }

  async function enterDoor(nodeId, el) {
    if (hallBusy) return;
    hallBusy = true;
    clearTimeout(hallIdleTimer);
    stopDrift();
    setHallHover(null);
    const depth = +(el.dataset.depth || 0);
    const isGlow = el.id === 'hallGlow';
    let aim;
    if (isGlow) {
      aim = { wx: 0, wyaw: 0, z: 3100 };
      setAimedDoor(null);
    } else {
      hallAimSide = el.dataset.side;
      hallProgress = depth;
      setAimedDoor(el);
      aim = doorAimPose(el.dataset.side, depth);
    }
    goal.wx = aim.wx; goal.wyaw = aim.wyaw; goal.z = aim.z;
    goal.yaw = 0; goal.pitch = 0; goal.off = 0;
    await whenSettled(3200);
    el.classList.add('opening');
    await new Promise((r) => setTimeout(r, 500));
    camRate = 2.4;
    goal.z = isGlow ? 3700 : 640;
    await whenSettled(3600);
    $('hallFlash').classList.add('on');
    await new Promise((r) => setTimeout(r, 480));
    $('hall').classList.remove('show');
    $('hallFlash').classList.remove('on');
    document.body.classList.remove('hall-on');
    el.classList.remove('opening');
    camRate = 4.2;
    if (nodeId === STORY.start) {
      resetPose();
    } else {
      Object.assign(pose, { wx: aim.wx, wyaw: aim.wyaw, z: aim.z, yaw: 0, pitch: 0, off: 0 });
      Object.assign(goal, pose);
    }
    hallBusy = false;
    state.hallEntryNode = nodeId;
    switchView('story', { skipHall: true });
    renderNode(nodeId);
  }

  /* 章节切换回调：离开序章即视为「已过序章」，之后回画廊看到完整走廊 */
  function onChapter(chapter) {
    if (!chapter) return;
    if (!/序章/.test(chapter)) markPassed();
  }

  /* 首屏如已有进度（非序章），直接视为已过序章 */
  try {
    if (state && state.chapter && !/序章/.test(state.chapter)) markPassed();
  } catch { /* ignore */ }

  window.addEventListener('resize', () => {
    if ($('hall') && $('hall').classList.contains('show')) applyCam();
  });

  function aimDoor(nodeId) {
    // 找到对应 nodeId 的门（两壁容器分别是 hallDoorsL / hallDoorsR）
    const doors = document.querySelectorAll('#hall .d3d[data-node]');
    let target = null;
    doors.forEach((d) => { if (d.dataset.node === nodeId) target = d; });
    if (!target) {
      // 不在 HALL_DOORS 列表 → 镜头回到起点中间
      goal.wx = 0; goal.wyaw = 0; goal.yaw = 0; goal.pitch = 0; goal.off = 0;
      goal.z = Math.max(0, Math.min(pose.z, HALL_Z_MAX - 400));
      hallAimSide = ''; setAimedDoor(null); armHallIdle(); return;
    }
    const side = target.dataset.side || 'left';
    const depth = parseFloat(target.dataset.depth || '450');
    const aim = doorAimPose(side, depth);
    goal.wx = aim.wx; goal.wyaw = aim.wyaw; goal.z = aim.z;
    goal.yaw = 0; goal.pitch = 0; goal.off = 0;
    hallAimSide = side;
    hallProgress = depth;
    setAimedDoor(target);
    armHallIdle();
  }

  function showAtDoor(nodeId) {
    buildHall();
    const solo = !passedPrologue();
    const hall = $('hall');
    if (!hall) return;
    hallHold = true;
    hall.classList.toggle('solo', solo);
    hall.classList.add('show');
    document.body.classList.add('hall-on');
    applyCam();
    startCamLoop();
    // 等视图布局稳定后，镜头平滑滑到目标门前，并停在那里
    setTimeout(() => aimDoor(nodeId), 360);
  }

  window.AdvHall = { show, hide, onChapter, aimDoor, showAtDoor };
})();
