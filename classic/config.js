/* =========================================================
 * config.js —— 前端连接后端的一行开关
 *
 * 默认留空：页面和接口在同一台服务器上（server.js 同时托管两者）。
 *
 * 如果后端跑在另一台电脑 / 另一个地址，把下面的地址改成后端的真实地址：
 *   window.API_BASE = 'http://192.168.1.8:3002';
 *
 * 改完保存、刷新页面即可；后端 server.js 已允许跨域请求。
 * ========================================================= */
/* 经典馆藏版挂在 /classic 子路径，接口统一走 /classic/api（由根目录 server.js 转发到 classic/routes）
 * 页面放到 GitHub Pages 等静态托管时，自动指向阿里云函数计算上的同一套后端。 */
window.API_BASE = (function () {
  var h = location.hostname;
  var local = !h || /^(localhost|127\.0\.0\.1)$/.test(h);
  if (local || /\.fcapp\.run$/.test(h)) return '/classic';
  return 'https://doumiao-adv-bfzrfvqpep.cn-shanghai.fcapp.run/classic';
})();
