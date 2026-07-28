
// ═══════════════════════════════════════════════════════════

// 轨道之眼 OrbitEye — 仪表盘核心逻辑

// Extracted from dashboard.html

// ═══════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════
// CORE — 参考 DeepSpace-Survival-Simulator 的可靠模式
// ═══════════════════════════════════════════════════════════
const API_URL = (location.protocol==='file:')?'http://127.0.0.1:5500/api/space':'/api/space';
function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
function showError(id, msg) {
const le = document.getElementById(id+'-loading');  if (le) { le.classList.remove('shimmer'); le.innerHTML = '<span class="r">X '+msg+'</span>'; }  
const ce = document.getElementById(id+'-content');  if (ce) ce.classList.add('hidden');}
function showContent(id) {  
const le = document.getElementById(id+'-loading');  if (le) le.classList.add('hidden');
const ce = document.getElementById(id+'-content');  if (ce) ce.classList.remove('hidden');}

// ── Navigation ──────────────────────────────────
let curPg = 0;
const tabs = document.querySelectorAll('.nav-t');
const pgs = document.querySelectorAll('.pg');
const ind = document.getElementById('nav-ind');
function goPg(n) {  if (n === curPg) return;  pgs[curPg].classList.remove('on');  pgs[n].classList.add('on');  tabs.forEach(t => t.classList.remove('on'));  tabs[n].classList.add('on');  ind.style.transform = 'translateY('+(72+n*46)+'px)';  
// 导航指示器颜色随页面切换  
const accentColors = ['#38bdf8', '#fbbf24', '#c084fc'];  ind.style.background = accentColors[n];  ind.style.boxShadow = '0 0 18px '+accentColors[n]+', 0 0 36px '+accentColors[n]+'55';  curPg = n;  if (n === 0 && window._resumeGlobe) setTimeout(()=>window._resumeGlobe(), 120);}tabs.forEach(t => t.addEventListener('click', () => goPg(+t.dataset.pg)));
document.addEventListener('keydown', e => {  if (e.key==='1') goPg(0);  if (e.key==='2') goPg(1);  if (e.ctrlKey && e.key==='r') { e.preventDefault(); refreshAll(); }});

// ── Data fetching (copy reference pattern exactly) ──
async function fetchISS() {  try {    
const res = await fetch(API_URL+'/iss');
const d = await res.json();
document.getElementById('iss-lat').innerText = parseFloat(d.iss_position.latitude).toFixed(4);
document.getElementById('iss-lon').innerText = parseFloat(d.iss_position.longitude).toFixed(4);
document.getElementById('iss-time').innerText = new Date(d.timestamp*1000).toLocaleTimeString('zh-TW',{hour12:false});    if (d.macao_link) {      document.getElementById('mo-dist').innerText = d.macao_link.distance_km+' km';
document.getElementById('mo-link').innerText = d.macao_link.status==='IN_RANGE'?'ISS 在澳门附近':'ISS 距澳门较远';
const mp = document.getElementById('mo-panel');      if (d.macao_link.alarm) {        mp.style.borderColor = 'rgba(248,113,113,.4)';        mp.style.background = 'rgba(248,113,113,.04)';
document.getElementById('mo-link').style.cssText = 'color:#f87171;font-weight:bold';      } else {        mp.style.borderColor = 'rgba(56,189,248,.2)';        mp.style.background = 'rgba(56,189,248,.015)';
document.getElementById('mo-link').style.cssText = 'color:#7dd3fc;font-weight:normal';      }    }    if (d.pass_predictions?.length) {      
const n = d.pass_predictions[0];
document.getElementById('iss-pass').innerHTML = 'NEXT PASS: <span class="w">'+n.start_in_minutes+' min</span> ('+n.duration_minutes+' min)';
document.getElementById('iss-pass').classList.remove('hidden');    }    if (d._source==='demo') {      document.getElementById('demo-badge').style.display='block';
document.getElementById('bt-demo').style.display='inline';    }    document.getElementById('iss-tag').textContent = d._source==='demo'?'演示':'实时';    updGlobe(parseFloat(d.iss_position.latitude),parseFloat(d.iss_position.longitude),d.macao_link?.distance_km||0);    showContent('iss');  } catch(e) {    
const ce = document.getElementById('iss-content');    if (ce && ce.classList.contains('hidden')) showError('iss','TELEMETRY LOST');  }}
async function fetchSpaceBody() {  try {    
const le = document.getElementById('space-loading');    le.innerHTML = 'TUNING...'; le.classList.add('shimmer'); le.classList.remove('hidden');
document.getElementById('space-content').classList.add('hidden');
const bt = document.getElementById('planet-select').value;
const res = await fetch(API_URL+'/space-body?type='+bt);
const d = await res.json();    if (d.imageUrl) {      document.getElementById('space-img').src = d.imageUrl;
document.getElementById('space-date').innerText = d.date||'--';
document.getElementById('space-cap').innerText = d.caption||'--';      showContent('space');    } else { showError('space','NO TEXTURE'); }  } catch(e) { showError('space','LINK EXPIRED'); }}
async function fetchWeather() {  try {    
const le = document.getElementById('weather-loading');    le.innerHTML = 'SYNCING...'; le.classList.add('shimmer'); le.classList.remove('hidden');
document.getElementById('weather-content').classList.add('hidden');
const ct = document.getElementById('city-select').value;
const res = await fetch(API_URL+'/weather?city='+encodeURIComponent(ct));
const d = await res.json();
document.getElementById('w-status').innerText = d.weather||'--';
document.getElementById('w-temp').innerText = d.temp||'--';
document.getElementById('w-aqi').innerText = d.aqi||'--';
document.getElementById('w-aqiname').innerText = '['+(d.aqi_name||'N/A')+']';
document.getElementById('w-wind').innerText = d.wind_dir?d.wind_dir+' '+d.wind_power+'级':'--';
document.getElementById('w-humid').innerText = d.humidity||'--';
const windBar = document.getElementById('w-wind-bar'); if (windBar) windBar.style.width = Math.min(100,Math.max(8,((parseInt(d.wind_power)||0)/12*100)))+'%';    if (d._source==='demo') document.getElementById('demo-badge').style.display='block';    showContent('weather');  } catch(e) { showError('weather','OFFLINE'); }}

