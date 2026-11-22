// ──────────────────────────────────────────────────────
//  数据配置 — 大尺寸确保可见，零外部贴图依赖
// ──────────────────────────────────────────────────────
// 著色器容错：只检查真正被使用的 RING_FS；缺失时用内联兜底，避免整页 3D 中断
const RING_FS_FALLBACK = 'varying vec2 vUv; void main(){float edge=smoothstep(0.0,0.12,vUv.x)*(1.0-smoothstep(0.88,1.0,vUv.x));gl_FragColor=vec4(0.72,0.68,0.52,edge*0.55);}';
const RING_FRAGMENT = (typeof RING_FS !== 'undefined') ? RING_FS : RING_FS_FALLBACK;
(function(){
  if(typeof RING_FS === 'undefined') console.warn('[DSM] RING_FS 未加载，土星环使用内联兜底；其余场景正常');
  else console.log('[DSM] GPU 着色器链路就绪');
})();
// showCard 请求代际号与轻量转义，防止快速切换行星时旧响应覆盖新卡片
let cardGen = 0;
function escHTML(v){ return String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

// 后端 total 是带千位分隔符的字符串（如 "27,081"），直接 Number() 会得到 0
function parseCount(v){ const n=Number(String(v ?? '').replace(/[,\s]/g,'')); return Number.isFinite(n) ? n : 0; }

// 一句话观测札记：只讲可核验、有记忆点的事实，不充当 API 数据
const PLANET_NOTES = {
  sun:     '太阳占太阳系总质量的约 99.8%，它的引力定义了每一条行星轨道。',
  mercury: '水星自转一周约 58.6 个地球日，绕太阳一圈却只要 88 天——一天比一年更长。',
  venus:   '金星自转方向与多数行星相反，站在它的地表会看到太阳从西边升起。',
  earth:   '地球是目前唯一已知拥有稳定液态海洋与生命的行星。',
  mars:    '火星的奥林帕斯山高约 22 公里，是太阳系已确认的最高火山。',
  jupiter: '木星的大红斑是一场延续数百年的巨型风暴，宽度足以容纳地球。',
  saturn:  '土星的平均密度小于水；若存在足够大的水池，它会浮在水面上。',
  uranus:  '天王星几乎侧躺着自转，极区会经历长达约 42 年的极昼与极夜。',
  neptune: '海王星的风速可超过 2000 km/h，是太阳系风暴最猛烈的行星之一。'
};
const INFO_FIELDS = ['重力','密度','半径','质量','均温','公转','自转','轴倾角','逃逸速度'];
const INFO_CATEGORIES = ['恒星','岩石行星','气态巨行星','冰巨星'];
function parsePlanetInfo(raw){
  const parts = String(raw || '').split('|').map(s => s.trim()).filter(Boolean);
  let category = '';
  if (INFO_CATEGORIES.includes(parts[0])) category = parts.shift();
  const facts = [];
  parts.forEach(seg => {
    const key = INFO_FIELDS.find(k => seg.startsWith(k));
    if (key) { facts.push({label:key, value:seg.slice(key.length).trim()}); return; }
    const moon = seg.match(/^(\d+)\s*颗已知卫星$/);
    if (moon) facts.push({label:'已知卫星', value:moon[1] + ' 颗'});
  });
  if (!facts.length && raw) facts.push({label:'档案', value:String(raw).trim()});
  return {category, facts};
}
// 電影級軌道 — 太陽半徑 3.50，所有行星軌道 > 6.0 絕不穿模（含日冕層）
// 公转角速度 ω 由开普勒第三定律推导：T² ∝ a³ → ω ∝ 1/T ∝ a^(-1.5)，以地球(a=1AU)=1.0 为基准
// a = 轨道半长轴(AU)，数据源 NASA Planetary Fact Sheet (nssdc.gsfc.nasa.gov)；v 由 a 动态计算，不再硬编码
// 自转 rot 为真实自转速度比例（地球=1.0）：木星最快0.41天，金星/天王星逆行为负
// tilt = 真实自转轴倾角(度, 相对轨道面)；inc/node = 真实轨道倾角与升交点黄经(度)；ecc = 真实离心率
// 数据源：NASA Planetary Fact Sheet / JPL SSD。ecc 在渲染时按 ECC_K 阻尼，仅取形态不取极端近日点（防撞日冕）
const KEPLER = { EARTH_A: 1.0 };
const ECC_K = 0.5;
const P = [
  {n:'太阳',  s:3.50,d:0,    a:0,      v:0, rot:0.00006,  t:'sun',    tilt:7.25},                                        // 自转 ~25天
  {n:'水星',  s:0.15,d:6.0,  a:0.387,  v:0, rot:0.000026, t:'mercury',tilt:0.03,  inc:7.005, node:48.33,  ecc:0.2056}, // 公转 87.97天
  {n:'金星',  s:0.40,d:8.0,  a:0.723,  v:0, rot:-0.000006,t:'venus',  tilt:177.4, inc:3.395, node:76.68,  ecc:0.0068}, // 自转243天逆行
  {n:'地球',  s:0.63,d:10.0, a:1.0,    v:1, rot:0.0015,   t:'earth',  tilt:23.44, inc:0.0,   node:0,      ecc:0.0167}, // 公转/自转 基准
  {n:'火星',  s:0.25,d:12.0, a:1.524,  v:0, rot:0.00146,  t:'mars',   tilt:25.19, inc:1.850, node:49.56,  ecc:0.0934},
  {n:'木星',  s:2.20,d:16.5, a:5.203,  v:0, rot:0.00366,  t:'jupiter',tilt:3.13,  inc:1.303, node:100.46, ecc:0.0489},
  {n:'土星',  s:1.80,d:23.5, a:9.537,  v:0, rot:0.00333,  t:'saturn', tilt:26.73, inc:2.485, node:113.66, ecc:0.0565},
  {n:'天王星',s:0.85,d:29.5, a:19.191, v:0, rot:-0.00209, t:'uranus', tilt:97.77, inc:0.773, node:74.01,  ecc:0.0457},
  {n:'海王星',s:0.80,d:34.0, a:30.069, v:0, rot:0.00224,  t:'neptune',tilt:28.32, inc:1.770, node:131.78, ecc:0.0113}
];
// ω_rel = (a_earth / a)^1.5 —— 一次计算，供整个动画使用，避免每帧重复开方
P.forEach(p => {
  if (p.a > 0) p.v = Math.pow(KEPLER.EARTH_A / p.a, 1.5);
  p.incR  = (p.inc  || 0) * Math.PI / 180;   // 轨道倾角
  p.nodeR = (p.node || 0) * Math.PI / 180;   // 升交点黄经
  p.eccV  = (p.ecc  || 0) * ECC_K;           // 阻尼后的离心率：保留椭圆形态，但不让近日点擦到日冕
  p.tiltR = (p.tilt || 0) * Math.PI / 180;   // 自转轴倾角
});
// 轨道面上的极坐标 → 黄道坐标（含倾角与升交点）
const _orbV = new THREE.Vector3();
function orbitPoint(p, nu, out){
  // 椭圆：焦点在太阳；无离心率时退化为正圆
  const r = p.eccV ? p.d * (1 - p.eccV*p.eccV) / (1 + p.eccV*Math.cos(nu)) : p.d;
  if (!p.incR && !p.nodeR) return out.set(Math.cos(nu)*r, 0, Math.sin(nu)*r);
  const ci=Math.cos(p.incR), si=Math.sin(p.incR), cO=Math.cos(p.nodeR), sO=Math.sin(p.nodeR);
  const cU=Math.cos(nu), sU=Math.sin(nu);
  return out.set(
    r * (cO*cU - sO*sU*ci),
    r * (si*sU),
    r * (sO*cU + cO*sU*ci)
  );
}
window.__KEPLER__ = P.map(p => ({name:p.n, a:p.a, v:p.v})); // 暴露给验证脚本核对比例
const PC={sun:0xffdd44,mercury:0xb0ada6,venus:0xe8dcc8,earth:0x3388dd,mars:0xd45a38,jupiter:0xd4b896,saturn:0xe8d5b0,uranus:0xb8d8d8,neptune:0xa0c8d8,
  pillars:0x6cb6e8, blackhole:0x8fd4ff};

// ═══════════════════════════════════════════════════════════════
//  🌌 深空档案：焦点序列在 9 大行星之后新增两站 —— 创生之柱 / M87* 黑洞。
//  设计约束：P 数组必须保持 9 项（开普勒时序 QA 依赖 __KEPLER__ = P.map），
//  所以深空目标独立成 DEEP 数组，通过统一访问函数接入，绝不往 P 里塞。
//  ⚠️ 这两站是【程序化 3D 建模】，不是照片贴图：
//     · 黑洞走广义相对论光线偏折 raymarch（见 deep_space.js）；
//     · 创生之柱是十万级体积点云塑形。
//     所以来源标注必须写"程序化建模"，不能冒充 NASA 原始影像。
// ═══════════════════════════════════════════════════════════════
const DEEP = [
  { name:'创生之柱', type:'pillars', kind:'pillars',
    pos:new THREE.Vector3(0, 4, -150), s:5.4, zoom:17,
    note:'这几根由气体与尘埃构成的柱子位于鹰状星云 M16，距离地球约 6500 光年；最近的大质量恒星正用紫外线与恒星风把它们慢慢雕刻、蒸发。',
    facts:[
      {label:'所在星云', value:'鹰状星云 M16'},
      {label:'距离地球', value:'约 6,500 光年'},
      {label:'最高柱体', value:'约 4 光年'},
      {label:'主要成分', value:'分子氢与尘埃'},
      {label:'首次拍摄', value:'哈勃 1995 年'},
      {label:'重拍', value:'哈勃 2015 年 WFC3'},
      {label:'尺度', value:'横跨约 20 光年'},
      {label:'状态', value:'恒星形成区'}
    ],
    source:'程序化建模 · 结构依据哈勃 M16 影像' },
  { name:'M87* 黑洞', type:'blackhole', kind:'blackhole',
    pos:new THREE.Vector3(150, 4, 0), s:3.6, zoom:14,
    note:'这是人类拍到的第一张黑洞影像：事件视界望远镜在 2019 年公布的 M87 星系中心超大质量黑洞。亮环是被引力透镜弯曲的吸积盘光，中间的暗影是事件视界。',
    facts:[
      {label:'所在星系', value:'M87（室女座 A）'},
      {label:'距离地球', value:'约 5,500 万光年'},
      {label:'质量', value:'约 65 亿倍太阳'},
      {label:'视界直径', value:'约 400 亿公里'},
      {label:'首次成像', value:'2019 年 4 月'},
      {label:'观测手段', value:'事件视界望远镜'},
      {label:'观测波段', value:'1.3 mm 射电'},
      {label:'自转轴', value:'指向地球附近'}
    ],
    source:'程序化建模 · 基于广义相对论光线偏折' }
];
const STOP_N = P.length + DEEP.length;          // 焦点循环总站点 = 11
const isDeep = i => i >= P.length;
const deepOf = i => DEEP[i - P.length];
function focusName(i){ return isDeep(i) ? deepOf(i).name : P[i].n; }
function focusType(i){ return isDeep(i) ? deepOf(i).type : P[i].t; }
function focusSize(i){ return isDeep(i) ? deepOf(i).s : P[i].s; }
function focusZoom(i){ return isDeep(i) ? deepOf(i).zoom : (planetZoomDist[P[i].t] || 2.0); }
function focusPos(i){ return isDeep(i) ? deepOf(i).pos : ssObjs[i].mesh.position; }

// 🛡️ 紋理載入器（跨域開放）
// 🚀【彻底修复】：接入全球最稳定的开源天文贴图库 (threex.planets)，提供全套高清PBR纹理
const TEX_BASE = 'https://cdn.jsdelivr.net/gh/jeromeetienne/threex.planets@master/images/';
const TX = {
  sun: 'https://upload.wikimedia.org/wikipedia/commons/9/99/Map_of_the_full_sun.jpg', 
  mercury: TEX_BASE+'mercurymap.jpg',
  venus: TEX_BASE+'venusmap.jpg',
  earth: TEX_BASE+'earthmap1k.jpg',
  mars: TEX_BASE+'marsmap1k.jpg',
  jupiter: TEX_BASE+'jupitermap.jpg',
  saturn: TEX_BASE+'saturnmap.jpg',
  uranus: TEX_BASE+'uranusmap.jpg',
  neptune: TEX_BASE+'neptunemap.jpg',
  moon: TEX_BASE+'moonmap1k.jpg',
};
// 真实感增强用的第二层贴图：凹凸（地貌起伏）/ 云层与夜面灯光（仅地球）
// 夜灯图为 NASA Black Marble，作为 emissiveMap 只在暗面生效
const TX_EXTRA = {
  mercuryBump: TEX_BASE+'mercurybump.jpg',
  earthBump:   TEX_BASE+'earthbump1k.jpg',
  earthCloud:  TEX_BASE+'earthcloudmaptrans.jpg',
  earthNight:  'https://cdn.jsdelivr.net/npm/three-globe/example/img/earth-night.jpg',
  marsBump:    TEX_BASE+'marsbump1k.jpg',
};
const BUMP_SCALE = { mercury:0.014, earth:0.010, mars:0.012 };
const texLoader = new THREE.TextureLoader();
texLoader.setCrossOrigin('anonymous');

// 🔬 贴图锐度：默认只在正对视线的方向清晰，斜看时靠 mipmap 糊成一片。
// 行星聚焦时贴图是被斜着看的（球面除了正中全是斜视），不开各向异性过滤，
// 放大后整颗球会像蒙了一层雾——这就是"不够真实"的主因之一。
const MAX_ANISO = (() => {
  try { return ssRn.capabilities.getMaxAnisotropy(); } catch (e) { return 4; }
})();
function tuneTex(tex){
  if (!tex) return tex;
  tex.anisotropy = MAX_ANISO;
  tex.minFilter = THREE.LinearMipMapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

// 贴图调色：threex.planets 的水星/金星贴图是色彩增强过的（水星金褐、金星橙褐），
// 与肉眼观感差很远。这里按亮度重映射拉回真实色调——水星中性灰、金星明亮黄白。
function loadRetinted(url, kind, cb){
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    try {
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height), a = d.data;
      for (let k = 0; k < a.length; k += 4){
        const l = a[k]*0.299 + a[k+1]*0.587 + a[k+2]*0.114;
        if (kind === 'venus'){
          const v = 205 + (l - 128) * 0.30;   // 压对比 + 抬亮：金星是均匀的黄白硫酸云顶
          a[k] = v; a[k+1] = v*0.965; a[k+2] = v*0.875;
        } else {
          const v = l * 1.03;                 // 水星：中性灰，但保留环形山层次
          a[k] = v; a[k+1] = v*0.99; a[k+2] = v*0.965;
        }
      }
      g.putImageData(d, 0, 0);
      const tex = new THREE.CanvasTexture(c);
      tex.encoding = THREE.sRGBEncoding;
      tex.anisotropy = 4;
      cb(tex);
    } catch (e) {
      // canvas 被跨域污染时退回原图，不影响主流程
      texLoader.load(url, tex => { tex.encoding = THREE.sRGBEncoding; cb(tex); });
    }
  };
  img.onerror = () => {};
  img.src = url;
}

// ──────────────────────────────────────────────────────
//  Three.js 场景初始化 (电影级 3D 光影)
// ──────────────────────────────────────────────────────
const cv=document.getElementById('ss-canvas'), handCanvas=document.getElementById('hand-overlay'), handCtx=handCanvas.getContext('2d');
// 手势骨架画布初始就应与视口等大；否则初始 300×150 时按全屏坐标绘制会被裁切错位。
handCanvas.width=innerWidth; handCanvas.height=innerHeight;
const ssS=new THREE.Scene(), ssCam=new THREE.PerspectiveCamera(55,innerWidth/innerHeight,.1,500); ssCam.position.set(0,12,20);
const ssRn=new THREE.WebGLRenderer({canvas:cv,antialias:true,alpha:true});
ssRn.setSize(innerWidth,innerHeight); ssRn.setPixelRatio(Math.min(devicePixelRatio,1.5));
// 点光源阴影 = 每帧 6 面 cube 阴影贴图重渲染整个场景（含 7k 小行星带），
// 在开摄像头/低端机上会明显掉帧，而太空里球体互相投影几乎看不见。这里关掉换稳定帧率。
ssRn.shadowMap.enabled = false;
ssRn.outputEncoding = THREE.sRGBEncoding;
ssRn.toneMapping = THREE.ACESFilmicToneMapping;
// 💡 降低全局曝光，避免高光区泛白
ssRn.toneMappingExposure = 1.0; 
// 💡 环境光压到 0.35：太阳是唯一强光源，明暗界线才立得住；太亮会把夜面洗平
ssS.add(new THREE.AmbientLight(0x334466, 0.35)); 
const sunLight = new THREE.PointLight(0xffffff, 1.45, 5000);
sunLight.castShadow = false;
ssS.add(sunLight);
ssS.add(new THREE.HemisphereLight(0x8899cc, 0x112244, 0.16));

