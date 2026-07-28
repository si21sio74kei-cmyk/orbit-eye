// ──────────────────────────────────────────────────────
//  数据配置 — 大尺寸确保可见，零外部贴图依赖
// ──────────────────────────────────────────────────────
// 著色器加載檢查
(function(){
  const missing=[];
  if(typeof NOISE_GLSL==='undefined') missing.push('NOISE_GLSL');
  if(typeof PLANET_VS==='undefined') missing.push('PLANET_VS');
  if(typeof SUN_FS==='undefined') missing.push('SUN_FS');
  if(missing.length>0){
    console.error('[DSM] planet_shaders.js 著色器載入失敗！缺少: '+missing.join(', '));
    console.error('[DSM] 請確認 /static/js/planet_shaders.js 存在且無語法錯誤');
    console.warn('[DSM] 將使用純色材質降級顯示星球');
  } else {
    console.log('[DSM] GPU 著色器全部載入成功 ('+Object.keys(window).filter(k=>k.endsWith('_FS')).length+' fragment shaders)');
  }
})();
// 電影級軌道 — 太陽半徑 3.50，所有行星軌道 > 6.0 絕不穿模（含日冕層）
// 公转 v = 真实轨道角速度比例（地球=1.0）  |  自转 rot = 真实自转速度（地球=1.0）
// 轨道间距按星球体积+光环计算，确保绝不穿模
const P = [
  {n:'太阳',  s:3.50,d:0,    v:0,       rot:0.00006,  t:'sun'},     // 自转 ~25天
  {n:'水星',  s:0.15,d:6.0,  v:4.152,   rot:0.000026, t:'mercury'},  // 公转 0.24年  自转 58.6天
  {n:'金星',  s:0.40,d:8.0,  v:1.626,   rot:-0.000006,t:'venus'},    // 公转 0.62年  自转 243天（逆行）
  {n:'地球',  s:0.63,d:10.0, v:1.0,     rot:0.0015,   t:'earth'},    // 公转/自转 基准
  {n:'火星',  s:0.25,d:12.0, v:0.532,   rot:0.00146,  t:'mars'},     // 公转 1.88年  自转 1.03天
  {n:'木星',  s:2.20,d:16.5, v:0.0843,  rot:0.00366,  t:'jupiter'},  // 公转 11.9年  自转 0.41天（最快）
  {n:'土星',  s:1.80,d:23.5, v:0.0339,  rot:0.00333,  t:'saturn'},   // 公转 29.5年  自转 0.45天  +光环外延4.5u
  {n:'天王星',s:0.85,d:29.5, v:0.0119,  rot:-0.00209, t:'uranus'},   // 公转 84年    自转 0.72天（逆行）
  {n:'海王星',s:0.80,d:34.0, v:0.00607, rot:0.00224,  t:'neptune'}   // 公转 165年   自转 0.67天
];
const PC={sun:0xffdd44,mercury:0xb0ada6,venus:0xe8dcc8,earth:0x3388dd,mars:0xd45a38,jupiter:0xd4b896,saturn:0xe8d5b0,uranus:0xb8d8d8,neptune:0xa0c8d8};

// 🛡️ 紋理載入器（跨域開放）
// 🚀【彻底修复】：接入全球最稳定的开源天文贴图库 (threex.planets)，提供全套高清PBR纹理
const TX = {
  sun: 'https://upload.wikimedia.org/wikipedia/commons/9/99/Map_of_the_full_sun.jpg', 
  mercury: 'https://cdn.jsdelivr.net/gh/jeromeetienne/threex.planets@master/images/mercurymap.jpg',
  venus: 'https://cdn.jsdelivr.net/gh/jeromeetienne/threex.planets@master/images/venusmap.jpg',
  earth: 'https://cdn.jsdelivr.net/gh/jeromeetienne/threex.planets@master/images/earthmap1k.jpg',
  mars: 'https://cdn.jsdelivr.net/gh/jeromeetienne/threex.planets@master/images/marsmap1k.jpg',
  jupiter: 'https://cdn.jsdelivr.net/gh/jeromeetienne/threex.planets@master/images/jupitermap.jpg',
  saturn: 'https://cdn.jsdelivr.net/gh/jeromeetienne/threex.planets@master/images/saturnmap.jpg',
  uranus: 'https://cdn.jsdelivr.net/gh/jeromeetienne/threex.planets@master/images/uranusmap.jpg',
  neptune: 'https://cdn.jsdelivr.net/gh/jeromeetienne/threex.planets@master/images/neptunemap.jpg',
  moon: 'https://cdn.jsdelivr.net/gh/jeromeetienne/threex.planets@master/images/moonmap1k.jpg',
};
const texLoader = new THREE.TextureLoader();
texLoader.setCrossOrigin('anonymous');