// ── 各 API 拉取 ───────────────────────────────────────
async function fetchAPOD() {  try {    
const res = await fetch(API_URL+'/apod');
const d = await res.json();
document.getElementById('apod-title').innerText = d.title||'--';
document.getElementById('apod-expl').innerText = d.explanation||'--';
const img = document.getElementById('apod-img');    img.src = d.imageUrl||'';    showContent('apod');  } catch(e) { showError('apod','APOD LOST'); }}
// [合并] 太空威胁: 太阳风暴 + 近地小行星
async function fetchThreats() {
  const le = document.getElementById("threat-loading");
  le.classList.remove("hidden"); le.classList.add("shimmer");
  document.getElementById("threat-content").classList.add("hidden");
  let ok = false;
  try {
    const r = await fetch(API_URL+"/solar-storm");
    const d = await r.json();
    document.getElementById("st-note-short").innerText = (d.note||"--").substring(0,80);
    document.getElementById("st-ins").innerText = d.instruments||"--";
    if (d.storm_active) { triggerStormAlert(true); } else { triggerStormAlert(false); }
    ok = true;
  } catch(e) {}
  try {
    const r = await fetch(API_URL+"/neo");
    const d = await r.json();
    const list = document.getElementById("neo-list"); list.innerHTML = "";
    const haz = (d.objects||[]).filter(o=>o.hazardous).length;
    const alert = document.getElementById("neo-alert");
    if (haz) { alert.innerHTML = "⚠ "+haz+"颗危险小行星"; alert.style.color="var(--danger)"; }
    else { alert.textContent = (d.count||0)+"颗近地天体, 全部安全"; alert.style.color="var(--dim)"; }
    (d.objects||[]).slice(0,6).forEach(o=>{
      list.innerHTML+="<div class=\"flex justify-between items-center bg-black/30 p-1.5 border border-[var(--border)] rounded text-[10px]\"><span class=\"text-white\">"+o.name+"</span><span class=\"text-gray-500\">"+o.diameter_km+"km</span><span class=\""+(o.hazardous?"text-red-400":"text-gray-400")+"\">"+o.miss_distance_lunar+"LD</span><span class=\"text-gray-600 text-[8px]\">"+o.approach_date+"</span></div>";
    });
    ok = true;
  } catch(e) {}
  if (ok) showContent("threat"); else showError("threat","OFFLINE");
}
async function fetchMarsWeather() {  try {
	const res = await fetch(API_URL+'/mars-weather');
	const d = await res.json();
	const list = document.getElementById('mars-sol-list');    list.innerHTML = '<div class="text-[10px] text-gray-500 mb-1">'+d.station+'</div>';    (d.sols||[]).forEach(s=>{      const windStr = (s.wind_mps != null) ? s.wind_mps+'m/s' : (s.atmo_opacity||'--');      list.innerHTML+=`<div class="flex justify-between bg-black/30 p-1.5 border border-[var(--border)] rounded">        <span class="text-red-400">Sol ${s.sol}</span><span class="text-white">${s.max_temp_c!=null?s.max_temp_c+'°C':'--'}</span><span class="text-blue-400">${s.min_temp_c!=null?s.min_temp_c+'°C':'--'}</span>        <span class="text-gray-500">${windStr}</span><span class="text-gray-600 text-[8px]">${s.season||'--'}</span></div>`;    });    showContent('mars-weather');  } catch(e) { showError('mars-weather','MARS LOST'); }}
