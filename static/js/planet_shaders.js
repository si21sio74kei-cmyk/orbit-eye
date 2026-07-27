// ============================================================
//  GPU SHADER PLANET SYSTEM v3.0
//  WebGL 1.0 compliant — all vec3+float fixed
//  Stable sin-free hash — zero overflow risk
//  All 9 planets + Saturn rings — complete
// ============================================================


// ── 共享 GLSL 噪聲函數庫 ──
const NOISE_GLSL = `
// Stable hash — zero sin(), zero vec3+float violations
float hash(vec3 p) {
    p = fract(p * 0.1031);
    p += vec3(dot(p, p.yzx + 33.33));
    return fract((p.x + p.y) * p.z);
}
float noise3D(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
        mix(mix(hash(i), hash(i + vec3(1.0,0.0,0.0)), f.x),
            mix(hash(i + vec3(0.0,1.0,0.0)), hash(i + vec3(1.0,1.0,0.0)), f.x), f.y),
        mix(mix(hash(i + vec3(0.0,0.0,1.0)), hash(i + vec3(1.0,0.0,1.0)), f.x),
            mix(hash(i + vec3(0.0,1.0,1.0)), hash(i + vec3(1.0,1.0,1.0)), f.x), f.y), f.z);
}
float fbm(vec3 p, int octaves, float lacunarity, float gain) {
    float val = 0.0, amp = 1.0, freq = 1.0, maxVal = 0.0;
    for (int i = 0; i < 8; i++) {
        if (i >= octaves) break;
        val += amp * noise3D(p * freq);
        maxVal += amp;
        amp *= gain;
        freq *= lacunarity;
    }
    return val / maxVal;
}
float turbulence(vec3 p, int octaves) {
    float val = 0.0, amp = 1.0, freq = 1.0, maxVal = 0.0;
    for (int i = 0; i < 6; i++) {
        if (i >= octaves) break;
        val += amp * abs(noise3D(p * freq) * 2.0 - 1.0);
        maxVal += amp;
        amp *= 0.5;
        freq *= 2.0;
    }
    return val / maxVal;
}
`;