// ──────────────────────────────────────────────────────
//  Three.js 场景初始化 (电影级 3D 光影)
// ──────────────────────────────────────────────────────
const cv=document.getElementById('ss-canvas'), handCanvas=document.getElementById('hand-overlay'), handCtx=handCanvas.getContext('2d');
const ssS=new THREE.Scene(), ssCam=new THREE.PerspectiveCamera(55,innerWidth/innerHeight,.1,500); ssCam.position.set(0,12,20);
const ssRn=new THREE.WebGLRenderer({canvas:cv,antialias:true,alpha:true});
ssRn.setSize(innerWidth,innerHeight); ssRn.setPixelRatio(Math.min(devicePixelRatio,1.5));
ssRn.shadowMap.enabled = true;
ssRn.shadowMap.type = THREE.PCFSoftShadowMap;
ssRn.outputEncoding = THREE.sRGBEncoding;
ssRn.toneMapping = THREE.ACESFilmicToneMapping;
// 💡 降低全局曝光，避免高光区泛白
ssRn.toneMappingExposure = 1.1; 
// 💡 提亮宇宙暗部的环境光，让星球背对太阳的那一面也能看清地貌质感
ssS.add(new THREE.AmbientLight(0x334466, 0.8)); 
// 💡 致命修复：把 30.0 的光强改为正常的 2.0，解除“强光闪瞎贴图”的现象
const sunLight = new THREE.PointLight(0xffffff, 2.0, 5000);
sunLight.castShadow = true;
sunLight.shadow.mapSize.width = 2048;
sunLight.shadow.mapSize.height = 2048;
sunLight.shadow.bias = -0.0001;
ssS.add(sunLight);
ssS.add(new THREE.HemisphereLight(0x8899cc, 0x112244, 0.30));

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
const sunLightPos = new THREE.Vector3(0, 0, 0);

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
        mat = new THREE.MeshStandardMaterial({color: PC[p.t], roughness: 0.85, metalness: 0.05});
        if (TX[p.t]) {
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

  const mesh = new THREE.Mesh(geo, mat);
  ssS.add(mesh);  // ← 致命修復：把行星加入場景！
  if (i > 0) { mesh.castShadow = true; mesh.receiveShadow = true; }

  // ☁️ 地球雲層球殼
  if (p.t === 'earth') {
    const cloudGeo = new THREE.SphereGeometry(p.s*1.01, 64, 64);
    const cloudMat = new THREE.MeshStandardMaterial({color:0xffffff, roughness:1.0, metalness:0.0, transparent:true, opacity:0.30, depthWrite:false});
    const cloudMesh = new THREE.Mesh(cloudGeo, cloudMat);
    mesh.add(cloudMesh);
    mesh.userData.clouds = cloudMesh;
  }

  // ☀️ 日冕光晕 — 双层（配合新太阳尺寸 0.65）
  if (i === 0) {
    const gGeoInner = new THREE.SphereGeometry(p.s*1.22, 96, 96);
    const gMatInner = new THREE.ShaderMaterial({
      uniforms: {c: {value: new THREE.Color(0xffffff)}, p: {value: 3.2}},
      vertexShader: 'varying vec3 vN; void main(){vN=normalize(normalMatrix*normal); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: 'uniform vec3 c; uniform float p; varying vec3 vN; void main(){float i=pow(1.0-max(0.0,dot(vN,vec3(0,0,1))),p); gl_FragColor=vec4(c,i*0.5);}',
      side: THREE.BackSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false
    });
    mesh.add(new THREE.Mesh(gGeoInner, gMatInner));
    const gGeoOuter = new THREE.SphereGeometry(p.s*1.55, 96, 96);
    const gMatOuter = new THREE.ShaderMaterial({
      uniforms: {c: {value: new THREE.Color(0xff8833)}, p: {value: 1.6}},
      vertexShader: 'varying vec3 vN; void main(){vN=normalize(normalMatrix*normal); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: 'uniform vec3 c; uniform float p; varying vec3 vN; void main(){float i=pow(1.0-max(0.0,dot(vN,vec3(0,0,1))),p); gl_FragColor=vec4(c,i*0.6);}',
      side: THREE.BackSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false
    });
    mesh.add(new THREE.Mesh(gGeoOuter, gMatOuter));
  }

  // 🌍 地球大气光晕
  if (p.t === 'earth') {
    const aGeo = new THREE.SphereGeometry(p.s*1.08, 64, 64);
    const aMat = new THREE.ShaderMaterial({
      uniforms: {c: {value: new THREE.Color(0x4499ff)}, p: {value: 4.0}},
      vertexShader: 'varying vec3 vN; void main(){vN=normalize(normalMatrix*normal); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: 'uniform vec3 c; uniform float p; varying vec3 vN; void main(){float i=pow(1.0-max(0.0,dot(vN,vec3(0,0,1))),p); gl_FragColor=vec4(c,i*0.28);}',
      side: THREE.FrontSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false
    });
    mesh.add(new THREE.Mesh(aGeo, aMat));
  }

  // 🌫️ 菲涅尔大气边缘光 — 金星 + 气态巨行星
  const fc = {venus:'#f5ead5', jupiter:'#ddbb88', saturn:'#eedd99', uranus:'#c8e8e0', neptune:'#b0d8e0'};
  if (fc[p.t]) {
    const fGeo = new THREE.SphereGeometry(p.s*1.03, 64, 64);
    const fMat = new THREE.ShaderMaterial({
      uniforms: {c: {value: new THREE.Color(fc[p.t])}, p: {value: 3.5}},
      vertexShader: 'varying vec3 vN; void main(){vN=normalize(normalMatrix*normal); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: 'uniform vec3 c; uniform float p; varying vec3 vN; void main(){float i=pow(1.0-max(0.0,dot(vN,vec3(0,0,1))),p); gl_FragColor=vec4(c,i*0.18);}',
      side: THREE.BackSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false
    });
    mesh.add(new THREE.Mesh(fGeo, fMat));
  }

  // 🔭 木星伽利略四大衛星 — Io, Europa, Ganymede, Callisto
  if (p.t === 'jupiter') {
    const galileanMoons = [
      {name:'Io',       color:0xffdd66, size:.16, dist:1.80, speed:2.4},
      {name:'Europa',   color:0xeeddcc, size:.15, dist:2.20, speed:1.8},
      {name:'Ganymede', color:0x999999, size:.22, dist:2.70, speed:1.3},
      {name:'Callisto', color:0x555555, size:.20, dist:3.20, speed:0.9}
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
      fragmentShader: RING_FS,
      side: THREE.DoubleSide, transparent: true, depthWrite: false
    });
    const ring = new THREE.Mesh(rGeo, rMat);
    ring.rotation.x = Math.PI / 2.2;
    mesh.add(ring);
    ssObjs._ringMat = rMat;
  }

  // 轨道环
  if (i > 0) {
    const orb = new THREE.Mesh(
      new THREE.TorusGeometry(p.d, .004, 12, 256),
      new THREE.MeshBasicMaterial({color: 0x556688, transparent: true, opacity: .35})
    );
    orb.rotation.x = Math.PI / 2;
    ssS.add(orb);
  }

  ssObjs.push({mesh, dist:p.d, speed:p.v, angle:Math.random()*Math.PI*2, name:p.n, type:p.t});
});