async function fetchNews() {  try {    
const res = await fetch(API_URL+'/news');
const d = await res.json();
const list = document.getElementById('news-list');    list.innerHTML = '';    (d.articles||[]).slice(0,6).forEach(a=>{      list.innerHTML+=`<a href="${a.url}" target="_blank" class="block bg-black/30 p-2 border border-[var(--border)] rounded hover:bg-black/50 transition">        <div class="text-[11px] text-white leading-tight">${a.title}</div>        <div class="flex justify-between mt-1 text-[8px]"><span class="text-sky-400">${a.source}</span><span class="text-gray-500">${a.published}</span></div></a>`;    });    showContent('news');  } catch(e) { showError('news','NEWS LOST'); }}
// [合并] 航天发射: SpaceX最新 + 即将发射
async function fetchLaunches() {
  const le = document.getElementById("launch-loading");
  le.classList.remove("hidden"); le.classList.add("shimmer");
  document.getElementById("launch-content").classList.add("hidden");
  let ok = false;
  try {
    const r = await fetch(API_URL+"/spacex");
    const d = await r.json();
    document.getElementById("sx-name").innerText = d.name||"--";
    document.getElementById("sx-date").innerText = d.date||"--";
    document.getElementById("sx-details").innerText = d.details||"--";
    if (d._source==="demo") { document.getElementById("demo-badge").style.display="block"; document.getElementById("bt-demo").style.display="inline"; }
    ok = true;
  } catch(e) {}
  try {
    const r = await fetch(API_URL+"/launches");
    const d = await r.json();
    const list = document.getElementById("launch-list"); list.innerHTML = "";
    (d.launches||[]).slice(0,6).forEach(l=>{
      list.innerHTML+="<div class=\"bg-black/30 p-1.5 border border-[var(--border)] rounded text-[10px]\"><div class=\"text-white font-bold\">"+l.name+"</div><div class=\"flex justify-between mt-0.5\"><span class=\"text-green-400\">"+l.rocket+"</span><span class=\"text-gray-500\">"+l.window_start+"</span></div></div>";
    });
    ok = true;
  } catch(e) {}
  if (ok) showContent("launch"); else showError("launch","OFFLINE");
}
async function fetchExoplanets() {  try {    
const res = await fetch(API_URL+'/exoplanets');
const d = await res.json();
const list = document.getElementById('exo-list');    list.innerHTML = '';    (d.planets||[]).slice(0,8).forEach(p=>{      
	list.innerHTML+=`<div class="flex justify-between items-center bg-black/30 p-1.5 border border-[var(--border)] rounded text-[10px]"><span class="text-white">${p.name||'--'}</span><span class="text-gray-500">${p.distance_ly||'--'} ly</span><span class="text-indigo-400">${p.mass_earth||'--'} M⊕</span><span class="text-amber-400">${p.radius_earth||'--'} R⊕</span><span class="text-gray-600 text-[8px]">${p.orbit_days||'--'} d</span></div>`;    });    showContent('exo');  } catch(e) { showError('exo','EXO LOST'); }}
async function fetchISSPassDetail() { try {
    const res = await fetch(API_URL+'/iss-pass-detail');
    const d = await res.json();
    document.getElementById('iss-pass-dist').innerText = d.current_distance_km+' km';
    const list = document.getElementById('iss-pass-list'); list.innerHTML = '';
    (d.next_passes||[]).forEach(p => {
      list.innerHTML+=`<div class="flex justify-between items-center bg-black/30 p-1 border border-[var(--border)] rounded text-[9px]"><span class="text-sky-400">${p.start_time_hkt||''}</span><span class="text-white">${p.duration_minutes}min</span><span class="text-gray-500">${p.min_distance_km}km</span></div>`;
    });
    document.getElementById('iss-pass-detail').classList.remove('hidden');
  } catch(e) { /* 静默降级 */ } }
