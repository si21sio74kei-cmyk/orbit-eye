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
const PC={sun:0xffdd44,mercury:0xb0ada6,venus:0xe8dcc8,earth:0x3388dd,mars:0xd45a38,jupiter:0xd4b896,saturn:0xe8d5b0,uranus:0xb8d8d8,neptune:0xa0c8d8};

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
ssS.add(new THREE.Points(starGeo,new THREE.PointsMaterial({color:0xffffff,size:.15,transparent:true,opacity:.75,vertexColors:true})));
// 亮星十字光芒层
const brightStarsGeo=new THREE.BufferGeometry(), brightPos=new Float32Array(200*3);
for(let i=0;i<200;i++){const r=50+Math.random()*20,theta=Math.random()*Math.PI*2,phi=Math.acos(2*Math.random()-1);brightPos[i*3]=r*Math.sin(phi)*Math.cos(theta);brightPos[i*3+1]=r*Math.sin(phi)*Math.sin(theta);brightPos[i*3+2]=r*Math.cos(phi);}
brightStarsGeo.setAttribute('position',new THREE.BufferAttribute(brightPos,3));
ssS.add(new THREE.Points(brightStarsGeo,new THREE.PointsMaterial({color:0xaaccff,size:.35,transparent:true,opacity:.9,blending:THREE.AdditiveBlending,depthWrite:false})));

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