// ── 通用 Vertex Shader ──
const PLANET_VS = `
varying vec3 vPos;
varying vec3 vNormal;
varying vec3 vWorldPos;
void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    vPos = position;
    vNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// ── 太陽 ──
const SUN_FS = NOISE_GLSL + `
varying vec3 vPos;
varying vec3 vNormal;
uniform float uTime;
uniform vec3 uLightPos;
void main() {
    vec3 pos = normalize(vPos);
    float limb = pow(abs(dot(pos, vec3(0.0,0.0,1.0))), 0.30);
    float gran1 = fbm(pos*18.0 + vec3(uTime*0.012), 5, 2.5, 0.50);
    float gran2 = fbm(pos*30.0 + vec3(uTime*0.022 + 2.0), 3, 2.2, 0.45);
    float gran = gran1*0.70 + gran2*0.30;
    float spotField = fbm(pos*3.5 + vec3(4.5), 4, 2.0, 0.55);
    float spotSize = fbm(pos*8.0 + vec3(1.3), 2, 1.6, 0.50);
    float spot = smoothstep(0.20, 0.23, spotField);
    spot = spot < 0.5 ? 0.0 : pow(1.0 - spotField/0.22, 3.5)*(0.50 + spotSize*0.30);
    float penumbra = smoothstep(0.23, 0.32, spotField)*(1.0 - smoothstep(0.20, 0.22, spotField))*0.25;
    float flare1 = fbm(pos*12.0 + vec3(1.0), 3, 2.0, 0.45);
    float flare2 = fbm(pos*22.0 + vec3(5.0), 2, 1.8, 0.40);
    float flare = smoothstep(0.72, 0.78, flare1)*0.35 + smoothstep(0.76, 0.82, flare2)*0.20;
    float superGran = fbm(pos*5.0 + vec3(2.0), 3, 2.8, 0.50);
    vec3 photo = vec3(1.0,0.85,0.28);
    vec3 chromo= vec3(1.0,0.90,0.42);
    vec3 spotC = vec3(0.10,0.03,0.00);
    vec3 penC  = vec3(0.28,0.14,0.02);
    vec3 color = mix(photo, chromo, gran*0.85);
    color = mix(color, spotC, spot);
    color = mix(color, penC, penumbra);
    color += flare * vec3(1.0,0.95,0.55);
    color += gran2 * vec3(0.10,0.06,0.01);
    color += superGran * vec3(0.05,0.03,-0.02);
    color *= mix(0.06, 1.0, limb);
    color += vec3(0.18,0.05,0.0)*(1.0-limb)*0.50;
    gl_FragColor = vec4(color, 1.0);
}
`;

// ── 水星 ──
const MERCURY_FS = NOISE_GLSL + `
varying vec3 vPos;
varying vec3 vNormal;
varying vec3 vWorldPos;
uniform vec3 uLightPos;
uniform float uTime;
void main() {
    vec3 pos = normalize(vPos);
    vec3 N = normalize(vNormal);
    vec3 L = normalize(uLightPos - vWorldPos);
    float high = fbm(pos*14.0, 6, 2.7, 0.52);
    float mid  = fbm(pos*28.0 + vec3(2.0), 4, 2.3, 0.48);
    float ridge= fbm(pos*45.0 + vec3(5.0), 3, 2.1, 0.45);
    float crate= fbm(pos*8.0 + vec3(1.5), 5, 2.0, 0.50);
    float micro= fbm(pos*60.0 + vec3(3.0), 3, 2.5, 0.42);
    float bC = smoothstep(0.36, 0.48, crate);
    float mC = smoothstep(0.40, 0.53, crate+0.12);
    float sC = smoothstep(0.42, 0.58, crate*0.80+micro*0.20);
    float bright = 0.40 + high*0.38 + mid*0.12 + ridge*0.06;
    bright -= bC*0.20 + mC*0.12 + sC*0.08;
    vec3 color = vec3(bright);
    color.r += 0.05; color.g += 0.02; color.b -= 0.04;
    color += bC*vec3(0.08,0.05,0.03);
    color += ridge*vec3(0.03,0.02,-0.01);
    float diff = max(0.0, dot(N,L))*0.80 + 0.20;
    color *= diff;
    gl_FragColor = vec4(color, 1.0);
}
`;

// ── 金星 ──
const VENUS_FS = NOISE_GLSL + `
varying vec3 vPos;
varying vec3 vNormal;
varying vec3 vWorldPos;
uniform vec3 uLightPos;
uniform float uTime;
void main() {
    vec3 pos = normalize(vPos);
    vec3 N = normalize(vNormal);
    vec3 L = normalize(uLightPos - vWorldPos);
    float turb1 = turbulence(pos*vec3(9.0,0.35,9.0)+vec3(noise3D(pos*3.0)*0.35), 5);
    float turb2 = turbulence(pos*vec3(16.0,0.25,16.0) + vec3(1.8), 4);
    float detail= fbm(pos*24.0 + vec3(2.0), 4, 2.7, 0.42);
    float bands  = sin(pos.y*26.0+noise3D(pos*4.5)*5.5)*0.50+0.50;
    float swirls = fbm(pos*12.0+vec3(0.0,uTime*0.0015,0.0), 3, 2.4, 0.45);
    vec3 cream =vec3(0.95,0.91,0.84);
    vec3 yellow=vec3(0.91,0.86,0.77);
    vec3 ochre =vec3(0.86,0.79,0.68);
    vec3 sulfur=vec3(0.89,0.83,0.60);
    vec3 color = mix(cream, yellow, bands*0.65+0.18);
    color = mix(color, ochre, turb1*0.55);
    color = mix(color, sulfur, turb2*0.35);
    color += swirls*vec3(0.04,0.02,-0.01);
    color += detail*vec3(0.02,0.01,0.01);
    float diff = max(0.0, dot(N,L))*0.76 + 0.24;
    color *= diff;
    gl_FragColor = vec4(color, 1.0);
}
`;

// ── 地球 ──
const EARTH_FS = NOISE_GLSL + `
varying vec3 vPos;
varying vec3 vNormal;
varying vec3 vWorldPos;
uniform vec3 uLightPos;
uniform float uTime;
void main() {
    vec3 pos = normalize(vPos);
    vec3 N = normalize(vNormal);
    vec3 L = normalize(uLightPos - vWorldPos);
    float lat = abs(pos.y);
    float c1 = fbm(pos*3.8, 5, 3.0, 0.55);
    float c2 = fbm(pos*7.0 + vec3(1.5), 4, 2.7, 0.50);
    float c3 = fbm(pos*2.0 + vec3(0.5), 3, 2.2, 0.45);
    float cont = c1*0.50 + c2*0.30 + c3*0.20;
    float detail = fbm(pos*24.0, 4, 2.6, 0.45);
    float mtn    = fbm(pos*30.0 + vec3(2.5), 3, 2.3, 0.50);
    float biome  = fbm(pos*9.0 + vec3(1.0), 3, 2.4, 0.48);
    float landMask = smoothstep(0.47, 0.54, cont);
    vec3 oceanSh = vec3(0.06,0.22,0.50);
    vec3 oceanMid= vec3(0.03,0.16,0.40);
    vec3 oceanDp = vec3(0.01,0.10,0.30);
    float od = 1.0 - cont/0.50;
    vec3 ocean = mix(oceanSh, oceanMid, smoothstep(0.20,0.60,od));
    ocean = mix(ocean, oceanDp, smoothstep(0.60,1.0,od));
    ocean += detail*vec3(0.01,0.02,0.03);
    float elev = cont + mtn*0.35;
    vec3 desert = vec3(0.80,0.66,0.38);
    vec3 savanna= vec3(0.58,0.50,0.24);
    vec3 forest = vec3(0.16,0.40,0.14);
    vec3 grass  = vec3(0.36,0.48,0.20);
    vec3 taiga  = vec3(0.24,0.40,0.18);
    vec3 rock   = vec3(0.50,0.42,0.32);
    vec3 snow   = vec3(0.95,0.96,0.97);
    vec3 land;
    if(elev > 0.78) land = mix(rock, snow, (elev-0.78)/0.22);
    else if(elev > 0.65) land = mix(rock*0.70, rock, (elev-0.65)/0.13);
    else if(biome < 0.20) land = desert;
    else if(biome < 0.35) land = savanna;
    else if(biome < 0.55) land = forest;
    else if(biome < 0.75) land = grass;
    else land = taiga;
    land += detail*vec3(0.04,0.03,0.01);
    float iceN = smoothstep(0.75,0.92,pos.y);
    float iceS = smoothstep(0.75,0.92,-pos.y);
    float ice = max(iceN,iceS)*0.85;
    float greenland = smoothstep(0.55,0.75,pos.y)*(1.0-smoothstep(0.50,0.68,abs(pos.x-0.18)));
    ice = max(ice, greenland*0.65);
    vec3 color = mix(ocean, land, landMask);
    color = mix(color, snow, ice);
    float clouds = fbm(pos*20.0+vec3(uTime*0.003,0.0,uTime*0.002), 4, 2.7, 0.42);
    float cMask = smoothstep(0.48,0.58,clouds);
    color = mix(color, vec3(0.96), cMask*0.18);
    float diff = max(0.0, dot(N,L))*0.82 + 0.18;
    color *= diff;
    float rim = 1.0 - abs(dot(N, normalize(vWorldPos-uLightPos)));
    color += pow(rim,4.0)*vec3(0.22,0.50,1.0)*0.15;
    gl_FragColor = vec4(color, 1.0);
}
`;

// ── 火星 ──
const MARS_FS = NOISE_GLSL + `
varying vec3 vPos;
varying vec3 vNormal;
varying vec3 vWorldPos;
uniform vec3 uLightPos;
uniform float uTime;
void main() {
    vec3 pos = normalize(vPos);
    vec3 N = normalize(vNormal);
    vec3 L = normalize(uLightPos - vWorldPos);
    float lat = abs(pos.y);
    float high = fbm(pos*11.0, 6, 2.6, 0.52);
    float low  = fbm(pos*7.0 + vec3(3.0), 4, 2.4, 0.50);
    float detail=fbm(pos*30.0 + vec3(1.5), 4, 2.4, 0.42);
    float crate = fbm(pos*14.0 + vec3(2.0), 5, 2.1, 0.48);
    float dust  = fbm(pos*48.0 + vec3(5.0), 3, 2.6, 0.40);
    vec3 rust  = vec3(0.84,0.34,0.16);
    vec3 ochre = vec3(0.74,0.30,0.13);
    vec3 dark  = vec3(0.42,0.16,0.06);
    vec3 tan   = vec3(0.90,0.50,0.26);
    vec3 basalt= vec3(0.28,0.12,0.05);
    vec3 color = mix(dark, rust, high*0.82+0.10);
    color = mix(color, ochre, low*0.52);
    color = mix(color, tan, detail*0.25);
    color += dust*vec3(0.06,0.03,-0.01);
    float craterMask = smoothstep(0.30,0.44,crate);
    color = mix(color, basalt*0.70, craterMask*0.35);
    float polar = smoothstep(0.80,0.95,lat);
    color = mix(color, vec3(0.93,0.92,0.91), polar*0.60);
    float diff = max(0.0, dot(N,L))*0.82 + 0.18;
    color *= diff;
    float rim = 1.0 - abs(dot(N, normalize(vWorldPos-uLightPos)));
    color += pow(rim,4.5)*vec3(0.75,0.45,0.25)*0.06;
    gl_FragColor = vec4(color, 1.0);
}
`;

// ── 木星 ──
const JUPITER_FS = NOISE_GLSL + `
varying vec3 vPos;
varying vec3 vNormal;
varying vec3 vWorldPos;
uniform vec3 uLightPos;
uniform float uTime;
void main() {
    vec3 pos = normalize(vPos);
    vec3 N = normalize(vNormal);
    vec3 L = normalize(uLightPos - vWorldPos);
    float bandFreq = 17.0 + noise3D(pos*2.2)*10.0;
    float bands = fbm(pos*vec3(2.6,bandFreq,2.6), 6, 2.7, 0.55);
    float turb  = turbulence(pos*vec3(13.0,0.50,13.0)+vec3(bands*0.35), 5);
    float fine  = fbm(pos*30.0 + vec3(2.5), 4, 2.5, 0.35);
    float bandPat = sin(pos.y*28.0 + bands*6.5);
    float band2   = sin(pos.y*42.0 + bands*3.5 + 1.5)*0.50+0.50;
    float isZone  = smoothstep(-0.08, 0.45, bandPat);
    vec3 cream = vec3(0.96,0.89,0.73);
    vec3 gold  = vec3(0.91,0.81,0.61);
    vec3 tan   = vec3(0.72,0.54,0.30);
    vec3 brown = vec3(0.60,0.40,0.20);
    vec3 redB  = vec3(0.66,0.26,0.12);
    vec3 base = mix(tan, cream, isZone);
    base = mix(base, gold, band2*0.45);
    float redLat = smoothstep(0.14,0.19,abs(pos.y)) - smoothstep(0.24,0.28,abs(pos.y));
    base = mix(base, redB, redLat*0.58);
    vec3 color = base;
    color += turb*vec3(0.08,0.05,0.03);
    color += fine*vec3(0.02,0.015,0.005);
    vec2 sc = vec2(0.38,0.22);
    float sd = length(pos.xz - sc);
    float sm = 1.0 - smoothstep(0.022,0.085,sd);
    float sw = fbm((pos+vec3(0.38,0.22,0.0))*40.0+vec3(uTime*0.0015), 3, 2.3, 0.45);
    vec3 spotC = mix(vec3(0.83,0.36,0.20), vec3(0.92,0.52,0.32), sw);
    color = mix(color, spotC, sm*0.85);
    float o1 = 1.0 - smoothstep(0.012,0.035, length(pos.xz-vec2(-0.22,-0.28)));
    float o2 = 1.0 - smoothstep(0.010,0.030, length(pos.xz-vec2(-0.12,0.32)));
    color = mix(color, vec3(0.95,0.92,0.85), o1*0.50);
    color = mix(color, vec3(0.93,0.90,0.82), o2*0.45);
    float diff = max(0.0, dot(N,L))*0.80 + 0.20;
    color *= diff;
    gl_FragColor = vec4(color, 1.0);
}
`;

// ── 土星 ──
const SATURN_FS = NOISE_GLSL + `
varying vec3 vPos;
varying vec3 vNormal;
varying vec3 vWorldPos;
uniform vec3 uLightPos;
uniform float uTime;
void main() {
    vec3 pos = normalize(vPos);
    vec3 N = normalize(vNormal);
    vec3 L = normalize(uLightPos - vWorldPos);
    float bands  = fbm(pos*vec3(1.7,11.0,1.7), 5, 2.6, 0.52);
    float bands2 = fbm(pos*vec3(1.5,20.0,1.5) + vec3(1.5), 4, 2.4, 0.48);
    float turb   = turbulence(pos*vec3(9.0,0.32,9.0)+vec3(bands*0.25), 4);
    float detail = fbm(pos*26.0 + vec3(2.0), 4, 2.5, 0.35);
    float bMix = sin(pos.y*30.0+bands*5.5)*0.50+0.50;
    float bMix2= sin(pos.y*50.0+bands2*3.5+1.3)*0.50+0.50;
    vec3 cream=vec3(0.94,0.88,0.75);
    vec3 gold =vec3(0.91,0.83,0.66);
    vec3 tan  =vec3(0.83,0.73,0.55);
    vec3 brown=vec3(0.66,0.52,0.34);
    vec3 grey =vec3(0.76,0.69,0.56);
    vec3 color = mix(gold, cream, bMix*0.65);
    color = mix(color, tan, bMix2*0.40);
    color = mix(color, brown, turb*0.30);
    color += detail*vec3(0.02,0.015,0.01);
    float polar = smoothstep(0.68,0.88,abs(pos.y));
    color = mix(color, grey, polar*0.42);
    float diff = max(0.0, dot(N,L))*0.82 + 0.18;
    color *= diff;
    gl_FragColor = vec4(color, 1.0);
}
`;

// ── 天王星 ──
const URANUS_FS = NOISE_GLSL + `
varying vec3 vPos;
varying vec3 vNormal;
varying vec3 vWorldPos;
uniform vec3 uLightPos;
uniform float uTime;
void main() {
    vec3 pos = normalize(vPos);
    vec3 N = normalize(vNormal);
    vec3 L = normalize(uLightPos - vWorldPos);
    float bands  = fbm(pos*vec3(1.5,4.5,1.5), 4, 2.4, 0.50);
    float bands2 = fbm(pos*vec3(1.4,8.0,1.4) + vec3(2.0), 3, 2.2, 0.48);
    float detail = fbm(pos*22.0 + vec3(1.0), 4, 2.4, 0.38);
    float haze   = fbm(pos*14.0, 3, 2.1, 0.45);
    vec3 aqua =vec3(0.56,0.83,0.86);
    vec3 teal =vec3(0.52,0.78,0.82);
    vec3 soft =vec3(0.64,0.88,0.90);
    vec3 white=vec3(0.86,0.93,0.95);
    vec3 color = mix(teal, aqua, bands*0.58+0.22);
    color = mix(color, soft, bands2*0.38);
    color += haze*vec3(0.04,0.03,0.02);
    color += detail*vec3(0.02,0.02,0.02);
    float polar = smoothstep(0.62,0.88,abs(pos.y));
    color = mix(color, white, polar*0.52);
    float diff = max(0.0, dot(N,L))*0.83 + 0.17;
    color *= diff;
    gl_FragColor = vec4(color, 1.0);
}
`;

// ── 海王星 ──
const NEPTUNE_FS = NOISE_GLSL + `
varying vec3 vPos;
varying vec3 vNormal;
varying vec3 vWorldPos;
uniform vec3 uLightPos;
uniform float uTime;
void main() {
    vec3 pos = normalize(vPos);
    vec3 N = normalize(vNormal);
    vec3 L = normalize(uLightPos - vWorldPos);
    float bands  = fbm(pos*vec3(1.7,6.0,1.7), 4, 2.5, 0.52);
    float bands2 = fbm(pos*vec3(1.6,10.0,1.6) + vec3(1.0), 3, 2.3, 0.48);
    float turb   = turbulence(pos*vec3(10.0,0.42,10.0), 4);
    float detail = fbm(pos*24.0 + vec3(2.5), 4, 2.5, 0.36);
    vec3 deep  =vec3(0.28,0.50,0.76);
    vec3 blue  =vec3(0.36,0.60,0.82);
    vec3 bright=vec3(0.48,0.70,0.89);
    vec3 white =vec3(0.82,0.90,0.96);
    vec3 color = mix(deep, blue, bands*0.62+0.20);
    color = mix(color, bright, bands2*0.42);
    color += turb*vec3(0.04,0.03,0.05);
    color += detail*vec3(0.02,0.02,0.03);
    float brightSpot = fbm(pos*16.0 + vec3(3.5), 3, 2.1, 0.50);
    float spotMask = smoothstep(0.77,0.87,brightSpot);
    color = mix(color, white, spotMask*0.55);
    float southP = smoothstep(-0.88,-0.58,pos.y);
    color = mix(color, bright, southP*0.38);
    float diff = max(0.0, dot(N,L))*0.80 + 0.20;
    color *= diff;
    gl_FragColor = vec4(color, 1.0);
}
`;

// ── 土星光環 ──
const RING_FS = `
varying vec2 vUv;
uniform float uTime;
void main() {
    float r = vUv.x;
    vec3 col;
    if(r<0.06){col=vec3(0.10,0.08,0.05);}
    else if(r<0.08){col=vec3(0.22,0.16,0.09);}
    else if(r<0.18){col=vec3(0.89,0.81,0.66);}
    else if(r<0.22){col=vec3(0.05,0.04,0.03);}
    else if(r<0.35){col=vec3(0.95,0.86,0.73);}
    else if(r<0.40){col=vec3(0.46,0.39,0.29);}
    else if(r<0.55){col=vec3(0.91,0.83,0.67);}
    else if(r<0.60){col=vec3(0.36,0.29,0.21);}
    else if(r<0.75){col=vec3(0.81,0.73,0.59);}
    else if(r<0.85){col=vec3(0.52,0.44,0.34);}
    else if(r<0.92){col=vec3(0.26,0.21,0.15);}
    else{col=vec3(0.05,0.04,0.02);}
    float grain = fract(sin(dot(vec2(r*260.0,vUv.y*130.0),vec2(12.9898,78.233)))*43758.5453);
    col += grain*0.045;
    float alpha=1.0;
    if(r<0.05||r>0.94){alpha=(r<0.05?r/0.05:(1.0-r)/0.06)*0.30;}
    else if(r>0.20&&r<0.24){alpha=0.08;}
    else if(r>0.38&&r<0.42){alpha=0.12;}
    gl_FragColor = vec4(col, alpha);
}
`;
