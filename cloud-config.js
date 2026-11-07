/* =========================================================
 * cloud-config.js —— 静态托管时的接口地址
 *
 * 页面放在 GitHub Pages / 对象存储等静态托管上时，页面和接口不同域，
 * 需要把接口指向云函数；本地开发（localhost / 127.0.0.1）保持同源。
 * app.js 会优先读 ?api= 参数，其次读 localStorage 里的 adv_api_base。
 * ========================================================= */
(function () {
  var h = location.hostname;
  if (!h) return;                                          // file:// 直接打开，跳过
  if (/^(localhost|127\.0\.0\.1)$/.test(h)) return;        // 本地开发，保持同源
  if (/\.fcapp\.run$/.test(h)) return;                     // 已经和后端同域，跳过

  var base = 'https://doumiao-adv-bfzrfvqpep.cn-shanghai.fcapp.run';
  try {
    if (!localStorage.getItem('adv_api_base')) {
      localStorage.setItem('adv_api_base', base);
    }
  } catch (e) { /* 隐私模式等场景忽略 */ }
})();