// ── 银河：沿一条倾斜大圆密集分布的软光点（点精灵，无球面 UV，因此不会有接缝） ──
(function buildMilkyWay(){
  // 4×4 像素的圆形柔光贴图：让每个点都是一小团雾，而不是硬方块
  const gcv = document.createElement('canvas'); gcv.width = gcv.height = 32;
  const gg = gcv.getContext('2d');
  const rad = gg.createRadialGradient(16, 16, 0, 16, 16, 16);
  rad.addColorStop(0, 'rgba(255,255,255,1)');
  rad.addColorStop(0.35, 'rgba(255,255,255,.55)');
  rad.addColorStop(1, 'rgba(255,255,255,0)');
  gg.fillStyle = rad; gg.fillRect(0, 0, 32, 32);
  const dotTex = new THREE.CanvasTexture(gcv);

  const N = 5200, R = 130;
  const g1 = new THREE.BufferGeometry(), pos = new Float32Array(N*3), col = new Float32Array(N*3);
  for (let i = 0; i < N; i++){
    const t = Math.random() * Math.PI * 2;
    // 三次均匀分布叠加 ≈ 高斯，形成中间密、两侧薄的带
    const g = (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
    const r = R + (Math.random() - 0.5) * 26;
    pos[i*3]   = Math.cos(t) * r;
    pos[i*3+1] = g * R * 0.13;
    pos[i*3+2] = Math.sin(t) * r;
    // 冷白到淡蓝的星色，亮度随机
    const b = 0.45 + Math.random() * 0.55;
    col[i*3] = b * 0.86; col[i*3+1] = b * 0.93; col[i*3+2] = b;
  }
  g1.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g1.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mw = new THREE.Points(g1, new THREE.PointsMaterial({
    size: 0.72, map: dotTex, vertexColors: true, transparent: true,
    opacity: 0.42, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true
  }));
  mw.rotation.z = 0.42;   // 让银河斜穿视野
  mw.renderOrder = -1;
  ssS.add(mw);
})();

// 星点柔光贴图：PointsMaterial 默认画的是硬方块，深空特写（创生之柱 / 黑洞）时
// 那些方块会被放大到 4~5px，非常出戏。统一换成柔边圆形点。
const _starDotTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const g = c.getContext('2d');
  const rg = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  rg.addColorStop(0, 'rgba(255,255,255,1)');
  rg.addColorStop(0.42, 'rgba(255,255,255,.60)');
  rg.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = rg; g.fillRect(0, 0, 32, 32);
  const t = new THREE.CanvasTexture(c);
  return t;
})();
// 星空背景 — 多层星场: 远处密集暗星 + 近处亮星
const starGeo=new THREE.BufferGeometry(), starPos=new Float32Array(3000*3);
for(let i=0;i<1500;i++){
  const r=55+Math.random()*10, theta=Math.random()*Math.PI*2, phi=Math.acos(2*Math.random()-1);
  starPos[i*3]=r*Math.sin(phi)*Math.cos(theta);
  starPos[i*3+1]=r*Math.sin(phi)*Math.sin(theta);
  starPos[i*3+2]=r*Math.cos(phi);
}
// 第二层: 更大范围的暗星
for(let i=1500;i<3000;i++){
  const r=55+Math.random()*25, theta=Math.random()*Math.PI*2, phi=Math.acos(2*Math.random()-1);
  starPos[i*3]=r*Math.sin(phi)*Math.cos(theta);
  starPos[i*3+1]=r*Math.sin(phi)*Math.sin(theta);
  starPos[i*3+2]=r*Math.cos(phi);
}
starGeo.setAttribute('position',new THREE.BufferAttribute(starPos,3));
const starColors=new Float32Array(3000*3);
for(let i=0;i<3000;i++){const b=0.6+Math.random()*0.4;const tint=Math.random();starColors[i*3]=b*(tint<0.1?0.7:1);starColors[i*3+1]=b*(tint<0.1?0.8:1);starColors[i*3+2]=b*(tint<0.05?0.6:1);}
starGeo.setAttribute('color',new THREE.BufferAttribute(starColors,3));
const _starPts=new THREE.Points(starGeo,new THREE.PointsMaterial({color:0xffffff,size:.17,map:_starDotTex,alphaTest:.01,transparent:true,opacity:.75,vertexColors:true,depthWrite:false}));
ssS.add(_starPts);
// 亮星十字光芒层
const brightStarsGeo=new THREE.BufferGeometry(), brightPos=new Float32Array(200*3);
for(let i=0;i<200;i++){const r=50+Math.random()*20,theta=Math.random()*Math.PI*2,phi=Math.acos(2*Math.random()-1);brightPos[i*3]=r*Math.sin(phi)*Math.cos(theta);brightPos[i*3+1]=r*Math.sin(phi)*Math.sin(theta);brightPos[i*3+2]=r*Math.cos(phi);}
brightStarsGeo.setAttribute('position',new THREE.BufferAttribute(brightPos,3));
const _brightPts=new THREE.Points(brightStarsGeo,new THREE.PointsMaterial({color:0xaaccff,size:.40,map:_starDotTex,alphaTest:.01,transparent:true,opacity:.9,blending:THREE.AdditiveBlending,depthWrite:false}));
ssS.add(_brightPts);

// 🌌 深空站要把这两层星点压小压淡：
//    星点材质开了 sizeAttenuation，深空焦点离星壳只有几十单位，
//    个别星就会被放大成二三十像素的柔光斑（像镜头虚化），在柱体前面很脏。
//    深空自己的星空由着色器里的 starField 负责，不需要这两层。
function applyStarScale(deep){
  // 直接隐藏，而不是"缩小"：星点开了 sizeAttenuation，只要有一颗离相机足够近，
  // 0.12 的尺寸也会被放大到 40px —— 缩小治不了根。
  // 深空站的星空由黑洞着色器里的 starField 和星云背景负责，不需要这两层。
  _starPts.visible = !deep;
  _brightPts.visible = !deep;
}

// 💫 流星 — 12 條隨機出現的宇宙光軌
const shootingStars = [];
const MAX_SHOOTERS = 12;
function spawnShootingStar() {
  const angle = Math.random() * Math.PI * 2;
  const dist = 40 + Math.random() * 30;
  const startX = Math.cos(angle) * dist;
  const startZ = Math.sin(angle) * dist;
  const startY = (Math.random() - 0.5) * 30;
  const length = 2 + Math.random() * 6;
  const speed = 0.08 + Math.random() * 0.25;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    startX, startY, startZ,
    startX - Math.cos(angle) * length, startY + (Math.random()-0.5)*length*0.3, startZ - Math.sin(angle) * length
  ]), 3));
  const mat = new THREE.LineBasicMaterial({color: 0xffffff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false});
  const line = new THREE.Line(geo, mat);
  ssS.add(line);
  shootingStars.push({line, startX, startZ, startY, angle, speed, life: 1.0, maxLife: 80 + Math.random() * 120});
  // 限制最大數量
  while (shootingStars.length > MAX_SHOOTERS) {
    const old = shootingStars.shift();
    ssS.remove(old.line);
    old.line.geometry.dispose();
    old.line.material.dispose();
  }
}

// ──────────────────────────────────────────────────────

const ssObjs=[];