// [合并] 天文观测: 观星预报 + 月相月历
async function fetchObserving() {
  const le = document.getElementById("obs-loading");
  le.classList.remove("hidden"); le.classList.add("shimmer");
  document.getElementById("obs-content").classList.add("hidden");
  let ok = false;
  try {
    const r = await fetch(API_URL+"/observing");
    const d = await r.json();
    document.getElementById("obs-score").innerText = d.observing_score+" / 100";
    const gb = document.getElementById("obs-grade-badge");
    gb.textContent = d.grade||"--";
    if ((d.grade||"").startsWith("A")) { gb.style.color="var(--good)"; gb.style.borderColor="rgba(52,211,153,.4)"; }
    else if ((d.grade||"").startsWith("B")) { gb.style.color="#fbbf24"; gb.style.borderColor="rgba(251,191,36,.4)"; }
    else { gb.style.color="var(--warn)"; gb.style.borderColor="rgba(248,113,113,.4)"; }
    document.getElementById("obs-moon-phase").innerText = d.moon_phase||"--";
    document.getElementById("obs-moon-illum").innerText = d.moon_illumination||"--";
    document.getElementById("obs-planets").innerText = (d.visible_planets||[]).join(" · ");
    document.getElementById("obs-tip").innerText = d.tip||"";
    ok = true;
  } catch(e) {}
  try {
    const r = await fetch(API_URL+"/moon-calendar");
    const d = await r.json();
    const list = document.getElementById("mooncal-forecast"); list.innerHTML = "";
    (d.forecast||[]).forEach(e => {
      list.innerHTML+="<div><span class=\"text-white\">"+e.date.slice(5)+"</span><br><span class=\"text-gray-400 text-[8px]\">"+e.phase+"</span><br><span class=\"text-gray-500 text-[8px]\">"+e.illumination+"%</span></div>";
    });
    ok = true;
  } catch(e) {}
  if (ok) showContent("obs"); else showError("obs","OFFLINE");
}
async function fetchHealth() { try {
    const res = await fetch(API_URL+'/health');
    const d = await res.json();
    const led = document.getElementById('health-led');
    const txt = document.getElementById('health-text');
    if (d.status==='ONLINE') {
      led.style.background='#34d399'; led.style.boxShadow='0 0 6px #34d399';
      txt.textContent = '全部在线';
      txt.style.color = 'var(--good)';
    } else {
      led.style.background='#f87171';
      txt.textContent = d.status||'异常';
    }
  } catch(e) {
    const led = document.getElementById('health-led');
    if (led) { led.style.background='#f87171'; led.style.boxShadow='none'; }
    const txt = document.getElementById('health-text');
    if (txt) { txt.textContent = '离线'; txt.style.color = 'var(--warn)'; }
  } }
function refreshAll() { fetchISS(); fetchLaunches(); fetchSpaceBody(); fetchWeather(); fetchThreats(); fetchAPOD(); fetchMarsWeather(); fetchNews(); fetchExoplanets(); fetchObserving(); fetchHealth(); fetchISSPassDetail(); }