// ☄️ 小行星帶 — 火星(d=2.80) 與木星(d=4.20) 之間
const astGeo = new THREE.BufferGeometry();
const astCount = 12288, astPosArr = new Float32Array(astCount * 3), astColArr = new Float32Array(astCount * 3);
for (let i = 0; i < astCount; i++) {
  const angle = Math.random() * Math.PI * 2;
  const radius = 12.0 + Math.random() * 3.0;
  const y = (Math.random() - 0.5) * 0.80;
  astPosArr[i*3] = Math.cos(angle) * radius;
  astPosArr[i*3+1] = y;
  astPosArr[i*3+2] = Math.sin(angle) * radius;
  const brightness = 0.35 + Math.random() * 0.45;
  astColArr[i*3] = brightness; astColArr[i*3+1] = brightness * 0.85; astColArr[i*3+2] = brightness * 0.7;
}
astGeo.setAttribute('position', new THREE.BufferAttribute(astPosArr, 3));
astGeo.setAttribute('color', new THREE.BufferAttribute(astColArr, 3));
const astMat = new THREE.PointsMaterial({size: 0.03, vertexColors: true, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false});
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

// ☀️ 太陽日冕粒子場（太陽半徑 3.50）
const coronaGeo = new THREE.BufferGeometry();
const coronaCount = 1500, coronaPosArr = new Float32Array(coronaCount * 3);
for (let i = 0; i < coronaCount; i++) {
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos(2 * Math.random() - 1);
  const r = 3.50 * (1.02 + Math.random() * 0.18);
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
  lbl.style.cssText = 'position:absolute;font-family:var(--title);font-size:13px;letter-spacing:2px;transform:translate(-50%,-50%);transition:opacity .3s;white-space:nowrap;';
  lbl.textContent = o.name;
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
    fragmentShader: 'uniform vec3 c; uniform float p; varying vec3 vN; void main(){float i=pow(1.0-max(0.0,dot(vN,vec3(0,0,1))),p); gl_FragColor=vec4(c,i*0.18);}',
    side: THREE.BackSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false
  });
  const moonGlow = new THREE.Mesh(moonGlowGeo, moonGlowMat);
  earthObj.moon.add(moonGlow);
}

