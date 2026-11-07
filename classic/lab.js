/* =========================================================
 * lab.js —— AI 实验室：调教一台感知机（纯前端，不依赖后端）
 *
 * 玩法：在训练场上点一点，给机器喂「甜果🍎 / 酸果🍋」样本；
 * 点「开始训练」，感知机（打分器）一轮轮改错，
 * 画布上的分界线会慢慢挪到正确位置；最后用「考试」检验它。
 *
 * 教学点：数据（样本数）· 算法（感知机改错规则）· 算力（每步训练速度）
 * ========================================================= */
(function () {
  const cv = document.getElementById('labCanvas');
  if (!cv) return;
  const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  const $ = (id) => document.getElementById(id);

  /* ---------- 状态 ---------- */
  // 样本：{ x, y } ∈ [0,1]²（x=颜色深浅，y=个头大小），label：1=甜 / -1=酸
  const PRESET = [
    { x: .78, y: .72, label: 1 }, { x: .84, y: .55, label: 1 }, { x: .68, y: .82, label: 1 },
    { x: .88, y: .80, label: 1 }, { x: .72, y: .62, label: 1 }, { x: .60, y: .72, label: 1 },
    { x: .22, y: .30, label: -1 }, { x: .32, y: .18, label: -1 }, { x: .16, y: .44, label: -1 },
    { x: .38, y: .38, label: -1 }, { x: .26, y: .12, label: -1 }, { x: .12, y: .24, label: -1 },
  ];
  let samples = [];
  let w = { a: 0, b: 0, bias: 0 };   // 感知机权重：score = a*x + b*y + bias
  let epoch = 0;
  let training = false;
  let timer = null;
  let power = 6;                      // 算力：每个动画帧跑几轮训练
  let addLabel = 1;                   // 当前添加的是甜果还是酸果
  let examFruit = null;               // 考试中的神秘水果 { x, y, label, revealed }

  /* ---------- 感知机 ---------- */
  const predict = (x, y) => (w.a * x + w.b * y + w.bias >= 0 ? 1 : -1);
  function accuracy() {
    if (!samples.length) return 0;
    const ok = samples.filter((s) => predict(s.x, s.y) === s.label).length;
    return ok / samples.length;
  }
  // 一轮训练：把所有样本过一遍，判错就挪权重（感知机学习规则）
  function trainOneEpoch() {
    for (const s of samples) {
      const err = s.label - predict(s.x, s.y);   // 判对 err=0；判错 err=±2
      if (err !== 0) {
        w.a += 0.5 * err * s.x;
        w.b += 0.5 * err * s.y;
        w.bias += 0.5 * err;
      }
    }
    epoch += 1;
  }

  /* ---------- 绘制 ---------- */
  const px = (x) => x * W, py = (y) => (1 - y) * H;   // y 轴翻转，符合直觉（上=大）
  function draw() {
    ctx.clearRect(0, 0, W, H);
    // 底色：先铺一层浅浅的「酸区」，再沿分界线裁出「甜区」，避免锯齿小方块
    const hasLine = Math.abs(w.a) > 1e-6 || Math.abs(w.b) > 1e-6;
    if (hasLine) {
      ctx.fillStyle = 'rgba(47, 199, 154, .12)';
      ctx.fillRect(0, 0, W, H);
      // 逐边求 f=0 的交点，拼出甜区那块半平面
      const score = (X, Y) => w.a * (X / W) + w.b * (1 - Y / H) + w.bias;
      const corners = [[0, 0], [W, 0], [W, H], [0, H]];
      const pts = [];
      for (let i = 0; i < 4; i++) {
        const [x1, y1] = corners[i], [x2, y2] = corners[(i + 1) % 4];
        const f1 = score(x1, y1), f2 = score(x2, y2);
        if (f1 >= 0) pts.push([x1, y1]);
        if ((f1 >= 0) !== (f2 >= 0)) {
          const t = f1 / (f1 - f2);
          pts.push([x1 + (x2 - x1) * t, y1 + (y2 - y1) * t]);
        }
      }
      if (pts.length >= 3) {
        ctx.beginPath();
        pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.closePath();
        ctx.fillStyle = 'rgba(255, 201, 60, .17)';
        ctx.fill();
      }
    }
    // 网格线
    ctx.strokeStyle = 'rgba(34, 52, 77, .10)'; ctx.lineWidth = 1;
    for (let gx = 0; gx <= W; gx += W / 8) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke(); }
    for (let gy = 0; gy <= H; gy += H / 6) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke(); }
    // 轴标签
    ctx.fillStyle = '#55647d'; ctx.font = '600 12px Nunito, sans-serif';
    ctx.fillText('颜色深 →', W - 68, H - 10);
    ctx.save(); ctx.translate(14, 70); ctx.rotate(-Math.PI / 2); ctx.fillText('个头大 →', 0, 0); ctx.restore();
    // 分界线：a*x + b*y + bias = 0
    if (w.a !== 0 || w.b !== 0) {
      ctx.strokeStyle = '#ff6b4a'; ctx.lineWidth = 2.5; ctx.setLineDash([8, 6]);
      ctx.beginPath();
      if (Math.abs(w.b) > 1e-6) {
        const y0 = -(w.bias) / w.b, y1 = -(w.a + w.bias) / w.b;
        ctx.moveTo(0, py(y0)); ctx.lineTo(W, py(y1));
      } else {
        const x0 = -w.bias / w.a;
        ctx.moveTo(px(x0), 0); ctx.lineTo(px(x0), H);
      }
      ctx.stroke(); ctx.setLineDash([]);
    }
    // 样本
    ctx.font = '20px "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const s of samples) {
      const right = predict(s.x, s.y) === s.label;
      ctx.beginPath();
      ctx.arc(px(s.x), py(s.y), 13, 0, Math.PI * 2);
      ctx.fillStyle = '#fffdf6';
      ctx.fill();
      ctx.strokeStyle = right ? '#2fc79a' : '#ff6b4a';
      ctx.lineWidth = right ? 2 : 3;
      ctx.stroke();
      ctx.fillText(s.label === 1 ? '🍎' : '🍋', px(s.x), py(s.y) + 1);
    }
    // 考试中的神秘水果
    if (examFruit) {
      const e = examFruit;
      ctx.beginPath();
      ctx.arc(px(e.x), py(e.y), 15, 0, Math.PI * 2);
      ctx.fillStyle = '#fff8e8'; ctx.fill();
      ctx.strokeStyle = e.revealed ? '#3d9df3' : '#8b79f0';
      ctx.lineWidth = 3; ctx.stroke();
      ctx.fillText(e.revealed ? (e.label === 1 ? '🍎' : '🍋') : '❓', px(e.x), py(e.y) + 1);
    }
  }

  /* ---------- 仪表盘 ---------- */
  function paintMeters() {
    $('labAcc').textContent = samples.length ? Math.round(accuracy() * 100) + '%' : '—';
    $('labEpoch').textContent = epoch;
    $('labSamples').textContent = samples.length;
  }
  function status(t) { $('labStatus').textContent = t; }

  /* ---------- 训练循环 ---------- */
  function stopTraining() {
    training = false;
    clearInterval(timer);
    $('labTrain').disabled = false;
    $('labTrain').textContent = '▶ 开始训练';
  }
  $('labTrain').addEventListener('click', () => {
    if (training) { stopTraining(); status('训练暂停。分界线停在这里——要不要加点样本再继续？'); return; }
    if (samples.length < 2) { status('样本太少啦，先点训练场加几个水果吧！'); return; }
    training = true;
    $('labTrain').textContent = '⏸ 暂停';
    status('训练中：机器正在一轮轮改错，看那条虚线慢慢挪……');
    timer = setInterval(() => {
      for (let i = 0; i < power; i++) trainOneEpoch();
      draw(); paintMeters();
      const acc = accuracy();
      if (acc === 1) {
        stopTraining();
        status(`全部答对！第 ${epoch} 轮，准确率 100%。点「考试」让它见识新水果吧。`);
      } else if (epoch > 600) {
        stopTraining();
        status('它尽力了……有些水果的位置太纠缠，也许直线分不开？试试调整样本再练。');
      }
    }, 110);
  });

  /* ---------- 添加样本 / 考试 ---------- */
  function setAdd(label) {
    addLabel = label;
    $('labAddSweet').classList.toggle('active', label === 1);
    $('labAddSour').classList.toggle('active', label === -1);
  }
  $('labAddSweet').addEventListener('click', () => setAdd(1));
  $('labAddSour').addEventListener('click', () => setAdd(-1));
  cv.addEventListener('click', (e) => {
    const r = cv.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = 1 - (e.clientY - r.top) / r.height;
    if (examFruit && !examFruit.revealed) return;   // 等考试结果揭晓
    examFruit = null;
    samples.push({ x, y, label: addLabel });
    draw(); paintMeters();
    status(`放进一颗${addLabel === 1 ? '甜果🍎' : '酸果🍋'}——数据 +1。样本越多，机器学得越稳。`);
  });
  $('labTest').addEventListener('click', () => {
    if (training) return;
    // 随机出一颗机器没见过的水果（按真实规律：颜色深+个头大→甜）
    const x = 0.15 + Math.random() * 0.7, y = 0.15 + Math.random() * 0.7;
    const label = (x + y > 1.05) ? 1 : -1;
    examFruit = { x, y, label, revealed: false };
    draw();
    status('来了一颗没见过的水果……机器正在打分……');
    setTimeout(() => {
      if (!examFruit) return;
      examFruit.revealed = true;
      const guess = predict(x, y);
      const right = guess === label;
      draw();
      status(right
        ? `机器猜${guess === 1 ? '甜' : '酸'}——答对了！🎉 它真的学会了，不只是背答案。`
        : `机器猜${guess === 1 ? '甜' : '酸'}，其实是${label === 1 ? '甜' : '酸'}的……答错了。给它补几颗类似的样本，再练一轮？`);
    }, 700);
  });
  $('labReset').addEventListener('click', () => {
    stopTraining();
    samples = PRESET.map((s) => ({ ...s }));
    w = { a: 0, b: 0, bias: 0 };
    epoch = 0; examFruit = null;
    draw(); paintMeters();
    status('已重置为果园送来的第一批样本。点「开始训练」试试看！');
  });
  $('labPower').querySelectorAll('button').forEach((b) =>
    b.addEventListener('click', () => {
      power = +b.dataset.p;
      $('labPower').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
      status(`算力调到「${b.textContent}」：同样的算法，跑得快的机器学得也快。`);
    }));

  /* ---------- 初始化 ---------- */
  samples = PRESET.map((s) => ({ ...s }));
  draw(); paintMeters();
  status('已装好果园送来的第一批样本。点「开始训练」，或先亲手加几颗水果。');
})();
