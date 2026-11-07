/* =========================================================
 * fx.js —— 视觉层（CG 场景 / 首屏粒子 / 视差 / 入场动效）
 *
 * 只做「画面」，不碰剧情状态：
 *   1. SceneFX.setNode(node) 由 app.js 在每个剧情节点调用，
 *      根据章节切换 CG 影像、年份水印、环境色调
 *   2. 首屏 heroCanvas：星尘 + 连线，极轻量的氛围动画
 *   3. 鼠标视差：CG 画面 / 光斑随指针轻微移动
 *   4. 视图切换入场：监听 .view.active 变化重播动画
 * ========================================================= */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- 章节 → CG 场景 ---------- */
  const SCENES = {
    '序章 · 博物馆之夜': {
      key: 'museum', art: 'museum', tint: 'museum',
      year: '2022', name: '时光机展厅', meta: '科技博物馆 · 开馆时间',
    },
    '第一章 · 模仿游戏': {
      key: 'turing', art: 'room', tint: 'cold',
      img: 'assets/sci_turing.jpg', pos: '64% 16%', photoCaption: '1950 · 艾伦·图灵',
      wall: ['#EAF5FF', '#D9EAF9'], floor: ['#FFE7C4', '#FFD5A4'], desk: '#FFE3BE',
      year: '1950', name: '艾伦·图灵', meta: '英国曼彻斯特 · 清晨的街道',
      doodles: ['💡', '📝'],
    },
    '第二章 · 给新学科起名字': {
      key: 'dartmouth', art: 'room', tint: 'warm',
      img: 'assets/sci_mccarthy.jpg', pos: '52% 20%', photoCaption: '1956 · 达特茅斯会议',
      wall: ['#FFF6E0', '#FFEBCB'], floor: ['#FFE1B8', '#FFCF98'], desk: '#FFD9A8',
      year: '1956', name: '达特茅斯会议', meta: '美国 · 汉诺威 · 那个夏天',
      doodles: ['☀️', '🧠'],
    },
    '第三章 · 漫长的冬天': {
      key: 'winter', art: 'room', tint: 'warm',
      img: 'assets/sci_hinton.jpg', pos: '50% 18%', photoCaption: '1974 · 杰弗里·辛顿',
      wall: ['#E4EEF9', '#CFDEEE'], floor: ['#EFF4FA', '#DCE7F3'], desk: '#F0DCC4',
      year: '1974', name: '杰弗里·辛顿', meta: '爱丁堡 · 只有一盏灯亮着',
      doodles: ['❄️', '🕯️'],
    },
    '第四章 · 会请教专家的电脑': {
      key: 'expert', art: 'room', tint: 'warm',
      img: 'assets/sci_feigenbaum.jpg', pos: '50% 14%', photoCaption: '1975 · 费根鲍姆',
      wall: ['#FFF6E6', '#F6E2C8'], floor: ['#F4E7D3', '#E7D6BE'], desk: '#E8D2B4',
      year: '1975', name: 'MYCIN 终端室', meta: '斯坦福大学 · 病历与规则之间',
      doodles: ['🩺', '📚'],
    },
    '第五章 · 棋盘上的深蓝': {
      key: 'blue', art: 'room', tint: 'cold',
      img: 'assets/sci_kasparov.jpg', pos: '50% 18%', photoCaption: '1997 · 深蓝对局',
      wall: ['#DDEBFF', '#CBE0FA'], floor: ['#E8EEF7', '#D5E1F0'], desk: '#CFD9E8',
      year: '1997', name: '深蓝对局', meta: '纽约 · 公平保险中心大厦',
      doodles: ['♟️', '🤖'],
    },
    '第六章 · 认出猫的神经网络': {
      key: 'imagenet', art: 'photos', tint: 'photos',
      year: '2012', name: 'ImageNet', meta: '机器第一次「看见」世界',
    },
    '第七章 · 神之一手': {
      key: 'alphago', art: 'room', tint: 'violet',
      img: 'assets/sci_lee.jpg', pos: '46% 18%', photoCaption: '2016 · 首尔第五局',
      wall: ['#F0E9FF', '#E0D7F6'], floor: ['#F2E9DA', '#E4D8C5'], desk: '#E3CFAF',
      year: '2016', name: 'AlphaGo 对局', meta: '首尔 · 第五局 · 神之一手',
      doodles: ['⚫', '⚪'],
    },
    '第八章 · 会说话的大模型': {
      key: 'llm', art: 'data', tint: 'data',
      year: '2022', name: '大语言模型', meta: '和词语做朋友的大机器',
    },
    '尾声 · 小豆苗发芽了': {
      key: 'sprout', art: 'sprout', tint: 'sprout',
      year: '2022', name: '小豆苗发芽了', meta: '你走过的七十年，长成了一棵树',
    },
  };
  const FALLBACK = SCENES['序章 · 博物馆之夜'];

  /* ---------- 插图式 CG（没有历史照片的章节，用可动的插画场面） ---------- */
  /* 第四位 cat=1 标记「猫」：第六章找猫小游戏按这个标记判定（不能靠名字，熊猫也带「猫」字）
     4 只猫分散在照片墙两端与中间，孩子需要真的扫一遍，而不是一眼全看见 */
  const PHOTO_ANIMALS = [
    ['🐱', '虎斑猫', '#FFE3C8', 1], ['🐶', '小狗', '#DDF1FF'], ['🐰', '兔子', '#FFE0EC'],
    ['🐼', '熊猫', '#E8F6DF'], ['🦊', '狐狸', '#FFE0CE'], ['🐈', '橘猫', '#FFE9CE', 1],
    ['🐸', '青蛙', '#E0F7DE'], ['🐧', '企鹅', '#E3F1FA'], ['🐈‍⬛', '黑猫', '#E4EEF7', 1],
    ['🐟', '小鱼', '#D9F0FF'], ['🌻', '向日葵', '#FFF2C4'], ['😺', '白猫', '#FFFFFF', 1],
    ['🍎', '苹果', '#FFE0DE'], ['🚗', '小汽车', '#E0EEFF'], ['🚀', '火箭', '#E7E2FF'],
    ['🐮', '奶牛', '#FFF0E2'], ['🦋', '蝴蝶', '#F3E4FF'], ['🌵', '仙人掌', '#E2F5DE'],
  ];
  const WORDS = ['你好呀', '喵星人', '讲故事', '为什么', '晚安', '苹果派'];

  function procMuseum() {
    let teeth = '';
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      teeth += `<circle cx="${(480 + Math.cos(a) * 92).toFixed(1)}" cy="${(212 + Math.sin(a) * 92).toFixed(1)}"
        r="12" fill="#FFD35A" stroke="#2C3E57" stroke-width="2"/>`;
    }
    return `<div class="proc proc-museum">
      <svg class="pm-scene" viewBox="0 0 960 420" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <defs>
          <linearGradient id="pmWallG" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#EAF8FF"/><stop offset="1" stop-color="#FFF7E6"/>
          </linearGradient>
          <linearGradient id="pmFloorG" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#FFE9C9"/><stop offset="1" stop-color="#FFDAB0"/>
          </linearGradient>
        </defs>
        <rect width="960" height="420" fill="url(#pmWallG)"/>
        <path d="M40 0h190L110 330H0z" fill="#FFFFFF" opacity=".38"/>

        <!-- 地面 -->
        <rect y="330" width="960" height="90" fill="url(#pmFloorG)"/>
        <path d="M0 330h960" stroke="#2C3E57" stroke-width="3"/>
        <ellipse cx="480" cy="392" rx="330" ry="30" fill="#CFE9FF" opacity=".55"/>

        <!-- 三个展厅壁龛 -->
        <g stroke="#2C3E57" stroke-width="3" fill="#FFFAEC">
          <path d="M92 330V152a108 108 0 0 1 216 0V330Z"/>
          <path d="M372 330V152a108 108 0 0 1 216 0V330Z"/>
          <path d="M652 330V152a108 108 0 0 1 216 0V330Z"/>
        </g>

        <!-- 彩旗 -->
        <path d="M40 66q140 48 280 6" stroke="#2C3E57" stroke-width="2" fill="none"/>
        <path d="M60 76l18 2-6 26z" fill="#FF8A6B"/>
        <path d="M112 88l18 1-5 26z" fill="#FFD35A"/>
        <path d="M164 94l18 0-4 26z" fill="#7FD8B2"/>
        <path d="M216 92l18-2-3 26z" fill="#8FC5FF"/>
        <path d="M268 84l17-3-2 26z" fill="#FFAFCF"/>

        <!-- 展品 1：会笑的老电脑 -->
        <g>
          <rect x="132" y="268" width="176" height="16" rx="8" fill="#FFD79E" stroke="#2C3E57" stroke-width="2.4"/>
          <rect x="154" y="284" width="152" height="46" rx="10" fill="#FFF3D8" stroke="#2C3E57" stroke-width="2.4"/>
          <rect x="178" y="176" width="104" height="86" rx="12" fill="#D8F0FF" stroke="#2C3E57" stroke-width="2.6"/>
          <rect x="190" y="188" width="80" height="56" rx="8" fill="#2C3E57"/>
          <circle cx="213" cy="208" r="6" fill="#7FF0D0"/>
          <circle cx="247" cy="208" r="6" fill="#7FF0D0"/>
          <path d="M214 224q12 9 24 0" stroke="#FFD35A" stroke-width="3" fill="none" stroke-linecap="round"/>
          <rect x="196" y="252" width="68" height="10" rx="5" fill="#FFE1B8" stroke="#2C3E57" stroke-width="2"/>
          <path d="M178 236h104" stroke="#2C3E57" stroke-width="2" opacity=".25"/>
        </g>

        <!-- 展品 2：时光机（大钟 + 齿轮） -->
        <g>
          ${teeth}
          <circle cx="480" cy="212" r="78" fill="#FFF6D6" stroke="#2C3E57" stroke-width="3"/>
          <circle cx="480" cy="212" r="62" fill="#FFFDF4" stroke="#2C3E57" stroke-width="2"/>
          <path d="M480 212V164" stroke="#FF6B4A" stroke-width="6" stroke-linecap="round"/>
          <path d="M480 212l34 24" stroke="#2C3E57" stroke-width="5" stroke-linecap="round"/>
          <circle cx="480" cy="212" r="7" fill="#2C3E57"/>
          <circle cx="480" cy="154" r="3.4" fill="#2C3E57"/>
          <circle cx="480" cy="270" r="3.4" fill="#2C3E57"/>
          <circle cx="418" cy="212" r="3.4" fill="#2C3E57"/>
          <circle cx="542" cy="212" r="3.4" fill="#2C3E57"/>
          <path d="M440 300h80l14 44H426z" fill="#FFC48F" stroke="#2C3E57" stroke-width="2.6"/>
          <circle cx="480" cy="292" r="10" fill="#FFD35A" stroke="#2C3E57" stroke-width="2"/>
        </g>

        <!-- 展品 3：挥手的机器人 -->
        <g>
          <rect x="700" y="272" width="164" height="14" rx="7" fill="#FFD79E" stroke="#2C3E57" stroke-width="2.4"/>
          <rect x="722" y="286" width="120" height="44" rx="10" fill="#FFF3D8" stroke="#2C3E57" stroke-width="2.4"/>
          <rect x="748" y="196" width="96" height="82" rx="20" fill="#DDF7EE" stroke="#2C3E57" stroke-width="2.6"/>
          <circle cx="776" cy="230" r="6" fill="#2C3E57"/>
          <circle cx="810" cy="230" r="6" fill="#2C3E57"/>
          <path d="M776 248q15 10 30 0" stroke="#2C3E57" stroke-width="3" fill="none" stroke-linecap="round"/>
          <path d="M748 214q-24-16-34-38" stroke="#2C3E57" stroke-width="3" stroke-linecap="round"/>
          <circle cx="710" cy="172" r="9" fill="#FFD35A" stroke="#2C3E57" stroke-width="2"/>
          <path d="M844 216q22 8 32 30" stroke="#2C3E57" stroke-width="3" stroke-linecap="round"/>
          <circle cx="880" cy="250" r="9" fill="#FFD35A" stroke="#2C3E57" stroke-width="2"/>
          <path d="M796 184v-14" stroke="#2C3E57" stroke-width="2.4"/>
          <circle cx="796" cy="164" r="6" fill="#FF8A6B" stroke="#2C3E57" stroke-width="2"/>
        </g>

        <!-- 小豆苗在角落探头 -->
        <g>
          <path d="M118 302c-8-10-16-13-26-14 3 10 10 16 24 18z" fill="#6BCB8F" stroke="#2C3E57" stroke-width="2"/>
          <path d="M119 302c7-10 14-14 24-15-2 10-9 17-22 19z" fill="#8EDCA8" stroke="#2C3E57" stroke-width="2"/>
          <path d="M128 316c0-16 4-24 10-24s10 8 10 24c0 14-4 22-10 22s-10-8-10-22z" fill="#A8E6BE" stroke="#2C3E57" stroke-width="2"/>
          <circle cx="134" cy="310" r="3" fill="#2C3E57"/>
          <circle cx="144" cy="310" r="3" fill="#2C3E57"/>
          <path d="M135 320q5 5 10 0" stroke="#2C3E57" stroke-width="2" fill="none" stroke-linecap="round"/>
        </g>

        <g fill="#FFD35A" stroke="#2C3E57" stroke-width="1.4">
          <path d="M84 120l3 7 7 1-5 5 2 7-7-4-7 4 2-7-5-5 7-1z"/>
          <path d="M604 120l3 7 7 1-5 5 2 7-7-4-7 4 2-7-5-5 7-1z"/>
        </g>
      </svg>
      <div class="proc-label">EXHIBIT 00 · 时光机展厅</div>
    </div>`;
  }

  function procPhotos() {
    const photos = PHOTO_ANIMALS.map(([emoji, label, bg, isCat], i) => {
      const tilt = ((i % 5) - 2) * 2.4 + ((i % 3) - 1) * 1.6;
      return `<figure class="pw-photo" data-cat="${isCat ? 1 : 0}" data-name="${label}" style="--t:${tilt.toFixed(1)}deg;--bg:${bg};--d:${(i * 0.09).toFixed(2)}s">
        <span class="pw-emoji">${emoji}</span>
        <figcaption>${label}</figcaption>
      </figure>`;
    }).join('');
    return `<div class="proc proc-photos">
      <div class="pw-board">
        <div class="pw-grid">${photos}</div>
      </div>
      <div class="proc-label">IMAGENET · 2012 · 1400 万张照片</div>
    </div>`;
  }

  function procData() {
    let bubbles = '';
    WORDS.forEach((w, i) => {
      bubbles += `<span class="pd-bubble b${i + 1}" style="--d:${(i * 0.6).toFixed(1)}s">${w}</span>`;
    });
    return `<div class="proc proc-data">
      ${bubbles}
      <svg class="pd-robot" viewBox="0 0 320 300" aria-hidden="true">
        <g stroke="#2C3E57" stroke-width="2.6">
          <path d="M160 54V32" stroke-linecap="round"/>
          <circle cx="160" cy="24" r="9" fill="#FFD35A"/>
          <rect x="60" y="56" width="200" height="136" rx="42" fill="#DCF7FF"/>
          <rect x="82" y="80" width="156" height="92" rx="26" fill="#2C3E57" stroke="none"/>
          <circle cx="132" cy="120" r="12" fill="#7FF0D0" stroke="none"/>
          <circle cx="188" cy="120" r="12" fill="#7FF0D0" stroke="none"/>
          <circle cx="136" cy="116" r="4" fill="#FFFFFF" stroke="none"/>
          <circle cx="192" cy="116" r="4" fill="#FFFFFF" stroke="none"/>
          <path d="M136 146q24 16 48 0" fill="none" stroke="#FFB48F" stroke-width="4"/>
          <circle cx="56" cy="124" r="14" fill="#FFC48F"/>
          <circle cx="264" cy="124" r="14" fill="#FFC48F"/>
          <rect x="96" y="206" width="128" height="70" rx="18" fill="#FFF0CF"/>
          <circle cx="126" cy="232" r="8" fill="#FF8A6B" stroke="none"/>
          <circle cx="160" cy="232" r="8" fill="#7FD8B2" stroke="none"/>
          <circle cx="194" cy="232" r="8" fill="#8FC5FF" stroke="none"/>
          <path d="M96 224q-24 6-32 30" stroke-linecap="round"/>
          <circle cx="62" cy="260" r="10" fill="#DCF7FF"/>
          <path d="M224 224q24 6 32 30" stroke-linecap="round"/>
          <circle cx="258" cy="260" r="10" fill="#DCF7FF"/>
        </g>
      </svg>
      <div class="proc-label">大语言模型 · 词语接龙高手</div>
    </div>`;
  }

  function procSprout() {
    return `<div class="proc proc-sprout">
      <svg class="ps-scene" viewBox="0 0 640 360" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <defs>
          <linearGradient id="psSkyG" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#DFF6FF"/><stop offset="1" stop-color="#FFF9E8"/>
          </linearGradient>
          <linearGradient id="psPotG" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#FFC49A"/><stop offset="1" stop-color="#F79B72"/>
          </linearGradient>
          <linearGradient id="psLeafG" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#8EE9AF"/><stop offset="1" stop-color="#3FBF7F"/>
          </linearGradient>
        </defs>
        <rect width="640" height="360" fill="url(#psSkyG)"/>

        <!-- 太阳 -->
        <g class="ps-sun">
          <circle cx="86" cy="76" r="62" fill="#FFD65C" opacity=".22"/>
          <g stroke="#F6C64A" stroke-width="4" stroke-linecap="round">
            <line x1="86" y1="10" x2="86" y2="-2"/><line x1="86" y1="142" x2="86" y2="154"/>
            <line x1="20" y1="76" x2="8" y2="76"/><line x1="152" y1="76" x2="164" y2="76"/>
            <line x1="42" y1="32" x2="32" y2="22"/><line x1="130" y1="32" x2="140" y2="22"/>
            <line x1="42" y1="120" x2="32" y2="130"/><line x1="130" y1="120" x2="140" y2="130"/>
          </g>
          <circle cx="86" cy="76" r="40" fill="#FFD35A" stroke="#E9AE36" stroke-width="2.4"/>
          <path d="M70 70q5 6 10 0M92 70q5 6 10 0" stroke="#8A5A18" stroke-width="2.2" fill="none" stroke-linecap="round"/>
          <path d="M74 88q12 9 24 0" stroke="#8A5A18" stroke-width="2.2" fill="none" stroke-linecap="round"/>
        </g>

        <!-- 云朵 -->
        <g fill="#FFFFFF" stroke="#D6E7F5" stroke-width="2" opacity=".95">
          <ellipse cx="512" cy="86" rx="62" ry="26"/><ellipse cx="558" cy="72" rx="44" ry="30"/>
          <ellipse cx="470" cy="96" rx="34" ry="19"/>
        </g>

        <!-- 远山与草地 -->
        <path d="M0 296q120-64 250-6t230-12t160 10v82H0z" fill="#CFEFD4"/>
        <path d="M0 316h640v44H0z" fill="#9FE2B0"/>
        <path d="M0 330q80-16 160 0t160 0t160 0t160 0" stroke="#7FD39A" stroke-width="3" fill="none"/>

        <!-- 花盆 -->
        <rect x="248" y="268" width="156" height="22" rx="11" fill="#FFD7B8" stroke="#2C3E57" stroke-width="2.6"/>
        <path d="M260 286h132l-16 58h-100z" fill="url(#psPotG)" stroke="#2C3E57" stroke-width="2.6"/>
        <path d="M272 302h108" stroke="#FFFFFF" stroke-width="3" opacity=".5"/>

        <!-- 大棵小豆苗 -->
        <g class="ps-mascot">
          <path d="M326 190c-18-26-36-36-58-38 6 26 24 41 52 46z" fill="url(#psLeafG)" stroke="#2C3E57" stroke-width="2.4"/>
          <path d="M330 190c15-26 33-38 55-40-4 26-21 43-49 48z" fill="#8EE9AF" stroke="#2C3E57" stroke-width="2.4"/>
          <path d="M328 250V196" stroke="#4FAF78" stroke-width="8" stroke-linecap="round"/>
          <path d="M286 266c0-44 14-66 40-66s40 22 40 66c0 34-14 52-40 52s-40-18-40-52z" fill="#B4EFC8" stroke="#2C3E57" stroke-width="2.6"/>
          <circle cx="310" cy="246" r="7" fill="#2C3E57"/>
          <circle cx="342" cy="246" r="7" fill="#2C3E57"/>
          <circle cx="312.6" cy="243.6" r="2.6" fill="#FFFFFF"/>
          <circle cx="344.6" cy="243.6" r="2.6" fill="#FFFFFF"/>
          <path d="M312 270q14 12 28 0" stroke="#2C3E57" stroke-width="3" fill="none" stroke-linecap="round"/>
          <circle cx="294" cy="266" r="6" fill="#FFB0B0" opacity=".65"/>
          <circle cx="358" cy="266" r="6" fill="#FFB0B0" opacity=".65"/>
          <path d="M290 262l-26 12" stroke="#2C3E57" stroke-width="3" stroke-linecap="round"/>
          <circle cx="260" cy="277" r="8" fill="#B4EFC8" stroke="#2C3E57" stroke-width="2.2"/>
          <path d="M356 266l24 6" stroke="#2C3E57" stroke-width="3" stroke-linecap="round"/>
          <circle cx="383" cy="273" r="8" fill="#B4EFC8" stroke="#2C3E57" stroke-width="2.2"/>
        </g>

        <!-- 小花 -->
        <g stroke="#2C3E57" stroke-width="1.6">
          <path d="M180 300v-22M470 304v-26" stroke="#4FAF78" stroke-width="2.6"/>
          <g fill="#FFAFCF"><circle cx="180" cy="272" r="7"/><circle cx="172" cy="280" r="6"/><circle cx="188" cy="280" r="6"/></g>
          <circle cx="180" cy="278" r="5" fill="#FFD35A"/>
          <g fill="#8FC5FF"><circle cx="470" cy="272" r="7"/><circle cx="462" cy="280" r="6"/><circle cx="478" cy="280" r="6"/></g>
          <circle cx="470" cy="278" r="5" fill="#FFD35A"/>
        </g>

        <!-- 蝴蝶 -->
        <g class="ps-fly">
          <path d="M520 232q-18-18-28 0t18 14q14-14 10-14z" fill="#FFD35A" stroke="#2C3E57" stroke-width="2"/>
          <path d="M520 232q18-18 28 0t-18 14q-14-14-10-14z" fill="#FFAFCF" stroke="#2C3E57" stroke-width="2"/>
          <path d="M520 232v14" stroke="#2C3E57" stroke-width="2"/>
        </g>
      </svg>
      <div class="proc-label">尾声 · 小豆苗发芽了</div>
    </div>`;
  }

  /* =========================================================
   * 有历史照片的六章：插画书桌 + 照片明信片
   *   画面 = 同一间「博物馆小房间」（墙 / 地板 / 书桌）
   *        + 当章语境的童趣道具（纸带机、黑板、雪窗、终端、棋盘……）
   *        + 右侧一张照片明信片（object-fit: contain，整张脸都在）
   * 六章同一骨架、同一描边配色，只换道具与墙色 —— 热闹但不乱
   * ========================================================= */
  function propsTuring() {
    return `<g stroke="#2C3E57" stroke-linecap="round" stroke-linejoin="round">
      <!-- 台灯 -->
      <g transform="translate(96 0)">
        <ellipse cx="118" cy="292" rx="36" ry="7" fill="#FFD35A" opacity=".5" stroke="none"/>
        <path d="M118 292V210" stroke-width="5" fill="none"/>
        <path d="M106 206h24l30 44H76z" fill="#FFD35A" stroke-width="2.4"/>
        <ellipse cx="118" cy="292" rx="82" ry="12" fill="#FFD35A" opacity=".2" stroke="none"/>
      </g>
      <!-- 纸带机 -->
      <g transform="translate(40 0)">
        <rect x="214" y="188" width="216" height="104" rx="14" fill="#FFF6E4" stroke-width="2.4"/>
        <circle cx="262" cy="232" r="26" fill="#DCEBFA" stroke-width="2.4"/>
        <circle cx="262" cy="232" r="6" fill="#2C3E57" stroke="none"/>
        <circle cx="344" cy="232" r="26" fill="#DCEBFA" stroke-width="2.4"/>
        <circle cx="344" cy="232" r="6" fill="#2C3E57" stroke="none"/>
        <rect x="282" y="224" width="42" height="16" rx="8" fill="#FFF0CF" stroke-width="1.8"/>
        <circle cx="292" cy="232" r="2.6" fill="#2C3E57" stroke="none"/>
        <circle cx="302" cy="232" r="2.6" fill="#2C3E57" stroke="none"/>
        <circle cx="322" cy="232" r="2.6" fill="#2C3E57" stroke="none"/>
        <text x="322" y="278" font-size="11" font-weight="800" fill="#9F8A66" stroke="none" text-anchor="middle">TURING · 1950</text>
      </g>
      <!-- 茶杯 -->
      <g transform="translate(-26 0)">
        <ellipse cx="548" cy="292" rx="48" ry="8" fill="#CFE8FF" opacity=".55" stroke="none"/>
        <path d="M518 246h58v18q0 26-29 26t-29-26z" fill="#FFFDF7" stroke-width="2.2"/>
        <path d="M576 252q22 0 20 16t-20 12" fill="none" stroke-width="2.2"/>
        <path class="pr-steam" d="M530 232q8-12 0-22M552 232q8-12 0-22" fill="none" stroke="#A9C9E6" stroke-width="2.6"/>
      </g>
      <!-- 墙上的便签（贴在茶杯上方，不压台灯） -->
      <g transform="rotate(-6 626 130)" stroke="none">
        <rect x="586" y="92" width="80" height="80" rx="5" fill="#FFE9A8" stroke="#2C3E57" stroke-width="2"/>
        <text x="626" y="150" font-size="42" font-weight="800" fill="#C9922B" text-anchor="middle">?</text>
      </g>
    </g>`;
  }

  function propsDartmouth() {
    let cards = '';
    for (let i = 0; i < 7; i++) {
      const x = 82 + i * 74;
      const t = i % 2 ? 4 : -4;
      cards += `<g transform="rotate(${t} ${x + 28} 272)" stroke="#2C3E57">
        <rect x="${x}" y="248" width="56" height="44" rx="5" fill="#FFFDF7" stroke-width="1.8"/>
        <path d="M${x + 9} 264h38M${x + 9} 276h26" stroke="#B9C7D4" stroke-width="2.6"/>
      </g>`;
    }
    return `<g stroke="#2C3E57" stroke-linecap="round" stroke-linejoin="round">
      <!-- 夏日斜光 -->
      <path class="pr-beam" d="M140 0h230L204 326h-64z" fill="#FFF3C4" opacity=".34" stroke="none"/>
      <!-- 黑板（整体右移，手机端也不被裁） -->
      <g transform="translate(116 0)">
        <rect x="62" y="92" width="352" height="178" rx="10" fill="#2F4F45" stroke-width="3"/>
        <rect x="74" y="104" width="328" height="154" rx="6" fill="none" stroke="#8FBFAD" stroke-width="1.4" opacity=".45"/>
        <text x="92" y="178" font-size="52" font-weight="800" fill="#FFFFFF" opacity=".92" stroke="none">AI</text>
        <text x="164" y="178" font-size="52" font-weight="800" fill="#FFD35A" stroke="none">?</text>
        <path d="M92 202h120" stroke="#FFFFFF" stroke-width="3" opacity=".55"/>
        <rect x="300" y="246" width="46" height="9" rx="4.5" fill="#FFFDF7" stroke-width="1.8"/>
      </g>
      <g transform="translate(114 0)">${cards}</g>
    </g>`;
  }

  function propsWinter() {
    let snow = '';
    for (let i = 0; i < 10; i++) {
      snow += `<circle class="pr-snow" style="animation-delay:-${(i * 0.42).toFixed(2)}s"
        cx="${96 + i * 26}" cy="${104 + (i % 3) * 40}" r="${2.2 + (i % 2) * 1.4}" fill="#FFFFFF" opacity=".9" stroke="none"/>`;
    }
    return `<g stroke="#2C3E57" stroke-linecap="round" stroke-linejoin="round">
      <!-- 落雪的窗（整体右移，手机端不被裁） -->
      <g transform="translate(116 0)">
        <rect x="62" y="72" width="270" height="196" rx="12" fill="#CFE9FF" stroke-width="3"/>
        <path d="M62 226q62-34 132-8t138-10v60H62z" fill="#FFFFFF" opacity=".92" stroke="none"/>
        ${snow}
        <path d="M197 72v196M62 170h270" stroke-width="3" fill="none"/>
        <rect x="48" y="266" width="298" height="16" rx="8" fill="#FFEBCB" stroke-width="2.2"/>
      </g>
      <!-- 台灯 -->
      <g transform="translate(20 0)">
        <path d="M394 292V244l50-40" stroke-width="5" fill="none"/>
        <path d="M424 194l66-6 16 50-78 8z" fill="#FFC48F" stroke-width="2.4"/>
        <ellipse cx="454" cy="298" rx="92" ry="13" fill="#FFB86B" opacity=".18" stroke="none"/>
      </g>
      <!-- 论文堆 -->
      <g transform="translate(-30 0)">
        <g transform="rotate(-4 540 272)">
          <rect x="490" y="248" width="104" height="44" rx="4" fill="#FFFDF7" stroke-width="1.8"/>
          <path d="M502 264h76M502 276h52" stroke="#C5D2DF" stroke-width="2.6"/>
        </g>
      </g>
      <!-- 蜡烛 -->
      <rect x="598" y="246" width="16" height="46" rx="4" fill="#FFF0CF" stroke-width="2"/>
      <path class="pr-flame" d="M606 232q9 10 0 16t-9-16q3-8 9-16z" fill="#FFB84D" stroke="#E08A2E" stroke-width="1.6"/>
      <!-- 睡着的橘猫 -->
      <g stroke-width="2.2" transform="translate(96 0)">
        <ellipse cx="150" cy="278" rx="40" ry="16" fill="#FFC48F"/>
        <circle cx="114" cy="266" r="17" fill="#FFC48F"/>
        <path d="M102 252l-5-14 14 6M121 252l9-14-3 17" fill="#FFC48F" stroke-width="2"/>
        <path d="M106 268q4 3 8 0M118 268q4 3 8 0" stroke="#2C3E57" stroke-width="2" fill="none"/>
        <path d="M190 274q22-8 14-24" fill="none" stroke-width="2.4"/>
        <text x="196" y="244" font-size="15" font-weight="800" fill="#8FA6BE" stroke="none">z z</text>
      </g>
    </g>`;
  }

  function propsExpert() {
    return `<g stroke="#2C3E57" stroke-linecap="round" stroke-linejoin="round">
      <!-- MYCIN 终端（整体右移，手机端也不被裁） -->
      <g transform="translate(84 0)">
        <rect x="96" y="140" width="236" height="152" rx="12" fill="#E9F1F7" stroke-width="2.6"/>
        <rect x="114" y="158" width="200" height="104" rx="8" fill="#1F3B36" stroke-width="2"/>
        <text x="126" y="182" font-size="15" font-weight="700" fill="#7FF0D0" stroke="none">MYCIN&gt;</text>
        <rect class="pr-cursor" x="186" y="171" width="9" height="14" rx="2" fill="#7FF0D0" stroke="none"/>
        <text x="126" y="206" font-size="12" fill="#7FF0D0" opacity=".8" stroke="none">FEVER: YES</text>
        <text x="126" y="226" font-size="12" fill="#7FF0D0" opacity=".8" stroke="none">RASH: YES</text>
        <text x="126" y="246" font-size="12" fill="#FFD35A" opacity=".9" stroke="none">RULE 5 → ?</text>
        <circle class="pr-led" cx="306" cy="278" r="5" fill="#7FF0D0" stroke="none"/>
        <rect x="84" y="292" width="260" height="12" rx="6" fill="#DCEBFA" stroke-width="2"/>
      </g>
      <!-- 挂在墙上的听诊器 -->
      <g transform="translate(42 0)">
        <path d="M382 152v42q0 40 42 40t42-40v-42" fill="none" stroke-width="4"/>
        <circle cx="382" cy="146" r="7" fill="#DCEBFA" stroke-width="2.2"/>
        <circle cx="466" cy="146" r="7" fill="#DCEBFA" stroke-width="2.2"/>
        <circle cx="424" cy="242" r="16" fill="#DCEBFA" stroke-width="2.6"/>
        <circle cx="424" cy="242" r="6" fill="#FFFFFF" stroke-width="1.6"/>
      </g>
      <!-- 病历卡 -->
      <g transform="translate(22 0)">
        <g transform="rotate(5 556 268)">
          <rect x="498" y="240" width="116" height="52" rx="6" fill="#FFFDF7" stroke-width="1.8"/>
          <path d="M512 258h66M512 270h46" stroke="#C0CDD9" stroke-width="2.6"/>
          <path d="M560 246h20M570 236v20" stroke="#FF8A6B" stroke-width="4"/>
        </g>
      </g>
    </g>`;
  }

  function propsBlue() {
    let squares = '';
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if ((r + c) % 2 === 0) continue;
        squares += `<rect x="${90 + c * 27}" y="${128 + r * 20}" width="27" height="20" fill="#C9DCF2" stroke="none"/>`;
      }
    }
    let leds = '';
    for (let i = 0; i < 9; i++) {
      leds += `<circle class="pr-led" style="animation-delay:-${(i * 0.28).toFixed(2)}s"
        cx="${408 + (i % 3) * 40}" cy="${168 + Math.floor(i / 3) * 34}" r="5"
        fill="${i % 3 === 0 ? '#FFD35A' : '#7FF0D0'}" stroke="none"/>`;
    }
    return `<g stroke="#2C3E57" stroke-linecap="round" stroke-linejoin="round">
      <!-- 棋盘（右移并略微缩小，立在桌面上；手机端也不被裁） -->
      <g transform="translate(106 29) scale(0.9)">
        <g transform="rotate(-3 184 208)">
          <rect x="80" y="112" width="224" height="180" rx="8" fill="#FFFDF7" stroke-width="2.8"/>
          ${squares}
          <rect x="80" y="112" width="224" height="180" rx="8" fill="none" stroke-width="2.8"/>
          <!-- 棋子 -->
          <path d="M146 268h26l-6-14h-14z" fill="#2C3E57" stroke-width="2"/>
          <path d="M150 246h18l-4-10h-10z" fill="#2C3E57" stroke-width="2"/>
          <circle cx="159" cy="232" r="7" fill="#2C3E57" stroke-width="2"/>
          <path d="M226 268h24l-5-12h-14z" fill="#FFFDF7" stroke-width="2"/>
          <circle cx="238" cy="246" r="9" fill="#FFFDF7" stroke-width="2"/>
          <circle cx="214" cy="192" r="7" fill="#2C3E57" stroke-width="2"/>
          <circle cx="260" cy="172" r="7" fill="#FFFDF7" stroke-width="2"/>
        </g>
      </g>
      <!-- 深蓝机柜 -->
      <g transform="translate(16 0)">
        <rect x="376" y="118" width="176" height="174" rx="14" fill="#BFD9F2" stroke-width="2.8"/>
        <rect x="394" y="146" width="140" height="112" rx="8" fill="#9FC2E4" stroke-width="2"/>
        ${leds}
        <text x="464" y="278" font-size="12" font-weight="800" fill="#2C3E57" stroke="none" text-anchor="middle">DEEP BLUE</text>
      </g>
      <!-- 比分牌（放在桌面上） -->
      <g transform="rotate(-4 600 268)">
        <rect x="576" y="242" width="86" height="50" rx="8" fill="#FFFDF7" stroke-width="2"/>
        <text x="619" y="276" font-size="19" font-weight="800" fill="#2C3E57" stroke="none" text-anchor="middle">3.5:2.5</text>
      </g>
    </g>`;
  }

  function propsAlphago() {
    let grid = '';
    for (let i = 0; i < 9; i++) {
      grid += `<path d="M${98 + i * 22.5} 130V324M98 ${134 + i * 21.5}h180" stroke="#8A6A42" stroke-width="1.4" opacity=".75" fill="none"/>`;
    }
    const stones = [
      [1, 2, 1], [2, 2, 0], [3, 2, 1], [5, 2, 0], [6, 3, 1],
      [2, 4, 0], [3, 4, 1], [4, 4, 0], [5, 4, 1], [6, 4, 0],
      [2, 6, 1], [3, 6, 0], [4, 6, 1], [5, 5, 0], [4, 7, 0],
    ];
    let stoneSvg = '';
    for (const [c, r, black] of stones) {
      stoneSvg += `<circle cx="${98 + c * 22.5}" cy="${134 + r * 21.5}" r="8.4"
        fill="${black ? '#2C3E57' : '#FFFDF7'}" stroke="#2C3E57" stroke-width="1.6"/>`;
    }
    return `<g stroke="#2C3E57" stroke-linecap="round" stroke-linejoin="round">
      <!-- 围棋盘（右移并缩小，正好立在桌面上；手机端也不被裁） -->
      <g transform="translate(114 22) scale(0.82)">
        <g transform="rotate(-3 188 226)">
          <rect x="88" y="120" width="200" height="214" rx="8" fill="#FFD9A0" stroke-width="2.8"/>
          ${grid}
          <circle cx="188" cy="220" r="4" fill="#2C3E57" stroke="none"/>
          <!-- 第 37 手：轻轻发光的那一手 -->
          <circle class="pr-glow" cx="188" cy="284.5" r="16" fill="#FFD35A" stroke="none"/>
          ${stoneSvg}
        </g>
      </g>
      <!-- 两个棋钵 -->
      <g transform="translate(54 8)">
        <ellipse cx="354" cy="292" rx="36" ry="9" fill="#000000" opacity=".07" stroke="none"/>
        <path d="M322 258h64l-8 26h-48z" fill="#FFFDF7" stroke-width="2.2"/>
        <circle cx="342" cy="254" r="7" fill="#2C3E57" stroke-width="1.8"/>
        <circle cx="360" cy="250" r="7" fill="#2C3E57" stroke-width="1.8"/>
        <ellipse cx="452" cy="292" rx="34" ry="9" fill="#000000" opacity=".07" stroke="none"/>
        <path d="M422 258h60l-8 26h-44z" fill="#FFFDF7" stroke-width="2.2"/>
        <circle cx="442" cy="252" r="7" fill="#FFFFFF" stroke-width="1.8"/>
        <circle cx="460" cy="252" r="7" fill="#FFFFFF" stroke-width="1.8"/>
      </g>
      <!-- 第 37 手的便签（放在桌面上） -->
      <g transform="rotate(4 596 258)">
        <rect x="552" y="226" width="92" height="66" rx="5" fill="#FFF3B8" stroke-width="2"/>
        <text x="598" y="256" font-size="17" font-weight="800" fill="#B98A2C" stroke="none" text-anchor="middle">第 37 手</text>
        <path d="M568 272h60" stroke="#D9B96A" stroke-width="2.4"/>
      </g>
    </g>`;
  }

  const ROOM_PROPS = {
    turing: propsTuring,
    dartmouth: propsDartmouth,
    winter: propsWinter,
    expert: propsExpert,
    blue: propsBlue,
    alphago: propsAlphago,
  };

  function procRoom(scene) {
    const wall = scene.wall || ['#EAF5FF', '#D9EAF9'];
    const floor = scene.floor || ['#FFE7C4', '#FFD5A4'];
    const desk = scene.desk || '#FFE3BE';
    const props = ROOM_PROPS[scene.key] ? ROOM_PROPS[scene.key]() : '';
    /* 展厅顶部的彩旗：钉在画框顶部的一层 HTML 装饰（不画进 SVG），
       这样画框在桌面端上下裁切时旗子也不会被切掉；与首屏小屋的彩旗同一个母题 */
    const bunting = `<div class="pr-bunting" aria-hidden="true">${['#FFD35A', '#FF8A6B', '#7FD8B2', '#8FC5FF', '#FFAFCF', '#C7B8FF', '#FFD35A']
      .map((c) => `<i style="--c:${c}"></i>`).join('')}</div>`;
    const doodles = (scene.doodles || []).map((d, i) =>
      `<span class="pr-doodle d${i + 1}">${d}</span>`).join('');
    return `<div class="proc proc-room pr-${scene.key}">
      ${bunting}
      <svg class="pr-scene" viewBox="0 0 960 420" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <defs>
          <linearGradient id="prWall-${scene.key}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="${wall[0]}"/><stop offset="1" stop-color="${wall[1]}"/>
          </linearGradient>
          <linearGradient id="prFloor-${scene.key}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="${floor[0]}"/><stop offset="1" stop-color="${floor[1]}"/>
          </linearGradient>
        </defs>
        <rect width="960" height="420" fill="url(#prWall-${scene.key})"/>
        <!-- 展墙暖光：把视线聚到书桌与照片上 -->
        <ellipse cx="330" cy="286" rx="260" ry="150" fill="#FFFDF7" opacity=".3"/>

        <!-- 踢脚线：墙与地面之间加一条白线，房间有了厚度 -->
        <rect y="318" width="960" height="9" fill="#FFFDF7" opacity=".55"/>
        <rect y="326" width="960" height="94" fill="url(#prFloor-${scene.key})"/>
        <path d="M0 326h960" stroke="#2C3E57" stroke-width="3"/>
        <g stroke="#FFFFFF" stroke-opacity=".3" stroke-width="2" fill="none">
          <path d="M120 340V420M300 336V420M480 334V420M660 336V420M840 340V420"/>
          <path d="M0 380h960"/>
        </g>
        <!-- 书桌：六章同一张，只换木色 -->
        <ellipse cx="360" cy="352" rx="300" ry="14" fill="#000000" opacity=".07"/>
        <rect x="40" y="292" width="640" height="40" rx="7" fill="${desk}" stroke="#2C3E57" stroke-width="2.6"/>
        <path d="M48 301h624" stroke="#FFFFFF" stroke-opacity=".5" stroke-width="3"/>
        <path d="M72 314q132 7 268 1t196 3" stroke="#FFFFFF" stroke-opacity=".38" stroke-width="2" fill="none"/>
        <rect x="330" y="308" width="190" height="17" rx="6" fill="#000000" fill-opacity=".06" stroke="#2C3E57" stroke-width="1.6"/>
        <circle cx="425" cy="316.5" r="3" fill="#2C3E57"/>
        ${props}
      </svg>
      <figure class="pr-photo" style="--tilt:${scene.key === 'dartmouth' ? '-3.5' : '3'}deg">
        <div class="pr-frame"><img src="${scene.img}" alt="历史照片 · ${scene.photoCaption || ''}" draggable="false"></div>
        <figcaption>${scene.photoCaption || ''}</figcaption>
      </figure>
      ${doodles}
    </div>`;
  }

  function artMarkup(scene) {
    if (scene.art === 'room') return procRoom(scene);
    if (scene.img) {
      const doodles = (scene.doodles || []).map((d, i) =>
        `<span class="cg-doodle d${i + 1}">${d}</span>`).join('');
      return `<img class="cg-img" src="${scene.img}" alt="" draggable="false"
        style="object-position:${scene.pos || '50% 25%'}">${doodles}`;
    }
    if (scene.art === 'photos') return procPhotos();
    if (scene.art === 'data') return procData();
    if (scene.art === 'sprout') return procSprout();
    return procMuseum();
  }

  /* ---------- 切章 ---------- */
  let lastKey = '';
  function setNode(node) {
    if (!node) return;
    const frameEl = $('cgFrame');
    // 每一拍换镜头：同一章的 CG 也按 beat 轻微推拉（不换画面，只换视角）
    if (frameEl) frameEl.dataset.beat = node.beat || '';

    const scene = SCENES[node.chapter] || FALLBACK;
    if (scene.key === lastKey) return;
    lastKey = scene.key;

    const stage = $('stage');
    const frame = $('cgFrame');
    const media = $('cgMedia');
    if (!stage || !frame || !media) return;

    stage.dataset.scene = scene.tint;
    frame.dataset.cg = scene.key;

    /* 淡出旧画面 → 换内容 → 淡入（下一帧触发过渡） */
    media.classList.add('swapping');
    setTimeout(() => {
      media.innerHTML = artMarkup(scene);
      $('cgYear').textContent = scene.year;
      $('cgName').textContent = scene.name;
      $('cgMeta').textContent = scene.meta;
      $('cgWatermark').textContent = scene.year;
      frame.classList.remove('flash');
      void frame.offsetWidth;
      frame.classList.add('flash');
      media.classList.remove('swapping');
    }, reduceMotion ? 0 : 180);
  }

  /* ---------- 首屏：星尘 / 连线 ---------- */
  function initHeroCanvas() {
    const cv = $('heroCanvas');
    if (!cv) return;
    const ctx = cv.getContext('2d');
    let W = 0, H = 0, dpr = 1;
    let dots = [];
    let raf = null;
    let visible = false;

    function resize() {
      const r = cv.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = Math.max(1, r.width); H = Math.max(1, r.height);
      cv.width = W * dpr; cv.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.min(90, Math.round((W * H) / 14000));
      dots = Array.from({ length: n }, () => ({
        x: Math.random() * W,
        y: Math.random() * H,
        vx: (Math.random() - 0.5) * 0.12,
        vy: -0.06 - Math.random() * 0.2,
        r: 1.4 + Math.random() * 3.4,
        a: 0.35 + Math.random() * 0.45,
        ph: Math.random() * Math.PI * 2,
        star: Math.random() < 0.22,
      }));
    }

    function frame(t) {
      ctx.clearRect(0, 0, W, H);
      /* 泡泡与星星：白天展厅里飘着的小光点 */
      for (const p of dots) {
        p.x += p.vx; p.y += p.vy;
        if (p.y < -12) { p.y = H + 10; p.x = Math.random() * W; }
        if (p.x < -10) p.x = W + 8;
        if (p.x > W + 10) p.x = -8;
        const tw = 0.6 + Math.sin(t / 1800 + p.ph) * 0.4;
        if (p.star) {
          const s = p.r * 1.5;
          ctx.beginPath();
          ctx.fillStyle = `rgba(255, 226, 150, ${p.a * tw})`;
          ctx.moveTo(p.x, p.y - s);
          ctx.quadraticCurveTo(p.x, p.y, p.x + s, p.y);
          ctx.quadraticCurveTo(p.x, p.y, p.x, p.y + s);
          ctx.quadraticCurveTo(p.x, p.y, p.x - s, p.y);
          ctx.quadraticCurveTo(p.x, p.y, p.x, p.y - s);
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255, 255, 255, ${0.35 * tw})`;
          ctx.fill();
          ctx.strokeStyle = `rgba(255, 255, 255, ${0.7 * tw})`;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
      raf = requestAnimationFrame(frame);
    }

    function start() {
      if (raf || !visible || reduceMotion) return;
      raf = requestAnimationFrame(frame);
    }
    function stop() { cancelAnimationFrame(raf); raf = null; }

    resize();
    window.addEventListener('resize', () => { resize(); });
    /* 只在首屏可见时跑，别让后台标签页白烧 CPU */
    const gate = $('view-gate');
    if ('IntersectionObserver' in window && gate) {
      new IntersectionObserver((es) => {
        visible = es[0].isIntersecting && gate.classList.contains('active');
        visible ? start() : stop();
      }, { threshold: 0.05 }).observe(gate);
    } else {
      visible = true; start();
    }
    document.addEventListener('visibilitychange', () => {
      document.hidden ? stop() : (visible && start());
    });
    /* 视图切回首屏时重新跑起来 */
    document.querySelectorAll('.view').forEach((v) => {
      new MutationObserver(() => {
        if (v.id === 'view-gate' && v.classList.contains('active')) { visible = true; start(); }
      }).observe(v, { attributes: true, attributeFilter: ['class'] });
    });
  }

  /* ---------- 指针视差：CG 与光斑轻轻跟随 ---------- */
  function initParallax() {
    if (reduceMotion) return;
    const stage = $('stage');
    if (!stage) return;
    const frame = $('cgFrame');
    let tx = 0, ty = 0, cx = 0, cy = 0, raf = null;

    function loop() {
      cx += (tx - cx) * 0.12;
      cy += (ty - cy) * 0.12;
      frame.style.setProperty('--px', cx.toFixed(3));
      frame.style.setProperty('--py', cy.toFixed(3));
      stage.style.setProperty('--gx', (50 + cx * 8).toFixed(2) + '%');
      stage.style.setProperty('--gy', (34 + cy * 8).toFixed(2) + '%');
      if (Math.abs(tx - cx) > 0.001 || Math.abs(ty - cy) > 0.001) raf = requestAnimationFrame(loop);
      else raf = null;
    }
    stage.addEventListener('pointermove', (e) => {
      const r = stage.getBoundingClientRect();
      tx = ((e.clientX - r.left) / r.width - 0.5) * 2;
      ty = ((e.clientY - r.top) / r.height - 0.5) * 2;
      if (!raf) raf = requestAnimationFrame(loop);
    });
    stage.addEventListener('pointerleave', () => {
      tx = 0; ty = 0;
      if (!raf) raf = requestAnimationFrame(loop);
    });
  }

  /* ---------- 首屏指针微倾 ---------- */
  function initHeroTilt() {
    if (reduceMotion) return;
    const art = document.querySelector('.hero-art');
    const hero = document.querySelector('.gate-hero');
    if (!art || !hero) return;
    hero.addEventListener('pointermove', (e) => {
      const r = hero.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width - 0.5);
      const y = ((e.clientY - r.top) / r.height - 0.5);
      art.style.transform = `translate3d(${(-x * 22).toFixed(1)}px, ${(-y * 16).toFixed(1)}px, 0)`;
    });
    hero.addEventListener('pointerleave', () => { art.style.transform = ''; });
  }

  /* ---------- 视图切换：重播内容入场 ---------- */
  function initViewReveal() {
    const views = document.querySelectorAll('.view');
    views.forEach((v) => {
      // 只对 active 的「变化」做反应：entering 的增删不算变化，
      // 否则观察器会被自己写入的 class 反复唤醒（死循环）
      let wasActive = v.classList.contains('active');
      new MutationObserver(() => {
        const isActive = v.classList.contains('active');
        if (isActive === wasActive) return;
        wasActive = isActive;
        if (!isActive) return;
        v.classList.remove('entering');
        void v.offsetWidth;
        v.classList.add('entering');
      }).observe(v, { attributes: true, attributeFilter: ['class'] });
    });
  }

  /* ---------- 启动 ---------- */
  function boot() {
    initHeroCanvas();
    initParallax();
    initHeroTilt();
    initViewReveal();
    window.SceneFX = { setNode };
    /* 首屏先铺好序章的展厅画面 */
    if (window.STORY && window.STORY.nodes && window.STORY.nodes[window.STORY.start]) {
      setNode(window.STORY.nodes[window.STORY.start]);
    }
    document.body.classList.add('fx-ready');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