P.forEach((p,i)=>{
  // 球體幾何（岩石行星用更高面數以呈現紋理細節）
  const isRocky = ['mercury','venus','earth','mars'].includes(p.t);
  const geo = new THREE.SphereGeometry(p.s, isRocky?256:128, isRocky?256:128);
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
              mat.map = tex;
              mat.color.setHex(0xffffff);
              mat.needsUpdate = true;
            });
          } else {
            texLoader.load(TX[p.t], tex => { 
              tex.encoding = THREE.sRGBEncoding; 
              mat.map = tex; 
              // 🚀【核心修复】：贴图加载成功后，必须立刻把模型的底色洗成纯白(0xffffff)！
              // 否则高清贴图会被原本的单色严重污染，导致画面发黑失真！
              mat.color.setHex(0xffffff); 
              mat.needsUpdate = true; 
            });
          }
        }
        // 凹凸贴图：岩石行星才有真实起伏；数据贴图不做 sRGB 转换
        const bkey = {mercury:'mercuryBump', earth:'earthBump', mars:'marsBump'}[p.t];
        if (bkey && TX_EXTRA[bkey]) {
          texLoader.load(TX_EXTRA[bkey], tex => {
            mat.bumpMap = tex;
            mat.bumpScale = BUMP_SCALE[p.t] || 0.01;
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

  // 🌍 地球大气光晕
  if (p.t === 'earth') {
    const aGeo = new THREE.SphereGeometry(p.s*1.08, 64, 64);
    const aMat = new THREE.ShaderMaterial({
      uniforms: {c: {value: new THREE.Color(0x4499ff)}, p: {value: 4.0}},
      vertexShader: 'varying vec3 vN; void main(){vN=normalize(normalMatrix*normal); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: 'uniform vec3 c; uniform float p; varying vec3 vN; void main(){float d=dot(vN,vec3(0,0,1)); float i=pow(1.0-clamp(d,0.0,1.0),p)*smoothstep(0.0,0.32,d); gl_FragColor=vec4(c,i*0.30);}',
      side: THREE.FrontSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false
    });
    mesh.add(new THREE.Mesh(aGeo, aMat));
  }

  // 🌫️ 菲涅尔大气边缘光 — 金星 + 气态巨行星
  const fc = {venus:'#f5ead5', jupiter:'#ddbb88', saturn:'#eedd99', uranus:'#c8e8e0', neptune:'#b0d8e0'};
  if (fc[p.t]) {
    const fGeo = new THREE.SphereGeometry(p.s*1.055, 64, 64);
    const fMat = new THREE.ShaderMaterial({
      uniforms: {c: {value: new THREE.Color(fc[p.t])}, p: {value: 3.5}},
      vertexShader: 'varying vec3 vN; void main(){vN=normalize(normalMatrix*normal); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: 'uniform vec3 c; uniform float p; varying vec3 vN; void main(){float d=dot(vN,vec3(0,0,1)); float i=pow(1.0-clamp(d,0.0,1.0),p*0.8)*smoothstep(0.0,0.55,d); gl_FragColor=vec4(c,i*0.22);}',
      side: THREE.FrontSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false
    });
    mesh.add(new THREE.Mesh(fGeo, fMat));
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
  const lbl = document.createElement('div');
  lbl.style.cssText = 'position:absolute;left:0;top:0;font-family:var(--title);font-size:13px;letter-spacing:2px;transform:translate3d(-9999px,-9999px,0);transition:opacity .3s;white-space:nowrap;will-change:transform;';
  lbl.textContent = o.name;
  // 星球专属本色只需要设一次，不必每帧重写
  lbl.__tc = '#' + PC[o.type].toString(16).padStart(6, '0');
  lbl.style.color = lbl.__tc;
  labelDiv.appendChild(lbl);
  return lbl;
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
let focus=0,speed=1,tRY=0,tZoom=16,ssRY=0,ssZoom=16,isPinching=false;
let camOn=false,camStream=null,hands=null,trail=[],satActive=false,satData=null,satOpenTimer=null;
let satRn=null, satCam=null;  // 卫星图渲染器引用，供 resize 同步尺寸
let camBusy=false, camGen=0;  // 加载锁防双开；代际号让旧 pump 循环在关闭后自动退出
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
const _camOff = new THREE.Vector3(0, 12, 20);   // 相机相对行星的偏移
const _lookOff = new THREE.Vector3();           // 视点残余偏移（换焦点时平滑收敛）
let _camAz = null, _camAzFocus = -1;
function camAzimuth(i, now){
  const target = (i === 0) ? (now * 0.02) : (ssObjs[i].angle - 1.57);
  if (_camAz === null || _camAzFocus !== i) { _camAz = target; _camAzFocus = i; return _camAz; }
  if (i === 0) { _camAz = target; return _camAz; }
  let d = target - _camAz;
  d = Math.atan2(Math.sin(d), Math.cos(d));      // 取最短弧，避免绕过 2π 时甩镜头
  _camAz += d * 0.02;
  return _camAz;
}
function followPlanet(tx, ty, tz, ox, oy, oz, k){
  _camOff.x += (ox - _camOff.x) * k;
  _camOff.y += (oy - _camOff.y) * k;
  _camOff.z += (oz - _camOff.z) * k;
  ssCam.position.set(tx + _camOff.x, ty + _camOff.y, tz + _camOff.z);
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
  focus = idx;
  updateUI();
  tRY = 0;
  tZoom = planetZoomDist[P[idx].t] || 2.0;
  triggerAlert('🔭 ' + P[focus].n);

  // 换焦点时保持镜头连续：把偏移/视点差值重算成「当前相机位置 − 新行星位置」，
  // 之后偏移会自己收敛到跟随位，看上去是镜头飞过去，而不是瞬移或甩一下。
  const tp = ssObjs[idx] && ssObjs[idx].mesh ? ssObjs[idx].mesh.position : null;
  if (tp) {
    _camOff.copy(ssCam.position).sub(tp);
    if (_camOff.lengthSq() < 1e-3) _camOff.set(0, 6, 12);   // 防止退化导致朝向 NaN
    _lookOff.copy(window._camTarget).sub(tp);
  }
  _camAzFocus = -1;   // 新焦点重新对齐方位角基准
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

function updateUI(){ document.getElementById('st-planet').textContent=P[focus].n; }

// ──────────────────────────────────────────────────────
//  行星卡布局：横向紧凑卡，贴聚焦星球左上角（右下角靠近星球左上象限）；
//  字体放大、间隔收紧后卡片更矮更窄，正好塞进星球上方左侧的空隙。
//  绝不遮星球本体 / 时间流速滑条 / HUD；用真实 DOM 矩形做几何避让。
//  不动相机、手势、任何 id。
// ──────────────────────────────────────────────────────
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
    // 星球左上候选：卡片右边缘压在星球中心偏左处，底缘抬到星球上缘之上 gap，
    // 视觉上卡片"挂"在星球左肩；左缘不得压到左上角控制条，故用其右缘钳制。
    const ctrlSafe = cr ? cr.right + gap : 10;
    const ulL = Math.max(ctrlSafe, sx - rPx * 0.35 - cw);
    const ulT = sy - rPx - ch - gap;
    // 候选按 preference 排序：左上 → 正上方 → 正下方；取第一个同时避开 HUD/控制条/状态面板者。
    const cands = [
      [ulL, ulT],
      [sx - cw / 2, ulT],
      [sx - cw / 2, sy + rPx + gap]
    ];
    let placed = false;
    for(const [cl, ct] of cands){
      const inView = cl >= 10 && ct >= minTop && cl + cw <= vw - 10 && ct + ch <= vh - 10;
      if(inView && !hitsCtrl(cl, ct) && !hitsStatus(cl, ct)){ L = cl; T = ct; placed = true; break; }
    }
    if(!placed){
      // 兜底：HUD 下方起步，依次避让控制条 / 状态面板
      L = Math.max(10, sx - rPx - cw - gap);
      T = minTop;
      if(hitsCtrl(L,T)) T = cr.bottom + gap;
      if(hitsStatus(L,T)) T = Math.max(T, sr.bottom + gap);
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
}

function showCard(){
  const p=P[focus], c=document.getElementById('planet-card'), tc='#'+PC[p.t].toString(16).padStart(6,'0');
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
      c.innerHTML=`<div class="pc-head">
          <span class="pc-swatch" aria-hidden="true"></span>
          <h2 class="pc-title">${escHTML(data.planet || p.n)}</h2>
          <span class="pc-class">${escHTML(classText)}</span>
        </div>
        <dl class="pc-facts">${factHTML}</dl>
        ${note ? `<div class="pc-note"><span class="pc-note-label">观测札记</span><p>${escHTML(note)}</p></div>` : ''}
        <div class="pc-source">数据来源 · ${escHTML(src)}</div>`;
    }catch(e){
      if(myGen !== cardGen) return;
      c.innerHTML=`<div class="pc-head"><span class="pc-swatch"></span><h2 class="pc-title">${escHTML(p.n)}</h2></div>
        <div class="pc-error">星际数据链路中断<span>无法连接到深空观测站服务器</span></div>`;
    }
  })();
}

function triggerAlert(msg){ const a=document.getElementById('swipe-alert'); a.textContent=msg; a.classList.add('show'); setTimeout(()=>a.classList.remove('show'),800); }

// ──────────────────────────────────────────────────────
//  AI 摄像头识别中枢
// ──────────────────────────────────────────────────────
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
      const lm=r.multiHandLandmarks?.[0];
      if(!lm){
        window._hoverZone='none'; window._hoverFrames=0; updateHoverUI(); isPinching=false;
        document.getElementById('st-mode').textContent='未检测到手掌'; 
        window._lastWristX = undefined; 
        window._lastSpan = undefined; // 🖐️ 手离开时，同步清除“张合度”追踪记录
        return;
      }
      // 提取小拇指尖(20)，用来和拇指(4)测算手掌最大跨度
      const wrist=lm[0], tip=lm[8], thumb=lm[4], pinky=lm[20], now=Date.now();
      const fingers=countExtendedFingers(lm);
      
      // 💡【神级调优】：只计算 X 和 Y 的 2D 屏幕投影距离，彻底丢弃波动的 Z 轴深度数据！
      const pinchDist = Math.hypot(thumb.x - tip.x, thumb.y - tip.y);
      isPinching = (pinchDist < 0.06) && !fingers.isFist; 
      
      // 📏 计算手掌的“绝对物理跨度”（大拇指尖到小拇指尖的距离），用于连续推拉变焦
      const spanDist = Math.hypot(pinky.x - thumb.x, pinky.y - thumb.y);

      document.getElementById('st-open').textContent = Math.round(fingers.openness * 100) + '% | ' + fingers.extended + '指';
      
      if (fingers.isIndex) {
        document.getElementById('st-mode').textContent = '单食指 ☝️';
      } else if (fingers.isTwoFinger) {
        document.getElementById('st-mode').textContent = '双指 ✌️';
      } else if (fingers.isOpen) {
        document.getElementById('st-mode').textContent = '全张开 🖐️';
      } else if (fingers.isFist) {
        document.getElementById('st-mode').textContent = '握拳 ✊';
      } else {
        const fingerNames = ['握拳 ✊', '单食指 ☝️', '双指 ✌️', '三指 🤟', '全张开 🖐️'];
        document.getElementById('st-mode').textContent = fingerNames[fingers.extended] || '全张开';
      }

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
      if(window._hoverZone!=='none') window._hoverFrames++; else window._hoverFrames=0;
      updateHoverUI();

      if(window._hoverFrames > 30 && now - window._lastHoverAction > 2000){
        window._lastHoverAction = now;
        if(satActive){
          if(window._hoverZone==='left') closeSatMap();  // 需要长按2秒左边缘才关闭
        }else{
          if(window._hoverZone==='left'){ focusPlanet((focus-1+P.length)%P.length); }
          else if(window._hoverZone==='right'){ focusPlanet((focus+1)%P.length); }
        }
        window._hoverFrames=0;
      }

      if(satActive){
        // 🚀 速度驱动旋转：手掌滑动速度 = 地球旋转速度（1:1 响应，无延迟）
        if (window._lastWristX !== undefined) {
          const dx = wrist.x - window._lastWristX;
          // dx 有效时才注入速度；手停后保留上帧速度，交给卫星图动画按摩擦衰减
          if (Math.abs(dx) > 0.0005) window._satRotationVelocity = dx * 5.5;
        }
        window._lastWristX = wrist.x;

        if(fingers.isOpen){ 
          window._satTargetDistance=2.0; 
          document.getElementById('st-mode').textContent = '张手：放大近观并滑动旋转'; 
        }
        else if(fingers.isFist){ 
          window._satTargetDistance=6.5; 
          document.getElementById('st-mode').textContent = '握拳：看全轨道'; 
        }
        else { 
          window._satTargetDistance=4.0; 
          document.getElementById('st-mode').textContent = '✋ 请左右滑动拨动地球';
        }
      }else{
        if(isPinching){
          document.getElementById('st-mode').textContent = '双指捏合：追踪聚焦并开启信息卡';
          if(!window._cardActive){ window._cardActive=true; showCard(); }
        } else {
          // 🚀【神级运镜：连续无级动态推拉】通过比对上一帧的手掌跨度，获取手掌开合的“速度矢量”
          if (window._lastSpan !== undefined) {
            const dSpan = spanDist - window._lastSpan;
            
            // 设立一个极其微小的死区 (0.003)，过滤掉手掌轻微颤抖的干扰
            if (Math.abs(dSpan) > 0.003) {
              // dSpan > 0 说明手指在撑开，立刻缩减 tZoom（向内拉近放大镜头）
              // dSpan < 0 说明手指在收缩，立刻增加 tZoom（向外拉远缩小镜头）
              tZoom -= dSpan * 120.0; // 乘以 120 的阻尼系数，转化为视角的物理推拉速度
              
              // 设定物理极限防穿模：最近推到 2.5 看地表，最远退到 60 统览整个大星系
              tZoom = Math.max(2.5, Math.min(60.0, tZoom)); 
            }
          }
          window._lastSpan = spanDist; // 更新当前跨度给下一帧做差值运算

          if (fingers.isOpen) {
            document.getElementById('st-mode').textContent = '🖐️ 动态推近...';
          } else if (fingers.isFist && focus !== 3) {
            document.getElementById('st-mode').textContent = '✊ 动态拉远...';
          } else {
            document.getElementById('st-mode').textContent = '✋ 识别到单指,向对应方向停留可切换星球';
          }
          
          // 如果手一松开，立刻收起并关闭信息卡片
          
          // 如果手一松开，立刻收起并关闭信息卡片
          if(window._cardActive) {
             const c = document.getElementById('planet-card');
             c.classList.remove('show');
             window._cardActive=false;
             setTimeout(()=> { if(!window._cardActive) c.style.display='none'; }, 300);
          }
        }

        if(focus===3 && fingers.isFist && !satActive){
          if(!satOpenTimer) satOpenTimer=setTimeout(()=>{openSatMap();satOpenTimer=null;},800);
          document.getElementById('st-mode').textContent = '握拳：部署卫星网...';
        }else{ clearTimeout(satOpenTimer); satOpenTimer=null; }
        
        if((fingers.isOpen || (fingers.isFist&&focus!==3)) && Math.abs(wrist.x-0.5)>0.05) tRY=(wrist.x-0.5)*Math.PI*2.2;
      }

      handCtx.clearRect(0,0,innerWidth,innerHeight); drawHandSkeleton(lm);
      
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
window.__SOLAR__ = { scene: ssS, cam: ssCam, objs: ssObjs, planets: P, get focus(){ return focus; } };
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
    
    const lbl = planetLabels[i];
    if (lbl) {
      // 🚀【3D空间头顶对齐】：动态获取当前星球网格网格半径，将文字定位点精准提升至星球上空，绝不冲突
      const labelPos = _tmpLabel.copy(o.mesh.position);
      const radius = P[i] ? P[i].s : 1.0;
      labelPos.y += radius * 1.3 + 0.15; // 根据每颗球身大小，按比例向上推高
      
      const wp = labelPos.project(ssCam);
      const lx = (wp.x * .5 + .5) * innerWidth;
      const ly = (-wp.y * .5 + .5) * innerHeight;
      // 用 transform 定位而不是 left/top：transition 只走合成线程，不会每帧触发布局重算。
      // 9 个标签 × 7 个样式属性每帧写，在开摄像头的机器上会明显拖慢主线程 → 掉帧 → 看着像抖。
      lbl.style.transform = `translate3d(${lx.toFixed(1)}px,${ly.toFixed(1)}px,0) translate(-50%,-50%)`;

      const isFocus = (i === focus);
      if (lbl.__focus !== isFocus) {
        lbl.__focus = isFocus;
        lbl.style.fontSize = isFocus ? '20px' : '12px';
        lbl.style.fontWeight = isFocus ? '900' : '400';
        lbl.style.textShadow = isFocus
          ? `0 0 10px ${lbl.__tc}, 0 0 20px ${lbl.__tc}`
          : `0 0 4px ${lbl.__tc}80`;
      }
      // 卡片激活时隐藏标签（卡片已显示星球名，避免重叠）
      const vis = isFocus
        ? ((wp.z > 1 || window._cardActive) ? '0' : '1')
        : (wp.z > 1 ? '0' : '.55');
      if (lbl.__vis !== vis) { lbl.__vis = vis; lbl.style.opacity = vis; }
    }
  });
  const time = performance.now() * 0.0005;
  if (!camOn) {
    // 🌌 1. 非手势默认模式 — 【侧舷伴飞：终极防穿模】
    const fObj = ssObjs[focus];
    const tx = fObj.mesh.position.x, ty = fObj.mesh.position.y, tz = fObj.mesh.position.z;
    
    // 💡 核心破局点：不再从星球的正前后方看，而是将相机放在轨道“侧后方”（-1.57 弧度即 -90度）
    // 这样太阳永远在画面左/右侧发光，既能看到绝美昼夜交界线，而且往后退多远都不会撞到太阳！
    const camAngle = camAzimuth(focus, now); 
    
    // 窄屏的水平视角小得多，同样距离下球体会撑满整屏；按屏宽补偿，保证行星整体可见
    const narrowK = innerWidth < 700 ? 1.5 : 1;
    const lockDist = tZoom * 0.82 * narrowK;
    followPlanet(tx, ty, tz,
      Math.cos(camAngle) * lockDist,
      tZoom * 0.42 * narrowK,
      Math.sin(camAngle) * lockDist, 0.06);

    // 卡片跟随：贴星球左上但不遮星球 / 不挡时间流速滑条（每帧几何避让）
    if(window._cardActive){
      const wp = _tmpProj.set(tx, ty, tz).project(ssCam);
      if(wp.z > 1) layoutCard(null, null);
      else {
        const sx = (wp.x * 0.5 + 0.5) * window.innerWidth;
        const sy = (-wp.y * 0.5 + 0.5) * window.innerHeight;
        const rPx = (P[focus].s / (lockDist || 1)) * window.innerHeight * 0.5;
        layoutCard(sx, sy, rPx);
      }
    }
  } else {
    // 🌌 2. 手势控制模式
    const f = ssObjs[focus];
    const tx = f.mesh.position.x, ty = f.mesh.position.y, tz = f.mesh.position.z;
    
    if (isPinching) {
      // 🔒 状态 A：双指捏合状态
      const lockDist = (planetZoomDist[f.type] || 5.0) * 0.65; 
      const camAngle = camAzimuth(focus, now);   // 同样采用侧舷伴飞，但不再跟着公转甩镜头
      
      followPlanet(tx, ty, tz,
        Math.cos(camAngle) * lockDist,
        lockDist * 0.25,
        Math.sin(camAngle) * lockDist, 0.10);

      if(window._cardActive){
        const wp = _tmpProj.set(tx, ty, tz).project(ssCam);
        if(wp.z > 1) layoutCard(null, null);
        else {
          const sx = (wp.x * 0.5 + 0.5) * window.innerWidth;
          const sy = (-wp.y * 0.5 + 0.5) * window.innerHeight;
          const rPx = (P[focus].s / (lockDist || 1)) * window.innerHeight * 0.5;
          layoutCard(sx, sy, rPx);
        }
      }
    } else {
      // 🔓 状态 B：手势松开（解除捏合）— 平滑退回宏观大视角
      ssRY += (tRY - ssRY) * 0.09; 
      ssZoom += (tZoom - ssZoom) * 0.12;
      
      const pitchY = (focus === 0) ? ssZoom * 0.55 : ssZoom * 0.42;
      // 这里的 baseAngle 极为关键！退远时也保持侧向，保证倒车绝对安全
      const baseAngle = camAzimuth(focus, now) + ssRY;
      followPlanet(tx, ty, tz,
        Math.cos(baseAngle) * ssZoom,
        pitchY - ty,
        Math.sin(baseAngle) * ssZoom, 0.06);
    }
  }
  // 🌊 宇宙悬浮微动 — 风暴不再抖镜头，仅由红色日冕粒子表达异变（见上方日冕动画）
  // ⚠️ 微动必须发生在 lookAt 之后「再补一次 lookAt」：否则相机位置每帧都被推走、
  //    朝向却停留在上一帧的位置算出来的角度，等于让整个画面以帧率频率来回错位
  //    —— 这就是"星球看起来在剧烈抖"的根源之一。
  ssCam.position.x += Math.sin(time) * 0.005;
  ssCam.position.y += Math.cos(time * 0.8) * 0.003;
  ssCam.lookAt(window._camTarget);

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
  if (e.key === 'ArrowLeft')  { e.preventDefault(); focusPlanet((focus-1+P.length)%P.length); }
  if (e.key === 'ArrowRight') { e.preventDefault(); focusPlanet((focus+1)%P.length); }
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