// ──────────────────────────────────────────────────────
//  逻辑控制与交互增强
// ──────────────────────────────────────────────────────
let focus=0,speed=1,tRY=0,tZoom=16,ssRY=0,ssZoom=16,isPinching=false;
let camOn=false,camStream=null,hands=null,trail=[],satActive=false,satData=null,satOpenTimer=null;
let fpsCount=0,fpsStart=performance.now();
window._hoverFrames=0; window._hoverZone='none'; window._lastHoverAction=0; window._cardActive=false;
window._satTargetDistance=3.5; window._satCurrentDistance=3.5;
window._satTargetRotationY=0; window._satCurrentRotationY=0;
window._camTarget = new THREE.Vector3(0,0,0);

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
}

function pointToScreen(pt){ return {x: pt.x*innerWidth, y: pt.y*innerHeight}; }

function drawHandSkeleton(landmarks){
  handCtx.save(); handCtx.strokeStyle='rgba(56,189,248,0.55)'; handCtx.lineWidth=2;
  const conns=[[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[0,17],[17,18],[18,19],[19,20]];
  conns.forEach(([a,b])=>{ const p1=pointToScreen(landmarks[a]), p2=pointToScreen(landmarks[b]); handCtx.beginPath(); handCtx.moveTo(p1.x,p1.y); handCtx.lineTo(p2.x,p2.y); handCtx.stroke(); });
  landmarks.forEach((lm,i)=>{ const p=pointToScreen(lm); handCtx.fillStyle=(i===4||i===8||i===12)?'#34d399':'#38bdf8'; handCtx.beginPath(); handCtx.arc(p.x,p.y,3,0,Math.PI*2); handCtx.fill(); });
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

function showCard(){
  const p=P[focus], c=document.getElementById('planet-card'), tc='#'+PC[p.t].toString(16).padStart(6,'0');
  c.innerHTML=`<div style="font-weight:900;color:${tc};font-size:24px;text-shadow:0 0 12px ${tc};">${p.n}</div>
    <div style="color:#94a3b8;margin-top:14px;position:relative;">
      <span style="display:inline-block;background:linear-gradient(90deg,transparent,rgba(56,189,248,.15),transparent);background-size:200% 100%;animation:shimmer 1.5s infinite;padding:8px 0;width:100%;">⚡ 正在建立星际数据链路...</span>
    </div>`;
  c.style.display='block'; c.style.borderColor=tc+'60'; c.style.boxShadow=`0 24px 64px rgba(0,0,0,.9),0 0 32px ${tc}30`;
  c.classList.add('show');

  const baseUrl = (location.protocol==='file:') ? 'http://127.0.0.1:5500' : '';
  (async () => {
    try{
      const resp = await fetch(`${baseUrl}/api/space/planet-info?planet=${encodeURIComponent(p.n)}`);
      const data = await resp.json();
      c.innerHTML=`<div style="font-weight:900;color:${tc};font-size:24px;text-shadow:0 0 12px ${tc};">${data.planet}</div>
        <div style="color:#e2e8f0;margin-top:12px;line-height:1.8;">${data.info}</div>
        <div style="color:rgba(148,163,184,.45);margin-top:14px;font-size:9px;letter-spacing:1px;text-align:right;">[DATA SOURCE: ${data.source}]</div>`;
    }catch(e){
      c.innerHTML=`<div style="font-weight:900;color:${tc};font-size:24px;text-shadow:0 0 12px ${tc};">${p.n}</div>
        <div style="color:#f87171;margin-top:14px;">⚠️ 星际数据链路中断<br><span style="font-size:11px;color:#94a3b8;">无法连接到深空观测站服务器</span></div>`;
    }
  })();
}

function triggerAlert(msg){ const a=document.getElementById('swipe-alert'); a.textContent=msg; a.classList.add('show'); setTimeout(()=>a.classList.remove('show'),800); }

// ──────────────────────────────────────────────────────
//  AI 摄像头识别中枢
// ──────────────────────────────────────────────────────
async function initCam(){
  const btn=document.getElementById('btn-cam');
  if(camOn){
    camOn=false; camStream.getTracks().forEach(t=>t.stop());
    document.getElementById('webcam-pip').srcObject=null; document.getElementById('hand-overlay').style.display='none';
    document.getElementById('st-cam').textContent='关闭'; btn.textContent='📷 启动摄像头'; return;
  }
  btn.textContent='加载中...';
  // 🛡️ 安全上下文检查
  if (location.protocol === 'file:') { btn.textContent='⚠️ 请用 http://127.0.0.1:5500/solar 访问'; setTimeout(()=>{btn.textContent='📷 启动摄像头';},3500); return; }
  // 🛡️ SDK 加载检查
  if (typeof Hands === 'undefined') { btn.textContent='⚠️ AI模型加载失败，请刷新页面'; setTimeout(()=>{btn.textContent='📷 启动摄像头';},3500); return; }
  try {
    camStream=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:640},height:{ideal:480},facingMode:'user'}});
    const v=document.getElementById('webcam-pip'); v.srcObject=camStream;
    await new Promise(r=>{v.onloadedmetadata=r;if(v.readyState>=1)r();}); await v.play();
    camOn=true; btn.textContent='📷 关闭摄像头'; document.getElementById('hand-overlay').style.display='block';
    
    hands=new Hands({locateFile:f=>'https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1646424915/'+f});
    hands.setOptions({maxNumHands:1,modelComplexity:1,minDetectionConfidence:0.5,minTrackingConfidence:0.5});

    hands.onResults(r => {
      const lm=r.multiHandLandmarks?.[0];
      if(!lm){
        window._hoverZone='none'; window._hoverFrames=0; updateHoverUI();
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
          // 直接累积旋转速度：dx 大→转得快，dx 小→转得慢，手停→靠摩擦自然减速
          window._satRotationVelocity = dx * 5.5;
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
      if(!camOn) return;
      if(v && v.readyState >= 2) try{ await hands.send({image:v}); }catch(e){ console.error('MediaPipe send error:', e); }
      setTimeout(()=>requestAnimationFrame(cameraPumpLoop),33);
    }
    cameraPumpLoop();
  } catch(e) { console.error(e); btn.textContent='📷 启动失败，请允许权限'; setTimeout(()=>{btn.textContent='📷 启动摄像头';},3500); }
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
    const tleLabel = isRealTLE ? '🟢 CelesTrak 实时轨道' : '🟡 本地数学模拟';
    const tleColor = isRealTLE ? '#00ff44' : '#fbbf24';
    const isLiveSat = satData._source === 'celestrak';
    const satSrcLabel = isLiveSat ? '🟢 实时推定' : '🟡 离线参考';
    let listHTML = '<div style=\"color:var(--good);margin-bottom:6px;font-size:10px;\">🛰 在轨总数: <b>'+satData.total+'</b> 颗</div>';
    if (satData.total_source) listHTML += '<div style=\"font-size:8px;color:var(--dim);margin-bottom:2px;\">'+satData.total_source+'</div>';
    listHTML += '<div style=\"color:'+tleColor+';margin-bottom:4px;font-size:10px;\">'+tleLabel+': <b>'+tleData.sats.length+'</b> 颗 (3D渲染)</div>';
    listHTML += '<div style=\"font-size:8px;color:var(--dim);margin-bottom:4px;\">(CelesTrak 拉取 '+satData.groups_fetched+' 组, 每2小时刷新)</div>';
    listHTML += '<div style=\"border-top:1px solid var(--border);margin:8px 0;\"></div>';
    listHTML += '<div style=\"font-size:8px;color:var(--label);margin-bottom:6px;\">📊 各国卫星分布 '+satSrcLabel+'</div>';
    if (satData.countries_source) listHTML += '<div style=\"font-size:7px;color:var(--dim);margin-bottom:4px;\">'+satData.countries_source+'</div>';
    const flagMap = {US:'🇺🇸',CN:'🇨🇳',RU:'🇷🇺',GB:'🇬🇧',JP:'🇯🇵',IN:'🇮🇳',EU:'🇪🇺',CA:'🇨🇦',KR:'🇰🇷',FR:'🇫🇷',DE:'🇩🇪',BR:'🇧🇷',AU:'🇦🇺',AE:'🇦🇪',IL:'🇮🇱',AR:'🇦🇷',TW:'🇹🇼',OT:'🌐'};
    const totalCount = satData.countries.reduce((sum,c) => sum + (c.count||0), 0) || 1;
    satData.countries.forEach(c => {
      const pct = ((c.count / totalCount) * 100).toFixed(1);
      listHTML += '<div style=\"display:flex;justify-content:space-between;font-size:9px;padding:2px 4px;color:#cbd5e1;\"><span>'+(flagMap[c.code]||'•')+' '+c.name+'</span><span style=\"color:var(--primary);\">'+c.count.toLocaleString()+' <span style=\"font-size:7px;color:var(--dim);\">('+pct+'%)</span></span></div>';
    });
    document.getElementById('sat-list').innerHTML = listHTML;
    
    // 🚀【核心修复2】：拿到API后，直接解析出卫星轨道模型，无缝塞入现有渲染器！
    if(tleData.sats && tleData.sats.length > 0 && satActive) {
      const newSats = [];
      tleData.sats.forEach(s=>{
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
    if(satActive) document.getElementById('sat-list').innerHTML='<span style=\"color:var(--warn);\">📡 离线模式 — CelesTrak API 不可用，显示本地模拟</span>';
  }
}

function renderSatGlobe(){
  const ct=document.getElementById('sat-globe'); ct.innerHTML=''; const W=ct.clientWidth||400, H=ct.clientHeight||400;
  const sc=new THREE.Scene(), cam=new THREE.PerspectiveCamera(45,W/H,.1,100); cam.position.set(0,.5,3.5);
  const rn=new THREE.WebGLRenderer({antialias:true,alpha:true}); rn.setSize(W,H); ct.appendChild(rn.domElement);

  const earth=new THREE.Mesh(
    new THREE.SphereGeometry(0.85,64,64),
    new THREE.MeshPhongMaterial({color:0x2244aa, specular:0x112244, shininess:15})
  ); sc.add(earth);
  texLoader.load(TX.earth, tex => { tex.encoding = THREE.sRGBEncoding; earth.material.map = tex; earth.material.color.set(0xffffff); earth.material.needsUpdate = true; });
  sc.add(new THREE.AmbientLight(0x334466,2.8)); const sl=new THREE.DirectionalLight(0xffffff,2.2); sl.position.set(5,1,3); sc.add(sl);

  const glowGeo = new THREE.SphereGeometry(0.90, 48, 48);
  const glowMat = new THREE.ShaderMaterial({
    uniforms:{c:{value:new THREE.Color(0x4488ff)},p:{value:3.0}},
    vertexShader:'varying vec3 vN;void main(){vN=normalize(normalMatrix*normal);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader:'uniform vec3 c;uniform float p;varying vec3 vN;void main(){float i=pow(1.0-max(0.0,dot(vN,vec3(0,0,1))),p);gl_FragColor=vec4(c,i*0.35);}',
    side:THREE.FrontSide,blending:THREE.AdditiveBlending,transparent:true,depthWrite:false
  });
  sc.add(new THREE.Mesh(glowGeo,glowMat));

  [0.92, 2.0, 5.6].forEach(r => {
    const orbGeo = new THREE.TorusGeometry(r, 0.003, 8, 128);
    const orbMat = new THREE.MeshBasicMaterial({color:0x338855, transparent:true, opacity:0.4});
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

  const satMatCore=new THREE.PointsMaterial({size:0.025,color:0x44ff88,transparent:true,opacity:0.95,blending:THREE.AdditiveBlending,depthWrite:false});
  const satMatMid=new THREE.PointsMaterial({size:0.050,color:0x22cc66,transparent:true,opacity:0.55,blending:THREE.AdditiveBlending,depthWrite:false});
  const satMatOuter=new THREE.PointsMaterial({size:0.080,color:0x00ff44,transparent:true,opacity:0.25,blending:THREE.AdditiveBlending,depthWrite:false});
  
  const pCore = new THREE.Points(satGeo, satMatCore);
  const pMid = new THREE.Points(satGeo, satMatMid);
  const pOuter = new THREE.Points(satGeo, satMatOuter);
  sc.add(pCore); sc.add(pMid); sc.add(pOuter);

  let animId = null;
  window._satTargetDistance=4.0; window._satCurrentDistance=4.0; window._satRotationVelocity=0; window._satCurrentRotationY=0;
  function anim(){
    if(!satActive){ cancelAnimationFrame(animId); return; }
    animId = requestAnimationFrame(anim);
    window._satCurrentDistance += (window._satTargetDistance - window._satCurrentDistance)*0.08;

    // 🚀 速度驱动旋转：手速 = 球速，摩擦自然减速（手停→球逐渐停）
    window._satCurrentRotationY += window._satRotationVelocity;
    window._satRotationVelocity *= 0.94;  // 每帧保留94%，手停后自然滑行
    cam.position.set(Math.sin(window._satCurrentRotationY)*window._satCurrentDistance, 0.5, Math.cos(window._satCurrentRotationY)*window._satCurrentDistance);
    cam.lookAt(0,0,0);

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
(function anim(){
  requestAnimationFrame(anim);
  ssObjs[0].mesh.rotation.y += P[0].rot * speed;

  // 更新 GPU shader uniforms
  const now = performance.now() * 0.001;
  sunLightPos.copy(ssObjs[0].mesh.position);
  ssObjs.forEach(o => {
    if (o.uniforms) {
      o.uniforms.uTime.value = now;
      o.uniforms.uLightPos.value.copy(sunLightPos);
    }
  });
  if (ssObjs._ringMat) ssObjs._ringMat.uniforms.uTime.value = now;

  // ☄️ 小行星帶緩慢旋轉
  if (asteroidBelt) asteroidBelt.rotation.y += 0.00015 * speed;

  // ☀️ 日冕粒子沸騰動畫
  if (ssObjs[0]._corona) {
    const cp = ssObjs[0]._corona;
    if (window._isStormActive) {
      // ☢️ 电磁暴激活：疯狂旋转 + 血红粒子 + 剧烈抖动
      cp.rotation.y += 0.04 * speed;
      cp.rotation.x += 0.015 * speed;
      cp.material.color.setHex(0xff1111);
      cp.material.opacity = 0.5 + Math.sin(now * 5.0) * 0.35;
      cp.material.size = 0.02 + Math.sin(now * 5.7) * 0.018;
    } else {
      // 🌿 空间天气平静：温和沸腾呼吸
      cp.rotation.y += 0.008 * speed;
      cp.rotation.x += 0.003 * speed;
      cp.material.color.setHex(0xffaa44);
      cp.material.opacity = 0.4 + Math.sin(now * 1.7) * 0.15;
      cp.material.size = 0.02 + Math.sin(now * 2.3) * 0.008;
    }
  }

  ssObjs.forEach((o, i) => {
    if (i > 0) {
      o.angle += o.speed * .0208 * speed;
      o.mesh.position.x = Math.cos(o.angle) * o.dist;
      o.mesh.position.z = Math.sin(o.angle) * o.dist;
    }
    o.mesh.rotation.y += (P[i] ? P[i].rot : 0.0015) * speed;

    // ☁️ 地球雲層獨立旋轉（比本體稍快）
    if (o.mesh.userData && o.mesh.userData.clouds) {
      o.mesh.userData.clouds.rotation.y += 0.0022 * speed;  // 云层比地表快 ~1.5×
    }

    // 🌙 月球繞地球運行
    if (o.moon) {
      const moonAngle = now * 2.5;
      o.moon.position.set(
        o.mesh.position.x + Math.cos(moonAngle) * 0.95,
        o.mesh.position.y + Math.sin(moonAngle * 0.7) * 0.22,
        o.mesh.position.z + Math.sin(moonAngle) * 0.95
      );
    }

    // 🔭 木星伽利略衛星運行
    if (o.mesh.userData && o.mesh.userData.moons) {
      o.mesh.userData.moons.forEach(m => {
        m.angle += m.speed * 0.012 * speed;
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
      const labelPos = o.mesh.position.clone();
      const radius = P[i] ? P[i].s : 1.0;
      labelPos.y += radius * 1.3 + 0.15; // 根据每颗球身大小，按比例向上推高
      
      const wp = labelPos.project(ssCam);
      lbl.style.left = (wp.x * .5 + .5) * innerWidth + 'px';
      lbl.style.top = (-wp.y * .5 + .5) * innerHeight + 'px';
      
      const tc = '#' + PC[o.type].toString(16).padStart(6, '0');
      lbl.style.color = tc; // 彻底停用白字，全面采用契合星球色调的专属本色
      
      if (i === focus) {
        // 卡片激活时隐藏标签（卡片已显示星球名，避免重叠）
        const cardActive = window._cardActive && !(wp.z > 1);
        lbl.style.opacity = (wp.z > 1 || cardActive) ? '0' : '1';
        lbl.style.fontSize = '20px';
        lbl.style.fontWeight = '900';
        lbl.style.textShadow = `0 0 10px ${tc}, 0 0 20px ${tc}`; // 高级星际霓虹霓虹发光
      } else {
        lbl.style.opacity = wp.z > 1 ? '0' : '.55';
        lbl.style.fontSize = '12px';
        lbl.style.fontWeight = '400';
        lbl.style.textShadow = `0 0 4px ${tc}80`;
      }
    }
  });
  const time = performance.now() * 0.0005;
  if (!camOn) {
    // 🌌 1. 非手势默认模式 — 【侧舷伴飞：终极防穿模】
    const fObj = ssObjs[focus];
    const tx = fObj.mesh.position.x, ty = fObj.mesh.position.y, tz = fObj.mesh.position.z;
    
    // 💡 核心破局点：不再从星球的正前后方看，而是将相机放在轨道“侧后方”（-1.57 弧度即 -90度）
    // 这样太阳永远在画面左/右侧发光，既能看到绝美昼夜交界线，而且往后退多远都不会撞到太阳！
    const camAngle = (focus === 0) ? (now * 0.02) : (fObj.angle - 1.57); 
    
    const lockDist = tZoom * 0.82;
    const targetX = tx + Math.cos(camAngle) * lockDist;
    const targetZ = tz + Math.sin(camAngle) * lockDist;
    const targetY = ty + tZoom * 0.42; 

    ssCam.position.lerp(new THREE.Vector3(targetX, targetY, targetZ), 0.04); 
    window._camTarget.lerp(new THREE.Vector3(tx, ty, tz), 0.05); 
    ssCam.lookAt(window._camTarget);
  } else {
    // 🌌 2. 手势控制模式
    const f = ssObjs[focus];
    const tx = f.mesh.position.x, ty = f.mesh.position.y, tz = f.mesh.position.z;
    
    if (isPinching) {
      // 🔒 状态 A：双指捏合状态
      const lockDist = (planetZoomDist[f.type] || 5.0) * 0.65; 
      const camAngle = (focus === 0) ? 0.5 : (f.angle - 1.57); // 同样采用侧舷伴飞
      
      const targetX = tx + Math.cos(camAngle) * lockDist;
      const targetZ = tz + Math.sin(camAngle) * lockDist;
      const targetY = ty + lockDist * 0.25; 
      
      ssCam.position.lerp(new THREE.Vector3(targetX, targetY, targetZ), 0.08);
      window._camTarget.lerp(new THREE.Vector3(tx, ty, tz), 0.1); 
      ssCam.lookAt(window._camTarget);

      const card = document.getElementById('planet-card');
      if (card && window._cardActive) {
        const wp = new THREE.Vector3(tx, ty, tz).project(ssCam);
        if (wp.z > 1) {
          card.style.left = '-9999px'; // 镜头摇摄时安全隐藏
        } else {
          const screenX = (wp.x * 0.5 + 0.5) * window.innerWidth;
          const screenY = (-wp.y * 0.5 + 0.5) * window.innerHeight;
          card.style.position = 'fixed';
          
          const realSize = P[focus].s;
          const planetRadiusOffset = (realSize / lockDist) * window.innerWidth * 0.3;
          card.style.left = (screenX - 360 - planetRadiusOffset) + 'px';
          card.style.top  = (screenY - 180 - planetRadiusOffset) + 'px';  
        }
      }
    } else {
      // 🔓 状态 B：手势松开（解除捏合）— 平滑退回宏观大视角
      ssRY += (tRY - ssRY) * 0.09; 
      ssZoom += (tZoom - ssZoom) * 0.12;
      
      const pitchY = (focus === 0) ? ssZoom * 0.55 : ssZoom * 0.42;
      // 这里的 baseAngle 极为关键！退远时也保持侧向，保证倒车绝对安全
      const baseAngle = (focus === 0) ? 0 : (f.angle - 1.57); 
      const targetX = tx + Math.cos(baseAngle + ssRY) * ssZoom;
      const targetZ = tz + Math.sin(baseAngle + ssRY) * ssZoom;
      
      ssCam.position.lerp(new THREE.Vector3(targetX, pitchY, targetZ), 0.05); 
      window._camTarget.lerp(new THREE.Vector3(tx, ty, tz), 0.05); 
      ssCam.lookAt(window._camTarget);
    }
  }
  // 🌊 宇宙悬浮微动 — 平静：微弱漂流 / 风暴：电磁震颤 + 画布Glitch
  if (window._isStormActive) {
    // ☢️ 相机高频电磁震颤抖动（每轴 ±0.03，有故障感但不脱离视野）
    ssCam.position.x += (Math.sin(time) * 0.005) + (Math.random() - 0.5) * 0.06;
    ssCam.position.y += (Math.cos(time * 0.8) * 0.003) + (Math.random() - 0.5) * 0.06;
    ssCam.position.z += (Math.random() - 0.5) * 0.04;
    // 高能宇宙射线穿帮色调：15% 的帧触发
    cv.style.filter = Math.random() < 0.15
      ? 'hue-rotate(90deg) contrast(1.4) brightness(1.2) saturate(2.5)'
      : 'none';
  } else {
    // 🌿 平静太空：恢复温和慢速漂流
    ssCam.position.x += Math.sin(time) * 0.005;
    ssCam.position.y += Math.cos(time * 0.8) * 0.003;
    cv.style.filter = 'none';
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

  ssRn.render(ssS,ssCam);
})();

window.addEventListener('resize',()=>{ssCam.aspect=innerWidth/innerHeight;ssCam.updateProjectionMatrix();ssRn.setSize(innerWidth,innerHeight);handCanvas.width=innerWidth;handCanvas.height=innerHeight;});
document.getElementById('btn-cam').onclick=initCam;
document.getElementById('btn-rst').onclick=()=>{focusPlanet(0);ssRY=0;ssZoom=16;window._camTarget.set(0,0,0)};
document.getElementById('speed-slider').oninput=e=>{speed=parseFloat(e.target.value);document.getElementById('speed-label').textContent=speed.toFixed(1)+'x'};
// ⌨️ 键盤快捷鍵
document.addEventListener('keydown', e => {
  if (satActive) return;
  if (e.key === 'ArrowLeft')  { e.preventDefault(); focusPlanet((focus-1+P.length)%P.length); }
  if (e.key === 'ArrowRight') { e.preventDefault(); focusPlanet((focus+1)%P.length); }
  if (e.key === '+' || e.key === '=') { speed = Math.min(5, speed + 0.2); document.getElementById('speed-label').textContent = speed.toFixed(1)+'x'; }
  if (e.key === '-') { speed = Math.max(0.1, speed - 0.2); document.getElementById('speed-label').textContent = speed.toFixed(1)+'x'; }
  if (e.key === '0') { focusPlanet(4); }  // 地球
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