// ── 3D Globe ─────────────────────────────────────
let GR = null;
function llv(lat,lon,r) {  
const phi=(90-lat)*Math.PI/180, theta=(lon+180)*Math.PI/180, sp=Math.sin(phi);  return new THREE.Vector3(-r*sp*Math.cos(theta), r*Math.cos(phi), r*sp*Math.sin(theta));}
function initGlobe() {  
const ct = document.getElementById('globe-ct'), W=ct.clientWidth, H=ct.clientHeight;
const sc = new THREE.Scene();
const cam = new THREE.PerspectiveCamera(45,W/H,.1,1000); cam.position.set(0,0,3.8);
const rn = new THREE.WebGLRenderer({antialias:true,alpha:true}); rn.setSize(W,H); rn.setPixelRatio(Math.min(devicePixelRatio,2));  ct.appendChild(rn.domElement);
const ctrl = new THREE.OrbitControls(cam,rn.domElement); ctrl.enableDamping=true; ctrl.autoRotate=false; ctrl.enablePan=false; ctrl.minDistance=2.5; ctrl.maxDistance=6; ctrl.target.set(0,0,0);
const sg = new THREE.SphereGeometry(8,64,64);
const sm = new THREE.ShaderMaterial({vertexShader:'varying vec3 p;void main(){p=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',fragmentShader:'precision highp float;varying vec3 p;float r(vec3 p){return fract(sin(dot(p,vec3(12.9898,78.233,45.5432)))*43758.5453);}void main(){float b=smoothstep(.997,1.,r(floor(p*200.)));gl_FragColor=vec4(vec3(.5,.8,1.)*b,b);}',side:THREE.BackSide,transparent:true});  sc.add(new THREE.Mesh(sg,sm));
const eg = new THREE.SphereGeometry(1.4,64,64), em = new THREE.MeshPhongMaterial({color:0x113355});
const earth = new THREE.Mesh(eg,em); sc.add(earth);  new THREE.TextureLoader().load('https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg', tex => {em.map=tex;em.color.set(0xffffff);em.needsUpdate=true;}, undefined, ()=>{});
const gg = new THREE.SphereGeometry(1.43,64,64);
const gm = new THREE.ShaderMaterial({vertexShader:'varying vec3 n;varying vec3 p;void main(){n=normalize(normalMatrix*normal);p=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',fragmentShader:'precision highp float;varying vec3 n;varying vec3 p;void main(){float i=pow(.65-dot(n,vec3(0,0,1)),3.);gl_FragColor=vec4(0,.6,1.,1.)*i*.4;}',side:THREE.FrontSide,transparent:true,blending:THREE.AdditiveBlending});  sc.add(new THREE.Mesh(gg,gm));  sc.add(new THREE.AmbientLight(0x334466,2.5));
const sl = new THREE.DirectionalLight(0xffffff,2); sl.position.set(5,1,3); sc.add(sl);
const mg = new THREE.Group(); mg.position.copy(llv(22.1989,113.5491,1.41)); mg.add(new THREE.Mesh(new THREE.SphereGeometry(.03,16,16),new THREE.MeshBasicMaterial({color:0xf87171}))); sc.add(mg);
const ig = new THREE.Group(); ig.add(new THREE.Mesh(new THREE.SphereGeometry(.024,12,12),new THREE.MeshBasicMaterial({color:0x34d399}))); sc.add(ig);
const al = new THREE.Line(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:0x38bdf8,transparent:true,opacity:.8,depthTest:false,depthWrite:false})); al.renderOrder=3; sc.add(al);
(function anim(){requestAnimationFrame(anim);if(curPg!==0)return;ctrl.update();rn.render(sc,cam);})();
window._resumeGlobe = () => { if(!GR) return; const ct=document.getElementById('globe-ct'); const w=ct.clientWidth, h=ct.clientHeight; if(w<10||h<10){setTimeout(()=>window._resumeGlobe(),100);return;} GR.cam.aspect=w/h; GR.cam.updateProjectionMatrix(); GR.rn.setSize(w,h); };  
window.addEventListener('resize',()=>{
const w=ct.clientWidth,h=ct.clientHeight;cam.aspect=w/h;cam.updateProjectionMatrix();rn.setSize(w,h);});  GR = {sc,earth,mg,ig,al,cam,ctrl,rn};}
function updGlobe(lat,lon,dist) {  if(!GR) return;
const {ig,al} = GR, ip = llv(lat,lon,1.43);  ig.position.copy(ip);
const mp = llv(22.1989,113.5491,1.43), mid = new THREE.Vector3().addVectors(mp,ip).normalize().multiplyScalar(1.50);
const cv = new THREE.QuadraticBezierCurve3(mp.clone(),mid,ip.clone());  al.geometry.dispose(); al.geometry = new THREE.BufferGeometry().setFromPoints(cv.getPoints(72));
document.getElementById('gl-pos').textContent = lat.toFixed(2)+' deg, '+lon.toFixed(2)+' deg';
document.getElementById('gl-dst').textContent = dist+' km';}
function toast(msg,cls){
const t=document.getElementById('toast');t.textContent=msg;t.className=cls;t.classList.add('on');clearTimeout(t._t);t._t=setTimeout(()=>t.classList.remove('on'),3000);}

// ── 操作教程切换 ──
function toggleGuide(){  
const pn=document.getElementById('guide-panel'),btn=document.getElementById('guide-toggle');  if(!pn||!btn)return;
const showing=pn.classList.contains('show');  if(showing){pn.classList.remove('show');btn.classList.remove('on');btn.textContent='?';}  else{pn.classList.add('show');btn.classList.add('on');btn.textContent='×';}}
// ═══════════════════════════════════════════════════

