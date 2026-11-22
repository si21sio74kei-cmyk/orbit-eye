/* ══════════════════════════════════════════════════════════════
   DSM DEEP-SPACE v1.0 — 程序化 3D 深空天体
   ─────────────────────────────────────────────────────────────
   · 黑洞：广义相对论光线偏折（Schwarzschild 测地线近似）raymarch，
          含事件视界阴影、光子环、多普勒增亮、引力透镜把盘的后侧
          弯到阴影上方 / 下方 —— 即 Gargantua 那样的形态。
   · 创生之柱：约 10 万程序化尘埃粒子塑形 + 上升气流粒子，
          可被真实相机绕看 / 旋转，不再是平面贴图。
   ─────────────────────────────────────────────────────────────
   编码约定：两套渲染都在 ShaderMaterial 内自行做 ACES + sRGB，
   因此颜色与场景里走同一色调映射的行星一致。
   ══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (typeof THREE === 'undefined') { console.warn('[DSMDEEP] THREE 未加载'); return; }

  // ── 共用 GLSL：ACES + sRGB ────────────────────────────────
  const TONE_GLSL = `
vec3 acesFilm(vec3 x){
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}
vec3 toDisplay(vec3 c, float exposure){
  return pow(acesFilm(c * exposure), vec3(0.4545));
}
float sat(float x){ return clamp(x, 0.0, 1.0); }
`;

  // ═══════════════════════════════════════════════════════════
  //  1. 黑洞
  // ═══════════════════════════════════════════════════════════
  const BH_VS = `
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

  // ⚠️ TONE_GLSL 必须拼进来：片元着色器末尾要调 toDisplay()，
  //    漏拼会让整个 program 编译失败（表现是黑屏 + "Fragment shader is not compiled"）。
  const BH_FS = TONE_GLSL + `
precision highp float;
varying vec2 vUv;

uniform float uTime;
uniform float uPush;      // 0..1 握拳推近
uniform float uYaw;       // 手转拳 → 绕黑洞转视角
uniform float uPitch;
uniform float uDist;      // 虚拟相机距离（视界半径 = 1）
uniform float uOpacity;
uniform float uAspect;
uniform vec2  uRes;

const float R_HOR = 1.0;    // 事件视界
const float R_IN  = 2.30;   // 吸积盘内缘（ISCO 量级）
const float R_OUT = 8.60;   // 外缘

// ── hash / noise ──
float h21(vec2 p){
  p = fract(p * vec2(443.8975, 397.2973));
  p += dot(p, p.yx + 19.19);
  return fract((p.x + p.y) * p.x);
}
float h31(vec3 p){
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}
float n31(vec3 p){
  vec3 i = floor(p), f = fract(p);
  // ⚠️ 用 quintic（6f⁵-15f⁴+10f³）而不是 smoothstep 的 3f²-2f³：
  //    单层噪声被 pow 拉成细丝时，cubic 插值的格子边界会显影成一片网格点阵。
  //    quintic 二阶连续，几乎看不到格子；成本只多两次乘。
  f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = mix(h31(i + vec3(0.0,0.0,0.0)), h31(i + vec3(1.0,0.0,0.0)), f.x);
  float b = mix(h31(i + vec3(0.0,1.0,0.0)), h31(i + vec3(1.0,1.0,0.0)), f.x);
  float c = mix(h31(i + vec3(0.0,0.0,1.0)), h31(i + vec3(1.0,0.0,1.0)), f.x);
  float d = mix(h31(i + vec3(0.0,1.0,1.0)), h31(i + vec3(1.0,1.0,1.0)), f.x);
  return mix(mix(a, b, f.y), mix(c, d, f.y), f.z);
}
// 3 octave 就够：离屏逐像素积分，盘面每像素最多穿越一两次，
// 多一个 octave 就是全屏多 8 次 hash，帧率换不来可辨的细节。
float fbm(vec3 p){
  float v = 0.0, a = 0.55;
  for (int i = 0; i < 3; i++){ v += a * n31(p); p *= 2.11; a *= 0.5; }
  return v;
}

// ── 背景星空：三层不同密度的球面格点 ──
vec3 starField(vec3 d){
  vec3 col = vec3(0.0);
  for (int k = 0; k < 3; k++){
    float f = 62.0 + float(k) * 118.0;
    vec3 p = d * f;
    vec3 id = floor(p);
    vec3 fr = fract(p) - 0.5;
    float h = h31(id);
    float thr = 0.9958;
    if (h > thr){
      float m = (h - thr) / (1.0 - thr);
      float dist = length(fr);
      float s = smoothstep(0.5, 0.0, dist);
      vec3 tint = mix(vec3(0.70, 0.80, 1.00), vec3(1.00, 0.90, 0.78), h21(id.xy));
      col += tint * pow(s, 3.0) * (0.30 + 1.10 * m);
    }
  }
  // 极淡的银河带
  float band = exp(-pow((d.y * 2.6 + d.x * 0.45), 2.0) * 2.2);
  col += vec3(0.030, 0.036, 0.052) * band;
  return col;
}

// ── 黑体色温（来自 Gemini 的版本，比原先三段 mix 更连续）
//    四段：深红橙 → 橙金 → 金白 → 白热。刻意不给蓝、不给绿 ——
//    吸积盘再热也不该跑出彩虹色，这是这张图"不 AI 味"的底线。
vec3 blackbody(float t){
  t = clamp(t, 0.0, 1.5);
  vec3 c = mix(vec3(0.80, 0.14, 0.02), vec3(1.00, 0.36, 0.06), smoothstep(0.00, 0.40, t));
  c = mix(c, vec3(1.00, 0.72, 0.30), smoothstep(0.40, 0.84, t));
  c = mix(c, vec3(1.00, 0.96, 0.90), smoothstep(0.84, 1.35, t));
  return c;
}

void main(){
  vec2 uv = vUv * 2.0 - 1.0;
  uv.x *= uAspect;

  // 相机基（看向原点）
  float yaw = uYaw;
  float pit = uPitch;
  vec3 camPos = vec3(sin(yaw) * cos(pit), sin(pit), cos(yaw) * cos(pit)) * uDist;
  vec3 fwd = normalize(-camPos);
  vec3 rgt = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
  vec3 up  = cross(fwd, rgt);

  const float TANF = 0.62;   // 与显示平面角尺寸严格对应（见 frame()）
  vec3 rd = normalize(fwd + rgt * uv.x * TANF + up * uv.y * TANF);

  // 测地线积分：d²x/dλ² = -1.5 h² x / r⁵（零测地线偏折的经典近似）
  vec3 p = camPos;
  vec3 v = rd;
  vec3 hv = cross(p, v);
  float h2 = dot(hv, hv);

  vec3 col = vec3(0.0);
  float trans = 1.0;
  bool captured = false;

  for (int i = 0; i < 128; i++){
    float r = length(p);
    if (r < 0.94 * R_HOR){ captured = true; break; }
    if (r > 26.0 && dot(p, v) > 0.0) break;

    float dt = clamp(0.020 * r * r, 0.004, 0.40);
    // 半隐式欧拉（同 Gemini）：先更新速度再走一步。贴近视界时显式欧拉
    // 容易"越步飞出去"，半隐式把这一步压回来，边界处的盘面穿越也更准。
    vec3 acc = -1.5 * h2 * p / pow(r, 5.0);
    vec3 nv = v + acc * dt;
    vec3 np = p + nv * dt;

    // ── 盘面穿越（每次穿越累加一层，后侧被引力弯上来的像也就自然出现）──
    if (p.y * np.y < 0.0){
      float t = p.y / (p.y - np.y);
      vec3 hit = mix(p, np, t);
      float rr = length(hit.xz);
      if (rr > R_IN * 0.94 && rr < R_OUT){
        float phi = atan(hit.z, hit.x);
        float lr  = log(rr);

        // 内缘火焰带的形状（ISCO 外一点点最亮，向外指数衰减）
        float isoRim = exp(-max(rr - R_IN, 0.0) * (3.40 - 0.60 * uPush))
                     * smoothstep(R_IN - 0.20, R_IN + 0.10, rr);
        vec3 vdir = normalize(v);

        // ── 盘面厚度：吸积盘不是零厚度的一张纸（结构取自 Gemini）──
        // 用视线方向把命中点沿 y 上下推 hSlab，得到"上表面 / 下表面"两个采样点，
        // 两层噪声之差 → 立体起伏（relief）。hSlab 随 uPush 变大 → 推近时盘真的变厚。
        // 这比"整体放大"可靠得多：放大只会糊，变厚会长出新的暗部与视差。
        float hSlab = (0.020 + 0.150 * uPush) * smoothstep(R_IN, R_IN + 1.70, rr)
                    + isoRim * (0.040 + 0.170 * uPush);
        vec2 sh = vdir.xz / (abs(vdir.y) + 0.16) * hSlab;
        vec2 pTop = hit.xz - sh;
        vec2 pBot = hit.xz + sh * 0.75;
        float phiT = atan(pTop.y, pTop.x), phiB = atan(pBot.y, pBot.x);
        float lrT = log(max(length(pTop), 1.0)), lrB = log(max(length(pBot), 1.0));

        // ── 双相位循环（结构取自 Gemini）──
        // 差速旋转跑久了，内外圈相位差会累积到几十圈，纹理被剪切碾成噪点。
        // 用两个相差半周期的相位交叉淡化：任一时刻总有一个"刚起步"的相位在主导，
        // 交叉用三角权重过渡，看不到跳变。流速随 uPush 加快 = 光粒子流速的压迫感。
        float flow  = 1.0 + 0.85 * uPush;
        float omega = 8.40 / pow(max(rr, 1.10), 1.5);
        float cyc   = uTime * 0.085 * flow;
        float ph0   = fract(cyc);
        float ph1   = fract(cyc + 0.5);
        float wMix  = abs(ph0 * 2.0 - 1.0);

        // ⚠️ 旧版用 sp = vec2(pha * 1.9, log(rr) * 3.6) 做 2D 噪声，有两个硬伤：
        //   ① pha 在 ±π 处不连续 → 盘面上留一条贯穿的接缝竖线；
        //   ② 方位频率远低于径向 → 纹理沿方位几乎不变，只剩一圈圈"同心圆环"。
        // 现在用螺旋极坐标采样：cos/sin 的半径随 log(r) 增长，采样路径本身是螺旋，
        // 纹理天然是斜向丝缕；相位只做 phi 的平移，cos/sin 在 ±π 处天然连续。

        // ① 大尺度涡旋（决定明暗团块与旋臂走向）
        float RM  = 2.10 + 0.85 * lr;
        float aM0 = phi + lr * 2.40 - omega * ph0 * 6.2;
        float aM1 = phi + lr * 2.40 - omega * ph1 * 6.2 + 3.1416;
        float nM0 = n31(vec3(cos(aM0) * RM, sin(aM0) * RM, lr * 2.30));
        float nM1 = n31(vec3(cos(aM1) * RM, sin(aM1) * RM, lr * 2.30 + 5.3));
        float macro = mix(nM0, nM1, wMix);

        // ② 细丝：上下表面各采一次（视差），推近时指数变高 → 丝更细更利（细节更多）。
        //    ⚠️ 频率上限由离屏 RT 决定：0.70× 分辨率下 4.6~6.8 是能用的上限，
        //    再高就会退化成斜向摩尔纹网格（看起来像点阵贴图）。
        float RF  = 4.60 + 2.20 * lr;
        float bF0 = lrT * 4.40 - omega * ph0 * 14.0;
        float bF1 = lrB * 4.40 - omega * ph1 * 14.0 + 2.4;
        float nF0 = n31(vec3(cos(phiT + bF0) * RF, sin(phiT + bF0) * RF, lrT * 4.40 - uTime * 0.42 * flow));
        float nF1 = n31(vec3(cos(phiB + bF1) * RF, sin(phiB + bF1) * RF, lrB * 4.40 - uTime * 0.42 * flow + 3.9));
        float rid = mix(1.0 - abs(nF0 * 2.0 - 1.0), 1.0 - abs(nF1 * 2.0 - 1.0), wMix);
        float fil = pow(clamp(rid, 0.0, 1.0), 1.90 + 1.00 * uPush);
        float relief = clamp(1.0 + (nM0 - nM1) * (0.18 + 0.40 * uPush), 0.62, 1.42);

        // 径向亮度：内缘白热、向外快速衰减。这一项是「薄盘」 vs 「厚面包圈」的分界：
        // 旧版密度几乎不随半径降，透镜像就把阴影上方糊成一整块厚墙。
        float radial = pow(R_IN / rr, 1.35);
        float edge = smoothstep(R_IN * 0.90, R_IN + 0.22, rr)
                   * (1.0 - smoothstep(R_OUT * 0.55, R_OUT, rr));
        float dens = edge * radial * (0.34 + 1.05 * macro + 0.85 * fil) * relief
                   // 内缘火焰环用 macro 打断：真实 ISCO 的亮边是被湍流咬出缺口的，
                   // 一整圈均匀的白环一眼就是画上去的。
                   + isoRim * (0.30 + 0.60 * uPush) * (0.40 + 0.60 * fil) * (0.42 + 1.05 * macro);

        // 多普勒 beaming：迎向侧更亮更白，背向侧偏暗偏红。
        // beta 用 1/sqrt(r) 近似轨道速度；上限 4.2 是因为再高就会把迎向侧
        // 整片烧白、盘面纹理全被吞掉 —— 宁可少一点极端，也要保住看得见的丝缕。
        vec3 vel = normalize(vec3(-hit.z, 0.0, hit.x));
        float beta = clamp(0.78 / sqrt(max(rr, 1.20)), 0.0, 0.80);
        float app  = dot(vel, -vdir) * beta * 1.35;
        float dop = min(1.0 / max(0.14, 1.0 - app), 4.2);
        dop = pow(dop, 1.50);

        // 引力红移：光子要爬出深井，越靠内缘损失的能量越多 → 压暗
        float grav = sqrt(max(0.0, 1.0 - 0.42 / max(rr, 0.9)));

        float T = pow(R_IN / rr, 0.85) + isoRim * 0.35;   // 内热外冷，内缘再抬一档
        vec3 c = blackbody(T);
        c = mix(c, vec3(1.00, 0.99, 0.96), smoothstep(-0.25, 0.75, app) * 0.55);  // 迎向侧推白

        float em = dens * (0.26 + 1.60 * T) * dop * grav;
        col += trans * c * em * 1.02;

        trans *= (1.0 - clamp(dens * 0.50, 0.0, 0.66));
        if (trans < 0.015) break;
      }
    }

    // ── 内缘等离子体鞘（体积感来源）
    //    只在内缘环带里存在，且阴影正前方必须干净 —— 否则这层雾会把"黑洞阴影"
    //    填成褐色，看起来像没洗干净。握拳推近时鞘变厚：这是"压迫感"里唯一
    //    不靠放大缩小的成分，近看时才会觉得气是被吸进去的，而不是一张贴图。──
    float rr2 = length(p.xz);
    if (rr2 < R_OUT * 0.82 && abs(p.y) < 0.40 && rr2 > R_IN * 1.60){
      float vh = 3.60 - 1.60 * uPush;                  // 越小 = 衰减越慢 = 越厚
      float sheath = exp(-abs(p.y) * vh)
                   * smoothstep(R_IN * 1.60, R_IN * 2.05, rr2)
                   * (1.0 - smoothstep(R_IN * 1.95, R_OUT * 0.80, rr2));
      // 系数必须很小：这条路径每帧要走几十步，每步多 0.001 累积起来
      // 就足以把"黑洞阴影"洗成一块棕灰色 —— 阴影不黑，前面做的全白费。
      col += trans * vec3(1.00, 0.55, 0.24) * sheath * (0.0006 + 0.0016 * uPush);
    }

    p = np;
    v = nv;
  }

  if (!captured){
    // ⚠️ 背景必须用【偏折后的光线方向 v】采样，而不是入射方向 rd。
    //    用 rd 等于把黑洞当一张透明贴纸：背景星星完全不弯；用 v 才会自然形成
    //    绕阴影的爱因斯坦弧 —— 这是"真实"和"看起来像真的"的分界线。
    vec3 bent = normalize(v);
    float defl = clamp(1.0 - dot(rd, bent), 0.0, 1.0);
    col += trans * starField(bent) * (1.0 + 1.4 * defl);
  } else {
    // 落入视界：背景全黑，只留前方盘面已经累积的光
    trans = 0.0;
  }

  // 大面积暖色光晕（绕在洞口外围的柔光）
  // ⚠️ 必须在阴影内部压掉：否则整块"影子"会被这层雾填成灰褐色，黑洞就不黑了。
  float drad = length(vec2(uv.x * 0.92, uv.y * 1.45));
  // 起始半径从 0.16 提到 0.30：阴影在屏幕上的半径约 0.30~0.36，
  // 旧起点会让光晕渗进阴影上半部，把黑洞洗成一块棕灰。
  float halo = exp(-drad * 2.85) * smoothstep(0.30, 0.62, drad);
  col += vec3(1.00, 0.56, 0.24) * halo * (0.024 + 0.030 * uPush);

  // ⚠️ 这里曾经手写过一圈"保底光子环"，结果是在阴影内部画出一个几何完美的正圆，
  //    推近时尤其明显，像后期 PS 上去的。真正的光子环已由光线弯折后多次穿盘自然生成
  //    （贴着阴影边缘那道细亮弧）。删掉人工圆：宁可少一点亮度，也不要一眼假的完美圆。

  // 推近时轻微抬曝光：盘面亮度先于构图压过来，这是"被推近"最直接的体感
  col = toDisplay(col, 0.94 + 0.20 * uPush);
  gl_FragColor = vec4(col, uOpacity);
}`;

  // 显示平面：把 raymarch 的结果（离屏 RT）原样贴上来，避免二次编码
  const DISPLAY_VS = `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
  const DISPLAY_FS = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform float uOpacity;
void main(){
  vec3 c = texture2D(uTex, vUv).rgb;
  gl_FragColor = vec4(c, uOpacity);
}`;

  function createBlackHole() {
    const group = new THREE.Group();

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uPush: { value: 0 },
        uYaw: { value: 0.34 },
        uPitch: { value: 0.085 },
        uDist: { value: 9.6 },
        // ⚠️ 离屏这一遍必须写不透明像素（alpha=1）：这张 RT 是「一张图」，
        //    淡入淡出由显示平面的 uOpacity 负责。写成 0 会让 RT 全透明 → 全黑。
        uOpacity: { value: 1 },
        uAspect: { value: 1.6 },
        uRes: { value: new THREE.Vector2(1024, 640) }
      },
      vertexShader: BH_VS,
      fragmentShader: BH_FS,
      transparent: true,
      depthWrite: false,
      depthTest: false
    });

    // 离屏低分辨率 raymarch（只有聚焦时渲染，避免全屏逐像素积分拖垮帧率）
    const rt = new THREE.WebGLRenderTarget(1024, 640, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: false,
      stencilBuffer: false
    });
    const rScene = new THREE.Scene();
    const rCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    rScene.add(quad);

    const dispMat = new THREE.ShaderMaterial({
      uniforms: { uTex: { value: rt.texture }, uOpacity: { value: 0 } },
      vertexShader: DISPLAY_VS,
      fragmentShader: DISPLAY_FS,
      transparent: true,
      depthWrite: false,
      depthTest: false
    });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), dispMat);
    plane.renderOrder = 8;
    plane.visible = false;
    group.add(plane);

    let elapsed = 0, pushS = 0, opacity = 0, yaw = 0.34, pitch = 0.055;

    return {
      group,
      isDeep3D: true,
      _rt: rt, _mat: mat, _disp: dispMat,   // 只读调试句柄（QA 脚本回调像素用）
      get yaw(){ return yaw; },
      setYaw(v){ yaw = v; },
      spin(a){ yaw += a; },

      setOpacity(o) {
        opacity = o;
        dispMat.uniforms.uOpacity.value = o;
        plane.visible = o > 0.004;
      },
      setPush(p) { pushS = p; },

      // 每帧：更新虚拟相机 / 时间，并跑一次离屏积分
      frame(sceneCam, renderer, nowSec, dt) {
        if (opacity <= 0.004) return;
        elapsed += dt;
        // 离屏分辨率跟屏幕比例走。0.70 是权衡后的上限：低于 0.6 时盘面细纹会被
        // 拉成摩尔纹（RT 每像素一个格），高于 0.8 在这个 128 步积分下开始掉帧。
        const w = Math.max(560, Math.round(innerWidth * 0.70));
        const h = Math.max(340, Math.round(innerHeight * 0.70));
        if (rt.width !== w || rt.height !== h) {
          rt.setSize(w, h);
          mat.uniforms.uRes.value.set(w, h);
          mat.uniforms.uAspect.value = w / h;
        }

        mat.uniforms.uTime.value = elapsed;
        mat.uniforms.uPush.value = pushS;
        mat.uniforms.uYaw.value = yaw;
        // 俯仰角不随推近改变：否则盘面会在推近过程中持续转动，被眼睛读成"画面在抖"。
        // 压迫感由 uDist / FOV / 暗角负责，不需要拿机位角度换。
        mat.uniforms.uPitch.value = pitch;
        // 窄屏适配：着色器的取景是按画面高度算的，手机这种竖屏会让黑洞横向撑爆。
        // 按高宽比把虚拟相机拉远，保证视界半径落在画面宽度的合理比例内。
        const fit = Math.max(1, 1.06 * innerHeight / Math.max(innerWidth, 1));
        // ⚠️ 推近幅度必须受盘外缘约束（R_OUT = 8.6）：相机一旦进到盘里，
        //    盘面就会糊满全屏变成一团亮雾。所以 9.6→8.9 只走 7%，
        //    压迫感交给 FOV 收紧(55°→45.5°)、曝光抬升、鞘变厚和流速加快。
        mat.uniforms.uDist.value = (9.6 - 0.7 * pushS) * fit;

        renderer.setRenderTarget(rt);
        renderer.render(rScene, rCam);
        renderer.setRenderTarget(null);

        // 显示平面贴合相机：uv=±1 对应 tan 0.62（与片元里的 TANF 严格一致）。
        // ⚠️ 宽高必须按贴图比例分开设：贴图是 16:10、如果给它一个正方形平面，
        //    画面会被横向压扁，两侧还会露出场景原本的星空（看起来像"图片边框"）。
        const d = sceneCam.position.distanceTo(group.position);
        const TANF = 0.62;
        const asp = (rt.width / rt.height) || 1.6;
        plane.scale.set(Math.max(2.0, d * 2 * TANF * asp), Math.max(2.0, d * 2 * TANF), 1);
        plane.quaternion.copy(sceneCam.quaternion);
      }
    };
  }

  // ═══════════════════════════════════════════════════════════
  //  2. 创生之柱（体积 raymarch）
  //  ⚠️ 为什么不再是点云：Additive/Normal blending 的粒子只能「加光」，
  //     物理上画不出「暗尘埃挡住亮背景」的吸收式剪影 —— 这正是哈勃照片
  //     最关键的特征。改成和黑洞同构的离屏 raymarch：逐样本累加
  //     Beer–Lambert 透射率，柱体内部几乎不发光，背景电离气体才是光源。
  // ═══════════════════════════════════════════════════════════

  // 体积密度 + 光照 + 背景星云，全部在一个片元里积分。
  const PILLAR_RM_FS = TONE_GLSL + `
precision highp float;
varying vec2 vUv;
uniform float uTime;
uniform float uPush;
uniform float uYaw;
uniform float uPitch;
uniform float uDist;
uniform float uOpacity;
uniform float uAspect;
uniform vec2  uRes;

float h31(vec3 p){
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}
float h21(vec2 p){
  p = fract(p * vec2(443.8975, 397.2973));
  p += dot(p, p.yx + 19.19);
  return fract((p.x + p.y) * p.x);
}
// quintic 插值：二阶连续，单层噪声被 pow 拉成丝时不会显影出网格
float n31(vec3 p){
  vec3 i = floor(p), f = fract(p);
  f = f*f*f*(f*(f*6.0-15.0)+10.0);
  float a = mix(h31(i+vec3(0.0,0.0,0.0)), h31(i+vec3(1.0,0.0,0.0)), f.x);
  float b = mix(h31(i+vec3(0.0,1.0,0.0)), h31(i+vec3(1.0,1.0,0.0)), f.x);
  float c = mix(h31(i+vec3(0.0,0.0,1.0)), h31(i+vec3(1.0,0.0,1.0)), f.x);
  float d = mix(h31(i+vec3(0.0,1.0,1.0)), h31(i+vec3(1.0,1.0,1.0)), f.x);
  return mix(mix(a,b,f.y), mix(c,d,f.y), f.z);
}
float n2(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f*f*f*(f*(f*6.0-15.0)+10.0);
  return mix(mix(h21(i),h21(i+vec2(1.0,0.0)),f.x),
             mix(h21(i+vec2(0.0,1.0)),h21(i+vec2(1.0,1.0)),f.x), f.y);
}
float fbm2(vec2 p){
  float v = 0.0, a = 0.55;
  for (int i = 0; i < 4; i++){ v += a * n2(p); p *= 2.07; a *= 0.5; }
  return v;
}

// 三根柱：cx, cz, r0, r1（y0/y1 由索引给出）
vec4 colData(int i){
  if (i == 0) return vec4(-3.90,  0.10, 3.45, 1.85);
  if (i == 1) return vec4( 1.35,  0.95, 2.55, 1.30);
  return              vec4( 5.25, -0.85, 1.55, 0.78);
}
float colY0(int i){ return (i == 2) ? -6.20 : -8.00; }
float colY1(int i){ return (i == 0) ? 4.20 : ((i == 1) ? 1.35 : -1.45); }

// 尘埃密度场。解析轮廓定骨架（保证柱体形状稳定），
// 单层 n31 扰动半径（生成参差的指状边缘 + 被恒星风啃出的缺口）。
float dustDensity(vec3 p){
  float total = 0.0;
  for (int i = 0; i < 3; i++){
    vec4 c = colData(i);
    float y0 = colY0(i), y1 = colY1(i);
    if (p.y < y0 - 0.7 || p.y > y1 + 1.1) continue;

    float ang = atan(p.z - c.y, p.x - c.x);
    // 顶部高度随方位起伏 → 参差指状，不是平头圆柱
    float tipN = n31(vec3(cos(ang)*1.6 + c.x, 3.7, sin(ang)*1.6 + c.y));
    float top = y1 + (tipN - 0.5) * 2.4 - 0.35;
    if (p.y > top) continue;

    float t = clamp((p.y - y0) / (y1 - y0), 0.0, 1.0);
    float prof = c.z * pow(1.0 - 0.50*t, 1.22) + c.w * 0.48*t;
    prof *= 1.0 - pow(t, 5.0) * 0.34;
    // 沿高度的鼓包 + 方位褶皱（用 q 参数让扰动随柱体移动）
    prof *= 0.52 + 1.02 * n31(vec3(c.x*0.5 + cos(ang)*1.7, p.y*0.42, c.y*0.5 + sin(ang)*1.7));
    // 3 次大起伏 + 5 次指状缺口：真实柱顶是参差的，不是整齐圆柱
    prof *= 0.62 + 0.46*sin(ang*3.0 + p.y*0.42 + float(i)*0.7)
                + 0.26*sin(ang*5.0 - p.y*0.28 + 1.7);
    prof = max(prof, 0.09);

    float rr = length(vec2(p.x - c.x, (p.z - c.y) * 1.16));
    float d = prof - rr;                       // >0 表示在柱内
    float shell = smoothstep(-0.26, 0.24, d);
    // 内部暗纹：让柱面不是均匀一块，有沿轴层理和横向暗带
    float lane = n31(vec3(p.x, p.y - uTime*(0.05 + 0.16*uPush), p.z) * 1.05 + vec3(11.3, 4.7, -2.9));
    float strata = 0.5 + 0.5*sin(p.y*3.0 + n31(p*0.45)*5.0);
    // 高频侵蚀：在柱面啃出小缺口与尘球，避免光滑得像融化的蜡烛
    // 时间漂移：气体沿柱轴缓慢上升，推近时加快（用户要的"流动感"）
    vec3 fp = p + vec3(0.0, -uTime * (0.09 + 0.24*uPush), 0.0);
    float pit = n31(fp * 2.65 + vec3(5.7, -2.1, 9.3));
    float dens = shell * (0.52 + 0.52*lane) * (0.66 + 0.52*strata)
               * (0.72 + 0.55*pit);
    total = max(total, dens);
  }
  // 柱基：扁而宽的分子云，把三根柱连成一体。
  // ⚠️ 必须用「三维椭球」衰减：旧版把 x/z 和 y 各自套 smoothstep，
  //    等于切出一个方形柱体 —— 画面右侧那块笔直的矩形墙就是这么来的。
  vec3 bp = (p - vec3(-1.2, -8.0, 0.2)) / vec3(7.4, 2.9, 3.6);
  float br = length(bp);
  float base = 1.0 - smoothstep(0.52, 1.04, br);
  base *= 0.62 + 0.72 * n31(p*0.95 + vec3(3.1, 8.7, -1.3));
  total = max(total, base);
  return clamp(total, 0.0, 1.0);
}

// 背景电离气体：沿视线方向采样，不是屏幕 uv —— 转拳时背景跟着转，才有纵深
vec3 nebula(vec3 rd){
  vec2 q = vec2(atan(rd.z, rd.x), rd.y * 1.7);
  float n1 = fbm2(q*1.9 + vec2(1.3, 7.7) + uTime*0.006);
  float n2 = fbm2(q*5.2 - vec2(4.1, 2.3) - uTime*0.009);
  float n  = n1*0.76 + n2*0.34;
  // 蓝绿为主，靠近柱基（视线偏下）掺入暖金；这才是哈勃配色的骨架
  vec3 cool = vec3(0.052, 0.150, 0.235);
  vec3 warm = vec3(0.255, 0.185, 0.085);
  float w = smoothstep(0.10, -0.60, rd.y) * 0.72;
  vec3 c = mix(cool, warm, w);
  c *= 0.10 + 1.75 * pow(n, 1.7);             // 暗空腔 + 亮云团，不能是一团均匀青
  // 大尺度辉光：中心亮、四周渐暗，但仍留足够亮度托住暗剪影
  c *= 0.52 + 0.78 * exp(-pow(rd.y*1.9, 2.0));
  return c;
}

// 稀疏星点：用方向格点，转拳时随背景一起转
vec3 stars(vec3 rd){
  vec3 col = vec3(0.0);
  for (int k = 0; k < 2; k++){
    float f = 110.0 + float(k)*160.0;
    vec3 p = rd * f;
    vec3 id = floor(p);
    vec3 fr = fract(p) - 0.5;
    float h = h31(id + float(k)*7.3);
    if (h > 0.9972){
      float s = smoothstep(0.42, 0.0, length(fr));
      vec3 tint = mix(vec3(0.72,0.84,1.0), vec3(1.0,0.86,0.74), h21(id.xy));
      col += tint * pow(s, 3.0) * 1.5;
    }
  }
  return col;
}

void main(){
  vec2 uv = vUv * 2.0 - 1.0;
  uv.x *= uAspect;

  // 虚拟相机绕原点（柱群中心）旋转；uDist 由握拳推近驱动
  vec3 ro = vec3(sin(uYaw)*cos(uPitch), sin(uPitch), cos(uYaw)*cos(uPitch)) * uDist;
  vec3 fw = normalize(-ro);
  vec3 rgt = normalize(cross(vec3(0.0,1.0,0.0), fw));
  vec3 up  = cross(fw, rgt);
  vec3 rd = normalize(fw + rgt*uv.x*0.62 + up*uv.y*0.62);

  // 包围盒裁剪：柱群在 x[-8,8] y[-10,6] z[-5,5]，外层留一点余量
  vec3 bmin = vec3(-9.0, -10.5, -6.0);
  vec3 bmax = vec3( 9.0,   6.5,  6.0);
  vec3 inv = 1.0 / (rd + vec3(1e-6));
  vec3 t0 = (bmin - ro) * inv, t1 = (bmax - ro) * inv;
  vec3 tsmall = min(t0, t1), tbig = max(t0, t1);
  float tn = max(max(tsmall.x, tsmall.y), tsmall.z);
  float tf = min(min(tbig.x, tbig.y), tbig.z);
  tn = max(tn, 0.0);

  // 电离光来自柱群后上方（哈勃照片里前方是暗的，只有上缘/侧缘被点亮）。
  // z 取负：相机在 +z 方向，光从背面来 → 正面落在阴影里，剪影才成立。
  vec3 L = normalize(vec3(-0.52, 0.78, -0.34));

  vec3 col = vec3(0.0);
  float trans = 1.0;
  if (tf > tn){
    const int STEPS = 96;
    float dt = (tf - tn) / float(STEPS);
    // 抖动起点：消除等距采样造成的层状条纹（dithering）
    float jitter = h21(gl_FragCoord.xy) * dt;
    float t = tn + jitter;
    // 表面法线只在第一次命中时算一次（6 次密度采样），后续步进复用。
    // ⚠️ 上一版用「沿光方向再采一次」判定迎光面 —— 密度在任意位置都沿光递减，
    //    结果整个正面 rim≈1，柱体被烧成金黄色。真正的电离边只在
    //    法线朝向光源、同时视线擦过表面的那一圈（菲涅耳式边缘）。
    bool gotNormal = false;
    vec3 N = vec3(0.0, 1.0, 0.0);
    for (int i = 0; i < STEPS; i++){
      vec3 p = ro + rd * t;
      float de = dustDensity(p);
      if (de > 0.030){
        if (!gotNormal){
          float e = 0.16;
          vec3 grad = vec3(
            dustDensity(p + vec3(e,0.0,0.0)) - dustDensity(p - vec3(e,0.0,0.0)),
            dustDensity(p + vec3(0.0,e,0.0)) - dustDensity(p - vec3(0.0,e,0.0)),
            dustDensity(p + vec3(0.0,0.0,e)) - dustDensity(p - vec3(0.0,0.0,e)));
          N = normalize(-grad + vec3(0.0, 0.0001, 0.0));
          gotNormal = true;
        }
        float facing = abs(dot(N, rd));                  // 0=掠射边缘, 1=正对
        float ndl    = max(dot(N, L), 0.0);
        float rim    = pow(1.0 - facing, 3.6) * pow(ndl, 1.7);
        // 顶端电离：越高越偏冷蓝，且只在迎光侧
        float ion = clamp((p.y - 1.2) / 3.4, 0.0, 1.0) * ndl;
        // 尘埃本体必须近黑（暗剪影的物理来源），只有边缘有电离光
        vec3 dust = vec3(0.016, 0.010, 0.007);
        vec3 gold = vec3(0.98, 0.54, 0.14) * rim * (1.15 + 0.55*uPush);
        vec3 blue = vec3(0.17, 0.38, 0.78) * ion * (0.25 + 0.75*rim) * 0.55;
        vec3 local = dust + gold + blue;

        float a = 1.0 - exp(-de * dt * 3.10);
        col += trans * a * local;
        trans *= (1.0 - a);
        if (trans < 0.016) break;             // 已经完全被尘埃挡住，后面的不用算
      }
      t += dt;
    }
  }
  // 背景只有在没被尘埃挡住的方向才可见 —— 这一步就是「暗尘剪影」的物理来源
  col += trans * (nebula(rd) + stars(rd));

  col = toDisplay(col, 1.30 + 0.10 * uPush);
  gl_FragColor = vec4(col, uOpacity);
}`;

  function hash3(x, y, z) {
    const n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453123;
    return n - Math.floor(n);
  }
  function vnoise(x, y, z) {
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    let fx = x - ix, fy = y - iy, fz = z - iz;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
    const c = (a, b, d) => hash3(ix + a, iy + b, iz + d);
    const x00 = c(0,0,0) + (c(1,0,0) - c(0,0,0)) * fx;
    const x10 = c(0,1,0) + (c(1,1,0) - c(0,1,0)) * fx;
    const x01 = c(0,0,1) + (c(1,0,1) - c(0,0,1)) * fx;
    const x11 = c(0,1,1) + (c(1,1,1) - c(0,1,1)) * fx;
    const y0 = x00 + (x10 - x00) * fy;
    const y1 = x01 + (x11 - x01) * fy;
    return y0 + (y1 - y0) * fz;
  }
  function fbm3(x, y, z) {
    let v = 0, a = 0.5, f = 1;
    for (let i = 0; i < 4; i++) { v += a * vnoise(x * f, y * f, z * f); f *= 2.03; a *= 0.5; }
    return v;
  }

  const PILLAR_COLS = [
    // 主柱（左，最粗最高）
    { cx: -3.9, cz:  0.10, y0: -8.0, y1: 4.2, r0: 3.45, r1: 1.85, twist:  0.42, w: 0.42 },
    // 中柱
    { cx:  1.35, cz: 0.95, y0: -8.0, y1: 1.35, r0: 2.55, r1: 1.30, twist: -0.28, w: 0.34 },
    // 右柱（细，矮）
    { cx:  5.25, cz: -0.85, y0: -6.2, y1: -1.45, r0: 1.55, r1: 0.78, twist: 0.22, w: 0.18 }
  ];

  const PILLAR_VS = `
precision highp float;
attribute vec3 aColor;
attribute float aSize;
attribute float aSeed;
attribute float aAlpha;
uniform float uTime;
uniform float uPush;
uniform float uScreen;
uniform float uDetail;   // 细丝层专用：0 = 完全隐藏，推近时淡入
varying vec3 vCol;
varying float vFade;
varying float vSeed;
void main(){
  vec3 p = position;
  // 极缓的蠕动，避免看起来像静止的点阵。方向刻意偏向 +y（柱轴上方）：
  // 创生之柱是"被恒星风吹出来"的，气体整体在往上走；纯随机漂移只会像抖动的沙子。
  // 握拳推近时幅度加大（气体被搅动）。
  float a = uTime * 0.16 + aSeed * 6.2831;
  float drift = 0.055 + 0.050 * uPush;
  p.x += sin(a) * drift;
  p.y += (0.30 + 0.70 * sin(a * 1.27)) * drift;
  p.z += sin(a * 0.83 + 1.7) * drift;

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float sz = aSize * uScreen * 900.0 / max(-mv.z, 0.1);
  // ⚠️ 上限 26px（原 72）：粒子云一推近，每颗点会按 1/z 迅速放大，
  //    72px 时整片柱体就变成一堆大光斑 —— 这就是"越近越糊"的真正原因。
  //    近处的细节交给 detail 细丝层，主层只负责体量。
  gl_PointSize = clamp(sz, 1.0, 26.0);
  vCol = aColor;
  vSeed = aSeed;
  // 近距补偿不透明度：走近时粒子在屏幕上散开、间隙变大，会重新露出"一颗颗点"。
  // 按距离把 alpha 抬上去，近距离才是连续介质；远处不受影响。
  float nearBoost = 1.0 + 0.85 * smoothstep(34.0, 14.0, -mv.z);
  vFade = min(1.0, aAlpha * nearBoost) * smoothstep(64.0, 26.0, -mv.z) * uDetail;
}`;

  const PILLAR_FS = `
precision highp float;
varying vec3 vCol;
varying float vFade;
varying float vSeed;
void main(){
  vec2 q = gl_PointCoord - 0.5;
  float d = length(q) * 2.0;
  if (d > 1.0) discard;
  // 单颗点的内部结构：不是一个均匀的圆点，而是一小团有明暗的气体。
  // 十万颗"云絮"叠起来才有体积感；均匀圆点叠起来只会是"金粉/砂砾"。
  float mottle = 0.55 + 0.45 * sin(q.x * 21.0 + vSeed * 47.0) * sin(q.y * 17.0 - vSeed * 29.0);
  float a = pow(1.0 - d, 2.2) * (0.50 + 0.85 * mottle);
  gl_FragColor = vec4(vCol, a * vFade);
}`;

  // 上升气流粒子（被恒星风吹起的尘埃，握拳时流速明显加快）
  const FLOW_VS = `
precision highp float;
attribute float aAng;
attribute float aRad;
attribute float aCx;
attribute float aCz;
attribute float aY0;
attribute float aY1;
attribute float aSeed;
attribute float aTint;
uniform float uTime;
uniform float uPush;
uniform float uScreen;
varying vec3 vCol;
varying float vA;
void main(){
  float spd = 0.030 + 0.30 * uPush;
  float t = fract(aSeed + uTime * spd);
  float y = mix(aY0, aY1, t);
  float rr = aRad * (1.0 - 0.30 * t) * (0.85 + 0.3 * aTint);
  vec3 p = vec3(aCx + cos(aAng + t * 0.9) * rr, y, aCz + sin(aAng + t * 0.9) * rr);

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp((0.030 + 0.035 * aTint) * uScreen * 900.0 / max(-mv.z, 0.1), 1.0, 20.0);
  vCol = mix(vec3(0.95, 0.72, 0.42), vec3(0.72, 0.86, 1.00), t) * (0.55 + 0.85 * aTint);
  vA = sin(t * 3.14159);
}`;

  const FLOW_FS = `
precision highp float;
varying vec3 vCol;
varying float vA;
void main(){
  vec2 q = gl_PointCoord - 0.5;
  float d = length(q) * 2.0;
  if (d > 1.0) discard;
  float a = pow(1.0 - d, 3.0) * vA;
  gl_FragColor = vec4(vCol, a * 0.55);
}`;


  // 背景：鹰状星云里被电离的气体辉光。没有这层，柱体在纯黑上只是一团灰点，
  // 看不出"柱"的实体感——剪影必须有亮背景才成立。
  const BG_VS = `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
  const BG_FS = `
precision highp float;
varying vec2 vUv;
uniform float uTime;
uniform float uPush;
float h21(vec2 p){ p = fract(p * vec2(443.8975, 397.2973)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }
float n2(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  float a = h21(i), b = h21(i+vec2(1.0,0.0)), c = h21(i+vec2(0.0,1.0)), d = h21(i+vec2(1.0,1.0));
  return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
}
float fbm2(vec2 p){
  float v = 0.0, a = 0.55;
  for (int i = 0; i < 5; i++){ v += a * n2(p); p *= 2.03; a *= 0.5; }
  return v;
}
void main(){
  vec2 p = (vUv - vec2(0.5, 0.46)) * vec2(1.0, 0.78);
  float r = length(p);
  // 中心的高亮气团 + 向外衰减（衰减放缓：背景光要铺到画面边缘，
  // 否则柱体周围是一圈黑，剪影反而立不住）
  float glow = exp(-r * r * 4.2) * 0.85 + exp(-r * 2.4) * 0.26;
  // 云絮结构：两层不同尺度的 fbm 叠加。
  // 只用一层低频噪声，背景会糊成一大团光斑；叠一层高频才有"气体在翻卷"的层次。
  float n1 = fbm2(vUv * 3.4 + vec2(1.3, 7.7) + uTime * 0.004);
  float n2 = fbm2(vUv * 9.0 - vec2(4.1, 2.3) + uTime * 0.007);
  float n = n1 * 0.74 + n2 * 0.38;
  glow *= 0.30 + 1.25 * n;
  // 靠近柱基的地方更亮（那里是正在被恒星风吹散的气体）
  glow += exp(-pow((vUv.y - 0.20) * 3.4, 2.0)) * exp(-pow((vUv.x - 0.42) * 2.2, 2.0)) * 0.18 * n;

  vec3 cool = vec3(0.30, 0.44, 0.70);
  vec3 warm = vec3(0.86, 0.56, 0.24);
  vec3 c = mix(warm, cool, smoothstep(0.20, 0.92, n) * 0.75);
  // 只做衬托：亮到能托住柱体剪影即可，抢戏就变成"雷雨云"了。
  // 但也不能太暗 —— 柱体是"暗剪影"，背后没有足够亮的电离气体，剪影就不成立。
  c *= pow(glow, 1.50) * 0.36 * (1.0 - 0.16 * uPush);
  gl_FragColor = vec4(c, 1.0);
}`;

  // 柱体之间的稀薄气体片：纯点云再密也有"砂砾感"，叠几层极淡的体积雾才会
  // 像连续介质。三层不同深度/种子的雾片还顺带制造纵深，转拳时视差更明显。
  const MIST_FS = `
precision highp float;
varying vec2 vUv;
uniform float uTime;
uniform float uPush;
uniform float uSeed;
float h21(vec2 p){ p = fract(p * vec2(443.8975, 397.2973)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }
float n2(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = h21(i), b = h21(i + vec2(1.0,0.0)), c = h21(i + vec2(0.0,1.0)), d = h21(i + vec2(1.0,1.0));
  return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
}
float fbm2(vec2 p){ float v = 0.0, a = 0.55; for (int i = 0; i < 3; i++){ v += a * n2(p); p *= 2.07; a *= 0.5; } return v; }
void main(){
  vec2 p = (vUv - vec2(0.5, 0.5)) * vec2(1.0, 1.25);
  float n = fbm2(p * 3.4 + vec2(uSeed * 7.3, uTime * 0.005 + uSeed));
  float band = exp(-pow((p.y + 0.04 + uSeed * 0.10) * 1.75, 2.0) * 1.6);
  float a = smoothstep(0.45, 0.80, n) * band;
  vec3 c = mix(vec3(0.92, 0.56, 0.26), vec3(0.40, 0.62, 0.88), smoothstep(0.42, 0.76, n));
  // 推近时气体被搅动，雾片略微增亮 —— 不靠放大镜头制造压迫感（那会把柱子糊掉）
  // ⚠️ 这三层雾片是 billboard（永远正对相机），不会跟着 group 一起转。
  //    系数一大，转拳时就会出现"雾不跟身体转"的错位：柱体转到侧面，
  //    雾还铺在正面，看着像在雾里看影子。所以只让它做极淡的前景衬底。
  gl_FragColor = vec4(c * a * (0.055 + 0.030 * uPush), 1.0);
}`;


  // ═══════════════════════════════════════════════════════════
  //  创生之柱 · 照片驱动 2.5D（2026-11-22）
  //  ───────────────────────────────────────────────────────────
  //  为什么不用纯 raymarch：WebGL1 + 0.58× RT 下，程序化密度场永远
  //  做不出哈勃照片里的指状侵蚀、云絮层次和星点。用户要的是「像照片」，
  //  所以主体直接用参考图；暗部（尘埃）当深度，转拳时前景比背景多位移，
  //  得到真实但克制的视差。推近靠构图收紧 + 视差放大 + 暗角，不是放大糊掉。
  // ═══════════════════════════════════════════════════════════
  const PILLAR_PHOTO_FS = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform float uTime;
uniform float uPush;
uniform float uYaw;
uniform float uPitch;
uniform float uOpacity;
uniform float uAspect;
uniform float uPhotoAspect;
uniform float uReady;
uniform vec2  uRes;

float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 ph(vec2 uv){
  // x 用三角波镜像：视差把采样推出 [0,1] 时自动折回，不会拉出边缘条纹。
  float mx = 1.0 - abs(fract(uv.x * 0.5) * 2.0 - 1.0);
  float my = clamp(uv.y, 0.001, 0.999);
  return texture2D(uTex, vec2(clamp(mx, 0.001, 0.999), my)).rgb;
}

void main(){
  if (uReady < 0.5){
    // 贴图还没到：给一层安静的蓝灰底，避免闪黑
    vec3 hold = mix(vec3(0.035,0.075,0.115), vec3(0.10,0.19,0.25), vUv.y);
    gl_FragColor = vec4(hold, uOpacity);
    return;
  }

  vec2 q = vUv * 2.0 - 1.0;
  // 近方形照片放在宽屏里：按「高度撑满」居中，两侧用边缘云气延展，
  // 而不是把 1920x2002 拉成 16:9 —— 拉宽会让柱体变成矮胖子。
  float sx = uPhotoAspect / max(uAspect, 0.30);
  float zoom = 1.0 / (1.0 - 0.115 * uPush);       // 推近：构图收紧 11.5%
  vec2 p = q * zoom;
  vec2 uv = vec2(p.x / (2.0 * max(sx, 0.05)) + 0.5, p.y * 0.5 + 0.5);

  // 深度：暗的暖色尘埃 = 近；亮蓝背景 = 远。照片自带的颜色关系直接当深度图用，
  // 比另做一张 mask 更稳（边缘天然柔和，不会抠出硬边）。
  vec3 base = ph(uv);
  float lum = luma(base);
  float warm = clamp(base.r - base.b, 0.0, 1.0);
  float depth = clamp(1.12 - lum * 1.42 + warm * 0.42, 0.0, 1.0);
  float dust = smoothstep(0.34, 0.78, depth);

  // 转拳 → uYaw：前景位移约为背景的 4 倍，另有极小的旋转，
  // 所以肉眼能读出「柱子在转」，但不会转到把照片拉烂。
  // 饱和曲线：手势可以一直转，但视觉响应封顶。照片是 2.5D，硬套大角度
  // 会把不同深度的像素撕开（第一版旋转截图里的「镂空剪纸」就是这么来的）。
  float yeff = uYaw / (1.0 + abs(uYaw)) * 0.90;
  vec2 par = vec2(yeff * 0.016, uPitch * 0.010) * (1.0 + 0.40 * uPush);
  float rot = yeff * 0.025;
  mat2 R = mat2(cos(rot), -sin(rot), sin(rot), cos(rot));
  // 单层按深度位移采样：前景比背景多走一点 → 有视差。
  // ⚠️ 不能采两层再 mix：转拳幅度大时两张照片错开，柱子会「分身」出重影。
  vec2 duv = R * (uv + par * (0.15 + dust * 0.45) - 0.5) + 0.5;
  vec3 col = ph(duv);

  // 镜像折回的区域稍微压暗，读起来像取景框外的延伸，而不是重复贴图。
  float outside = smoothstep(sx * 0.92, sx * 1.45, abs(p.x));
  col *= 1.0 - outside * 0.16;

  // 电离边增强：只在尘埃/背景交界加一点点青绿和暖金，照片本身已经有边，
  // 这里只是补偿离屏采样抹掉的高频，不做「画上去的光环」。
  float e = 0.0024;
  // ⚠️ 边缘增强必须在位移后的 duv 上取梯度，否则彩边和柱子错位。
  float gx = luma(ph(duv + vec2(e,0.0))) - luma(ph(duv - vec2(e,0.0)));
  float gy = luma(ph(duv + vec2(0.0,e))) - luma(ph(duv - vec2(0.0,e)));
  float rim = clamp(length(vec2(gx, gy)) * 2.2, 0.0, 1.0) * dust;
  col += (vec3(0.10, 0.20, 0.17) + vec3(0.22, 0.11, 0.03)) * rim * 0.30;

  // 推近的压迫感：曝光略抬、暗角收紧；同时加一层只落在尘埃上的细颗粒流动，
  // 让「气体在跑」能被眼睛读到，但不改变照片主体。
  float px = uRes.x;
  vec2 cell = floor(vUv * vec2(min(px, 900.0), min(px, 900.0) * 0.62) + vec2(0.0, -uTime * 26.0));
  float grain = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
  col += dust * (grain - 0.5) * (0.010 + 0.016 * uPush);
  col *= 1.0 + 0.13 * uPush;
  float vig = 1.0 - (0.10 + 0.32 * uPush) * pow(clamp(length(q) * 0.72, 0.0, 1.0), 2.2);
  col *= vig;

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), uOpacity);
}`;

  // ═══════════════════════════════════════════════════════════
  //  创生之柱 · 体积光 raymarch（用户提供的 Gemini 版本，2026-11-22）
  //  ───────────────────────────────────────────────────────────
  //  96 步主积分 + 3 点自阴影 + Beer-Lambert 吸收；暗尘埃挡住明亮的
  //  电离背景，迎光侧用 powder 边缘散射起金边，柱顶有青蓝电离晕。
  //  这是真正的 3D 体积场（不是照片位移），转拳可绕柱群观察。
  //  ⚠️ 自带 toDisplay()，所以不能拼 TONE_GLSL，否则函数重定义。
  // ═══════════════════════════════════════════════════════════
  const PILLAR_VOL_FS = `
precision highp float;

varying vec2 vUv;

uniform float uTime;
uniform float uPush;
uniform float uYaw;
uniform float uPitch;
uniform float uDist;
uniform float uOpacity;
uniform float uAspect;
uniform vec2 uRes;

uniform float uDensityBoost;
uniform float uRimBoost;
uniform float uExpBoost;

const vec3 LIGHT_DIR = vec3(-0.4834, 0.6445, 0.5924);

float h21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

float h31(vec3 p) {
    p = fract(p * vec3(103.1, 113.69, 137.87));
    p += dot(p, p.yzx + 19.19);
    return fract((p.x + p.y) * p.z);
}

float n21(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = h21(i + vec2(0.0, 0.0));
    float b = h21(i + vec2(1.0, 0.0));
    float c = h21(i + vec2(0.0, 1.0));
    float d = h21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// quintic 插值：二阶连续，pow 放大细丝时不会显影出网格点阵
float n31(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    float n000 = h31(i + vec3(0.0, 0.0, 0.0));
    float n100 = h31(i + vec3(1.0, 0.0, 0.0));
    float n010 = h31(i + vec3(0.0, 1.0, 0.0));
    float n110 = h31(i + vec3(1.0, 1.0, 0.0));
    float n001 = h31(i + vec3(0.0, 0.0, 1.0));
    float n101 = h31(i + vec3(1.0, 0.0, 1.0));
    float n011 = h31(i + vec3(0.0, 1.0, 1.0));
    float n111 = h31(i + vec3(1.0, 1.0, 1.0));
    return mix(
        mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
        mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
        f.z
    );
}

float fbm2(vec2 p) {
    float v = 0.0;
    v += 0.5000 * n21(p); p = p * 2.03 + vec2(17.1, 31.7);
    v += 0.2500 * n21(p); p = p * 2.02 + vec2(43.5, 11.3);
    v += 0.1250 * n21(p); p = p * 2.04 + vec2(19.8, 53.2);
    v += 0.0625 * n21(p);
    return v;
}

float fbm3(vec3 p, out float ridgeOut) {
    float o1 = n31(p);
    vec3 q = p * 2.04 + vec3(o1 * 0.85, -o1 * 0.65, o1 * 0.75) + vec3(13.7, 29.3, 47.1);
    float o2 = n31(q);
    q = q * 2.08 + vec3(31.4, 17.9, 53.6);
    float o3 = n31(q);
    q = q * 2.12 + vec3(59.1, 41.2, 23.8);
    float o4 = n31(q);
    ridgeOut = 1.0 - abs(o3 * 2.0 - 1.0);
    return o1 * 0.51 + o2 * 0.26 + o3 * 0.15 + o4 * 0.08;
}

float fbm3Fast(vec3 p) {
    float o1 = n31(p);
    vec3 q = p * 2.04 + vec3(o1 * 0.80, -o1 * 0.60, o1 * 0.70) + vec3(13.7, 29.3, 47.1);
    float o2 = n31(q);
    return o1 * 0.66 + o2 * 0.34;
}

float smin(float a, float b, float k) {
    float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
}

float sdTaperedCapsule(vec3 p, vec3 a, vec3 b, float rA, float rB) {
    vec3 ba = b - a;
    vec3 pa = p - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    float r = mix(rA, rB, h);
    return length(pa - ba * h) - r;
}

float pillarsProfile(vec3 p, out float topIonMask) {
    vec3 q = p;
    q.x += sin(p.y * 0.38 + 0.6) * 0.28;
    q.z += cos(p.y * 0.34 + 1.1) * 0.22;

    float p1 = sdTaperedCapsule(q, vec3(-4.65, -8.5, -0.25), vec3(-3.65, 1.85, 0.15), 2.55, 1.25);
    float p1f1 = sdTaperedCapsule(q, vec3(-4.10, 1.10, 0.05), vec3(-4.35, 2.75, 0.20), 0.82, 0.32);
    float p1f2 = sdTaperedCapsule(q, vec3(-3.55, 1.25, 0.20), vec3(-3.40, 2.55, 0.35), 0.74, 0.28);
    float p1f3 = sdTaperedCapsule(q, vec3(-3.15, 0.45, -0.10), vec3(-2.85, 1.75, 0.05), 0.68, 0.25);
    p1 = smin(p1, smin(p1f1, smin(p1f2, p1f3, 0.45), 0.50), 0.65);

    float p2 = sdTaperedCapsule(q, vec3(0.85, -8.5, 0.80), vec3(1.55, 0.85, 1.05), 2.05, 0.98);
    float p2f1 = sdTaperedCapsule(q, vec3(1.35, 0.35, 0.95), vec3(1.62, 1.82, 1.15), 0.68, 0.26);
    float p2f2 = sdTaperedCapsule(q, vec3(1.85, -0.20, 1.10), vec3(2.18, 1.15, 1.22), 0.58, 0.22);
    p2 = smin(p2, smin(p2f1, p2f2, 0.42), 0.60);

    float p3 = sdTaperedCapsule(q, vec3(4.80, -8.5, -1.00), vec3(5.42, -0.35, -0.78), 1.68, 0.78);
    float p3f1 = sdTaperedCapsule(q, vec3(5.32, -0.75, -0.82), vec3(5.65, 0.55, -0.65), 0.55, 0.22);
    p3 = smin(p3, p3f1, 0.52);

    float egg1 = length(q - vec3(-4.85, 2.45, 0.35)) - 0.34;
    float egg2 = length(q - vec3(-2.55, 1.95, 0.22)) - 0.26;
    float egg3 = length(q - vec3(1.10, 2.15, 1.18)) - 0.28;
    float egg4 = length(q - vec3(5.85, 0.85, -0.55)) - 0.24;
    float eggs = min(min(egg1, egg2), min(egg3, egg4));

    float basePedestal = (q.y + 6.9) + 0.35 * sin(q.x * 0.45) + 0.12 * abs(q.z);

    float d = smin(p1, p2, 0.85);
    d = smin(d, p3, 0.85);
    d = smin(d, eggs, 0.55);
    d = smin(d, basePedestal, 1.45);

    float tip1 = smoothstep(0.0, 2.85, p.y) * exp(-length(p.xz - vec2(-3.75, 0.20)) * 0.48);
    float tip2 = smoothstep(-0.8, 1.95, p.y) * exp(-length(p.xz - vec2(1.60, 1.08)) * 0.58);
    float tip3 = smoothstep(-1.8, 0.70, p.y) * exp(-length(p.xz - vec2(5.55, -0.72)) * 0.65);
    topIonMask = clamp(tip1 + tip2 + tip3, 0.0, 1.0);

    return d;
}

float mapDensity(vec3 p, out float topIonMask, out float ridgeDetail) {
    float dBase = pillarsProfile(p, topIonMask);
    ridgeDetail = 0.0;
    if (dBase > 1.75) {
        return 0.0;
    }

    vec3 np = vec3(p.x * 0.68 - p.y * 0.16, p.y * 0.44, p.z * 0.68) + vec3(0.0, uTime * 0.012, 0.0);
    float f = fbm3(np, ridgeDetail);

    float erosion = (f - 0.46) * (2.35 + 0.35 * uPush);
    float signedField = -(dBase - erosion);
    if (signedField <= 0.0) {
        return 0.0;
    }

    float core = smoothstep(0.0, 1.15, signedField);
    float dens = (core * core * 3.4 + signedField * 1.35) * (0.72 + 0.56 * ridgeDetail);
    dens *= (1.0 + uDensityBoost);
    return clamp(dens, 0.0, 5.0);
}

// 只取密度：算首次命中法线时要沿 x/y/z 各采两次，省掉 out 参数的噪音
float densOnly(vec3 p) {
    float ion, ridge;
    return mapDensity(p, ion, ridge);
}

float mapDensityShadow(vec3 p) {
    float dummyIon;
    float dBase = pillarsProfile(p, dummyIon);
    if (dBase > 1.70) {
        return 0.0;
    }
    vec3 np = vec3(p.x * 0.68 - p.y * 0.16, p.y * 0.44, p.z * 0.68) + vec3(0.0, uTime * 0.012, 0.0);
    float f = fbm3Fast(np);
    float signedField = -(dBase - (f - 0.46) * 2.35);
    return max(signedField, 0.0) * 1.95;
}

vec2 intersectBox(vec3 ro, vec3 rd, vec3 bMin, vec3 bMax) {
    vec3 invR = 1.0 / rd;
    vec3 tbot = invR * (bMin - ro);
    vec3 ttop = invR * (bMax - ro);
    vec3 tmin = min(ttop, tbot);
    vec3 tmax = max(ttop, tbot);
    float t0 = max(max(tmin.x, tmin.y), tmin.z);
    float t1 = min(min(tmax.x, tmax.y), tmax.z);
    return vec2(max(t0, 0.0), t1);
}

vec3 backgroundNebula(vec3 rd) {
    vec2 skyUv = rd.xy / (abs(rd.z) + 0.55) * 2.6;
    float drift = uTime * 0.005;

    float nA = fbm2(skyUv * 1.15 + vec2(drift, -drift));
    float nB = fbm2(skyUv * 2.15 + vec2(nA * 1.45, -nA * 1.15) + vec2(8.3, 14.7));
    float wisp = smoothstep(0.20, 0.86, nB);
    float fineWisp = smoothstep(0.38, 0.88, nA * 0.5 + nB * 0.5);

    float clusterGlow = pow(clamp(dot(rd, LIGHT_DIR) * 0.5 + 0.5, 0.0, 1.0), 2.2);
    float up = clamp(rd.y * 0.5 + 0.5, 0.0, 1.0);

    // 按哈勃原图还原配色：上蓝灰带紫雾、中部青绿、下部橄榄金，
    // 而不是之前那种均匀高饱和青。亮背景只负责托住暗尘埃剪影。
    vec3 bottomCol = vec3(0.150, 0.165, 0.080);
    vec3 midCol    = vec3(0.055, 0.150, 0.190);
    vec3 topCol    = vec3(0.032, 0.052, 0.082);

    vec3 bg = mix(bottomCol, midCol, smoothstep(0.15, 0.55, up));
    bg = mix(bg, topCol, smoothstep(0.50, 0.95, up));

    // 左上方的紫红弥漫云（原图里很淡，但不能没有，否则一眼程序化）
    float rose = smoothstep(0.55, 0.95, up) * smoothstep(0.10, 0.80, nA);
    bg += vec3(0.100, 0.025, 0.045) * rose * 0.8;

    vec3 teal = vec3(0.100, 0.340, 0.380);
    vec3 cyan = vec3(0.220, 0.580, 0.620);
    bg = mix(bg, teal, wisp * 0.42 * (0.55 + 0.45 * clusterGlow));
    bg = mix(bg, cyan, pow(wisp, 2.0) * 0.30 * clusterGlow);

    // 柱基附近的暖金硫云絮
    bg += vec3(0.260, 0.180, 0.050) * fineWisp * pow(1.0 - up, 1.8) * 0.65;
    // 上方星团电离辉光偏白绿，不是纯青
    bg += vec3(0.52, 0.68, 0.62) * pow(clusterGlow, 3.0) * (0.20 + 0.30 * wisp);
    bg *= 0.95 + 0.08 * uPush;

    float phi = atan(rd.z, rd.x);
    float th  = acos(clamp(rd.y, -1.0, 1.0));
    vec2 sp   = vec2(phi, th);

    vec2 g1 = floor(sp * 82.0);
    float h1 = h21(g1);
    if (h1 > 0.9945) {
        vec2 f1 = fract(sp * 82.0) - 0.5;
        float b1 = exp(-dot(f1, f1) * 26.0) * smoothstep(0.9945, 1.0, h1);
        bg += mix(vec3(1.0, 0.75, 0.55), vec3(0.75, 0.92, 1.0), fract(h1 * 53.1)) * b1 * 2.8;
    }

    vec2 g2 = floor(sp * 156.0 + 23.7);
    float h2 = h21(g2);
    if (h2 > 0.9960) {
        vec2 f2 = fract(sp * 156.0 + 23.7) - 0.5;
        float b2 = exp(-dot(f2, f2) * 30.0) * smoothstep(0.9960, 1.0, h2);
        bg += vec3(0.86, 0.94, 1.0) * b2 * 1.7;
    }

    return bg;
}

vec3 toDisplay(vec3 col, float exposure) {
    col *= exposure;
    vec3 a = col * (2.51 * col + 0.03);
    vec3 b = col * (2.43 * col + 0.59) + 0.14;
    col = clamp(a / b, 0.0, 1.0);
    return pow(col, vec3(1.0 / 2.2));
}

void main() {
    vec2 screenUv = (uRes.x > 1.0) ? (gl_FragCoord.xy / uRes) : vUv;
    vec2 uv = mix(vUv, screenUv, 0.5) * 2.0 - 1.0;
    uv.x *= uAspect;

    float cy = cos(uYaw), sy = sin(uYaw);
    float cp = cos(uPitch), sp = sin(uPitch);
    vec3 ro = vec3(cp * sy, sp, cp * cy) * uDist;
    vec3 fwd = normalize(-ro);
    vec3 rgt = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
    vec3 up  = cross(rgt, fwd);
    vec3 rd  = normalize(fwd + rgt * uv.x * 0.62 + up * uv.y * 0.62);

    vec3 bgCol = backgroundNebula(rd);
    vec2 tBox = intersectBox(ro, rd, vec3(-9.2, -9.0, -4.6), vec3(9.2, 4.6, 4.6));

    vec3 col = vec3(0.0);
    float trans = 1.0;

    if (tBox.x < tBox.y && tBox.y > 0.0) {
        float t = tBox.x;
        float tEnd = tBox.y;
        float jitter = h21(uv * 173.3 + fract(uTime)) * 0.85;
        float baseDt = max((tEnd - t) / 92.0, 0.11);
        t += baseDt * jitter;

        float cosTheta = dot(rd, LIGHT_DIR);
        float phaseRim = 0.65 + 0.55 * pow(clamp(1.0 + cosTheta, 0.0, 1.0), 2.0);

        // ⚠️ 金边必须是「掠射 + 迎光」的菲涅耳边，不能用「沿光方向的密度差」：
        //    后者在任意正面位置都递减，会把整根柱子烧成奶油白（已踩坑）。
        //    首次命中时算一次密度梯度法线，后续步进复用。
        bool gotNormal = false;
        vec3 N = vec3(0.0, 1.0, 0.0);

        for (int i = 0; i < 96; i++) {
            if (t >= tEnd || trans < 0.008) {
                break;
            }

            vec3 p = ro + rd * t;
            float topIonMask;
            float ridgeDetail;
            float dens = mapDensity(p, topIonMask, ridgeDetail);

            if (dens > 0.030) {
                if (!gotNormal) {
                    float e = 0.14;
                    vec3 grad = vec3(
                        densOnly(p + vec3(e,0.0,0.0)) - densOnly(p - vec3(e,0.0,0.0)),
                        densOnly(p + vec3(0.0,e,0.0)) - densOnly(p - vec3(0.0,e,0.0)),
                        densOnly(p + vec3(0.0,0.0,e)) - densOnly(p - vec3(0.0,0.0,e)));
                    N = normalize(-grad + vec3(0.0, 0.0001, 0.0));
                    gotNormal = true;
                }
                float facing = abs(dot(N, rd));                 // 0=掠射边缘, 1=正对镜头
                float ndl = max(dot(N, LIGHT_DIR), 0.0);
                float fres = pow(1.0 - facing, 3.2);

                float dS1 = mapDensityShadow(p + LIGHT_DIR * 0.36);
                float dS2 = mapDensityShadow(p + LIGHT_DIR * 0.92);
                float dS3 = mapDensityShadow(p + LIGHT_DIR * 2.05);
                float tauShadow = dS1 * 0.42 + dS2 * 0.72 + dS3 * 1.25;

                float lightTrans = exp(-tauShadow * 3.45);
                // 只在薄壳掠射处起金边；柱芯永远是暗尘埃。
                float rimFactor = fres * pow(ndl, 1.5) * phaseRim
                                * (0.55 + 0.30 * uPush + uRimBoost);

                // 尘埃本体是暗褐偏酒红（原图的 R 通道明显高于 B），不是纯黑青。
                vec3 darkDustCore = vec3(0.030, 0.013, 0.011)
                                  * (0.62 + 0.38 * ridgeDetail)
                                  * (0.55 + 0.45 * exp(-tauShadow * 0.9));
                vec3 rimGold = mix(vec3(0.78, 0.32, 0.06), vec3(1.00, 0.78, 0.34), clamp(lightTrans * 0.8, 0.0, 1.0));
                // 柱顶电离边是淡黄绿，不是纯青蓝（哈勃 SII/Hα 配色）
                rimGold = mix(rimGold, vec3(0.82, 0.96, 0.66), topIonMask * 0.55);
                vec3 rimLight = rimGold * rimFactor * 1.05;

                float outerShell = exp(-dens * 0.75) * fres * ndl;
                vec3 topCyanGlow = vec3(0.62, 0.88, 0.74) * topIonMask * outerShell * (0.95 + 0.25 * uPush);

                // 推近时的暗红裂隙只能是一点点：pow(ridgeDetail, 2.2) 会把
                // quintic 噪声雕成规则方格（推近截图里的「华夫饼」就是它）。
                float internalScatter = uPush * exp(-tauShadow * 1.45) * pow(ridgeDetail, 1.3) * 0.025;
                vec3 subSurface = vec3(0.72, 0.22, 0.04) * internalScatter;

                float sigmaE = 2.75;
                float stepTrans = exp(-dens * sigmaE * baseDt);
                vec3 stepSource = darkDustCore + rimLight + topCyanGlow + subSurface;

                col += trans * (1.0 - stepTrans) * stepSource;
                trans *= stepTrans;

                t += baseDt;
            } else {
                t += baseDt * 1.45;
            }
        }
    }

    col += trans * bgCol;

    float sunDot = clamp(dot(rd, LIGHT_DIR), 0.0, 1.0);
    col += vec3(0.52, 0.62, 0.56) * pow(sunDot, 4.0) * 0.08;

    float exposure = 1.04 + 0.18 * uPush + uExpBoost;
    gl_FragColor = vec4(toDisplay(col, exposure), uOpacity);
}`;

  const _q = new THREE.Quaternion();
  function createPillars() {
    const group = new THREE.Group();

    // 体积光积分：96 步 + 3 点自阴影，必须先落在离屏 RT 上。
    // ⚠️ 离屏这一遍 uOpacity 必须为 1；淡入淡出交给显示平面的 uOpacity。
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime:          { value: 0 },
        uPush:          { value: 0 },
        uYaw:           { value: 0 },
        uPitch:         { value: 0.02 },
        uDist:          { value: 14.0 },
        uOpacity:       { value: 1 },
        uAspect:        { value: 1.6 },
        uRes:           { value: new THREE.Vector2(1024, 640) },
        uDensityBoost:  { value: 0 },
        uRimBoost:      { value: 0 },
        uExpBoost:      { value: 0 }
      },
      vertexShader: BH_VS,
      fragmentShader: PILLAR_VOL_FS,
      transparent: true, depthWrite: false, depthTest: false
    });

    // 0.70×：实测 151fps @0.58，还有余量；提到 0.70 让柱缘的指状侵蚀
    // 和背景云絮更锐利（再高收益很小，只是烧 GPU）。
    const rt = new THREE.WebGLRenderTarget(1024, 640, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: false,
      stencilBuffer: false
    });
    const rScene = new THREE.Scene();
    const rCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    rScene.add(quad);

    const dispMat = new THREE.ShaderMaterial({
      uniforms: { uTex: { value: rt.texture }, uOpacity: { value: 0 } },
      vertexShader: DISPLAY_VS,
      fragmentShader: DISPLAY_FS,
      transparent: true, depthWrite: false, depthTest: false
    });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), dispMat);
    plane.renderOrder = 8;
    plane.visible = false;
    group.add(plane);

    let elapsed = 0, pushS = 0, opacity = 0, yaw = 0, pitch = 0.02;

    return {
      group,
      isDeep3D: true,
      _rt: rt, _mat: mat, _disp: dispMat,  // QA 只读句柄：检查 RT / 着色器状态
      get yaw(){ return yaw; },
      setYaw(v){ yaw = v; },
      spin(a){ yaw += a; },        // 转拳：真实 3D 相机绕柱群，语义与黑洞一致
      setOpacity(o) {
        opacity = o;
        dispMat.uniforms.uOpacity.value = o;
        plane.visible = o > 0.004;
      },
      setPush(p) { pushS = p; },

      frame(sceneCam, renderer, nowSec, dt) {
        if (opacity <= 0.004) return;
        elapsed += dt;
        const w = Math.max(480, Math.round(innerWidth  * 0.70));
        const h = Math.max(300, Math.round(innerHeight * 0.70));
        if (rt.width !== w || rt.height !== h) {
          rt.setSize(w, h);
          mat.uniforms.uRes.value.set(w, h);
          mat.uniforms.uAspect.value = w / h;
        }

        mat.uniforms.uTime.value  = elapsed;
        mat.uniforms.uPush.value  = pushS;
        mat.uniforms.uYaw.value   = yaw;
        // 俯仰不随推近改变：否则体积场在推近时持续转动，会被眼睛读成画面抖动。
        mat.uniforms.uPitch.value = pitch;
        // 14 → 12.2：让三根柱从远景到推近都落在画面里，
        // 同时靠曝光与自阴影变化产生压迫感，而不是把相机塞进柱体糊墙。
        const fit = Math.max(1, 1.06 * innerHeight / Math.max(innerWidth, 1));
        mat.uniforms.uDist.value = (14.0 - 1.8 * pushS) * fit;

        renderer.setRenderTarget(rt);
        renderer.render(rScene, rCam);
        renderer.setRenderTarget(null);

        const d = sceneCam.position.distanceTo(group.position);
        const TANF = 0.62;
        const asp = (rt.width / rt.height) || 1.6;
        plane.scale.set(Math.max(2.0, d * 2 * TANF * asp), Math.max(2.0, d * 2 * TANF), 1);
        plane.quaternion.copy(sceneCam.quaternion);
      }
    };
  }

  window.DSMDEEP = {
    createBlackHole,
    createPillars,
    version: '1.0'
  };
})();
