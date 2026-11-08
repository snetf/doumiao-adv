/* =========================================================
 * cloud-sync.js —— 学习数据云端同步（两版共用）
 *
 * 职责：
 *   1. 生成/复用匿名设备 ID（adv_device_id，随机 UUID，无任何个人信息）
 *   2. 启动时静默 hello 注册设备 + 拉云端进度合并进 localStorage（只增不减）
 *   3. localStorage 进度变化后防抖上传到 MySQL；页面关闭前 keepalive 补一次
 *   4. CloudSync.track(event, meta) 上报学习事件（术语点亮 / 章节完成…）
 *
 * 铁律：接口失败 / 未配置 DB 时一律静默降级 localStorage，页面永不可崩。
 * 加载顺序：cloud-config.js 之后、app.js 之后（DOMContentLoaded 才启动）。
 * ========================================================= */
(function () {
  'use strict';

  /* ---------- 接口地址：与 app.js 同一套规则 ---------- */
  function apiBase() {
    let base = String(window.API_BASE || '').replace(/\/$/, '');
    if (!base) {
      try { base = String(localStorage.getItem('adv_api_base') || '').replace(/\/$/, ''); } catch { /* 忽略 */ }
    }
    return base;
  }

  /* ---------- 匿名设备 ID ---------- */
  function deviceId() {
    let id = '';
    try { id = localStorage.getItem('adv_device_id') || ''; } catch { /* 忽略 */ }
    if (!/^[A-Za-z0-9-]{8,64}$/.test(id)) {
      id = (crypto.randomUUID && crypto.randomUUID()) ||
        ('dev-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12));
      try { localStorage.setItem('adv_device_id', id); } catch { /* 忽略 */ }
    }
    return id;
  }

  /* ---------- 静默请求：永不抛错 ---------- */
  async function silentFetch(path, opts) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(apiBase() + path, { signal: ctrl.signal, ...opts });
      clearTimeout(timer);
      if (!res.ok) return null;
      return await res.json();
    } catch { return null; }
  }

  /* ---------- 合并规则（只增不减） ----------
   * 数组：按 JSON 值求并集；对象数值键：取大；对象其他键：本地优先、云端补缺；
   * 字符串：本地非空则保留本地，否则用云端。 */
  function mergeValue(local, cloud) {
    if (Array.isArray(local) && Array.isArray(cloud)) {
      const seen = new Set(local.map((v) => JSON.stringify(v)));
      const out = local.slice();
      for (const v of cloud) {
        const k = JSON.stringify(v);
        if (!seen.has(k)) { seen.add(k); out.push(v); }
      }
      return out;
    }
    if (local && cloud && typeof local === 'object' && typeof cloud === 'object'
      && !Array.isArray(local) && !Array.isArray(cloud)) {
      const out = { ...cloud, ...local };
      for (const k of Object.keys(cloud)) {
        if (typeof cloud[k] === 'number' && typeof local[k] === 'number') {
          out[k] = Math.max(local[k], cloud[k]);
        } else if (cloud[k] && local[k] && typeof cloud[k] === 'object' && typeof local[k] === 'object') {
          out[k] = mergeValue(local[k], cloud[k]);
        }
      }
      return out;
    }
    if (typeof local === 'string' || typeof cloud === 'string') {
      return local || cloud || '';
    }
    return local !== undefined && local !== null ? local : cloud;
  }

  /* ---------- 主模块 ---------- */
  let scene = 'joy';
  let keyMap = {};          // { localStorageKey: payloadField }
  let uploadTimer = null;
  let lastFingerprint = '';
  let started = false;

  function readPayload() {
    const payload = {};
    for (const [lsKey, field] of Object.entries(keyMap)) {
      try {
        const raw = localStorage.getItem(lsKey);
        if (raw !== null) payload[field] = JSON.parse(raw);
      } catch { /* 忽略坏数据 */ }
    }
    return payload;
  }

  function fingerprint() {
    try { return JSON.stringify(readPayload()); } catch { return ''; }
  }

  /* 防抖上传：2s 合并多次变更；keepalive 保证页面关闭也能发出 */
  function scheduleUpload(immediate) {
    clearTimeout(uploadTimer);
    uploadTimer = setTimeout(doUpload, immediate ? 0 : 2000);
  }

  async function doUpload() {
    const payload = readPayload();
    if (!Object.keys(payload).length) return;
    const body = JSON.stringify({ deviceId: deviceId(), scene, payload });
    if (body.length > 64 * 1024) return;    // 与服务端上限一致
    const out = await silentFetch('/api/progress', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    });
    if (out && out.ok) lastFingerprint = fingerprint();
  }

  /* 拉云端进度合并进 localStorage；有实际变化且页面刚加载时，刷新一次让合并生效 */
  async function pullAndMerge() {
    const out = await silentFetch(
      '/api/progress?deviceId=' + encodeURIComponent(deviceId()) + '&scene=' + scene);
    if (!out || !out.ok || !out.progress) {
      // 云端没记录：把本地现有进度推上去建档
      if (out && out.ok && !out.progress) scheduleUpload(true);
      return;
    }
    const cloud = out.progress;
    let changed = false;
    for (const [lsKey, field] of Object.entries(keyMap)) {
      if (!(field in cloud)) continue;
      let local;
      try { local = JSON.parse(localStorage.getItem(lsKey) || 'null'); } catch { local = null; }
      const merged = mergeValue(local === null ? undefined : local, cloud[field]);
      if (JSON.stringify(merged) !== JSON.stringify(local)) {
        try { localStorage.setItem(lsKey, JSON.stringify(merged)); } catch { /* 忽略 */ }
        changed = true;
      }
    }
    if (!changed) { lastFingerprint = fingerprint(); return; }
    lastFingerprint = fingerprint();
    // 回写云端一份合并结果，两端对齐
    scheduleUpload(true);
    // 页面刚打开（用户还没怎么操作）才自动刷新一次；防循环用 sessionStorage 标记
    const guard = 'adv_cs_applied_' + scene;
    let already = false;
    try { already = sessionStorage.getItem(guard) === '1'; } catch { /* 忽略 */ }
    if (!already && performance.now() < 5000) {
      try { sessionStorage.setItem(guard, '1'); } catch { /* 忽略 */ }
      location.reload();
    }
  }

  /* 每 5s 检查一次进度指纹，变了就防抖上传（不侵入 app.js 的各个存储点） */
  function startWatcher() {
    lastFingerprint = fingerprint();
    setInterval(() => {
      const fp = fingerprint();
      if (fp && fp !== lastFingerprint) scheduleUpload();
    }, 5000);
    window.addEventListener('beforeunload', () => {
      if (fingerprint() !== lastFingerprint) scheduleUpload(true);
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && fingerprint() !== lastFingerprint) scheduleUpload(true);
    });
  }

  /* ---------- 跨设备同步码（手机 ↔ 电脑） ----------
   * 自动注入两版都有的 API 弹窗（#apiModal .api-card），复用弹窗现有样式类，
   * app.js 零改动。流程：本机获取 6 位码 → 另一台设备输入 → 换成同一设备 ID。 */
  function wireSyncUI() {
    const card = document.querySelector('#apiModal .api-card');
    if (!card || document.getElementById('csSync')) return;

    const style = document.createElement('style');
    style.textContent = ''
      + '.cs-sync{margin-top:14px;border-top:1px solid rgba(127,127,127,.25);padding-top:12px}'
      + '.cs-sync-title{font-weight:700;margin-bottom:8px}'
      + '.cs-row{display:flex;gap:8px;align-items:center;margin:8px 0;flex-wrap:wrap}'
      + '.cs-code{font-size:22px;letter-spacing:4px;font-weight:800}'
      + '.cs-note{font-size:12px;opacity:.75;margin-top:4px}';
    document.head.appendChild(style);

    const box = document.createElement('div');
    box.className = 'cs-sync';
    box.id = 'csSync';
    box.innerHTML = ''
      + '<div class="cs-sync-title">📱↔💻 手机和电脑同步</div>'
      + '<div class="cs-row">本机同步码：<b class="cs-code" id="csCode">------</b>'
      + '<button type="button" class="ghost-btn" id="csCodeBtn">获取</button></div>'
      + '<div class="cs-row"><input class="api-input" id="csCodeInput" maxlength="6" '
      + 'placeholder="输入另一台设备的 6 位码" autocomplete="off" spellcheck="false" '
      + 'style="max-width:220px;text-transform:uppercase">'
      + '<button type="button" class="primary-btn" id="csRedeemBtn">连接</button></div>'
      + '<div class="cs-note" id="csNote">同步码 10 分钟内有效，一码一次。连接后两台设备共用同一份学习档案。</div>';
    card.appendChild(box);

    const codeEl = box.querySelector('#csCode');
    const noteEl = box.querySelector('#csNote');
    const inputEl = box.querySelector('#csCodeInput');

    box.querySelector('#csCodeBtn').addEventListener('click', async () => {
      noteEl.textContent = '正在获取同步码……';
      const out = await silentFetch('/api/sync/code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: deviceId() }),
      });
      if (out && out.ok && out.code) {
        codeEl.textContent = out.code;
        noteEl.textContent = '把 ' + out.code + ' 填到另一台设备上，10 分钟内有效。';
      } else if (out && out.fallback) {
        noteEl.textContent = '云端暂时不可用，稍后再试。';
      } else {
        noteEl.textContent = '获取失败，再点一次试试。';
      }
    });

    box.querySelector('#csRedeemBtn').addEventListener('click', async () => {
      const code = String(inputEl.value || '').trim().toUpperCase();
      if (!/^[A-Z2-9]{6}$/.test(code)) { noteEl.textContent = '格式不对：6 位字母或数字。'; return; }
      noteEl.textContent = '正在连接……';
      const out = await silentFetch('/api/sync/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, deviceId: deviceId() }),
      });
      if (out && out.ok && out.deviceId) {
        try { localStorage.setItem('adv_device_id', out.deviceId); } catch { /* 忽略 */ }
        noteEl.textContent = '连接成功！正在同步两台设备的进度……';
        setTimeout(() => { try { location.reload(); } catch { /* 忽略 */ } }, 1200);
      } else if (out && out.error === 'code_expired') {
        noteEl.textContent = '同步码已过期或被用过了，让对方重新获取一个。';
      } else if (out && out.error === 'same_device') {
        noteEl.textContent = '这是本机自己的码，要填另一台设备上的。';
      } else if (out && out.fallback) {
        noteEl.textContent = '云端暂时不可用，稍后再试。';
      } else {
        noteEl.textContent = '连接失败，检查一下码有没有输错。';
      }
    });
  }

  window.CloudSync = {
    /** opts: { scene: 'joy'|'classic', keys: { localStorageKey: payloadField } } */
    init(opts) {
      if (started || !opts || !opts.keys) return;
      started = true;
      scene = opts.scene === 'classic' ? 'classic' : 'joy';
      keyMap = opts.keys;
      const boot = () => {
        wireSyncUI();
        // 静默注册设备（不阻塞首屏）
        silentFetch('/api/account/hello', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceId: deviceId(), scene }),
        });
        pullAndMerge();
        startWatcher();
      };
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 0));
      } else {
        setTimeout(boot, 0);
      }
    },

    /** 学习事件上报：track('tip_collect', { term: '光合作用' }) */
    track(event, meta) {
      if (!/^[a-z][a-z0-9_]{1,47}$/.test(String(event || ''))) return;
      silentFetch('/api/stats/event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: deviceId(), scene, event, meta: meta || undefined }),
        keepalive: true,
      });
    },

    /** 调试/说明书用：当前设备 ID */
    deviceId,
  };
})();