// ═══════════════════════════════════════════════════
// STORM ALERT — dashboard 风暴警报联动
// ═══════════════════════════════════════════════════
let stormAlertAudio=null;
function triggerStormAlert(active){  
const banner=document.getElementById('storm-alert-banner');  if(!banner)return;  if(active){    banner.style.display='block';    
// Web Audio 低频警报
if(!stormAlertAudio)initStormAudio();    if(stormAlertAudio&&stormAlertAudio.context.state==='suspended')stormAlertAudio.context.resume();    if(stormAlertAudio)stormAlertAudio.play();  }else{    banner.style.display='none';    if(stormAlertAudio)stormAlertAudio.stop();  }}
function initStormAudio(){  try{    
const ctx=new(window.AudioContext||window.webkitAudioContext)();    stormAlertAudio={      context:ctx,osc:null,gain:null,playing:false,      play(){        if(this.playing)return;this.playing=true;
const now=ctx.currentTime;        
// 低频警报音 — 模拟基地应急警报        
const osc=ctx.createOscillator();osc.type='sawtooth';osc.frequency.setValueAtTime(80,now);
const gain=ctx.createGain();gain.gain.setValueAtTime(0,now);        
// 脉动警报: 0.6秒周期
for(let i=0;i<120;i++){          
const t=now+i*.6;          gain.gain.linearRampToValueAtTime(.12,t+.05);          gain.gain.linearRampToValueAtTime(.02,t+.3);          osc.frequency.setValueAtTime(80+Math.sin(i*.7)*15,t);        }        
const filter=ctx.createBiquadFilter();filter.type='lowpass';filter.frequency.value=200;        osc.connect(filter);filter.connect(gain);gain.connect(ctx.destination);        osc.start(now);osc.stop(now+72);        this.osc=osc;this.gain=gain;        setTimeout(()=>{this.playing=false;},72000);      },      stop(){        try{this.osc?.stop();}catch(e){}        this.playing=false;      }    };  }catch(e){stormAlertAudio=null;}}