// ══════════════════════════════════════════════════════════
//  大气层壳 — 真实感最关键的一层
//  旧实现只看「法线·视线」，得到一圈均匀发光的贴纸环：夜面也亮、朝阳面也不更亮。
//  真实大气是被恒星照亮的气体：**朝阳边缘最亮、夜面几乎消失、逆光时前向散射更亮**。
//  这里三个因子相乘（边缘 / 昼夜 / 前向散射），并随握拳推近整体增强 ——
//  贴到行星脸上时，那圈蓝边会明显"胀"起来，压迫感就来自这里。
// ══════════════════════════════════════════════════════════
const ATMO_VS = `
varying vec3 vN;
varying vec3 vWP;
void main(){
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWP = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const ATMO_FS = `
precision highp float;
varying vec3 vN;
varying vec3 vWP;
uniform vec3 uColor;
uniform vec3 uLight;
uniform float uPow;
uniform float uAmt;
uniform float uPush;
void main(){
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vWP);
  vec3 L = normalize(uLight - vWP);
  float edge = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), uPow);   // 边缘增厚（视线穿过的气体更多）
  float day  = smoothstep(-0.30, 0.55, dot(N, L));            // 夜面不发光
  float fwd  = pow(clamp(dot(-V, L), 0.0, 1.0), 2.2);         // 逆光前向散射
  float a = edge * day * (0.55 + 0.85 * fwd) * uAmt * (1.0 + 0.75 * uPush);
  gl_FragColor = vec4(uColor * (0.80 + 0.45 * fwd), a);
}`;
const _sunPos = new THREE.Vector3(0, 0, 0);
function addAtmosphere(mesh, radius, color, powv, amt){
  const m = new THREE.ShaderMaterial({
    uniforms: {
      uColor: {value: new THREE.Color(color)},
      uLight: {value: _sunPos},
      uPow:   {value: powv},
      uAmt:   {value: amt},
      uPush:  {value: 0}
    },
    vertexShader: ATMO_VS,
    fragmentShader: ATMO_FS,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.FrontSide
  });
  const shell = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.035, 72, 72), m);
  shell.renderOrder = 2;
  mesh.add(shell);
  return m;
}

P.forEach((p,i)=>{
  // 球體幾何（岩石行星用更高面數以呈現紋理細節）
  const isRocky = ['mercury','venus','earth','mars'].includes(p.t);
  const geo = new THREE.SphereGeometry(p.s, isRocky?256:192, isRocky?256:192);
  let mat;
  // ── PBR 物理材質 + 高清紋理 ──
      if (p.t === 'sun') {
        // ☀️ 太阳：加载高清贴图，使用基础发光材质
        mat = new THREE.MeshBasicMaterial({color: 0xffffff});
        if (TX.sun) texLoader.load(TX.sun, tex => { tex.encoding = THREE.sRGBEncoding; mat.map = tex; mat.needsUpdate = true; });
      } else {
        // 🪐 其他岩石与气态行星
        // 地球单独处理：海面反光 + 夜面城市灯光 + 凹凸，靠三层贴图叠出真实感
        if (p.t === 'earth') {
          mat = new THREE.MeshStandardMaterial({color: 0xffffff, roughness: 0.86, metalness: 0.06});
        } else {
          mat = new THREE.MeshStandardMaterial({color: PC[p.t], roughness: 0.85, metalness: 0.05});
        }
        if (TX[p.t]) {
          if (p.t === 'mercury' || p.t === 'venus') {
            // 这两张贴图是色彩增强过的雷达/拼接图：水星被染成金褐色、金星被染成橙褐色，
            // 和肉眼观感差得远。这里在 canvas 里做一次去饱和/提亮，还原真实色调。
            loadRetinted(TX[p.t], p.t, tex => {
              mat.map = tuneTex(tex);
              mat.color.setHex(0xffffff);
              mat.needsUpdate = true;
            });
          } else {
            texLoader.load(TX[p.t], tex => { 
              tex.encoding = THREE.sRGBEncoding; 
              mat.map = tuneTex(tex); 
              // 🚀【核心修复】：贴图加载成功后，必须立刻把模型的底色洗成纯白(0xffffff)！
              // 否则高清贴图会被原本的单色严重污染，导致画面发黑失真！
              mat.color.setHex(0xffffff); 
              mat.needsUpdate = true; 
              // 气态行星没有独立凹凸图：把自身色彩图当极弱的凹凸图用。
              // 云带本来就有明暗层次，转成法线扰动后，贴近看能看出"云在起伏"而不是一张平面贴纸。
              if (p.t === 'jupiter' || p.t === 'saturn' || p.t === 'venus') {
                mat.bumpMap = tex;
                mat.bumpScale = 0.0035;
                mesh.userData.bump = {mat, base: 0.0035};
                mat.needsUpdate = true;
              }
            });
          }
        }
        // 凹凸贴图：岩石行星才有真实起伏；数据贴图不做 sRGB 转换
        const bkey = {mercury:'mercuryBump', earth:'earthBump', mars:'marsBump'}[p.t];
        if (bkey && TX_EXTRA[bkey]) {
          texLoader.load(TX_EXTRA[bkey], tex => {
            mat.bumpMap = tuneTex(tex);
            mat.bumpScale = BUMP_SCALE[p.t] || 0.01;
            mesh.userData.bump = {mat, base: mat.bumpScale};
            mat.needsUpdate = true;
          });
        }
        // 地球夜面：NASA Black Marble 作为自发光贴图，白天被太阳光压住，夜面亮起城市
        if (p.t === 'earth' && TX_EXTRA.earthNight) {
          texLoader.load(TX_EXTRA.earthNight, tex => {
            tex.encoding = THREE.sRGBEncoding;
            mat.emissiveMap = tex;
            mat.emissive = new THREE.Color(0xffffff);
            mat.emissiveIntensity = 1.15;
            mat.needsUpdate = true;
          });
        }
      }

  const mesh = new THREE.Mesh(geo, mat);
  ssS.add(mesh);  // ← 致命修復：把行星加入場景！
  if (i > 0) { mesh.castShadow = true; mesh.receiveShadow = true; }
  // 🌐 真实自转轴倾角：ZYX 顺序 = 先自转(局部 Y) 再倾斜(世界 Z)，轴心固定、贴图绕真实极轴转
  // （若用默认 XYZ 顺序，倾角会随自转一起绕圈，看上去像"晃头"）
  mesh.rotation.order = 'ZYX';
  if (p.tiltR) mesh.rotation.z = p.tiltR;

  // ☁️ 地球雲層球殼 — 真实云图作为 alpha 遮罩，取代原来那层"白雾球"
  if (p.t === 'earth') {
    const cloudGeo = new THREE.SphereGeometry(p.s*1.012, 96, 96);
    const cloudMat = new THREE.MeshStandardMaterial({
      color:0xffffff, roughness:1.0, metalness:0.0,
      transparent:true, opacity:0, depthWrite:false   // 贴图到位前保持全透明，避免先闪一层白壳
    });
    const cloudMesh = new THREE.Mesh(cloudGeo, cloudMat);
    mesh.add(cloudMesh);
    mesh.userData.clouds = cloudMesh;
    texLoader.load(TX_EXTRA.earthCloud, tex => {
      tex.encoding = THREE.sRGBEncoding;
      cloudMat.alphaMap = tex;
      cloudMat.opacity = 0.42;   // 0.92 会把海陆整个盖成白球；0.42 保留独立云系又看得见地表
      cloudMat.needsUpdate = true;
    });
  }

  // ☀️ 日冕光晕 — 改用朝向相机的 Sprite 径向渐变。
  // 原来用「大球 + BackSide」：相机在球外时只能看到内壁，所有像素的 dot 都被 clamp 成 0，
  // 于是整块内壁全亮，在太阳外面糊出一个硬边"甜甜圈/塑料环"。
  // Sprite 平面位于日心，深度测试会自然让太阳本体挡住中央部分，辉光只留在轮廓之外。
  if (i === 0) {
    const makeGlow = (inner, outer, stops, size) => {
      const cvs = document.createElement('canvas');
      cvs.width = cvs.height = 512;
      const g2 = cvs.getContext('2d');
      const rg = g2.createRadialGradient(256, 256, 0, 256, 256, 256);
      stops.forEach(([pos, a]) => rg.addColorStop(pos, `rgba(${inner},${a})`));
      g2.fillStyle = rg; g2.fillRect(0, 0, 512, 512);
      // 8bit 画布在低透明度处会出现同心色阶带，用轻微噪点把台阶打散
      const imgData = g2.getImageData(0, 0, 512, 512), px = imgData.data;
      for (let k = 0; k < px.length; k += 4) {
        const n = (Math.random() - 0.5) * 5;
        px[k] += n; px[k + 1] += n; px[k + 2] += n;
        px[k + 3] = Math.max(0, Math.min(255, px[k + 3] + (Math.random() - 0.5) * 5));
      }
      g2.putImageData(imgData, 0, 0);
      const tex = new THREE.CanvasTexture(cvs);
      tex.encoding = THREE.sRGBEncoding;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex, transparent: true, blending: THREE.AdditiveBlending,
        depthWrite: false, depthTest: true, opacity: outer
      }));
      sp.scale.set(size, size, 1);
      sp.renderOrder = 6;   // 排在轨道线等辅助元素之后，光晕才会盖住它们
      return sp;
    };
    // 峰值放在太阳轮廓外一点点，然后单调渐隐到 0 —— 这样看到的是「从边缘长出来的辉光」，
    // 而不是一圈独立亮环（亮环就是之前被吐槽的甜甜圈）。两层叠加：内层暖白、外层柔和橙。
    // size 决定 sprite 半径：外层 11.4 → 半径 5.7，止于水星轨道 6.0 之内，不吃水星。
    const glowWide = makeGlow('255,176,104', 1, [
      [0.00, 0.00], [0.58, 0.00], [0.64, 0.26],
      [0.72, 0.18], [0.82, 0.09], [0.92, 0.03], [1.00, 0.00]
    ], 11.4);
    const glowCore = makeGlow('255,232,196', 1, [
      [0.00, 0.00], [0.80, 0.00], [0.855, 0.52],
      [0.89, 0.40], [0.93, 0.24], [0.97, 0.09], [1.00, 0.00]
    ], 8.2);
    ssS.add(glowWide);   // sprite 直接放在日心（太阳恒在原点），不需要每帧同步
    ssS.add(glowCore);
  }

  // 🌍🪐 大气层：地球 / 金星 / 火星 / 四颗巨行星各自的大气厚度与色温都不同
  //    水星没有大气（物理上就该是一颗裸岩），所以刻意不给它加壳。
  const ATMO = {
    venus:  [0xf7e6bd, 2.5, 0.62],
    earth:  [0x5aa9ff, 2.9, 0.90],
    mars:   [0xd08a5a, 3.6, 0.26],
    jupiter:[0xf2d0a4, 3.2, 0.34],
    saturn: [0xf6e6bd, 3.2, 0.30],
    uranus: [0x9fe4e8, 2.7, 0.58],
    neptune:[0x7db6ee, 2.7, 0.58]
  };
  if (ATMO[p.t]) {
    const a = ATMO[p.t];
    mesh.userData.atmo = addAtmosphere(mesh, p.s, a[0], a[1], a[2]);
  }

  // 🔭 木星伽利略四大衛星 — Io, Europa, Ganymede, Callisto
  if (p.t === 'jupiter') {
    const galileanMoons = [
      {name:'Io',       color:0xffdd66, size:.16, dist:2.85, speed:2.4},
      {name:'Europa',   color:0xeeddcc, size:.15, dist:3.45, speed:1.8},
      {name:'Ganymede', color:0x999999, size:.22, dist:4.15, speed:1.3},
      {name:'Callisto', color:0x555555, size:.20, dist:4.95, speed:0.9}
    ]
    const jupiterMoons = [];
    galileanMoons.forEach(m => {
      const mGeo = new THREE.SphereGeometry(m.size, 24, 24);
      const mMat = new THREE.MeshStandardMaterial({color:m.color, roughness:0.7, metalness:0.05});
      const mMesh = new THREE.Mesh(mGeo, mMat);
      mMesh.castShadow = true;
      ssS.add(mMesh);
      jupiterMoons.push({mesh:mMesh, dist:m.dist, speed:m.speed, angle:Math.random()*Math.PI*2, name:m.name});
    });
    mesh.userData.moons = jupiterMoons;
  }

  // 🪐 土星光环 — GPU shader
  if (p.t === 'saturn') {
    const rGeo = new THREE.RingGeometry(p.s*1.2, p.s*2.5, 256);
    const pos = rGeo.attributes.position, uv = rGeo.attributes.uv;
    for (let j = 0; j < pos.count; j++) {
      const r = Math.sqrt(pos.getX(j)**2 + pos.getY(j)**2);
      uv.setXY(j, (r - p.s*1.2) / (p.s*2.5 - p.s*1.2), 0.5);
    }
    const rMat = new THREE.ShaderMaterial({
      uniforms: {uTime: {value: 0}},
      vertexShader: 'varying vec2 vUv; void main(){vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: RING_FRAGMENT,
      side: THREE.DoubleSide, transparent: true, depthWrite: false
    });
    const ring = new THREE.Mesh(rGeo, rMat);
    // 环平面即赤道面：倾角由 mesh.rotation.z（26.73°）提供，这里只需摆平到赤道
    ring.rotation.x = Math.PI / 2;
    mesh.add(ring);
    ssObjs._ringMat = rMat;
  }

  // 🔵 天王星光环 — 真实存在但极暗；倾角 97.8° 让它近乎竖立，是识别天王星的关键特征
  // 用 6 条细环代替一整片圆盘：真实环系本来就是一组细窄的弧带，一整片会看成一个灰盘
  if (p.t === 'uranus') {
    const uBands = [
      [1.62, 0.006, 0.34], [1.68, 0.005, 0.26], [1.76, 0.010, 0.40],
      [1.84, 0.006, 0.24], [1.94, 0.008, 0.30], [2.02, 0.005, 0.20]
    ];
    uBands.forEach(([rr, w, op]) => {
      const uGeo = new THREE.RingGeometry(p.s*rr, p.s*(rr+w), 128);
      const uMat = new THREE.MeshBasicMaterial({
        color: 0xbfe3ea, transparent: true, opacity: op,
        side: THREE.DoubleSide, depthWrite: false
      });
      const uRing = new THREE.Mesh(uGeo, uMat);
      uRing.rotation.x = Math.PI / 2;   // 摆到赤道面；97.8° 的轴倾角由父级负责
      mesh.add(uRing);
    });
  }

  // 轨道环 —— 与真实轨道同一条曲线（含倾角/离心率），不再是一圈水平圆环
  let orbitMat = null;
  if (i > 0) {
    const SEG = 256, curvePts = [];
    for (let k = 0; k < SEG; k++) {
      curvePts.push(orbitPoint(p, k / SEG * Math.PI * 2, new THREE.Vector3()));
    }
    const orbCurve = new THREE.CatmullRomCurve3(curvePts, true);
    const orb = new THREE.Mesh(
      new THREE.TubeGeometry(orbCurve, SEG, .004, 6, true),
      new THREE.MeshBasicMaterial({color: 0x556688, transparent: true, opacity: .35, depthWrite: false})
    );
    orbitMat = orb.material;
    ssS.add(orb);
  }

  ssObjs.push({mesh, dist:p.d, speed:p.v, angle:Math.random()*Math.PI*2, name:p.n, type:p.t, orbitMat});
});

// 🌌 深空档案实体：真正的 3D 建模（deep_space.js），不是平面贴图。
//   黑洞 = 引力透镜 raymarch（离屏低分辨率渲染，只在聚焦时跑）；
//   创生之柱 = 九万余体积粒子 + 上升气流。
//   平时 opacity=0 完全不可见，焦点切过去时淡入，画面被建模铺满 = 星际飞跃。
DEEP.forEach(d => {
  const obj = (d.kind === 'blackhole')
    ? window.DSMDEEP.createBlackHole()
    : window.DSMDEEP.createPillars();
  obj.group.position.copy(d.pos);
  obj.setOpacity(0);
  ssS.add(obj.group);
  d.obj = obj;
  d.fade = 0;
  d.material = { opacity: 0 };   // 兼容旧引用（只作为淡入淡出状态镜像）
});

// ☄️ 小行星帶 — 火星(d=12.0) 與木星(d=16.5) 之間，按 2.2–3.3 AU 映射到 12.9–14.6
const astGeo = new THREE.BufferGeometry();
const astCount = 7000, astPosArr = new Float32Array(astCount * 3), astColArr = new Float32Array(astCount * 3);
for (let i = 0; i < astCount; i++) {
  const angle = Math.random() * Math.PI * 2;
  const radius = 12.9 + Math.random() * 1.7;
  const y = (Math.random() - 0.5) * 0.34;
  astPosArr[i*3] = Math.cos(angle) * radius;
  astPosArr[i*3+1] = y;
  astPosArr[i*3+2] = Math.sin(angle) * radius;
  const brightness = 0.35 + Math.random() * 0.45;
  astColArr[i*3] = brightness; astColArr[i*3+1] = brightness * 0.85; astColArr[i*3+2] = brightness * 0.7;
}
astGeo.setAttribute('position', new THREE.BufferAttribute(astPosArr, 3));
astGeo.setAttribute('color', new THREE.BufferAttribute(astColArr, 3));
const astMat = new THREE.PointsMaterial({size: 0.018, vertexColors: true, transparent: true, opacity: 0.34, blending: THREE.AdditiveBlending, depthWrite: false});
const asteroidBelt = new THREE.Points(astGeo, astMat);
ssS.add(asteroidBelt);

// 🌙 地球的月球（PBR + 紋理）
const moonGeo = new THREE.SphereGeometry(0.17, 48, 48);
const moonMat = new THREE.MeshStandardMaterial({color:0xccccbb, roughness:0.82, metalness:0.05});
texLoader.load(TX.moon, tex => { tex.encoding = THREE.sRGBEncoding; moonMat.map = tex; moonMat.needsUpdate = true; });
const moon = new THREE.Mesh(moonGeo, moonMat);
moon.castShadow = true; moon.receiveShadow = true;
const earthObj = ssObjs.find(o => o.type === 'earth');
if (earthObj) earthObj.moon = moon;

// ☀️ 太陽日冕粒子場（太陽半徑 3.50；外径收紧至 1.15R=4.03，远小于水星轨道 6.0）
const coronaGeo = new THREE.BufferGeometry();
const coronaCount = 1500, coronaPosArr = new Float32Array(coronaCount * 3);
for (let i = 0; i < coronaCount; i++) {
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos(2 * Math.random() - 1);
  const r = 3.50 * (1.01 + Math.random() * 0.14);
  coronaPosArr[i*3] = Math.sin(phi) * Math.cos(theta) * r;
  coronaPosArr[i*3+1] = Math.sin(phi) * Math.sin(theta) * r;
  coronaPosArr[i*3+2] = Math.cos(phi) * r;
}
coronaGeo.setAttribute('position', new THREE.BufferAttribute(coronaPosArr, 3));
const coronaMat = new THREE.PointsMaterial({size: 0.025, color: 0xffaa44, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false});
const coronaParticles = new THREE.Points(coronaGeo, coronaMat);
ssObjs[0].mesh.add(coronaParticles);
ssObjs[0]._corona = coronaParticles;

// 🏷️ 行星標籤層 — 永遠可見的 3D CSS 文字標籤
const labelDiv = document.createElement('div');
labelDiv.style.cssText = 'position:fixed;inset:0;z-index:4;pointer-events:none;';
document.body.appendChild(labelDiv);
const planetLabels = ssObjs.map(o => {
  // 标签分两层：外层只做定位（transform translate3d，无过渡 → 不拖尾/不虚影）；
  // 内层负责聚焦态的缩放/辉光/透明度（走 transition → 切换平滑、不再瞬间硬跳）。
  const lbl = document.createElement('div');
  lbl.style.cssText = 'position:absolute;left:0;top:0;transform:translate3d(-9999px,-9999px,0);will-change:transform;';
  const inner = document.createElement('span');
  inner.style.cssText = 'display:inline-block;font-family:var(--title);font-size:13px;letter-spacing:2px;'
    + 'white-space:nowrap;transform:translate(-50%,-50%) scale(.92);transform-origin:center;'
    + 'will-change:transform,opacity;'
    + 'transition:transform .3s var(--ease),opacity .3s var(--ease),text-shadow .3s var(--ease);';
  inner.textContent = o.name;
  const tc = '#' + PC[o.type].toString(16).padStart(6, '0');
  inner.style.color = tc;
  inner.style.textShadow = `0 0 3px ${tc}55, 0 0 6px ${tc}22`;
  lbl.__inner = inner;
  lbl.__tc = tc;
  lbl.appendChild(inner);
  labelDiv.appendChild(lbl);
  return lbl;
});
// 深空两站也各有标签（文本/颜色用 DEEP 的 name/type，与行星标签同构）
DEEP.forEach(d => {
  const lbl = document.createElement('div');
  lbl.style.cssText = 'position:absolute;left:0;top:0;transform:translate3d(-9999px,-9999px,0);will-change:transform;';
  const inner = document.createElement('span');
  inner.style.cssText = 'display:inline-block;font-family:var(--title);font-size:13px;letter-spacing:2px;'
    + 'white-space:nowrap;transform:translate(-50%,-50%) scale(.92);transform-origin:center;'
    + 'will-change:transform,opacity;'
    + 'transition:transform .3s var(--ease),opacity .3s var(--ease),text-shadow .3s var(--ease);';
  inner.textContent = d.name;
  const tc = '#' + PC[d.type].toString(16).padStart(6, '0');
  inner.style.color = tc;
  inner.style.textShadow = `0 0 3px ${tc}55, 0 0 6px ${tc}22`;
  lbl.__inner = inner; lbl.__tc = tc; lbl.appendChild(inner);
  labelDiv.appendChild(lbl);
  planetLabels.push(lbl);   // 索引 9/10 与焦点一一对应
});

// 🌙 把月球加入場景
if (earthObj && earthObj.moon) {
  ssS.add(earthObj.moon);
  const moonGlowGeo = new THREE.SphereGeometry(0.22, 16, 16);
  const moonGlowMat = new THREE.ShaderMaterial({
    uniforms: {c: {value: new THREE.Color(0xcccccc)}, p: {value: 3.0}},
    vertexShader: 'varying vec3 vN; void main(){vN=normalize(normalMatrix*normal); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader: 'uniform vec3 c; uniform float p; varying vec3 vN; void main(){float d=dot(vN,vec3(0,0,1)); float i=pow(1.0-clamp(d,0.0,1.0),p)*smoothstep(0.0,0.30,d); gl_FragColor=vec4(c,i*0.10);}',
    side: THREE.FrontSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false
  });
  const moonGlow = new THREE.Mesh(moonGlowGeo, moonGlowMat);
  earthObj.moon.add(moonGlow);
}

// ──────────────────────────────────────────────────────
//  逻辑控制与交互增强
// ──────────────────────────────────────────────────────
let focus=0,speed=1,tRY=0,tRPitch=0,tZoom=16,ssRY=0,ssRPitch=0,ssZoom=16,isPinching=false;
// ✊ 握拳推近 / 转拳旋转：pushTarget 由手势层写入，pushLevel 在动画里平滑跟随。
//    两者分离是为了「手一松就自然回弹」，也为非手势模式（键鼠）保持 0。
let pushTarget=0, pushLevel=0, spinAccum=0;
window._pushTarget = 0;
// 摄像头回调通常只有 30fps，直接在回调里逐次改 tZoom 会产生可见的阶梯感。
// 回调只写"目标值"，真正的插值放到 rAF 主循环里按 dt 做 —— 手势才跟得上丝。
window._zoomTarget = tZoom;
let camOn=false,camStream=null,hands=null,trail=[],satActive=false,satData=null,satOpenTimer=null;
let satRn=null, satCam=null;  // 卫星图渲染器引用，供 resize 同步尺寸
let camBusy=false, camGen=0;  // 加载锁防双开；代际号让旧 pump 循环在关闭后自动退出
// ⚠️ 必须初始化为 0：边缘切站的判定是 `now - _lastHoverAction > 2000`，
//    留 undefined 时是 NaN > 2000 === false —— 第一次悬停永远不生效（用户得先悬停两次）。
window._lastHoverAction = 0;
let fpsCount=0,fpsStart=performance.now();
window._hoverFrames=0; window._hoverZone='none'; window._lastHoverAction=0; window._cardActive=false;
window._satTargetDistance=3.5; window._satCurrentDistance=3.5;
window._satTargetRotationY=0; window._satCurrentRotationY=0;
window._camTarget = new THREE.Vector3(0,0,0);

// ── 相机跟随模型 ────────────────────────────────────────────
// 旧写法是每帧把相机 lerp 到「行星绝对位置 + 固定偏移」的目标点。行星一直在公转，
// lerp 永远追不上 → 行星在画面里持续滑动，速度越高滑得越猛，看起来就是剧烈抖动。
// 现在改成「行星刚性居中 + 相对偏移平滑」：
//   相机位置 = 行星位置 + 平滑后的偏移，行星永远钉在画面中心，只有镜头的相对位移被插值。
// 同时方位角只按 2% 比例跟随公转角：既有侧舷伴飞的视差，又不会把整个星空甩起来。
const _lookOff = new THREE.Vector3();           // 视点残余偏移（换焦点时平滑收敛）
// 相机相对行星的偏移改用「极坐标」保存：方位角 _offAz / 水平半径 _offR / 高度 _offY。
// 旧写法把偏移存成 Vector3 逐分量线性插值，换焦点时方位角常反转 ~180°，
// 两个反向向量做线性插值时中点恰好是零向量 → 相机瞬移到星球球心，
// 投影矩阵退化，太阳的屏幕坐标会在 ±6 万像素间来回甩（就是肉眼看到的"太阳剧烈抖动"）。
// 改极坐标后：方位走最短弧旋转、半径/高度各走标量插值，永远不经过零点。
let _offAz = null, _offR = 0, _offY = 0;
let _camAz = null, _camAzFocus = -1;
// 切站飞行：focusPlanet 只换"目标偏移"，相机若直接取新偏移就是一帧硬切。
// 记录起点，在 rAF 里把相机从起点平滑送到 followPlanet 算出的机位。
let _fly = null;
function camAzimuth(i, now){
  const target = (i === 0) ? (now * 0.02) : (ssObjs[i].angle - 1.57);
  if (_camAz === null || _camAzFocus !== i) { _camAz = target; _camAzFocus = i; return _camAz; }
  if (i === 0) { _camAz = target; return _camAz; }
  let d = target - _camAz;
  d = Math.atan2(Math.sin(d), Math.cos(d));      // 取最短弧，避免绕过 2π 时甩镜头
  // 【关键】跟随系数必须按公转角速度自适应，不能用固定 2%：
  // 水星 v=4.15，每帧目标角跳 ~0.086rad，固定 2% 追不上 → 稳态滞后积累到 2.03rad(116°)，
  // 镜头方向从「轨道切向」偏到「径向内侧」，太阳扫过相机侧面，投影除零式发散
  // （实测屏幕 x 在 ±760 万像素间跳）= 用户看到的「越靠太阳越抖」。
  // k ≈ 0.02 + v*0.18 让各行星稳态滞后统一在 ~0.1rad(6°)：
  // 相机始终贴着轨道切向，太阳稳定在侧向，保留侧舷伴飞视差又不甩镜头。
  const k = Math.min(0.9, 0.02 + (ssObjs[i].speed || 0) * 0.18);
  _camAz += d * k;
  return _camAz;
}
function followPlanet(tx, ty, tz, ox, oy, oz, k){
  const wantR = Math.sqrt(ox * ox + oz * oz);
  const wantAz = Math.atan2(oz, ox);
  if (_offAz === null) { _offAz = wantAz; _offR = wantR; _offY = oy; }
  else {
    let da = wantAz - _offAz;
    da = Math.atan2(Math.sin(da), Math.cos(da));   // 最短弧，避免绕过 ±π 时甩镜头
    _offAz += da * k;
    _offR += (wantR - _offR) * k;
    _offY += (oy - _offY) * k;
  }
  // 半径下限：任何情况下相机都不能落到行星球心附近，否则投影退化
  const r = Math.max(_offR, 0.35);
  ssCam.position.set(tx + Math.cos(_offAz) * r, ty + _offY, tz + Math.sin(_offAz) * r);
  _lookOff.multiplyScalar(0.88);
  window._camTarget.set(tx + _lookOff.x, ty + _lookOff.y, tz + _lookOff.z);
  ssCam.lookAt(window._camTarget);
}

// ═══════════════════════════════════════════════════════
//  ☢️ 空间天气联动 — 太阳风暴实时视效异变
// ═══════════════════════════════════════════════════════
window._isStormActive = false;

async function checkSpaceWeather() {
  const base = location.protocol === 'file:' ? 'http://127.0.0.1:5500' : '';
  try {
    const resp = await fetch(`${base}/api/space/solar-storm`);
    if (!resp.ok) { window._isStormActive = false; return; }
    const data = await resp.json();
    window._isStormActive = !!(data && data.storm_active === true);
  } catch (e) {
    // 安全降级：任何网络/解析异常一律视为平静
    window._isStormActive = false;
  }
}

// 立即拉取一次 + 每15秒高频轮询
checkSpaceWeather();
setInterval(checkSpaceWeather, 15000);

// 🔍 每顆行星的最佳觀察距離（越小越近越大）
const planetZoomDist = {
  sun: 18.0,
  mercury: 1.5,
  venus: 2.2,
  earth: 3.2,
  mars: 1.8,
  jupiter: 9.5,
  saturn: 8.5,
  uranus: 4.2,
  neptune: 3.8
};
function focusPlanet(idx) {
  idx = (idx % STOP_N + STOP_N) % STOP_N;   // 11 站循环
  const prevDeep = isDeep(focus);
  const oldTp = focusPos(focus);            // 切之前的观察点，用来量这次跳跃有多远
  focus = idx;
  updateUI();
  // 深空站压小场景星点（否则会有二三十像素的柔光斑糊在柱体前面）
  applyStarScale(isDeep(idx));
  tRY = 0;
  tRPitch = 0;
  ssRY = 0;
  ssRPitch = 0;
  tZoom = focusZoom(idx);
  window._zoomTarget = tZoom;   // 切站时同步目标，避免上一站残留距离被 rAF 拉回来
  triggerAlert(isDeep(idx) ? '🌌 ' + focusName(idx) : '🔭 ' + focusName(idx));

  // 星际飞跃：在「行星↔深空」或「深空↔深空」之间跨越时播放穿越动效（星线拉伸）。
  // 同行星之间不播，避免每次切星都闪。
  // 只要这一段旅程涉及深空（海王星→创生之柱→黑洞→太阳），每一跳都播放穿越动效
  if (prevDeep || isDeep(idx)) {
    triggerWarp();
    // 飞跃期间点亮 HUD 第 07 项；动效结束后交还给手势识别结果
    if (window.__markGesture__) {
      window.__markGesture__('warp');
      clearTimeout(window.__warpHintTimer);
      window.__warpHintTimer = setTimeout(() => {
        if (window.__activeGesture__ === 'warp') window.__markGesture__('');
      }, 1600);
    }
  }

  // 换焦点时保持镜头稳定：方位角【直接对齐】新目标的标准位，不做绕行。
  const tp = focusPos(idx);
  if (tp) {
    const dx = ssCam.position.x - tp.x, dy = ssCam.position.y - tp.y, dz = ssCam.position.z - tp.z;
    if (isDeep(idx)) {
      // 深空机位固定是 (0, y, +dist) → atan2(z,x)=π/2。
      // 旧代码写 0，切站后 followPlanet 每帧要把方位从 0 拉到 π/2，
      // 于是镜头绕着目标多甩 90° —— 这是深空切换抖动的一个隐蔽来源。
      _offAz = Math.PI / 2;
      _offR = Math.min(Math.abs(dz), deepOf(idx).zoom * 1.6);
      _offY = dy;
    } else {
      // 绕行半径上限：不得超过轨道半径的 58%，且相机到太阳至少留 5.0 单位
      const orbitR = Math.hypot(tp.x, tp.z) || (P[idx].d || 30);
      const cap = Math.min(orbitR * 0.58, Math.max(1.0, orbitR - 5.0));
      let rr = Math.sqrt(dx * dx + dz * dz);
      if (!isFinite(rr) || rr < 0.6) rr = cap * 0.8;
      _offAz = camAzimuth(idx, performance.now());
      _offR = Math.min(rr, cap);
      _offY = dy;
    }
    _lookOff.copy(window._camTarget).sub(tp);
  }
  _camAzFocus = -1;   // 新焦点重新对齐方位角基准

  // 远距离换站走一段短飞行，而不是镜头一帧瞬移（瞬移在视觉上就是"闪一下/抖一下"）。
  // 行星之间 650ms，涉及深空的 900ms —— 正好藏在 warp 动效下面。
  const nowTp = focusPos(idx);
  const travel = (oldTp && nowTp) ? oldTp.distanceTo(nowTp) : 0;
  // 阈值要小：金星→地球目标只差几个单位，但机位重算仍会跳 ~5 单位；
  // 2.5 的阈值会把这种小跳漏掉（实测 peak 4.86/帧）。
  if (travel > 0.6) _fly = { from: ssCam.position.clone(), start: performance.now(),
                             dur: (prevDeep || isDeep(idx)) ? 900 : 650 };
  else _fly = null;
}

function pointToScreen(pt){
  // MediaPipe landmark 基于【原始摄像头帧】(未镜像)：面对摄像头伸右手时，右手落在原始帧左侧(x<0.5)。
  // 用户期待的是「照镜子」效果——伸右手、骨架就该出现在屏幕右侧；这也和下方 hover 逻辑一致
  // （tip.x<0.25 被判为「物理右手→右光幕」）。所以这里对 x 做水平镜像：1-x。
  // 注意：只作用于骨架绘制；手势控制(pinch/hover/zoom/rotation)仍用原始坐标，语义已各自处理，不动。
  return {x: (1-pt.x)*innerWidth, y: pt.y*innerHeight};
}

function drawHandSkeleton(landmarks){
  // 骨架只在「启动摄像头」后出现，是手势反馈而非装饰。
  // 用冷青细线 + 柔和青绿关节点，融进深空仪器体系；去掉原先 2px 实线 + 荧光绿的调试感。
  handCtx.save(); handCtx.strokeStyle='rgba(140,196,232,0.42)'; handCtx.lineWidth=1.3;
  const conns=[[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[0,17],[17,18],[18,19],[19,20]];
  conns.forEach(([a,b])=>{ const p1=pointToScreen(landmarks[a]), p2=pointToScreen(landmarks[b]); handCtx.beginPath(); handCtx.moveTo(p1.x,p1.y); handCtx.lineTo(p2.x,p2.y); handCtx.stroke(); });
  landmarks.forEach((lm,i)=>{
    const p=pointToScreen(lm), key=(i===4||i===8||i===12);   // 拇指/食指/中指指尖 = 捏合关键点
    handCtx.fillStyle= key ? 'rgba(150,214,220,0.82)' : 'rgba(140,196,232,0.55)';
    handCtx.beginPath(); handCtx.arc(p.x,p.y,key?2.4:1.8,0,Math.PI*2); handCtx.fill();
  });
  handCtx.restore();
}

// 🌟 終極手勢識別：手腕錨點法 (Wrist Anchor) — 純 2D 平面測距，徹底免疫 Z 軸噪點
function countExtendedFingers(hand){
  const wrist = hand[0]; // 以手腕作為核心物理錨點
  let extended = 0;
  const pips = [6, 10, 14, 18]; // 食指、中指、無名指、小指的第二關節
  const tips = [8, 12, 16, 20]; // 食指、中指、無名指、小指的指尖
  const extArr = [false, false, false, false];

  for(let i=0; i<4; i++){
    // 只取 x 和 y 進行純 2D 屏幕平面測距，徹底免疫手掌前後傾斜的干擾
    const tipDist = Math.hypot(hand[tips[i]].x - wrist.x, hand[tips[i]].y - wrist.y);
    const pipDist = Math.hypot(hand[pips[i]].x - wrist.x, hand[pips[i]].y - wrist.y);

    // 只要指尖離手腕的距離，大於第二關節離手腕的距離，就絕對是伸直狀態！
    if(tipDist > pipDist) {
      extended++;
      extArr[i] = true;
    }
  }

  return {
    extended: extended,
    openness: extended / 4,
    isFist: extended === 0,
    isIndex: extArr[0] && !extArr[1] && !extArr[2] && !extArr[3],    // 嚴格判定：只有食指
    isTwoFinger: extArr[0] && extArr[1] && !extArr[2] && !extArr[3], // 嚴格判定：食指+中指
    isOpen: extended >= 3
  };
}

function updateUI(){ document.getElementById('st-planet').textContent=focusName(focus); }

// ──────────────────────────────────────────────────────
//  行星卡布局：横向紧凑卡，贴聚焦星球左上角（右下角靠近星球左上象限）；
//  字体放大、间隔收紧后卡片更矮更窄，正好塞进星球上方左侧的空隙。
//  绝不遮星球本体 / 时间流速滑条 / HUD；用真实 DOM 矩形做几何避让。
//  不动相机、手势、任何 id。
// ──────────────────────────────────────────────────────
// 星球的「真实屏幕半径」：旧写法 (s/dist)*vh*0.5 漏掉了透视相机的 fov 分母，
// 算出来的半径只有实际的一半左右 —— 卡片按一半半径避让，就会切进球体里近百像素，
// 看起来就是"过度遮挡星球"。这里补上 tan(fov/2)，并按相机到球心的真实距离计算。
function planetScreenR(dist){
  const h = window.innerHeight * 0.5;
  const tanHalf = Math.tan(ssCam.fov * 0.5 * Math.PI / 180) || 0.52;
  return (focusSize(focus) / Math.max(dist, 0.15)) * h / tanHalf;
}

// 把聚焦星球投影成屏幕坐标 + 真实半径，交给 layoutCard
function projectCard(tx, ty, tz){
  if(!window._cardActive) return;
  const wp = _tmpProj.set(tx, ty, tz).project(ssCam);
  if(wp.z > 1){ layoutCard(null, null); return; }
  const sx = (wp.x * 0.5 + 0.5) * window.innerWidth;
  const sy = (-wp.y * 0.5 + 0.5) * window.innerHeight;
  const dist = Math.sqrt((ssCam.position.x-tx)**2 + (ssCam.position.y-ty)**2 + (ssCam.position.z-tz)**2);
  layoutCard(sx, sy, planetScreenR(dist));
}

function layoutCard(sx, sy, rPx){
  const card = document.getElementById('planet-card');
  if(!card || !window._cardActive) return;
  if(sx == null || sy == null){ card.style.left='-9999px'; return; }

  const vw = window.innerWidth, vh = window.innerHeight;
  card.style.width = ''; // 恢复 CSS 宽度，避免上一帧缩窄残留
  let cw = card.offsetWidth || 480, ch = card.offsetHeight || 220;
  const gap = 16;
  const ctrl = document.getElementById('ctrl-panel');
  const cr = ctrl ? ctrl.getBoundingClientRect() : null;
  const st = document.getElementById('status-panel');
  const sr = st ? st.getBoundingClientRect() : null;
  const hud = document.getElementById('hud-top');
  const hr = hud ? hud.getBoundingClientRect() : null;
  const minTop = hr ? Math.min(vh - 10, hr.bottom + gap) : 10; // 顶部导航条下沿，卡片不得压住

  function hitsCtrl(L,T){
    return cr && L < cr.right + gap && L + cw > cr.left - gap && T < cr.bottom + gap && T + ch > cr.top - gap;
  }
  function hitsStatus(L,T){
    return sr && L < sr.right + gap && L + cw > sr.left - gap && T < sr.bottom + gap && T + ch > sr.top - gap;
  }

  const ctrlBottom = (cr && cr.top > vh * 0.55);
  const narrow = ctrlBottom || vw < 700;
  let L, T;

  if(narrow){
    // 窄屏：卡片贴顶（HUD 导航条下方）、水平居中；星球在下方露出。状态面板在右上，缩窄卡片避让。
    L = Math.max(10, Math.min(sx - cw / 2, vw - cw - 10));
    T = minTop;
    if(sr && L + cw > sr.left - 8 && sr.top < T + ch){
      const leftAvail = Math.floor(sr.left) - 18;
      if(leftAvail >= 300){ card.style.width = leftAvail + 'px'; cw = leftAvail; ch = card.offsetHeight || ch; L = 10; }
    }
  } else {
    // ── 桌面/平板：贴星球左上角 ──
    // 关键几何：卡片是矩形、星球是圆。矩形不与圆相交 ⇔ 圆心到矩形最近点的距离 ≥ r。
    // 卡片挂在星球左上时最近点就是它的「右下角」，所以只要
    //   √((sx−right)² + (sy−bottom)²) ≥ r + 留白
    // 就是数学上严格不遮球 —— 允许右下角"窝进"星球左上那片空角，这才是贴左上角的手感。
    const ctrlSafe = cr ? cr.right + gap : 10;
    const m = 12;                       // 卡片与球面之间的最小留白
    const rad = rPx + m;

    function discOK(Lq, Tq){
      const nx = Math.max(Lq, Math.min(sx, Lq + cw));
      const ny = Math.max(Tq, Math.min(sy, Tq + ch));
      return Math.hypot(sx - nx, sy - ny) >= rad - 0.5;   // 0.5px 容差，避免恰好相切被浮点误差判为相交
    }
    function fit(Lq, Tq){
      return Lq >= 10 && Lq + cw <= vw - 10 && Tq >= minTop && Tq + ch <= vh - 10
             && !hitsCtrl(Lq, Tq) && !hitsStatus(Lq, Tq) && discOK(Lq, Tq);
    }
    let done = false;

    // ① 首选「贴左上角」：卡片右下角沿球面左上角切过去，底缘尽量落在球心上方
    for(const floorK of [0.66, 0.4, 0]){
      const Lq = Math.max(ctrlSafe, sx - rad * 0.72 - cw);
      const dx = Math.max(sx - Math.min(Lq + cw, sx), 0);
      const floor = rPx * floorK;
      const need = dx >= rad ? Math.max(rPx + 6, floor)
                             : Math.max(Math.sqrt(rad * rad - dx * dx), floor);
      const Tq = sy - need - ch;
      if(fit(Lq, Tq)){ L = Lq; T = Tq; done = true; break; }
    }
    // ② 次选「贴左侧」：整卡在球左边、顶边与球顶对齐（球很大时唯一还能"左上"的落点）
    if(!done){
      const Rq = Math.min(sx - rad - 2.5, vw - 10);
      const Lq = Math.max(10, Math.min(Rq - cw, vw - cw - 10));
      let Tq = Math.max(minTop, sy - rad);
      if(cr && Lq < cr.right + gap) Tq = Math.max(Tq, cr.bottom + gap);
      if(fit(Lq, Tq)){ L = Lq; T = Tq; done = true; }
    }
    // ③ 球正上方居中
    if(!done){
      const Lq = sx - cw / 2, Tq = sy - rad - gap - ch;
      if(fit(Lq, Tq)){ L = Lq; T = Tq; done = true; }
    }
    // ④ 顶部左上：球体过大、四周都塞不下时，宁可让面板压住球体上缘一角，
    //    也绝不让它盖住球心/下半球——保证"这颗星球"始终看得见。
    if(!done){
      const Lq = Math.max(10, Math.min(sx - cw * 0.55, vw - cw - 10));
      const Tq = minTop;
      const coversCenter = sx > Lq - 24 && sx < Lq + cw + 24 && sy > Tq && sy < Tq + ch + 24;
      const inView = Lq + cw <= vw - 10 && Tq + ch <= vh - 10;
      if(inView && !coversCenter){ L = Lq; T = Tq; done = true; }
    }
    // ⑤ 兜底：球下方
    if(!done){
      const Lq = Math.max(10, Math.min(sx - cw / 2, vw - cw - 10));
      const Tq = Math.min(sy + rad + gap, vh - ch - 10);
      L = Lq; T = Math.max(minTop, Tq);
    }
  }

  // 视口边界钳制（顶部不低于 HUD 导航条下沿）
  L = Math.max(10, Math.min(L, vw - cw - 10));
  T = Math.max(minTop, Math.min(T, vh - ch - 10));

  card.style.position = 'fixed';
  card.style.left = L + 'px';
  card.style.top  = T + 'px';
  window._cardRect = {left:L, top:T, right:L+cw, bottom:T+ch};
  window._cardPlanet = {cx:sx, cy:sy, r:rPx};
  window._cardDbg = {sx:sx, sy:sy, rPx:rPx, cw:cw, ch:ch, narrow:narrow, minTop:minTop};
}

function showCard(){
  const c=document.getElementById('planet-card');
  // 🌌 深空档案：本地真实数据（NASA/ESA/EHT），不走 planet-info API
  if(isDeep(focus)){
    const d = deepOf(focus), tc = '#' + PC[d.type].toString(16).padStart(6,'0');
    c.style.setProperty('--planet-tint', tc);
    const factHTML = d.facts.map(f => `<div class="pc-fact"><dt>${escHTML(f.label)}</dt><dd>${escHTML(f.value)}</dd></div>`).join('');
    c.innerHTML=`<div class="pc-head">
        <span class="pc-swatch" aria-hidden="true"></span>
        <h2 class="pc-title">${escHTML(d.name)}</h2>
        <span class="pc-class">深空档案</span>
      </div>
      <dl class="pc-facts">${factHTML}</dl>
      <div class="pc-note"><span class="pc-note-label">观测札记</span><p>${escHTML(d.note)}</p></div>
      <div class="pc-source">${escHTML(d.source)}</div>`;
    c.style.display='block'; c.classList.add('show');
    window._cardActive = true;
    ++cardGen;
    return;
  }
  const p=P[focus], tc='#'+PC[p.t].toString(16).padStart(6,'0');
  const myGen = ++cardGen;
  c.style.setProperty('--planet-tint', tc);
  c.innerHTML=`<div class="pc-loading">
    <div class="pc-head"><span class="pc-swatch"></span><h2 class="pc-title">${escHTML(p.n)}</h2></div>
    <div class="pc-loading-line"><span>正在建立星际数据链路…</span></div>
  </div>`;
  c.style.display='block'; c.classList.add('show');
  window._cardActive = true;

  const baseUrl = (location.protocol==='file:') ? 'http://127.0.0.1:5500' : '';
  (async () => {
    try{
      const resp = await fetch(`${baseUrl}/api/space/planet-info?planet=${encodeURIComponent(p.n)}`);
      const data = await resp.json();
      if(myGen !== cardGen) return;  // 已有更新的行星请求，丢弃旧响应
      const src = data._source || data.source || 'local';
      const {category, facts} = parsePlanetInfo(data.info);
      const classText = category || (p.t === 'sun' ? '恒星' : '行星');
      const note = PLANET_NOTES[p.t] || '';
      const factHTML = facts.map(f => `<div class="pc-fact"><dt>${escHTML(f.label)}</dt><dd>${escHTML(f.value)}</dd></div>`).join('');
      // 轨道距离是可视化压缩（否则海王星要远 30 倍，单屏放不下）→ 必须诚实标注真实半长轴，
      // 避免把渲染距离误当成真实比例。用主色小字内联，不增加卡片高度（保持贴左上不遮球）。
      const auTag = (p.a > 0)
        ? `<span class="pc-au">真实半长轴 ${escHTML(p.a.toFixed(3))} AU · 轨道为压缩显示</span>`
        : '';
      c.innerHTML=`<div class="pc-head">
          <span class="pc-swatch" aria-hidden="true"></span>
          <h2 class="pc-title">${escHTML(data.planet || p.n)}</h2>
          <span class="pc-class">${escHTML(classText)}</span>
        </div>
        <dl class="pc-facts">${factHTML}</dl>
        ${note ? `<div class="pc-note"><span class="pc-note-label">观测札记</span><p>${escHTML(note)}</p></div>` : ''}
        <div class="pc-source">${auTag}数据来源 · ${escHTML(src)}</div>`;
    }catch(e){
      if(myGen !== cardGen) return;
      c.innerHTML=`<div class="pc-head"><span class="pc-swatch"></span><h2 class="pc-title">${escHTML(p.n)}</h2></div>
        <div class="pc-error">星际数据链路中断<span>无法连接到深空观测站服务器</span></div>`;
    }
  })();
}

function triggerAlert(msg){ const a=document.getElementById('swipe-alert'); a.textContent=msg; a.classList.add('show'); setTimeout(()=>a.classList.remove('show'),800); }

// 🌌 星际飞跃过场：星线从画面中心向四周拉伸 + 短暂蓝白闪光，营造穿越感。
// 纯 CSS 动效，不碰 3D 场景；reduced-motion 下自动降级为无动画。
function triggerWarp(){
  const ov = document.getElementById('warp-overlay');
  if(!ov || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  ov.classList.remove('run'); void ov.offsetWidth;  // reflow 重启动画
  ov.classList.add('run');
  clearTimeout(triggerWarp._t);
  triggerWarp._t = setTimeout(()=> ov.classList.remove('run'), 1500);
}

// ──────────────────────────────────────────────────────
//  AI 摄像头识别中枢
// ──────────────────────────────────────────────────────
  // 顶部一排提示的"当前手势"高亮。只改 class，不碰文案/布局；
  // 只有当识别结果真的变化时才写 DOM，避免每帧触发样式重算。
  const _hudGestures = Array.from(document.querySelectorAll('#hud-top .gesture'));
  function markGesture(key){
    const keys = Array.isArray(key) ? key : (key ? [key] : []);
    const sig = keys.join('|');
    if (window.__activeGesture__ === sig) return;
    window.__activeGesture__ = sig;
    _hudGestures.forEach(el => el.classList.toggle('live', keys.includes(el.dataset.gesture)));
  }
  window.__markGesture__ = markGesture;   // QA 可直接断言高亮状态

  // ══════════════════════════════════════════════════════════
  //  手势语义总入口（从 onResults 里抽出来，独立成函数）
  //  抽出来的原因：这样 QA 可以用合成关键点跑遍每一种手势，
  //  不用真的对着摄像头比划，交互回归才有办法自动化。
  //  lm = MediaPipe 21 点（原始未镜像坐标），now = ms
  // ══════════════════════════════════════════════════════════
  function handleHandLandmarks(lm, now){
      if(!lm){
        window._hoverZone='none'; window._hoverFrames=0; updateHoverUI(); isPinching=false;
        markGesture('');
        document.getElementById('st-mode').textContent='未检测到手掌'; 
        window._lastWristX = undefined; 
        window._lastSpan = undefined; // 🖐️ 手离开时，同步清除“张合度”追踪记录
        // 手离开画面必须立刻撤销推近与旋转基准：否则镜头会停在"最近"处不动，
        // 再次入画时第一帧的 roll 差值还会被当成一次大旋转。
        window._pushTarget = 0;
        window._lastRoll = undefined;
        // 同步清空推近/巡视的中间态：不清的话，下次入画第一帧会拿"上次的掌长
        // 平滑值"当起点，镜头会先弹一下再跟上。
        window._pushSmooth = undefined;
        window._lastOpenWrist = undefined;
        window._lastOpenWristY = undefined;
        window._hoverStable = 0;
        window._twoStable = 0;
        if (satOpenTimer) { clearTimeout(satOpenTimer); satOpenTimer = null; }
        return;
      }
      // 提取小拇指尖(20)，用来和拇指(4)测算手掌最大跨度
      const wrist=lm[0], tip=lm[8], thumb=lm[4], pinky=lm[20];
      const fingers=countExtendedFingers(lm);
      
      // 💡【神级调优】：只计算 X 和 Y 的 2D 屏幕投影距离，彻底丢弃波动的 Z 轴深度数据！
      const pinchDist = Math.hypot(thumb.x - tip.x, thumb.y - tip.y);
      isPinching = (pinchDist < 0.06) && !fingers.isFist; 
      
      // 📏 计算手掌的“绝对物理跨度”（大拇指尖到小拇指尖的距离），用于连续推拉变焦
      const spanDist = Math.hypot(pinky.x - thumb.x, pinky.y - thumb.y);

      document.getElementById('st-open').textContent = Math.round(fingers.openness * 100) + '% | ' + fingers.extended + '指';
      
      // 语义文案只由下方分支写一次。旧版在这里先写一版"单食指/握拳"再被覆盖，
      // 两处文案不一致时会闪一下错误提示，也让顶部高亮无从判断当前手势。
      window._hoverZone='none';
      if(fingers.isIndex){
        if(tip.x < 0.25) {
          window._hoverZone='right';  // 镜像修正：画面左侧=物理右手→右光幕
          document.getElementById('st-mode').textContent = '☝️ 锁定右边缘 >>>';
        } else if(tip.x > 0.75) {
          window._hoverZone='left';   // 镜像修正：画面右侧=物理左手→左光幕
          document.getElementById('st-mode').textContent = '☝️ 锁定左边缘 <<<';
        } else {
          document.getElementById('st-mode').textContent = '☝️ 单食指：请移向屏幕边缘';
        }
      }
      // 边缘切星防误触：只有「指尖停住不动」的帧才算有效停留。
      // 旧版只数帧数，手在边缘晃一下、或只是路过，也会累计到 30 帧切站。
      if(window._hoverZone!=='none'){
        window._hoverFrames++;
        if(window._lastHoverTip && Math.hypot(tip.x-window._lastHoverTip.x, tip.y-window._lastHoverTip.y) < 0.020)
          window._hoverStable = (window._hoverStable || 0) + 1;
        else window._hoverStable = 0;
      } else { window._hoverFrames=0; window._hoverStable=0; }
      window._lastHoverTip = { x:tip.x, y:tip.y };
      updateHoverUI();

      if(window._hoverFrames > 30 && window._hoverStable > 22 && now - window._lastHoverAction > 2000){
        window._lastHoverAction = now;
        if(satActive){
          if(window._hoverZone==='left') closeSatMap();  // 需要长按2秒左边缘才关闭
        }else{
          if(window._hoverZone==='left'){ focusPlanet((focus-1)%STOP_N); }
          else if(window._hoverZone==='right'){ focusPlanet((focus+1)%STOP_N); }
        }
        window._hoverFrames=0; window._hoverStable=0;
      }

      if(satActive){
        // 🚀 速度驱动旋转：手掌滑动速度 = 地球旋转速度（1:1 响应，无延迟）
        if (window._lastWristX !== undefined) {
          const dx = wrist.x - window._lastWristX;
          // dx 有效时才注入速度；手停后保留上帧速度，交给卫星图动画按摩擦衰减
          if (Math.abs(dx) > 0.0005) window._satRotationVelocity = dx * 5.5;
        }
        window._lastWristX = wrist.x;

        // 卫星图里的语义必须和太阳系主视图完全一致：握拳推近、张手拉远。
        // 旧版这里反过来写（握拳看全轨道），用户从主视图切进卫星图会瞬间懵。
        if (fingers.isFist) {
          markGesture('fist');
          const hs = Math.hypot(lm[9].x - wrist.x, lm[9].y - wrist.y);
          window._pushTarget = Math.max(0, Math.min(1, (hs - 0.095) / 0.105));
          window._satTargetDistance = 2.4;
          window._lastRoll = undefined;
        } else if (fingers.isOpen) {
          markGesture('open');
          window._pushTarget = 0;
          window._satTargetDistance = 5.6;
          window._lastRoll = undefined;
        } else {
          markGesture(fingers.isTwoFinger ? 'two' : 'edge');
          window._pushTarget = 0;
          window._satTargetDistance = 4.0;
          window._lastRoll = undefined;
        }
        document.getElementById('st-mode').textContent = fingers.isFist
          ? '✊ 推近卫星图 ' + Math.round(window._pushTarget * 100) + '%'
          : (fingers.isOpen ? '🖐️ 拉远卫星图 · 左右滑动换视角' : '✌️ 卫星图：握拳推近 / 张手拉远');
      }else{
        // ══════════════════════════════════════════════════════
        //  ✊ 握拳 = 推近（手离镜头越近越近）；转拳 = 目标跟着转
        //  🖐️ 张手 = 拉远观察；✌️ 双指 = 卫星网
        //  三个手势互斥、语义单一，不再出现"握拳既拉远又开卫星图"的冲突。
        // ══════════════════════════════════════════════════════
        const stMode = document.getElementById('st-mode');

        if(isPinching){
          markGesture('pinch');
          stMode.textContent = '双指捏合：追踪聚焦并开启信息卡';
          window._pushTarget = 0;
          window._lastRoll = undefined;
          if(!window._cardActive){ window._cardActive=true; showCard(); }
        } else {
          // 松开捏合 → 收起信息卡
          if(window._cardActive) {
             const c = document.getElementById('planet-card');
             c.classList.remove('show');
             window._cardActive=false;
             setTimeout(()=> { if(!window._cardActive) c.style.display='none'; }, 300);
          }

          if (fingers.isOpen) {
            // 🖐️ 张手：退到「观察位」—— 比默认机位更远，一眼看全目标。
            // 用户反馈 2× 还不够远，改成 3×（深空 17→51，太阳 18→54，都在 72 上限内）。
            const fz = isDeep(focus) ? deepOf(focus).zoom : (planetZoomDist[P[focus].t] || 2.0);
            window._zoomTarget = Math.min(72, fz * 3.0);   // 只写目标，插值交给 rAF
            window._pushTarget = 0;
            markGesture('open');
            window._lastRoll = undefined;
            stMode.textContent = '🖐️ 张手：拉远 · 移动手掌拖动星球';
          } else if (fingers.isFist) {
            // ✊ 握拳：用「掌长」（腕→中指根）当"离镜头多近"。
            //    它与手指是否伸开无关，握拳时依然稳定，比指尖距离可靠得多。
            const handSpan = Math.hypot(lm[9].x - wrist.x, lm[9].y - wrist.y);
            // 手臂自然弯曲 ≈0.095，贴到镜头前 ≈0.20 → 归一化成 0..1
            let push = (handSpan - 0.095) / 0.105;
            push = Math.max(0, Math.min(1, push));
            // ⚠️ 只在"正在转拳"时低通：转拳会让手掌平面倾斜、掌长的 2D 投影被压短，
            //    原始值会掉下去 → 镜头在推近过程中反复回退，手感像卡顿。
            //    单纯推近时不平滑，保持 1:1 跟随（不然推拉会有延迟感）。
            const spinning = now < (window._rollHotUntil || 0);
            window._pushSmooth = (!spinning || window._pushSmooth === undefined)
              ? push
              : window._pushSmooth + (push - window._pushSmooth) * 0.72;
            window._pushTarget = window._pushSmooth;
            // 推近时把「观察位」慢慢收回默认机位，避免张手后退远过的距离一直卡着
            const fz = isDeep(focus) ? deepOf(focus).zoom : (planetZoomDist[P[focus].t] || 2.0);
            window._zoomTarget = fz;   // 推近时把"观察位"慢慢收回默认机位
            stMode.textContent = '✊ 推近 ' + Math.round(window._pushSmooth * 100) + '% · 转拳旋转目标';

            // 转拳旋转：手掌平面倾角（食指根 5 → 小指根 17 的连线）。
            // x 取镜像，保证"手在屏幕上顺时针转，目标也顺时针转"。
            const roll = Math.atan2(lm[17].y - lm[5].y, -(lm[17].x - lm[5].x));
            if (window._lastRoll !== undefined) {
              let dr = roll - window._lastRoll;
              dr = Math.atan2(Math.sin(dr), Math.cos(dr));   // 最短弧，跨 ±π 不跳
              // 死区滤掉 landmark 抖动；上限防止单帧误判把目标甩飞
              if (Math.abs(dr) > 0.012 && Math.abs(dr) < 0.6) {
                spinAccum += dr * 1.55;
                // 高亮保持 400ms：原来只在"这一帧确实转了"才点亮，手一停就掉，
                // 顶部「04 转拳旋转」会以 30Hz 一闪一闪。
                window._rollHotUntil = now + 400;
              }
            }
            window._lastRoll = roll;

            // ⚠️ 握拳平移旋转已按用户要求删除：平移只归张手，
            //    握拳只负责推近 + 转拳，避免两个语义抢同一个手部位移。
            // 转拳的 400ms 热窗内同时点亮 03 握拳 + 04 转拳（手型仍是握拳）
            markGesture(now < (window._rollHotUntil || 0) ? ['fist', 'roll'] : 'fist');
          } else if (fingers.isTwoFinger) {
            // ✌️ 双指不在推近/拉远的语义里，提示与卫星网入口保持一致
            markGesture('two');
            window._pushTarget = 0;
            window._lastRoll = undefined;
            stMode.textContent = (focus === 3) ? '✌️ 双指：停留 0.9 秒部署卫星网' : '✌️ 双指：切到地球可部署卫星网';
          } else {
            markGesture('edge');
            window._pushTarget = 0;
            window._lastRoll = undefined;
            stMode.textContent = '☝️ 单指：移到左右边缘可切换目标';
          }
        }

        // ✌️ 双指保持 0.9s → 部署卫星网（地球专属）。
        // 之前这个入口占用"握拳"，与推近天然冲突；握拳还给"推近/旋转"，卫星网改用双指。
        // 双指部署防误触：手要相对停住（腕点每帧位移 < 0.02）才算持续 intention。
        // 挥手时食指+中指偶尔同时伸直，旧版会累计到 0.9s 直接弹出卫星网。
        if(window._lastTwoWrist !== undefined &&
           Math.hypot(wrist.x-window._lastTwoWrist.x, wrist.y-window._lastTwoWrist.y) < 0.020)
          window._twoStable = (window._twoStable || 0) + 1;
        else window._twoStable = 0;
        window._lastTwoWrist = { x:wrist.x, y:wrist.y };
        if(fingers.isTwoFinger && focus===3 && !satActive && window._twoStable > 8){
          if(!satOpenTimer) satOpenTimer=setTimeout(()=>{openSatMap();satOpenTimer=null;},900);
          stMode.textContent = '✌️ 双指：部署卫星网...';
        }else{ clearTimeout(satOpenTimer); satOpenTimer=null; }

        // 🖐️ 张手时移动手掌 = 拖着星球走（左右绕视、上下抬降机位）。
        // ⚠️ 必须增量式：绝对映射 tRY=(wrist.x-0.5)*2π 会在手偏侧时一张手就跳角度。
        //    握拳平移已删除，所以这里的位移不会再和推近/转拳抢语义。
        if (fingers.isOpen) {
          if (window._lastOpenWrist !== undefined && window._lastOpenWristY !== undefined) {
            const dw = wrist.x - window._lastOpenWrist;
            const dy = wrist.y - window._lastOpenWristY;
            // 死区滤摄像头抖动；单帧上限防手一晃把星球甩飞。
            // 左右移动 = 直接转动目标本身（手往右，球面纹理也往右走）；
            // 握拳平移已删，所以这个位移只归张手，不会和推近抢语义。
            if (Math.abs(dw) > 0.003 && Math.abs(dw) < 0.12) {
              spinAccum -= Math.max(-0.30, Math.min(0.30, dw * 4.0));
              markGesture('open');
            }
            // 上下移动 = 抬降机位，看清星球的极点/底面
            if (Math.abs(dy) > 0.003 && Math.abs(dy) < 0.12) {
              tRPitch = Math.max(-0.55, Math.min(0.55, tRPitch + dy * 1.8));
            }
          }
          window._lastOpenWrist = wrist.x;
          window._lastOpenWristY = wrist.y;
        } else {
          window._lastOpenWrist = undefined;
          window._lastOpenWristY = undefined;
        }
      }

      handCtx.clearRect(0,0,innerWidth,innerHeight); drawHandSkeleton(lm);
      
  }
  window.__handLandmarks__ = handleHandLandmarks;   // 只读调试入口（QA 用）

async function initCam(){
  const btn=document.getElementById('btn-cam');
  if(camBusy) return;  // 加载中重复点击直接忽略，避免双开流/双 pump
  if(camOn){
    // 关闭：停媒体轨 + 释放 MediaPipe 实例（否则每次重开都 new 一个，WASM/模型不回收）
    camOn=false; camGen++; isPinching=false;
    if(satOpenTimer){ clearTimeout(satOpenTimer); satOpenTimer=null; }
    camStream?.getTracks().forEach(t=>t.stop()); camStream=null;
    hands?.close?.(); hands=null;
    document.getElementById('webcam-pip').srcObject=null; document.getElementById('hand-overlay').style.display='none';
    document.getElementById('st-cam').textContent='关闭'; btn.textContent='📷 启动摄像头'; return;
  }
  camBusy=true; btn.textContent='加载中...';
  // 🛡️ 安全上下文检查
  if (location.protocol === 'file:' || !navigator.mediaDevices?.getUserMedia) { camBusy=false; btn.textContent='⚠️ 请用 localhost 或 HTTPS 访问'; setTimeout(()=>{btn.textContent='📷 启动摄像头';},3500); return; }
  // 🛡️ SDK 加载检查
  if (typeof Hands === 'undefined') { camBusy=false; btn.textContent='⚠️ AI模型加载失败，请刷新页面'; setTimeout(()=>{btn.textContent='📷 启动摄像头';},3500); return; }
  try {
    camStream=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:640},height:{ideal:480},facingMode:'user'}});
    const v=document.getElementById('webcam-pip'); v.srcObject=camStream;
    await new Promise(r=>{v.onloadedmetadata=r;if(v.readyState>=1)r();}); await v.play();
    camOn=true; camGen++; const myGen=camGen; camBusy=false;
    btn.textContent='📷 关闭摄像头'; document.getElementById('hand-overlay').style.display='block';
    
    hands=new Hands({locateFile:f=>'https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1646424915/'+f});
    hands.setOptions({maxNumHands:1,modelComplexity:1,minDetectionConfidence:0.5,minTrackingConfidence:0.5});

    hands.onResults(r => {
      const now = Date.now();
      handleHandLandmarks(r.multiHandLandmarks?.[0] || null, now);
      fpsCount++;
      if (now - fpsStart >= 1000) { document.getElementById('st-cam').textContent='开启 (FPS:'+fpsCount+')'; fpsCount=0; fpsStart=now; }
    });

    async function cameraPumpLoop(){
      // 代际不符 = 这轮摄像头已关闭/重开，旧循环必须退出，避免两个 pump 并存互抢 hands。
      if(!camOn || myGen!==camGen) return;
      if(v && v.readyState >= 2 && hands) try{ await hands.send({image:v}); }catch(e){ console.error('MediaPipe send error:', e); }
      if(!camOn || myGen!==camGen) return;  // await 期间可能已被关闭
      setTimeout(()=>requestAnimationFrame(cameraPumpLoop),33);
    }
    cameraPumpLoop();
  } catch(e) {
    console.error(e); camBusy=false; camOn=false; camStream?.getTracks().forEach(t=>t.stop());
    btn.textContent='📷 启动失败，请允许权限'; setTimeout(()=>{btn.textContent='📷 启动摄像头';},3500);
  }
}

function updateHoverUI(){
  const hzL=document.getElementById('hover-zone-left'), hzR=document.getElementById('hover-zone-right');
  if(!hzL||!hzR)return;
  hzL.classList.remove('active','trigger'); hzR.classList.remove('active','trigger');
  if(window._hoverZone==='left'){hzL.classList.add('active'); if(window._hoverFrames>10) hzL.classList.add('trigger');}
  else if(window._hoverZone==='right'){hzR.classList.add('active'); if(window._hoverFrames>10) hzR.classList.add('trigger');}
}

// ──────────────────────────────────────────────────────
//  地球卫星渲染（持久單一渲染器，无缝数据注入）
// ──────────────────────────────────────────────────────
let _satCleanup = null;  
window._activeSats = []; // 全局挂载真实卫星数据

async function openSatMap(){
  if(satActive)return; satActive=true; 
  document.getElementById('sat-overlay').style.display='flex';
  const base=location.protocol==='file:'?'http://127.0.0.1:5500':'';
  document.getElementById('sat-list').innerHTML='<span style="color:var(--warn);">正在连接深空观测站...</span>';
  
  // 🚀【核心修复1】：一进去只创建一次渲染器，坚决不反复销毁重建！
  window._activeSats = []; // 先清空，显示本地兜底散点
  if(!_satCleanup) _satCleanup = renderSatGlobe();
  
  // 拉取 API 数据
  try{
    const [tleR, satR] = await Promise.all([
      fetch(base+'/api/space/tle'),
      fetch(base+'/api/space/satellites')
    ]);
    const tleData = await tleR.json();
    const satData = await satR.json();
    
    const isRealTLE = tleData._source === 'celestrak';
    const tleLabel = isRealTLE ? 'CelesTrak TLE 推演' : '本地模型示意';
    const isCached = satData._source === 'celestrak-cache';
    const isLiveSat = satData._source === 'celestrak';
    const isAuthoritative = satData._source === 'celestrak-satcat';
    const satSrcLabel = isAuthoritative ? 'SATCAT 权威编目' : (isLiveSat ? '实时' : (isCached ? '缓存快照' : '离线参考'));
    const tleSats = Array.isArray(tleData.sats) ? tleData.sats : [];
    const countries = Array.isArray(satData.countries) ? satData.countries : [];
    const total = parseCount(satData.total);
    const countryTotal = countries.reduce((sum,c) => sum + parseCount(c.count), 0);
    const pctBase = total || countryTotal || 1;
    const notes = [];
    if(satData.countries_source) notes.push(satData.countries_source);
    notes.push(isAuthoritative ? '按运营国 OWNER 字段归类' : '仅覆盖已收录分组，不代表全球真实占比', '每 24 小时刷新');
    const totalNote = isAuthoritative
      ? 'CelesTrak SATCAT 在轨编目 · GROUP=active'
      : (satData.total_source || '分组收录统计') + ' · 非全球在轨总数';
    const sectionTitle = isAuthoritative ? '运营国构成' : '国别构成（推定）';
    const sectionTag = isAuthoritative ? 'SATCAT OWNER 真实字段' : '按卫星名称归类';
    const footText = isAuthoritative
      ? '数量与运营国来自 CelesTrak SATCAT 权威编目（OWNER 字段，非名称推定），统计 GROUP=active 在轨目标；主视图位置在实时 TLE 不可用时由本地模型生成。'
      : '数量来自 CelesTrak 分组收录，非全球在轨总数；国别按卫星名称关键字推定，仅供示意。主视图位置在实时 TLE 不可用时由本地模型生成。';
    let listHTML = `<div class="sat-headline">
      <section class="sat-summary">
        <div class="sat-summary-label">在轨目标总数 <span class="sat-status ${(isLiveSat || isAuthoritative) ? 'live' : 'offline'}">${satSrcLabel}</span></div>
        <div class="sat-total">${total.toLocaleString()}<span>颗</span></div>
        <div class="sat-total-note">${escHTML(totalNote)}</div>
      </section>
      <section class="sat-metrics">
        <div><span>可视化轨道目标</span><b>${tleSats.length}</b></div>
        <div><span>位置推算来源</span><b>${escHTML(tleLabel)}</b></div>
      </section>
    </div>
    <section class="sat-section">
      <h3>${sectionTitle}<span class="sat-section-tag">${sectionTag}</span></h3>
      <p>${escHTML(notes.join(' · '))}</p>
      <div class="sat-bars">`;
    countries.forEach(c => {
      const code = String(c.code || '—').toUpperCase() === 'OT' ? 'INT' : String(c.code || '—').toUpperCase();
      const count = parseCount(c.count);
      const rawPct = pctBase ? (count / pctBase) * 100 : 0;
      const pct = rawPct.toFixed(1);
      const bar = Math.max(0, Math.min(100, rawPct)).toFixed(1);
      listHTML += `<div class="sat-row">
        <div class="sat-row-top">
          <span class="sat-code">${escHTML(code)}</span>
          <span class="sat-name">${escHTML(c.name)}</span>
          <span class="sat-num">${count.toLocaleString()} <small>${pct}%</small></span>
        </div>
        <div class="sat-track"><span style="width:${bar}%"></span></div>
      </div>`;
    });
    listHTML += `</div></section>
    <footer class="sat-foot">${footText}</footer>`;
    if(satActive) document.getElementById('sat-list').innerHTML = listHTML;
    
    // 🚀【核心修复2】：拿到API后，直接解析出卫星轨道模型，无缝塞入现有渲染器！
    if(tleSats.length > 0 && satActive) {
      const newSats = [];
      tleSats.forEach(s=>{
        try{
          if(typeof satellite!=='undefined'&&satellite.twoline2satrec){
            const r=satellite.twoline2satrec(s.tle1,s.tle2);
            if(r)newSats.push(r);
          }
        }catch(e){}
      });
      window._activeSats = newSats; // 数据挂载完毕，渲染循环自动接管！
    }
  }catch(e){
    if(satActive) document.getElementById('sat-list').innerHTML='<span style="color:var(--warn);">离线模式 — CelesTrak API 不可用，显示本地模拟</span>';
  }
}

function renderSatGlobe(){
  const ct=document.getElementById('sat-globe'); ct.innerHTML=''; const W=ct.clientWidth||400, H=ct.clientHeight||400;
  let disposed=false;
  const sc=new THREE.Scene(), cam=new THREE.PerspectiveCamera(45,W/H,.1,100); cam.position.set(0,.5,3.5);
  const rn=new THREE.WebGLRenderer({antialias:true,alpha:true}); rn.setSize(W,H); ct.appendChild(rn.domElement);
  satRn=rn; satCam=cam;

  const earth=new THREE.Mesh(
    new THREE.SphereGeometry(0.85,64,64),
    new THREE.MeshPhongMaterial({color:0x2244aa, specular:0x112244, shininess:15})
  ); sc.add(earth);
  texLoader.load(TX.earth, tex => {
    if(disposed){ tex.dispose(); return; }
    tex.encoding = THREE.sRGBEncoding; earth.material.map = tex; earth.material.color.set(0xffffff); earth.material.needsUpdate = true;
  });
  sc.add(new THREE.AmbientLight(0x334466,2.8)); const sl=new THREE.DirectionalLight(0xffffff,2.2); sl.position.set(5,1,3); sc.add(sl);

  const glowGeo = new THREE.SphereGeometry(0.90, 48, 48);
  const glowMat = new THREE.ShaderMaterial({
    uniforms:{c:{value:new THREE.Color(0x6cb6e8)},p:{value:3.2}},
    vertexShader:'varying vec3 vN;void main(){vN=normalize(normalMatrix*normal);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader:'uniform vec3 c;uniform float p;varying vec3 vN;void main(){float i=pow(1.0-max(0.0,dot(vN,vec3(0,0,1))),p);gl_FragColor=vec4(c,i*0.22);}',
    side:THREE.FrontSide,blending:THREE.AdditiveBlending,transparent:true,depthWrite:false
  });
  sc.add(new THREE.Mesh(glowGeo,glowMat));

  [0.92, 2.0, 5.6].forEach(r => {
    const orbGeo = new THREE.TorusGeometry(r, 0.0025, 8, 128);
    const orbMat = new THREE.MeshBasicMaterial({color:0x6cb6e8, transparent:true, opacity:0.2});
    const orb = new THREE.Mesh(orbGeo, orbMat);
    orb.rotation.x = Math.PI/2;
    sc.add(orb);
  });

  // 预先开辟 6000 个卫星的显存槽位
  const totalParticles = 6000; 
  const satGeo=new THREE.BufferGeometry();
  const posArr=new Float32Array(totalParticles*3);
  for(let i=0;i<totalParticles;i++){
    let lat=Math.asin(Math.random()*2-1);
    const lon=Math.random()*Math.PI*2;
    const band=Math.random();
    const altKm=band<0.50?350+Math.random()*850:band<0.80?8000+Math.random()*4000:35786+Math.random()*200;
    if (altKm > 30000) { lat = (Math.random() - 0.5) * 0.03; }
    const alt=(6371+altKm)/6371 * 0.85; 
    posArr[i*3]=Math.cos(lat)*Math.cos(lon)*alt;
    posArr[i*3+1]=Math.sin(lat)*alt;
    posArr[i*3+2]=Math.cos(lat)*Math.sin(lon)*alt;
  }
  satGeo.setAttribute('position',new THREE.BufferAttribute(posArr,3));

  const satMatCore=new THREE.PointsMaterial({size:0.020,color:0xbfe4fa,transparent:true,opacity:0.86,blending:THREE.NormalBlending,depthWrite:false});
  const satMatMid=new THREE.PointsMaterial({size:0.042,color:0x6cb6e8,transparent:true,opacity:0.32,blending:THREE.AdditiveBlending,depthWrite:false});
  const satMatOuter=new THREE.PointsMaterial({size:0.070,color:0x4d8fbd,transparent:true,opacity:0.14,blending:THREE.AdditiveBlending,depthWrite:false});
  
  const pCore = new THREE.Points(satGeo, satMatCore);
  const pMid = new THREE.Points(satGeo, satMatMid);
  const pOuter = new THREE.Points(satGeo, satMatOuter);
  sc.add(pCore); sc.add(pMid); sc.add(pOuter);

  let animId = null;
  // 窄屏物理空间小：默认相机拉远让地球缩小，才能在面板下方完整放下（手势缩放基准随之适配）
  const _narrow=(ct.clientWidth||innerWidth)<600;
  const _initDist=_narrow?6.2:4.0;
  window._satTargetDistance=_initDist; window._satCurrentDistance=_initDist; window._satRotationVelocity=0; window._satCurrentRotationY=0;
  // ── 取景偏移：数据面板在右侧竖栏（窄屏在底部），让地球落在左侧约 2/3 的中央 ──
  // 桌面/平板：面板占右 34%，地球圆心移到左侧可用区的水平中点，垂直居中，观感最自然。
  // 窄屏：面板占底部，地球移到上半区居中。只偏移相机注视点，地球仍绕原点旋转、手势不变。
  const _tmpF=new THREE.Vector3(), _tmpR=new THREE.Vector3(), _tmpU=new THREE.Vector3(), _UP=new THREE.Vector3(0,1,0);
  function framing(){
    const list=document.getElementById('sat-list');
    const lr=list.getBoundingClientRect(), cr=ct.getBoundingClientRect();
    const cw=cr.width||1, ch=cr.height||1;
    const d=window._satCurrentDistance;
    const tanH=Math.tan(45*Math.PI/180/2);
    const Rp=(0.85/(d*tanH))*(ch/2); // 地球投影半径（像素）
    const cx0=cw/2, cy0=ch/2;
    const pad=16;
    const panelLeftRel=lr.left-cr.left;   // 面板左边缘（相对画布）
    const panelTopRel=lr.top-cr.top;      // 面板上边缘
    const isDrawer=panelLeftRel < cw*0.4;  // 底部抽屉模式（面板横跨整宽）
    let tx=cx0, ty=cy0;
    if(isDrawer){
      // 底部抽屉：地球移到上半区居中
      const safeTop=Rp+pad;
      ty=Math.max(safeTop, (panelTopRel-Rp-pad)/2);
      if(ty+Rp+pad>panelTopRel) ty=Math.max(Rp*0.5, (panelTopRel-Rp-pad)/2);
    } else {
      // 右侧竖栏：地球圆心取左侧可用区 [pad, panelLeftRel-pad] 的中点
      const lo=Rp+pad, hi=panelLeftRel-Rp-pad;
      tx = hi>=lo ? (lo+hi)/2 : panelLeftRel/2;
    }
    // 屏幕像素位移 → 世界坐标偏移；地球右移 sx → 注视点左移，地球下移 sy → 注视点上移
    const wpp=(2*d*tanH)/ch;
    const wantX=-(tx-cx0)*wpp, wantY=(ty-cy0)*wpp;
    _tmpF.set(0,0,-1).applyQuaternion(cam.quaternion); // 看向原点时的相机前向
    _tmpR.crossVectors(_tmpF,_UP).normalize();         // 右向基
    _tmpU.crossVectors(_tmpR,_tmpF).normalize();       // 上向基
    const lookX=_tmpR.x*wantX+_tmpU.x*wantY;
    const lookY=_tmpR.y*wantX+_tmpU.y*wantY;
    const lookZ=_tmpR.z*wantX+_tmpU.z*wantY;
    // 暴露地球投影圆与面板矩形，供验证脚本做确定性几何相交断言
    window._satEarthScreen={cx:cr.left+tx, cy:cr.top+ty, r:Rp,
      panel:{left:lr.left,right:lr.right,top:lr.top,bottom:lr.bottom}};
    return [lookX,lookY,lookZ];
  }
  function anim(){
    if(!satActive){ cancelAnimationFrame(animId); return; }
    animId = requestAnimationFrame(anim);
    window._satCurrentDistance += (window._satTargetDistance - window._satCurrentDistance)*0.08;

    // 🚀 速度驱动旋转：手速 = 球速，摩擦自然减速（手停→球逐渐停）
    window._satCurrentRotationY += window._satRotationVelocity;
    window._satRotationVelocity *= 0.94;  // 每帧保留94%，手停后自然滑行
    cam.position.set(Math.sin(window._satCurrentRotationY)*window._satCurrentDistance, 0.5, Math.cos(window._satCurrentRotationY)*window._satCurrentDistance);
    cam.lookAt(0,0,0);
    // 取景避让放在 lookAt 之后：基于看向原点的基向量，偏移注视点使地球移出面板
    const look=framing();
    cam.lookAt(look[0],look[1],look[2]);

    const realSats = window._activeSats || [];
    const d = new Date();
    const pAttr = satGeo.attributes.position;

    // 🚀【核心修复3】：数据驱动渲染，无缝切换
    if (realSats.length > 0) {
      // API真实数据已就位，取消整体瞎转
      pCore.rotation.y = 0; pMid.rotation.y = 0; pOuter.rotation.y = 0;
      
      for(let i = 0; i < totalParticles; i++){
        if (i < realSats.length) {
          try {
            const pv = satellite.propagate(realSats[i], d).position;
            if (pv && Number.isFinite(pv.x) && Number.isFinite(pv.y) && Number.isFinite(pv.z)) {
              pAttr.setXYZ(i, (pv.x/6371)*0.85, (pv.z/6371)*0.85, (-pv.y/6371)*0.85);
            } else {
              pAttr.setXYZ(i, 0, 0, 0); 
            }
          } catch(e) { pAttr.setXYZ(i, 0, 0, 0); }
        } else {
          // 超出真实数量的多余槽位，全部隐藏（设为原点）
          pAttr.setXYZ(i, 0, 0, 0);
        }
      }
      pAttr.needsUpdate = true;
    } else {
      // API数据还没回来，兜底散点图自己轻微转圈假装在飞
      pCore.rotation.y += 0.001; pMid.rotation.y += 0.001; pOuter.rotation.y += 0.001;
    }
    
    rn.render(sc,cam);
  }
  animId = requestAnimationFrame(anim);
  return function(){
    cancelAnimationFrame(animId);
    disposed=true;
    satRn=null; satCam=null;
    // 释放 GPU 资源：sc.clear() 只移除对象，不 dispose 几何体/材质/贴图。
    // 反复「部署→关闭」卫星网会持续泄漏显存，必须显式遍历释放。
    sc.traverse(o=>{
      if(o.geometry) o.geometry.dispose();
      const m=o.material;
      if(m){
        (Array.isArray(m)?m:[m]).forEach(mat=>{
          if(mat.map) mat.map.dispose();
          if(mat.uniforms) for(const k in mat.uniforms){ const u=mat.uniforms[k].value; if(u&&u.isTexture) u.dispose(); }
          mat.dispose();
        });
      }
    });
    rn.dispose();
    sc.clear();
  };
}

function closeSatMap(){
  satActive=false;
  if(_satCleanup){ _satCleanup(); _satCleanup=null; }
  window._activeSats = [];
  document.getElementById('sat-overlay').style.display='none';
  document.getElementById('sat-globe').innerHTML='';
}
// ──────────────────────────────────────────────────────
//  主渲染循环
// ──────────────────────────────────────────────────────
const _tmpLabel = new THREE.Vector3(), _tmpProj = new THREE.Vector3();
const _camFwd = new THREE.Vector3(), _toLbl = new THREE.Vector3();

// ── 帧率无关：所有天体增量以 60fps 为基准归一化，避免高刷屏(120/144Hz)整体加速 ──
let _lastFrameMs = 0;
const FRAME_MS = 1000 / 60;
// 单帧角增量软上限：超过阈值后增速放缓但不锁死，避免高速时水星频闪/视觉倒转
const SPIN_CAP = 0.16;
// dt 平滑：瞬时帧间隔本身有 ±10% 噪声，直接乘到角度上会让行星「忽快忽慢」，
// 看起来就是抖。这里用指数滑动平均吸收单帧噪声，只跟随真实帧率档位。
let _dtSmooth = 1;
function smoothDt(raw){
  // 帧率档位变化（首帧、切换显示器、从后台回来）直接对齐，避免整段动画先慢一拍；
  // 只有同档位内的单帧噪声才进 EMA，那部分正是造成「忽快忽慢」的抖动。
  if (Math.abs(raw - _dtSmooth) > 0.45) _dtSmooth = raw;
  else _dtSmooth += (raw - _dtSmooth) * 0.12;
  return Math.min(3, Math.max(0.2, _dtSmooth));
}
function softCapStep(step){
  const a = Math.abs(step);
  if (a <= SPIN_CAP) return step;
  const over = a - SPIN_CAP;
  return (step < 0 ? -1 : 1) * (SPIN_CAP + over / (1 + over / SPIN_CAP));
}
window.__FRAME__ = () => ({dtScale: window.__lastDt || 1});
// 只读调试引用：供 .workbuddy/qa 下的验证脚本逐帧采样，不参与渲染逻辑
window.__SOLAR__ = { scene: ssS, cam: ssCam, renderer: ssRn, objs: ssObjs, planets: P,
  labels: planetLabels,   // 只读调试句柄：逐帧抖动回归要读标签位置
  get focus(){ return focus; } };
window.__DEEP__ = DEEP;
// 深空建模的渲染时机与压迫感遮罩（两者都在动画主循环里逐帧更新）
let _pendingDeep = null;
const _pressureEl = document.getElementById('void-pressure');
(function anim(){
  requestAnimationFrame(anim);
  const nowMs = performance.now();
  const rawDt = _lastFrameMs ? (nowMs - _lastFrameMs) / FRAME_MS : 1;
  _lastFrameMs = nowMs;
  // 先钳位再平滑：切后台/GC 造成的单帧跳变不会变成行星瞬移，也不会让速度忽快忽慢
  let dt = (rawDt > 3 || rawDt < 0 || !isFinite(rawDt)) ? 1 : rawDt;
  dt = smoothDt(dt);
  window.__lastDt = dt;
  window.__lastRawDt = rawDt;

  // ✊ 握拳推近：pushLevel 是「压迫感」的唯一来源 ——
  //    镜头 FOV 收紧（55°→45.5°）+ 全局暗角遮罩 + 深空天体的光流加速，共同构成"被推近"的体感。
  //    FOV 变化会直接改变投影半径，卡片避让用的 planetScreenR() 会自动跟随，不需要另做补偿。
  pushTarget = window._pushTarget || 0;
  const pushK = 1 - Math.pow(0.88, dt);
  pushLevel += (pushTarget - pushLevel) * pushK;
  if (pushTarget === 0 && pushLevel < 0.004) pushLevel = 0;
  // 缩放目标的插值放在 rAF 里：摄像头 30fps 的离散回调不再把镜头拉成阶梯
  // 不能加 camOn 条件：QA 用合成关键点驱动手势时并没有真的开摄像头，
  // 但手势语义仍应生效。_zoomTarget 在 focusPlanet 里同步，键鼠模式不会被带着漂。
  if (!isPinching && window._zoomTarget !== undefined) {
    tZoom += (window._zoomTarget - tZoom) * (1 - Math.pow(0.90, dt));
  }
  const fovWant = 55 - 9.5 * pushLevel;
  if (Math.abs(ssCam.fov - fovWant) > 0.02) { ssCam.fov = fovWant; ssCam.updateProjectionMatrix(); }
  if (_pressureEl) _pressureEl.style.opacity = (pushLevel * 0.95).toFixed(3);

  ssObjs[0].mesh.rotation.y = (ssObjs[0].mesh.rotation.y + P[0].rot * speed * dt) % (Math.PI * 2);

  // 更新 GPU shader uniforms
  const now = nowMs * 0.001;
  if (ssObjs._ringMat) ssObjs._ringMat.uniforms.uTime.value = now;

  // ☄️ 小行星帶緩慢旋轉
  if (asteroidBelt) asteroidBelt.rotation.y += 0.00015 * speed * dt;

  // ☀️ 日冕粒子沸騰動畫
  if (ssObjs[0]._corona) {
    const cp = ssObjs[0]._corona;
    if (window._isStormActive) {
      // ☢️ 电磁暴激活：疯狂旋转 + 血红粒子 + 剧烈抖动
      cp.rotation.y += 0.04 * speed * dt;
      cp.rotation.x += 0.015 * speed * dt;
      cp.material.color.setHex(0xff1111);
      cp.material.opacity = 0.5 + Math.sin(now * 5.0) * 0.35;
      cp.material.size = 0.02 + Math.sin(now * 5.7) * 0.018;
    } else {
      // 🌿 空间天气平静：温和沸腾呼吸
      cp.rotation.y += 0.008 * speed * dt;
      cp.rotation.x += 0.003 * speed * dt;
      cp.material.color.setHex(0xffaa44);
      cp.material.opacity = 0.4 + Math.sin(now * 1.7) * 0.15;
      cp.material.size = 0.02 + Math.sin(now * 2.3) * 0.008;
    }
  }

  ssObjs.forEach((o, i) => {
    if (i > 0) {
      o.angle += softCapStep(o.speed * .0208 * speed * dt);
      // 角度取模：长时间运行后角度会累到很大，取模可避免三角函数精度退化带来的高频抖动
      if (o.angle > Math.PI * 2) o.angle %= Math.PI * 2;
      // 同一套轨道方程（倾角 + 离心率），位置与轨道环几何严格一致
      orbitPoint(P[i], o.angle, o.mesh.position);
    }
    o.mesh.rotation.y = (o.mesh.rotation.y + (P[i] ? P[i].rot : 0.0015) * speed * dt) % (Math.PI * 2);

    // 聚焦行星自身的轨道环淡出：近距离看时那圈线必然会横穿行星本体，像一道划痕
    if (o.orbitMat) {
      const orbTarget = (i === focus) ? 0.0 : 0.35;
      const dOp = orbTarget - o.orbitMat.opacity;
      // 死区：收敛后不再每帧改材质，避免透明物体每帧重排序
      if (Math.abs(dOp) > 0.003) o.orbitMat.opacity += dOp * 0.05;
    }

    // ☁️ 地球雲層獨立旋轉（比本體稍快）
    if (o.mesh.userData && o.mesh.userData.clouds) {
      o.mesh.userData.clouds.rotation.y = (o.mesh.userData.clouds.rotation.y + 0.0022 * speed * dt) % (Math.PI * 2);
    }

    // 🌙 月球繞地球運行
    // 原来用绝对时间 now*2.5 直接算角度：既不受时间流速控制，也会把系统时钟的
    // 抖动原样搬进位置。改成与其它天体一致的累加 + dt，速度可被滑块统一调节。
    if (o.moon) {
      o._moonAngle = ((o._moonAngle || 0) + 0.026 * speed * dt) % (Math.PI * 2);
      const moonAngle = o._moonAngle;
      o.moon.position.set(
        o.mesh.position.x + Math.cos(moonAngle) * 1.58,
        o.mesh.position.y + Math.sin(moonAngle * 0.7) * 0.20,
        o.mesh.position.z + Math.sin(moonAngle) * 1.58
      );
    }

    // 🔭 木星伽利略衛星運行
    if (o.mesh.userData && o.mesh.userData.moons) {
      o.mesh.userData.moons.forEach(m => {
        m.angle += m.speed * 0.012 * speed * dt;
        m.mesh.position.set(
          o.mesh.position.x + Math.cos(m.angle) * m.dist,
          o.mesh.position.y + Math.sin(m.angle * 0.3) * m.dist * 0.15,
          o.mesh.position.z + Math.sin(m.angle) * m.dist
        );
      });
    }
    
    // 🏷️ 标签投影已移到本帧相机更新之后（见文件下方）——不能再在这里投影。
    // 原因：此处 ssCam.matrixWorldInverse 还是「上一帧 render」留下的旧矩阵，而星球本体
    // 在本帧 render 时用的是更新后的新相机。相机静止时两者一致，切换星球时相机快速移动，
    // 标签就会慢一帧（实测偏差最高 57px），肉眼看到的就是「名字抖动 / 有虚影”。
  });

  // 🖐️ 转拳旋转：手转过的角度直接叠加到当前目标上 ——
  //    行星 = 本体自转；黑洞 = 绕它转视角（吸积盘朝向随之变化）；星云 = 整体转动。
  //    用"位置式"而不是"速度式"，转多少跟多少，手停就停，没有惯性漂移。
  if (spinAccum !== 0) {
    const sA = Math.max(-0.42, Math.min(0.42, spinAccum));
    if (isDeep(focus)) deepOf(focus).obj.spin(sA);
    else {
      const m = ssObjs[focus] && ssObjs[focus].mesh;
      if (m) m.rotation.y = (m.rotation.y + sA) % (Math.PI * 2);
    }
    spinAccum = 0;
  }

  const time = performance.now() * 0.0005;
  const fp = focusPos(focus);
  const tx = fp.x, ty = fp.y, tz = fp.z;

  if (isDeep(focus)) {
    // 🌌 深空档案：3D 建模前固定机位凝视，握拳时把镜头推进（视界/柱体压满画面）。
    //   不用侧舷伴飞（深空目标没有公转），offset 只有正前方的距离。
    const d = deepOf(focus);
    const baseDist = Math.max(d.zoom * 0.85, Math.min(tZoom, d.zoom * 2.2));
    // 推近幅度按目标区分：黑洞由着色器自己缩放，可以贴很近；
    // 星云是体积粒子云，镜头再进就成"沙尘暴"了 —— 0.22 是"能感到逼近、
    // 又不至于把柱体糊成一片"的折中（0.12 时代几乎看不出推近，0.34 会糊墙）。
    const pushK = (d.kind === 'blackhole') ? 0.34 : 0.14;
    const dist = baseDist * (1 - pushK * pushLevel) * (window._cardActive ? 0.90 : 1) * (innerWidth < 700 ? 1.45 : 1);
    // 深空站也响应张手上下平移；幅度小一点，避免体积场被从柱底/柱顶看穿。
    followPlanet(tx, ty, tz, 0, 0.4 + pushLevel * 0.15 + ssRPitch * 1.2, dist, 0.05);
    d.fade += (1 - d.fade) * 0.05;
    d.obj.setOpacity(d.fade);
    d.obj.setPush(pushLevel);
    d.material.opacity = d.fade;
    _pendingDeep = d;                 // 真正的 raymarch 放到本帧相机矩阵刷新后执行
    DEEP.forEach(x => {
      if (x === d) return;
      x.fade += (0 - x.fade) * 0.08;
      x.obj.setOpacity(x.fade); x.material.opacity = x.fade;
    });
    projectCard(tx, ty, tz);
  } else if (!camOn) {
    // 🌌 1. 非手势默认模式 — 【侧舷伴飞：终极防穿模】
    DEEP.forEach(x => { x.fade += (0 - x.fade) * 0.08; x.obj.setOpacity(x.fade); x.material.opacity = x.fade; });
    // 💡 核心破局点：不再从星球的正前后方看，而是将相机放在轨道“侧后方”（-1.57 弧度即 -90度）
    // 这样太阳永远在画面左/右侧发光，既能看到绝美昼夜交界线，而且往后退多远都不会撞到太阳！
    const camAngle = camAzimuth(focus, now);
    // 窄屏的水平视角小得多，同样距离下球体会撑满整屏；按屏宽补偿，保证行星整体可见
    const narrowK = innerWidth < 700 ? 1.5 : 1;
    const lockDist = tZoom * 0.82 * narrowK * (1 - 0.34 * pushLevel);
    followPlanet(tx, ty, tz,
      Math.cos(camAngle) * lockDist,
      tZoom * 0.42 * narrowK,
      Math.sin(camAngle) * lockDist, 0.06);

    // 卡片跟随：贴星球左上但不遮星球 / 不挡时间流速滑条（每帧几何避让）
    projectCard(tx, ty, tz);
  } else {
    // 🌌 2. 手势控制模式
    DEEP.forEach(x => { x.fade += (0 - x.fade) * 0.08; x.obj.setOpacity(x.fade); x.material.opacity = x.fade; });
    if (isPinching) {
      // 🔒 状态 A：双指捏合状态
      const lockDist = focusZoom(focus) * 0.65 * (1 - 0.30 * pushLevel);
      const camAngle = camAzimuth(focus, now);   // 同样采用侧舷伴飞，但不再跟着公转甩镜头

      followPlanet(tx, ty, tz,
        Math.cos(camAngle) * lockDist,
        lockDist * 0.25,
        Math.sin(camAngle) * lockDist, 0.10);

      projectCard(tx, ty, tz);
    } else {
      // 🔓 状态 B：手势松开（解除捏合）— 平滑退回宏观大视角
      ssRY += (tRY - ssRY) * 0.09;
      ssRPitch += (tRPitch - ssRPitch) * 0.09;
      ssZoom += (tZoom - ssZoom) * 0.12;

      // 张手上下平移改变机位高度；用 ssRPitch 平滑，避免摄像头 landmark 抖动直传镜头。
      const pitchBase = (focus === 0) ? 0.55 : 0.42;
      const pitchY = ssZoom * pitchBase * (1 + ssRPitch);
      // 这里的 baseAngle 极为关键！退远时也保持侧向，保证倒车绝对安全
      const baseAngle = camAzimuth(focus, now) + ssRY;
      // 同上：绕行半径既要 ≤ 轨道半径 0.58，也要保证离太阳至少 5.0（日冕外径 4.03）
      const orbitR = Math.hypot(tx, tz) || (P[focus].d || 30);
      const rideR = Math.min(ssZoom * (1 - 0.34 * pushLevel), orbitR * 0.58, Math.max(1.0, orbitR - 5.0));
      followPlanet(tx, ty, tz,
        Math.cos(baseAngle) * rideR,
        pitchY - ty,
        Math.sin(baseAngle) * rideR, 0.06);

      // 之前这里没有更新卡片位置：手势松开后镜头继续退远/换焦点，
      // 卡片却停在上一帧的位置不动 —— 表现为"某颗星球的面板跑到下面/乱飘"。
      projectCard(tx, ty, tz);
    }
  }
  // 切站飞行：把相机从起点送到本帧 followPlanet 算出的机位。
  // 必须先克隆终点——lerpVectors 写的就是 ssCam.position 本身，直接传它会在
  // 写 x 之后读到新 x，插值结果会歪。
  if (_fly) {
    const u = Math.min(1, (nowMs - _fly.start) / _fly.dur);
    if (u >= 1) _fly = null;
    else {
      const dest = ssCam.position.clone();
      const e = u * u * (3 - 2 * u);
      ssCam.position.lerpVectors(_fly.from, dest, e);
    }
  }

  // 🌊 宇宙悬浮微动 — 风暴不再抖镜头，仅由红色日冕粒子表达异变（见上方日冕动画）
  // ⚠️ 微动必须发生在 lookAt 之后「再补一次 lookAt」：否则相机位置每帧都被推走、
  //    朝向却停留在上一帧的位置算出来的角度，等于让整个画面以帧率频率来回错位
  //    —— 这就是"星球看起来在剧烈抖"的根源之一。
  // 悬浮微动按相机到目标的距离衰减：远景保留"活着"的感觉，
  // 近景（水星 zoom 1.5）必须钉死，否则 0.005 单位的摆动会被放大成可见抖动。
  const _microK = Math.max(0.06, Math.min(1, ssCam.position.distanceTo(window._camTarget) / 14));
  ssCam.position.x += Math.sin(time) * 0.005 * _microK;
  ssCam.position.y += Math.cos(time * 0.8) * 0.003 * _microK;
  ssCam.lookAt(window._camTarget);

  // 🏷️ 行星标签：必须在相机【本帧】更新完、且矩阵同步后再投影。
  // 相机 lookAt/位移后 matrixWorldInverse 尚未刷新，这里手动 updateMatrixWorld() 一次，
  // 保证标签和星球本体用【同一帧】的相机矩阵 —— 切换星球时不再慢一帧、不再有虚影。
  ssCam.updateMatrixWorld();

  // 🌌 深空建模的离屏 raymarch 放在这里：本帧相机位置/朝向已经定稿，
  //    显示平面贴合相机才不会慢一帧（慢一帧会在推近时看到轻微错位）。
  if (_pendingDeep) {
    _pendingDeep.obj.frame(ssCam, ssRn, now, dt / 60);
    _pendingDeep = null;
  }
  // 统一遍历 11 站：0..8 行星（标签抬头顶）+ 9/10 深空影像（标签贴影像下缘）。
  for (let i = 0; i < STOP_N; i++) {
    const lbl = planetLabels[i];
    if (!lbl) continue;
    const labelPos = _tmpLabel.copy(focusPos(i));
    const radius = focusSize(i);
    // 深空目标体积大，标签压到下缘之外，避免正好盖在视界/柱体上
    labelPos.y += isDeep(i) ? -(radius * 1.35) : (radius * 1.3 + 0.15);
    // ⚠️ 只判 wp.z 不够：相机背后的点 w<0，project 后仍可能得到 |z|<1 的假坐标，
    //    但 x/y 已经是 ±30 万像素。先用相机朝向做真正的可见性判定。
    _camFwd.set(0, 0, -1).applyQuaternion(ssCam.quaternion);
    const inFront = _toLbl.copy(labelPos).sub(ssCam.position).dot(_camFwd) > 0.5;
    let lx = 0, ly = 0, ok = false;
    if (inFront) {
      const wp = labelPos.project(ssCam);
      lx = (wp.x * .5 + .5) * innerWidth;
      ly = (-wp.y * .5 + .5) * innerHeight;
      // 极近距离擦过标签时投影仍会爆掉，额外按视口倍数兜底
      // 只给"真的在屏幕附近"的标签上可见度：旧版放到 4 倍视口，
      // 结果 x=±5000px 的标签也顶着 0.55 透明度每帧跳上千像素（看不见但白算）。
      ok = wp.z <= 1 && isFinite(lx) && isFinite(ly)
           && Math.abs(lx) <= innerWidth * 1.2 && Math.abs(ly) <= innerHeight * 1.2;
    }
    lbl.__offscreen = !ok;
    if (ok) {
      lbl.__offscreenSet = false;
      // 外层只定位（无 transition → 跟随相机零滞后）；toFixed(1) 抑制亚像素抖动
      lbl.style.transform = `translate3d(${lx.toFixed(1)}px,${ly.toFixed(1)}px,0)`;
    } else {
      // ⚠️ 不能立刻把坐标钉到画外：内层还有 0.3s 淡出，位置瞬移会让标签
      //    在淡出过程中"闪一下"飞走。等它完全透明后再收。
      const op = parseFloat(lbl.__inner.style.opacity || '1');
      if (op < 0.02 && !lbl.__offscreenSet) {
        lbl.style.transform = 'translate3d(-9999px,-9999px,0)';
        lbl.__offscreenSet = true;
      }
    }

    const isFocus = (i === focus);
    if (lbl.__focus !== isFocus) {
      lbl.__focus = isFocus;
      const inner = lbl.__inner, tc = lbl.__tc;
      // 聚焦态平滑放大 + 辉光增强，走 .3s transition，不再 20↔12px 瞬间硬跳产生"抖一下"
      inner.style.transform = isFocus
        ? 'translate(-50%,-50%) scale(1.55)'
        : 'translate(-50%,-50%) scale(.92)';
      inner.style.textShadow = isFocus
        ? `0 0 10px ${tc}, 0 0 20px ${tc}bb`
        : `0 0 3px ${tc}55, 0 0 6px ${tc}22`;
      inner.style.fontWeight = isFocus ? '900' : '400';
    }
    // 卡片激活时隐藏聚焦标签（卡片已显示星球名，避免重叠）；
    // 深空标签只在自己聚焦时显示——否则看行星时，远处的"创生之柱/黑洞"标签会飘在星野里。
    const vis = isFocus
      ? ((lbl.__offscreen || window._cardActive) ? '0' : '1')
      : ((lbl.__offscreen || isDeep(i)) ? '0' : '.55');
    if (lbl.__vis !== vis) { lbl.__vis = vis; lbl.__inner.style.opacity = vis; }
  }

  // 💫 流星生命週期管理 — 風暴期間觸發率暴增至 20%
  const spawnChance = window._isStormActive ? 0.20 : 0.012;
  if (Math.random() < spawnChance) spawnShootingStar();
  for (let i = shootingStars.length - 1; i >= 0; i--) {
    const s = shootingStars[i];
    s.life -= 0.008;
    s.line.material.opacity = Math.max(0, s.life);
    // 移動流星
    const dx = Math.cos(s.angle) * s.speed;
    const dz = Math.sin(s.angle) * s.speed;
    const posArr = s.line.geometry.attributes.position.array;
    posArr[0] += dx; posArr[2] += dz;
    posArr[3] += dx; posArr[5] += dz;
    s.line.geometry.attributes.position.needsUpdate = true;
    if (s.life <= 0) {
      ssS.remove(s.line);
      s.line.geometry.dispose();
      s.line.material.dispose();
      shootingStars.splice(i, 1);
    }
  }

  if(!satActive) ssRn.render(ssS,ssCam);
})();

window.addEventListener('resize',()=>{
  ssCam.aspect=innerWidth/innerHeight;ssCam.updateProjectionMatrix();ssRn.setSize(innerWidth,innerHeight);
  if(satRn && satCam){ const ct=document.getElementById('sat-globe'); const w=ct.clientWidth||innerWidth, h=ct.clientHeight||innerHeight; satCam.aspect=w/h; satCam.updateProjectionMatrix(); satRn.setSize(w,h); }
  handCanvas.width=innerWidth;handCanvas.height=innerHeight;
});
document.getElementById('btn-cam').onclick=initCam;
document.getElementById('btn-rst').onclick=()=>{focusPlanet(0);ssRY=0;ssZoom=16;window._camTarget.set(0,0,0)};
document.getElementById('speed-slider').oninput=e=>{speed=parseFloat(e.target.value);document.getElementById('speed-label').textContent=speed.toFixed(1)+'x'};
// ⌨️ 键盤快捷鍵
document.addEventListener('keydown', e => {
  if (satActive) return;
  // 输入控件聚焦时不劫持方向键，保留滑块的原生键盘操作
  if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
  if (e.key === 'ArrowLeft')  { e.preventDefault(); focusPlanet((focus-1)%STOP_N); }
  if (e.key === 'ArrowRight') { e.preventDefault(); focusPlanet((focus+1)%STOP_N); }
  if (e.key === '+' || e.key === '=') { speed = Math.min(5, speed + 0.2); document.getElementById('speed-label').textContent = speed.toFixed(1)+'x'; }
  if (e.key === '-') { speed = Math.max(0.1, speed - 0.2); document.getElementById('speed-label').textContent = speed.toFixed(1)+'x'; }
  if (e.key === '0') { focusPlanet(3); }  // 地球
  if (e.key === '9') { focusPlanet(5); }  // 木星
  if (e.key === '8') { focusPlanet(6); }  // 土星
});
// 🖱️ 滑鼠點擊行星聚焦
cv.addEventListener('click', e => {
  if (camOn || satActive) return;
  const mouse = new THREE.Vector2((e.clientX/innerWidth)*2-1, -(e.clientY/innerHeight)*2+1);
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(mouse, ssCam);
  const hits = raycaster.intersectObjects(ssObjs.map(o => o.mesh), false);
  if (hits.length > 0) {
    const idx = ssObjs.findIndex(o => o.mesh === hits[0].object);
    if (idx >= 0) focusPlanet(idx);
  }
});
updateUI();