// ── Init ────────────────────────────────────────
window.addEventListener('DOMContentLoaded',()=>{  
// ═══════════════════════════════════════════════════════  

//  电影级启动画面 — 深度粒子引擎 + 环形进度  
// ═══════════════════════════════════════════════════════  
const startupCanvas=document.getElementById('startup-canvas');
const startupCtx=startupCanvas.getContext('2d');
let startupParticles=[],startupStreaks=[],startupRings=[];
let startupRaf=null,startupTime=0;
let startupProgress=0,targetProgress=0;
function initStartupParticles(){    startupCanvas.width=innerWidth;startupCanvas.height=innerHeight;
const cx=startupCanvas.width/2,cy=startupCanvas.height/2;    
// 上升粒子（像深海气泡向上浮）
startupParticles=[];
const count=Math.floor((innerWidth*innerHeight)/6000);    for(let i=0;i<count;i++){      
const angle=Math.random()*Math.PI*2;
const dist=Math.random()*Math.max(cx,cy)*1.2;      startupParticles.push({        x:cx+Math.cos(angle)*dist,        y:cy+Math.sin(angle)*dist*.6,        vx:(Math.random()-.5)*.25,        vy:-.4-Math.random()*1.2,        r:.4+Math.random()*2.2,        alpha:.1+Math.random()*.5,        hue:190+Math.random()*35,        life:Math.random(),        orbitAngle:angle,        orbitDist:dist,        orbitSpeed:(Math.random()-.5)*.003      });    }    
// 流星/光轨粒子
startupStreaks=[];    for(let i=0;i<35;i++){      startupStreaks.push({        x:Math.random()*startupCanvas.width,        y:Math.random()*startupCanvas.height*.4,        vx:.3+Math.random()*1.5,        vy:.1+Math.random()*.4,        len:40+Math.random()*120,        alpha:.08+Math.random()*.25,        hue:190+Math.random()*30,        reset(){this.x=-this.len;this.y=Math.random()*startupCanvas.height*.5;this.vx=.3+Math.random()*1.5;this.alpha=.08+Math.random()*.25;}      });    }    
// 雷达脉冲环
startupRings=[];    for(let i=0;i<3;i++){      startupRings.push({        radius:0,        maxRadius:Math.min(cx,cy)*.7,        speed:.6+Math.random()*.8,        alpha:0,        phase:i*2.1      });    }  }  
function drawStartupParticles(ts){    if(!startupCanvas||document.getElementById('loading-overlay').classList.contains('hidden')){      startupRaf=null;return;    }    startupTime=ts*.001;    startupCtx.clearRect(0,0,startupCanvas.width,startupCanvas.height);
const w=startupCanvas.width,h=startupCanvas.height;
const cx=w/2,cy=h/2;    
// ── 1. 中心微光背景 ──    
const bgGrad=startupCtx.createRadialGradient(cx,cy,0,cx,cy,Math.min(cx,cy)*.8);    bgGrad.addColorStop(0,'rgba(56,189,248,.025)');    bgGrad.addColorStop(.5,'rgba(56,189,248,.005)');    bgGrad.addColorStop(1,'rgba(0,0,0,0)');    startupCtx.fillStyle=bgGrad;    startupCtx.fillRect(0,0,w,h);    
// ── 2. 粒子连线 ──
startupCtx.lineWidth=.25;    for(let i=0;i<startupParticles.length;i++){      
const a=startupParticles[i];      for(let j=i+1;j<startupParticles.length;j++){        
const b=startupParticles[j];
const dx=a.x-b.x,dy=a.y-b.y,dist=Math.hypot(dx,dy);        if(dist<100){          startupCtx.strokeStyle=`rgba(56,189,248,${.035*(1-dist/100)})`;          startupCtx.beginPath();startupCtx.moveTo(a.x,a.y);startupCtx.lineTo(b.x,b.y);startupCtx.stroke();        }      }    }    
// ── 3. 轨道粒子 (绕中心微旋) ──
for(const p of startupParticles){      p.orbitAngle+=p.orbitSpeed;
const tx=cx+Math.cos(p.orbitAngle)*p.orbitDist;
const ty=cy+Math.sin(p.orbitAngle)*p.orbitDist*.6;      p.x+=(tx-p.x)*.008;      p.y+=(ty-p.y)*.008+p.vy*.015;      
// 边界包裹
if(p.y<-20)p.y=h+20;      if(p.y>h+20)p.y=-20;      if(p.x<-20)p.x=w+20;      if(p.x>w+20)p.x=-20;      
// 绘制
startupCtx.fillStyle=`hsla(${p.hue},70%,68%,${p.alpha})`;      startupCtx.beginPath();startupCtx.arc(p.x,p.y,p.r,0,Math.PI*2);startupCtx.fill();    }    
// ── 4. 流星拖尾 ──
for(const s of startupStreaks){      
const grad=startupCtx.createLinearGradient(s.x,s.y,s.x-s.vx*s.len,s.y-s.vy*s.len);      grad.addColorStop(0,`hsla(${s.hue},90%,70%,${s.alpha})`);      grad.addColorStop(1,'transparent');      startupCtx.strokeStyle=grad;      startupCtx.lineWidth=1.2;      startupCtx.beginPath();      startupCtx.moveTo(s.x,s.y);      startupCtx.lineTo(s.x-s.vx*s.len,s.y-s.vy*s.len);      startupCtx.stroke();      s.x+=s.vx;s.y+=s.vy;      if(s.x>w+s.len||s.y>h+s.len)s.reset();    }    
// ── 5. 雷达脉冲环 ──
for(const ring of startupRings){      ring.radius+=ring.speed;      if(ring.radius>ring.maxRadius){ring.radius=0;ring.alpha=0;}      ring.alpha=Math.max(0,Math.min(.35,ring.alpha+.008*(1-ring.radius/ring.maxRadius)));
const fadeAlpha=ring.alpha*(1-ring.radius/ring.maxRadius);      startupCtx.strokeStyle=`rgba(56,189,248,${fadeAlpha})`;      startupCtx.lineWidth=.8;      startupCtx.shadowColor='rgba(56,189,248,.15)';      startupCtx.shadowBlur=6;      startupCtx.beginPath();      startupCtx.ellipse(cx,cy,ring.radius,ring.radius*.5,0,0,Math.PI*2);      startupCtx.stroke();      startupCtx.shadowBlur=0;    }    
// ── 6. 中心旋转几何环 (Canvas绘制，比CSS更精细) ──    
const hexSides=6,hexR=55+Math.sin(startupTime*.8)*6;    startupCtx.strokeStyle=`rgba(56,189,248,${.18+Math.sin(startupTime*1.3)*.06})`;    startupCtx.lineWidth=.6;    startupCtx.shadowColor='rgba(56,189,248,.3)';    startupCtx.shadowBlur=10;    startupCtx.beginPath();    for(let i=0;i<=hexSides;i++){      
const a=startupTime*.25+i/hexSides*Math.PI*2;
const x=cx+Math.cos(a)*hexR,y=cy+Math.sin(a)*hexR*.5;      if(i===0)startupCtx.moveTo(x,y);      else startupCtx.lineTo(x,y);    }    startupCtx.stroke();    
// 内环
startupCtx.strokeStyle=`rgba(56,189,248,${.08+Math.sin(startupTime*1.5)*.03})`;    startupCtx.lineWidth=.4;    startupCtx.beginPath();    startupCtx.ellipse(cx,cy,hexR*.7,hexR*.35,startupTime*.15,0,Math.PI*2);    startupCtx.stroke();    startupCtx.shadowBlur=0;    
// ── 7. 四角连接线 ──    
const cornerDist=Math.min(w,h)*.35;
const corners=[      [40,40], [w-40,40], [w-40,h-40], [40,h-40]    ];    startupCtx.strokeStyle=`rgba(56,189,248,${.04+Math.sin(startupTime)*.02})`;    startupCtx.lineWidth=.3;    corners.forEach(([cx2,cy2])=>{      startupCtx.beginPath();      startupCtx.moveTo(cx2,cy2);      startupCtx.lineTo(cx+(cx2-cx)*.15,cy+(cy2-cy)*.15);      startupCtx.stroke();    });    startupRaf=requestAnimationFrame(drawStartupParticles);  }  

// ── 进度环更新 ──  
function updateProgressRing(pct){    
const circle=document.getElementById('startup-progress-circle');
const text=document.getElementById('startup-progress-text');    if(!circle||!text)return;
const circumference=2*Math.PI*35; 
// r=35    
const offset=circumference*(1-pct/100);    circle.style.strokeDashoffset=offset;    text.textContent=Math.round(pct)+'%';  }  

// ── 启动序列 ──
initStartupParticles();  startupRaf=requestAnimationFrame(drawStartupParticles);  
window.addEventListener('resize',()=>{if(startupRaf)initStartupParticles();});
const statusEl=document.getElementById('startup-status-text');
const statusSeq=[    {t:0,   msg:'正在获取 ISS 实时位置...',          prog:5},    {t:300, msg:'正在加载 NASA 每日天文图...',         prog:12},    {t:650, msg:'正在计算与澳门的直线距离...',         prog:22},    {t:1000,msg:'正在查询近期火箭发射计划...',         prog:35},    {t:1350,msg:'正在加载 CelesTrak 卫星轨道数据...',  prog:48},    {t:1700,msg:'正在获取火星天气数据...',             prog:60},    {t:2000,msg:'正在监测太阳风暴活动...',             prog:72},    {t:2300,msg:'正在校准大气环境传感器数据...',       prog:82},    {t:2600,msg:'正在整理近地小行星列表...',           prog:90},    {t:2900,msg:'遥测数据流已就绪',                    prog:100},  ];
let seqIdx=0;
const statusTimer=setInterval(()=>{    if(seqIdx<statusSeq.length){      
const step=statusSeq[seqIdx];      if(statusEl)statusEl.textContent=step.msg;      targetProgress=step.prog;      seqIdx++;    }else{      clearInterval(statusTimer);    }  },300);  

// ── 进度环平滑动画 ──  
function animProgress(){    if(document.getElementById('loading-overlay').classList.contains('hidden'))return;    startupProgress+=(targetProgress-startupProgress)*.08;    updateProgressRing(startupProgress);    requestAnimationFrame(animProgress);  }  requestAnimationFrame(animProgress);  

// ── 完成淡出 ──  
const finishStartup=()=>{    clearInterval(statusTimer);    if(statusEl)statusEl.textContent='✅ DS/M-7 深空网络全部节点在线';    targetProgress=100;    setTimeout(()=>{      cancelAnimationFrame(startupRaf);
document.getElementById('loading-overlay').classList.add('hidden');
      // 延迟600ms等CSS过渡完成后刷新globe真实尺寸
      setTimeout(()=>{ if(window._resumeGlobe) window._resumeGlobe(); },600);
    },800);  };
// 总时长 ~3.2秒 + 0.8秒淡出 + 0.6秒延迟 = ~4.6秒后globe正确撑满
setTimeout(finishStartup,3400);  try{initGlobe();}catch(e){}

refreshAll();
document.getElementById('city-select').addEventListener('change',fetchWeather);
document.getElementById('planet-select').addEventListener('change',fetchSpaceBody);  setInterval(fetchISS,10000);setInterval(fetchLaunches,120000);setInterval(fetchSpaceBody,300000);  setInterval(fetchThreats,180000);setInterval(fetchWeather,300000);  setInterval(fetchAPOD,3600000);setInterval(fetchMarsWeather,600000);  setInterval(fetchNews,900000);setInterval(fetchExoplanets,3600000);  setInterval(fetchObserving,600000);    setInterval(fetchHealth,30000);  setInterval(fetchISSPassDetail,300000);  setInterval(()=>{
const e=document.getElementById('clk');if(e)e.textContent=new Date().toLocaleString('zh-TW',{hour12:false,timeZone:'Asia/Shanghai'})+' CST';},1000);
document.querySelectorAll('.tilt').forEach(el=>{el.addEventListener('mousemove',e=>{
const r=el.getBoundingClientRect(),x=(e.clientX-r.left)/r.width-.5,y=(e.clientY-r.top)/r.height-.5;el.style.transform='perspective(1200px) rotateY('+(x*2.5)+'deg) rotateX('+(-y*2.5)+'deg)';});el.addEventListener('mouseleave',()=>{el.style.transform='perspective(1200px) rotateY(0deg) rotateX(0deg)';});});});