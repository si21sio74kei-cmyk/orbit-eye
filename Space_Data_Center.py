#!/usr/bin/env python3
"""
轨道之眼 OrbitEye — 太空数据中心（高中期末项目）
每个 API 端点都尽量用真实数据源，并在不可用时保留兜底
Usage: python Space_Data_Center.py  →  http://127.0.0.1:5500
"""
from flask import Flask, jsonify, request, Response, send_file, send_from_directory
from flask_cors import CORS
import requests, math, time, json, os
from pathlib import Path
from datetime import datetime, timedelta, timezone

app = Flask(__name__)
CORS(app)

BASE_DIR = Path(__file__).parent
STATIC_DIR = BASE_DIR / "static"
SAT_CACHE_FILE = BASE_DIR / ".satellite_cache.json"  # 持久缓存，避免限流时无数据

# ── 配置（从环境变量 / .env 读取，避免硬编码密钥） ──────────────
def _load_env(path=BASE_DIR / ".env"):
    """轻量 .env 加载器（无第三方依赖）：仅为未设置的变量填入默认值"""
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
    except FileNotFoundError:
        pass

_load_env()

def env(key, default):
    return os.environ.get(key, default)

NASA_KEY      = env("NASA_API_KEY", "DEMO_KEY")
SOLAR_SYS_KEY = env("SOLAR_SYSTEM_API_KEY", "56f9bdf9-e7cc-4f25-b1bf-7b16735edfd0")
SOLAR_API_URL = env("SOLAR_SYSTEM_API_URL", "https://api.le-systeme-solaire.net/rest/bodies/")
PORT          = int(env("PORT", "5500"))
MACAO_LAT     = float(env("MACAO_LAT", "22.1989"))
MACAO_LON     = float(env("MACAO_LON", "113.5491"))

# ── 共用常數 ──────────────────────────────────────
USER_AGENT = "OrbitEye/1.0 (Educational Project)"

# 太阳风暴结果缓存（10 分钟），避免每次请求都重复拉取 NASA DONKI
_STORM_CACHE = {"data": None, "time": 0}
# 月相計算參考基準：2000-01-06 18:14 UTC (Known New Moon)
LUNAR_REF  = datetime(2000, 1, 6, 18, 14, 0, tzinfo=timezone.utc)
LUNAR_DAYS = 29.530588  # 朔望月 (synodic month)

# ── 工具函数 ──────────────────────────────────────
def haversine(lat1, lon1, lat2, lon2):
    rlat1, rlon1, rlat2, rlon2 = map(math.radians, [lat1, lon1, lat2, lon2])
    a = math.sin((rlat2-rlat1)/2)**2 + math.cos(rlat1)*math.cos(rlat2)*math.sin((rlon2-rlon1)/2)**2
    return round(2*math.asin(math.sqrt(a))*6371.0, 1)

def macao_dist(lat, lon):
    return haversine(lat, lon, MACAO_LAT, MACAO_LON)

def safe_fetch(url, timeout=6, headers=None):
    """帶 User-Agent 的安全 HTTP GET，失敗返回 None"""
    hdrs = {"User-Agent": USER_AGENT}
    if headers:
        hdrs.update(headers)
    try:
        r = requests.get(url, timeout=timeout, headers=hdrs)
        if r.status_code == 200: return r.json()
    except Exception: pass
    return None

def deg_to_wind_dir(deg):
    """将风向角度 (0-360) 转换为中文方向名"""
    if deg is None: return "?"
    dirs = ["北", "东北", "东", "东南", "南", "西南", "西", "西北"]
    idx = round(deg / 45) % 8
    return dirs[idx]

def predict_passes():
    """ISS 过境预测 (简化数学模型，预设观测点: 澳门)"""
    passes = []
    period_sec = 92.68 * 60
    ang_vel = 360.0 / period_sec
    sim_lat, sim_lon, sim_t = MACAO_LAT, MACAO_LON, 0
    lat_step = ang_vel * 60 * math.cos(math.radians(51.6))
    lon_step = ang_vel * 60 * math.sin(math.radians(51.6))
    win_start = None
    win_min_d = float('inf')
    for _ in range(1440):
        sim_lat += lat_step; sim_lon += lon_step
        if sim_lon > 180: sim_lon -= 360
        elif sim_lon < -180: sim_lon += 360
        if abs(sim_lat) > 55: lat_step *= -1
        sim_t += 60
        d = macao_dist(sim_lat, sim_lon)
        if d < 1500:
            if win_start is None: win_start = sim_t
            if d < win_min_d: win_min_d = d
        else:
            if win_start is not None:
                dur = sim_t - win_start
                if dur >= 120:
                    utc_time = datetime.now(timezone.utc)+timedelta(seconds=win_start)
                    passes.append({
                        "start_in_minutes": round(win_start/60,1),
                        "duration_minutes": round(dur/60,1),
                        "min_distance_km": round(win_min_d,1),
                        "start_time_hkt": (utc_time+timedelta(hours=8)).strftime("%Y-%m-%d %H:%M:%S HKT"),
                    })
                win_start = None
                win_min_d = float('inf')
        if len(passes) >= 6: break
    # 如果循环结束时仍在窗口中
    if win_start is not None:
        dur = sim_t - win_start
        if dur >= 120:
            utc_time = datetime.now(timezone.utc)+timedelta(seconds=win_start)
            passes.append({
                "start_in_minutes": round(win_start/60,1),
                "duration_minutes": round(dur/60,1),
                "min_distance_km": round(win_min_d,1),
                "start_time_hkt": (utc_time+timedelta(hours=8)).strftime("%Y-%m-%d %H:%M:%S HKT"),
            })
    return passes

def moon_phase():
    """計算當前月相 — 使用朔望月數學模型"""
    days = (datetime.now(timezone.utc) - LUNAR_REF).total_seconds() / 86400
    ang = (days % LUNAR_DAYS) / LUNAR_DAYS * 360
    ill = round((1 - math.cos(math.radians(ang))) / 2 * 100, 1)
    names = ["New Moon", "Waxing Crescent", "First Quarter", "Waxing Gibbous",
             "Full Moon", "Waning Gibbous", "Last Quarter", "Waning Crescent"]
    idx = int(((ang + 22.5) % 360) / 45)
    return {"phase_name": names[idx % 8], "illumination_pct": ill, "phase_angle": round(ang, 1)}

# ═══════════════════════════════════════════════════
#  API 端点 — 每个独立硬编码兜底数据
# ═══════════════════════════════════════════════════

@app.route('/')
def index():
    return send_file(str(BASE_DIR / "dashboard.html"))

@app.route('/solar')
def solar():
    return send_file(str(BASE_DIR / "solar-system.html"))

@app.route('/static/<path:filename>')
def static_files(filename):
    return send_from_directory(str(STATIC_DIR), filename)

# [卡片1] ISS 实时位置 + 与澳门的直线距离（澳门只是用来比对的一个参考点，并非测控站）
def _build_iss(lat, lon, ts, src):
    """构造 ISS 接口响应（直播 / 缓存共用），避免重复代码"""
    dist = macao_dist(lat, lon)
    return jsonify({
        "iss_position": {"latitude": lat, "longitude": lon},
        "timestamp": ts,
        "macao_link": {
            "distance_km": dist,
            "status": "IN_RANGE" if dist < 1500 else "OUT_OF_RANGE",
            "alarm": dist < 1500,
            "window_km": 1500,
        },
        "pass_predictions": predict_passes(),
        "orbital_info": {"period_minutes":92.68,"velocity_kms":7.66,"inclination_deg":51.6,"altitude_km":408},
        "_source": src,
    })

# 缓存上一次成功获取的实时坐标：接口偶发失败时复用，避免绿点突然跳到澳门演示点
last_iss = {"lat": None, "lon": None, "ts": None}

@app.route('/api/space/iss')
def api_iss():
    global last_iss
    try:
        # 改用 HTTPS 的 wheretheiss.at（比 open-notify.org 更稳，Vercel 上不易超时）
        data = safe_fetch("https://api.wheretheiss.at/v1/satellites/25544", timeout=6)
        if data and "latitude" in data:
            lat = float(data["latitude"]); lon = float(data["longitude"])
            ts = int(data.get("timestamp", time.time()))
            last_iss = {"lat": lat, "lon": lon, "ts": ts}
            return _build_iss(lat, lon, ts, "live")
    except Exception:
        pass
    # 实时失败 → 复用上一次真实坐标（绿点留在真实轨道，不跳澳门）
    if last_iss["lat"] is not None:
        return _build_iss(last_iss["lat"], last_iss["lon"], last_iss["ts"], "cached")
    # 仅在从未取到实时数据时的最后兜底（演示）
    return jsonify({
        "iss_position": {"latitude": 22.3512, "longitude": 114.0873},
        "timestamp": int(time.time()),
        "macao_link": {"distance_km": 58.7, "status": "IN_RANGE", "alarm": True, "window_km": 1500},
        "pass_predictions": [
            {"start_in_minutes":3.0,"duration_minutes":8.5,"min_distance_km":58.7,"start_time_hkt":"2026-06-18 20:03:00 HKT"},
            {"start_in_minutes":95.7,"duration_minutes":7.2,"min_distance_km":142.3,"start_time_hkt":"2026-06-18 21:35:40 HKT"},
            {"start_in_minutes":188.0,"duration_minutes":9.1,"min_distance_km":35.2,"start_time_hkt":"2026-06-18 23:08:00 HKT"},
            {"start_in_minutes":282.0,"duration_minutes":6.8,"min_distance_km":289.5,"start_time_hkt":"2026-06-19 00:42:00 HKT"},
            {"start_in_minutes":376.0,"duration_minutes":8.3,"min_distance_km":91.7,"start_time_hkt":"2026-06-19 02:16:00 HKT"},
            {"start_in_minutes":470.0,"duration_minutes":7.5,"min_distance_km":178.9,"start_time_hkt":"2026-06-19 03:50:00 HKT"},
        ],
        "orbital_info": {"period_minutes":92.68,"velocity_kms":7.66,"inclination_deg":51.6,"altitude_km":408},
        "_source": "demo",
    })

# [卡片2] 最新发射任务
@app.route('/api/space/spacex')
def api_spacex():
    try:
        data = safe_fetch("https://ll.thespacedevs.com/2.2.0/launch/previous/?limit=1&search=SpaceX", timeout=8)
        if data and data.get("results"):
            L = data["results"][0]
            utc = L.get("net","")
            fd = f"{utc[:10]} {utc[11:19]}" if len(utc)>=19 else utc
            rocket = L.get("rocket",{}).get("configuration",{}).get("full_name","?")
            vid = L.get("vid_urls",[])
            wc = vid[0].get("url","#") if vid else "#"
            return jsonify({
                "name": L.get("name","?"),
                "date": fd,
                "rocket": rocket,
                "success": L.get("status",{}).get("abbrev")=="Success",
                "details": (L.get("mission") or {}).get("description","") or "No description.",
                "webcast": wc,
                "_source": "live",
            })
    except Exception: pass
    return jsonify({
        "name": "Falcon 9 Block 5 | Starlink Group 6-35",
        "date": "2026-06-15 14:22:00",
        "rocket": "Falcon 9 Block 5",
        "success": True,
        "details": "Falcon 9 launched 23 Starlink V2 Mini satellites from Cape Canaveral SLC-40. Booster B1069 completed its 15th flight and landed on droneship.",
        "webcast": "https://www.spacex.com/launches/",
        "_source": "demo",
    })

# [卡片3] 宇宙天体影像 (地球/火星/月球)
@app.route('/api/space/space-body')
def api_space_body():
    bt = request.args.get("type", "earth")
    if bt == "earth":
        try:
            data = safe_fetch(f"https://api.nasa.gov/EPIC/api/natural?api_key={NASA_KEY}", timeout=8)
            if data and isinstance(data,list) and len(data)>0:
                x = data[0]; ds = x.get("date",""); y,m,d = ds[:4],ds[5:7],ds[8:10]
                return jsonify({
                    "date": ds,
                    "caption": x.get("caption","DSCOVR"),
                    "imageUrl": f"https://epic.gsfc.nasa.gov/archive/natural/{y}/{m}/{d}/png/{x.get('image')}.png",
                    "body_type": "earth",
                    "_source": "live",
                })
        except Exception: pass
        return jsonify({
            "date": "2026-06-17 EARTH OBSERVATION",
            "caption": "DSCOVR EPIC — Pacific Ocean, East Asia, Macau clearly visible under fair weather.",
            "imageUrl": "https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=800",
            "body_type": "earth",
            "_source": "demo",
        })
    elif bt == "mars":
        if NASA_KEY != "DEMO":
            try:
                data = safe_fetch(f"https://api.nasa.gov/mars-photos/api/v1/rovers/curiosity/latest_photos?api_key={NASA_KEY}", timeout=10)
                if data and data.get("latest_photos"):
                    L = data["latest_photos"][0]
                    rover = L.get("rover",{})
                    cam = L.get("camera",{})
                    return jsonify({
                        "date": f"{L.get('earth_date','?')} SOL-{rover.get('max_sol','?')}",
                        "caption": f"Curiosity Rover — {cam.get('full_name','Mastcam')} │ 着陆: {rover.get('landing_date','?')} │ 里程: >{rover.get('max_sol','?')} sol",
                        "imageUrl": L.get("img_src",""),
                        "body_type": "mars",
                        "_source": "live",
                    })
            except Exception: pass
        return jsonify({
            "date": "2026-06-15 MARS TELEMETRY",
            "caption": "Curiosity Rover — Gale Crater, Mars. Mastcam 高清成像 │ 着陆: 2012-08-06 │ 里程: >30 km",
            "imageUrl": "https://images.unsplash.com/photo-1545156521-77bd85671d30?w=800",
            "body_type": "mars",
            "_source": "demo",
        })
    elif bt == "moon":
        mp = moon_phase()
        return jsonify({
            "date": f"REALTIME | {mp['phase_name']}",
            "caption": "月球轨道物理指标 — 重力: 1.62 m/s² │ 半径: 1737.4 km │ 密度: 3.34 g/cm³ │ 月相: " + mp["phase_name"],
            "imageUrl": "https://svs.gsfc.nasa.gov/vis/a000000/a005000/a005048/moon.0001.jpg" if mp["illumination_pct"]>90 else "https://images.unsplash.com/photo-1522030299830-16b8d3d049fe?w=800",
            "body_type": "moon",
            "moon_phase": moon_phase(),
            "_source": "demo",
        })
    return jsonify({"error": "Unknown body type"}), 400

# [卡片4] 城市天气 + AQI (2层降级: Open-Meteo→硬编码)
@app.route('/api/space/weather')
def api_weather():
    ALLOWED = {
        "澳门":"澳门","香港":"香港","广州":"广东","深圳":"广东","北京":"北京","上海":"上海",
        "台北":"台湾","成都":"四川","拉萨":"西藏","乌鲁木齐":"新疆",
        "东京":"日本","首尔":"韩国","新加坡":"新加坡","曼谷":"泰国","迪拜":"阿联酋","新德里":"印度",
        "伦敦":"英国","巴黎":"法国","柏林":"德国","莫斯科":"俄罗斯",
        "纽约":"美国","洛杉矶":"美国","多伦多":"加拿大","圣保罗":"巴西",
        "悉尼":"澳大利亚","开普敦":"南非",
    }
    FALLBACK = {
        "澳门": {"temp":"31","humidity":"78","weather":"晴","wind_dir":"南","wind_power":"3-4","aqi":"52","aqi_name":"良","city":"澳门"},
        "香港": {"temp":"30","humidity":"82","weather":"多云","wind_dir":"东南","wind_power":"4-5","aqi":"58","aqi_name":"良","city":"香港"},
        "广州": {"temp":"33","humidity":"70","weather":"晴","wind_dir":"南","wind_power":"2-3","aqi":"65","aqi_name":"良","city":"广州"},
        "深圳": {"temp":"31","humidity":"75","weather":"多云","wind_dir":"东南","wind_power":"3-4","aqi":"48","aqi_name":"优","city":"深圳"},
        "北京": {"temp":"28","humidity":"35","weather":"晴","wind_dir":"北","wind_power":"3-4","aqi":"42","aqi_name":"优","city":"北京"},
        "上海": {"temp":"29","humidity":"65","weather":"多云","wind_dir":"东","wind_power":"4-5","aqi":"55","aqi_name":"良","city":"上海"},
        "台北": {"temp":"30","humidity":"75","weather":"多云","wind_dir":"东南","wind_power":"3-4","aqi":"50","aqi_name":"良","city":"台北"},
        "成都": {"temp":"28","humidity":"70","weather":"多云","wind_dir":"北","wind_power":"2-3","aqi":"62","aqi_name":"良","city":"成都"},
        "拉萨": {"temp":"22","humidity":"30","weather":"晴","wind_dir":"西","wind_power":"3-4","aqi":"25","aqi_name":"优","city":"拉萨"},
        "乌鲁木齐": {"temp":"30","humidity":"25","weather":"晴","wind_dir":"北","wind_power":"3-4","aqi":"45","aqi_name":"优","city":"乌鲁木齐"},
        "东京": {"temp":"26","humidity":"68","weather":"多云","wind_dir":"南","wind_power":"3-4","aqi":"38","aqi_name":"良","city":"东京"},
        "首尔": {"temp":"27","humidity":"62","weather":"多云","wind_dir":"西","wind_power":"3-4","aqi":"55","aqi_name":"良","city":"首尔"},
        "新加坡": {"temp":"31","humidity":"80","weather":"阵雨","wind_dir":"南","wind_power":"2-3","aqi":"40","aqi_name":"良","city":"新加坡"},
        "曼谷": {"temp":"33","humidity":"75","weather":"阵雨","wind_dir":"西南","wind_power":"2-3","aqi":"58","aqi_name":"良","city":"曼谷"},
        "迪拜": {"temp":"39","humidity":"40","weather":"晴","wind_dir":"西北","wind_power":"4-5","aqi":"70","aqi_name":"中等","city":"迪拜"},
        "新德里": {"temp":"38","humidity":"45","weather":"晴","wind_dir":"西","wind_power":"3-4","aqi":"120","aqi_name":"较差","city":"新德里"},
        "伦敦": {"temp":"20","humidity":"65","weather":"多云","wind_dir":"西南","wind_power":"4-5","aqi":"32","aqi_name":"良","city":"伦敦"},
        "巴黎": {"temp":"23","humidity":"58","weather":"多云","wind_dir":"西","wind_power":"3-4","aqi":"35","aqi_name":"良","city":"巴黎"},
        "柏林": {"temp":"22","humidity":"55","weather":"多云","wind_dir":"西","wind_power":"3-4","aqi":"30","aqi_name":"良","city":"柏林"},
        "莫斯科": {"temp":"22","humidity":"50","weather":"晴","wind_dir":"西北","wind_power":"3-4","aqi":"28","aqi_name":"优","city":"莫斯科"},
        "纽约": {"temp":"26","humidity":"60","weather":"多云","wind_dir":"西南","wind_power":"4-5","aqi":"42","aqi_name":"良","city":"纽约"},
        "洛杉矶": {"temp":"24","humidity":"55","weather":"晴","wind_dir":"西","wind_power":"3-4","aqi":"48","aqi_name":"良","city":"洛杉矶"},
        "多伦多": {"temp":"24","humidity":"58","weather":"多云","wind_dir":"西","wind_power":"4-5","aqi":"35","aqi_name":"良","city":"多伦多"},
        "圣保罗": {"temp":"20","humidity":"72","weather":"多云","wind_dir":"东南","wind_power":"2-3","aqi":"55","aqi_name":"良","city":"圣保罗"},
        "悉尼": {"temp":"16","humidity":"65","weather":"阵雨","wind_dir":"西南","wind_power":"4-5","aqi":"30","aqi_name":"优","city":"悉尼"},
        "开普敦": {"temp":"16","humidity":"70","weather":"阵雨","wind_dir":"西北","wind_power":"4-5","aqi":"28","aqi_name":"优","city":"开普敦"},
    }
    city = request.args.get("city", "澳门")
    if city not in ALLOWED:
        return jsonify({"error":"City not allowed"}), 403
    # 城市坐标 (Open-Meteo 全球 API)
    CITY_COORDS = {
        "澳门": (22.1989, 113.5491), "香港": (22.3193, 114.1694),
        "广州": (23.1291, 113.2644), "深圳": (22.5431, 114.0579),
        "北京": (39.9042, 116.4074), "上海": (31.2304, 121.4737),
        "台北": (25.0330, 121.5654), "成都": (30.5728, 104.0668),
        "拉萨": (29.6500, 91.1000), "乌鲁木齐": (43.8256, 87.6168),
        "东京": (35.6762, 139.6503), "首尔": (37.5665, 126.9780),
        "新加坡": (1.3521, 103.8198), "曼谷": (13.7563, 100.5018),
        "迪拜": (25.2048, 55.2708), "新德里": (28.6139, 77.2090),
        "伦敦": (51.5074, -0.1278), "巴黎": (48.8566, 2.3522),
        "柏林": (52.5200, 13.4050), "莫斯科": (55.7558, 37.6173),
        "纽约": (40.7128, -74.0060), "洛杉矶": (34.0522, -118.2437),
        "多伦多": (43.6532, -79.3832), "圣保罗": (-23.5505, -46.6333),
        "悉尼": (-33.8688, 151.2093), "开普敦": (-33.9249, 18.4241),
    }
    # WMO Weather Interpretation Codes (WW) → 简体中文
    # 参考 Open-Meteo 使用的 WMO 4677/4680 标准
    def wmo_to_cn(code):
        if code is None: return "?"
        mapping = {
            0: "晴", 1: "晴",
            2: "多云", 3: "阴",
            45: "雾", 48: "雾凇",
            51: "小雨", 53: "毛毛雨", 55: "毛毛雨",
            56: "冻毛毛雨", 57: "冻毛毛雨",
            61: "小雨", 63: "雨", 65: "大雨",
            66: "冻雨", 67: "冻雨",
            71: "小雪", 73: "雪", 75: "大雪",
            77: "雪粒",
            80: "阵雨", 81: "阵雨", 82: "大阵雨",
            85: "阵雪", 86: "大阵雪",
            95: "雷暴", 96: "雷暴+冰雹", 99: "强雷暴+冰雹",
        }
        return mapping.get(code, "?")
    # Open-Meteo (免费全球天气 API) — 主数据源
    try:
        lat, lon = CITY_COORDS[city]
        wx_data = safe_fetch(
            f"https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}"
            f"&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m", timeout=8)
        if wx_data and wx_data.get("current"):
            c = wx_data["current"]
            temp = str(round(c.get("temperature_2m", 999)))
            hum = str(c.get("relative_humidity_2m", 999))
            wx = wmo_to_cn(c.get("weather_code"))
            wdir = deg_to_wind_dir(c.get("wind_direction_10m"))
            wspd = str(round(c.get("wind_speed_10m", 0)))
            # 尝试 Open-Meteo Air Quality API
            aqi_val = "--"; aqi_name = "N/A"
            try:
                aq_data = safe_fetch(
                    f"https://air-quality-api.open-meteo.com/v1/air-quality"
                    f"?latitude={lat}&longitude={lon}&current=european_aqi", timeout=6)
                if aq_data and aq_data.get("current"):
                    e_aqi = aq_data["current"].get("european_aqi")
                    if e_aqi is not None:
                        aqi_val = str(e_aqi)
                        if e_aqi <= 20: aqi_name = "优"
                        elif e_aqi <= 40: aqi_name = "良"
                        elif e_aqi <= 60: aqi_name = "中等"
                        elif e_aqi <= 80: aqi_name = "较差"
                        elif e_aqi <= 100: aqi_name = "差"
                        else: aqi_name = "极差"
            except Exception: pass
            return jsonify({
                "temp": temp, "humidity": hum,
                "weather": wx, "wind_dir": wdir,
                "wind_power": wspd, "aqi": aqi_val,
                "aqi_name": aqi_name, "city": city,
                "_source": "open-meteo",
            })
    except Exception: pass
    # 3) 回退硬编码
    fb = FALLBACK.get(city, FALLBACK["澳门"])
    fb["_source"] = "demo"
    return jsonify(fb)

# [卡片5] 太阳风暴监测
@app.route('/api/space/solar-storm')
def api_solar_storm():
    # 短缓存：太阳活动变化很慢，10 分钟刷新一次即可（更快、也避免频繁打 NASA 被限流）
    if _STORM_CACHE.get("data") and (time.time() - _STORM_CACHE.get("time", 0)) < 600:
        return jsonify(_STORM_CACHE["data"])
    # 1. NOAA SWPC 实时太阳风等离子体（若可达为最理想实时源）
    try:
        raw = safe_fetch("https://services.swpc.noaa.gov/products/solar-wind/plasma-1-day.json", timeout=6)
        if raw and len(raw) > 1:
            L = raw[-1]
            spd = float(L[2])
            note = f"Solar wind {spd:.0f} km/s | Density: {L[1]} p/cc | Temp: {L[3]}K"
            note = ("[STORM ALERT] " if spd >= 700 else "[ACTIVE] " if spd >= 600 else "[QUIET] ") + note
            payload = {
                "startTime": L[0], "catalog": "NOAA SWPC",
                "instruments": "DSCOVR, ACE",
                "note": note, "storm_active": spd >= 600,
                "_source": "live",
            }
            _STORM_CACHE.update(data=payload, time=time.time())
            return jsonify(payload)
    except Exception:
        pass
    # 2. NASA DONKI 近期日冕物质抛射 CME（与 APOD 同域，Vercel 上通常可达）
    try:
        now = datetime.now(timezone.utc)
        start = (now - timedelta(days=14)).strftime("%Y-%m-%d")
        end = now.strftime("%Y-%m-%d")
        cme = safe_fetch(
            f"https://api.nasa.gov/DONKI/CME?startDate={start}&endDate={end}&api_key={NASA_KEY}",
            timeout=8)
        if isinstance(cme, list) and cme:
            earth_dir = []
            for e in cme:
                for a in (e.get("cmeAnalyses") or []):
                    try:
                        spd = float(a.get("speed") or 0)
                        lon = float(a.get("longitude"))
                    except (TypeError, ValueError):
                        continue
                    if spd >= 600 and abs(lon) <= 60:   # 高速且大致朝向地球
                        earth_dir.append((e.get("startTime"), spd))
            if earth_dir:
                earth_dir.sort()
                t, spd = earth_dir[-1]
                payload = {
                    "startTime": t, "catalog": "NASA DONKI",
                    "instruments": "SOHO, STEREO, SDO",
                    "note": f"[ACTIVE] Earth-directed CME detected {spd:.0f} km/s (launch {str(t)[:10]}) — geomagnetic storm possible",
                    "storm_active": True,
                    "_source": "NASA DONKI",
                }
                _STORM_CACHE.update(data=payload, time=time.time())
                return jsonify(payload)
            last = cme[0].get("startTime", "")
            payload = {
                "startTime": last, "catalog": "NASA DONKI",
                "instruments": "SOHO, STEREO, SDO",
                "note": f"[QUIET] No Earth-directed CME in last 14 days (last CME {str(last)[:10]})",
                "storm_active": False,
                "_source": "NASA DONKI",
            }
            _STORM_CACHE.update(data=payload, time=time.time())
            return jsonify(payload)
    except Exception:
        pass
    # 3. 兜底 demo（合理平静状态，保证前端永不报错）
    payload = {
        "startTime": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:00:00"),
        "catalog": "NOAA SWPC",
        "instruments": "DSCOVR, ACE, SOHO, STEREO",
        "note": "[QUIET] Solar wind 385 km/s | Density: 4.2 p/cc | Temp: 85000K | No storm expected.",
        "storm_active": False,
        "_source": "demo",
    }
    _STORM_CACHE.update(data=payload, time=time.time())
    return jsonify(payload)

# [健康检查]
@app.route('/api/space/health')
def api_health():
    return jsonify({
        "status": "ONLINE",
        "service": "轨道之眼 OrbitEye v1.0",
        "port": PORT,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })

# [Dashboard 聚合 — 并行拉取全部数据]
@app.route('/api/space/dashboard')
def api_dashboard():
    from concurrent.futures import ThreadPoolExecutor
    results = {}
    base_url = f"http://127.0.0.1:{PORT}"
    def _fetcher(path):
        try:
            r = requests.get(f"{base_url}{path}", timeout=10,
                           headers={"User-Agent": USER_AGENT})
            return r.json() if r.status_code == 200 else {}
        except Exception:
            return {}
    with ThreadPoolExecutor(max_workers=6) as pool:
        futures = {
            "iss": pool.submit(_fetcher, "/api/space/iss"),
            "spacex": pool.submit(_fetcher, "/api/space/spacex"),
            "space_body": pool.submit(_fetcher, "/api/space/space-body?type=earth"),
            "weather": pool.submit(_fetcher, "/api/space/weather"),
            "solar_storm": pool.submit(_fetcher, "/api/space/solar-storm"),
            "moon_phase": pool.submit(moon_phase),
        }
        for key, fut in futures.items():
            try: results[key] = fut.result(timeout=10)
            except Exception: results[key] = {"error": "timeout"}
    results["macao"] = {"lat": MACAO_LAT, "lon": MACAO_LON}
    results["timestamp"] = datetime.now(timezone.utc).isoformat()
    return jsonify(results)

# ═══════════════════════════════════════════════════
#  卫星分布数据 (手势太阳系 — 地球卫星地图)
#  从 CelesTrak 实时拉取多组 TLE 数据，按卫星名推定国籍归属
# ═══════════════════════════════════════════════════

# 卫星名称 → 国籍推定规则 (按优先级匹配)
SAT_COUNTRY_RULES = [
    # 中国航天 — 扩充关键词覆盖更多命名模式
    (["BEIDOU","北斗","TIANHE","天和","TIANZHOU","天舟","SHENZHOU","神舟",
      "YAOGAN","遥感","GAOFEN","高分","ZIYUAN","资源","SHIJIAN","实践",
      "FENGYUN","风云","HAIYANG","海洋","CHUANGXIN","创新","TANSUO","探索",
      "YUNHAI","云海","TIANLIAN","天链","TIANHUI","天绘","ZHONGXING","中星",
      "APSTAR","亚太","CHINASAT","SJ-","YG-","GF-","ZY-","HY-","FY-",
      "LINGQIAO","灵巧","TIANQI","天启","JILIN","吉林","HEDE","和德",
      "XINGSHIDAI","星时代","TIANYAN","天眼","TIANKUN","天鲲","XIAOXIANG",
      "HISEA","海丝","WENCHANG","文昌","NAXING","纳星","TIANPING","天平",
      "XINGHE","星河","HONGTU","宏图","TIANDU","天都","QIANSHENG","千乘",
      "WANGANG","万安","ZHUHAI","珠海","HUANJING","环境","KUAILONG","快龙",
      "BAYI","八一","QIXIANG","气象","SHIYONG","实用","TANGLIANG","探量",
      "PRC-","PRC ","CHINA","CHINESE","DFH-","DFH ","DHF-",
      "XW-","CX-","KL-","TS-","TZ-","WF-","MN-","TY-"], "中国"),
    # 俄罗斯 (含苏联时期遗留命名)
    (["COSMOS","KOSMOS","GLONASS","METEOR","RESURS","PROGRESS",
      "SOYUZ","GONETS","BLITS","LOMONOSOV","LUTCH","RADUGA",
      "EKSPRESS","YAMAL","KONDOR","KANOPUS","BARS","MERIDIAN",
      "GARANT","MOLNIYA","PROTON","ZENIT","FREGAT","BRIZ",
      "SILA","OLYMP","GEO-IK","ETALON","NADEZHDA","TSIKADA",
      "PARUS","STRELA","TAIGA","TUNDRA","PION","ERIDAN",
      "SKIF","MARAFON","RAZVAN","BIOS","FOTON","BION"], "俄罗斯"),
    # 英国
    (["ONEWEB","UK-DMC","ALSAT-","CARBONITE","TOPCLASS","LACROSSE",
      "SKYNET","INMARSAT","CERISE","CLYDE"], "英国"),
    # 欧盟/ESA
    (["GALILEO","SENTINEL","COPERNICUS","EUMETSAT","METOP","METOSAT",
      "MSG-","METEOSAT","CRYOSAT","SWARM","AEOLUS","BIOMASS","ENVISAT",
      "ERS-","GOCE","SMOS","SOIL","LISA","PROBA","CHEOPS","PLATO",
      "EUCLID","CLUSTER","XMM-","INTEGRAL","HERSCHEL","PLANCK",
      "ROSETTA","MARS EXPRESS","VENUS EXPRESS","ARIANE","VEGA",
      "HELIOS-","ATV-","EUTELSAT","HOT BIRD","ATLANTIC BIRD",
      "EUROBIRD","HELLAS SAT","THOR","SIRIUS FM","ASTRA","E-ST@R"], "欧盟/ESA"),
    # 日本
    (["HIMAWARI","ALOS","QZSS","GCOM","JAXA","DAICHI","IBUKI",
      "SHIZUKU","SHIKISAI","TSUBAME","HAYABUSA","AKATSUKI","H-II",
      "ETS-","KIKU","KIZUNA","WINDS","MICHIBIKI","SUPERBIRD","JCSAT",
      "BSAT","N-STAR","HORYU","HODOYOSHI","RISESAT","WASEDA",
      "TAMA","CUTE-","RAIKO","FITSAT","ITF-","KSAT","OSCAR",
      "REIMEI","SPRINT-A","ARASE","ERG","SELENE","KAGUYA",
      "HITOMI","ASTRO-H","SUZAKU","GINGA","TENMA","HAKUCHO"], "日本"),
    # 印度
    (["GSAT","INSAT","CARTOSAT","RISAT","NAVIC","IRNSS","OCEANSAT",
      "RESOURCESAT","ASTROSAT","SRE-","SCATSAT","EMISAT","MICROSAT",
      "HYSSIS","ANUSAT","JUGNU","PRATHAM","KALAMSAT","PSLV","GSLV",
      "SARAL","YOUTHSAT","STUDSAT","SRMSAT","SWAYAM","NIUSAT",
      "AISAT","BHASKARA","APPLE","ARYABHATA","ROHINI","MEGHA"], "印度"),
    # 加拿大
    (["RADARSAT","ANIK","NIMIQ","TELESAT","CASSIOPE","M3MSAT",
      "EXACTVIEW","CANX-","NEOSSAT","SCISAT","MOST","SAPPHIRE",
      "BRITE","ALOUETTE","ISIS","HERMES","MSAT","EAGLE"], "加拿大"),
    # 韩国
    (["KOMPSAT","ARIRANG","ANASIS","KOREASAT","MUGUNGWHA",
      "CHALLIAN","CHEOLLIAN","GEO-KOMPSAT","CAS500","NEXTSAT","SNIPE",
      "KITSAT","STSAT","NURI","DANURI","KPLO"], "韩国"),
    # 法国
    (["SPOT-","PLEIADES","HELIOS","ESSIAM","SYRACUSE","ATHENA",
      "FIDUS","JASON-","SARAL","PARASOL","COROT","PICARD","MICROSCOPE",
      "TARANIS","CFOSAT","ANGELS","CERES","STELLA","TOURNESOL",
      "AUREOLE","FR-","D5B","PEOLE","POLLUX","CAST0R","D1APASON"], "法国"),
    # 德国
    (["TERRASAR","TANDEM","RAPIDEYE","ENMAP","TET-","BIROS",
      "FIREBIRD","TUBIN","MAROC","DLR-","HEINRICH","COMPASS-",
      "EU:CROPIS","FLP-","RUBIN","UWE-","AISAT","DIAMANT",
      "AZUR","AEROS","DIAL","AMPHE","EQUATOR"], "德国"),
    # 巴西
    (["AMAZONIA","CBERS","SGDC","ITASAT","NANOSATC","FLORIPA",
      "TANCREDO","SACI","SCD-","BRASILSAT","STAR ONE"], "巴西"),
    # 澳大利亚
    (["OPTUS","AUSSAT","FEDSAT","UBIQUITI","BUCCANEER","AUSPACE",
      "SKY MUSTER","WESTERN","MYRIOTA"], "澳大利亚"),
    # 阿联酋
    (["YAHSAT","THURAYA","DUBAISAT","NAYIF","KHALIFASAT",
      "HOPE","AL-AMAL","MYSAT","DMSAT","PHI-DEMO"], "阿联酋"),
    # 以色列
    (["OFEQ","OFEK","AMOS","EROS","TECSAR","TECHSAT","VENUS",
      "BGUSAT","DIDO","SHALOM","SAMSON"], "以色列"),
    # 阿根廷
    (["SAC-","AR-SAT","ARSAT","BUGSAT","CAPITAN","FRESCO",
      "MEASAT","NUSAT","AQUARIUS","SAOCOM"], "阿根廷"),
    # 台湾
    (["FORMOSAT","FORMOSAT-","YAMSAT","IDEASSAT","NUTSAT",
      "PHOENIX","FLYING","TATIANA"], "台湾"),
    # 美国 (兜底匹配 — 最后才匹配，避免误吞)
    (["STARLINK","GPS ","NAVSTAR","GOES ","NOAA ","DMSP","LANDSAT",
      "IRIDIUM","GLOBALSTAR","ORBCOMM","PLANET","SPACEX","FALCON",
      "DRAGON","CYGNUS","USA ","USSF","NROL","OPS ","DSP ","SBIRS",
      "TDRS ","TDRS-","INTELSAT","SES-","ASTRA","ECHOSTAR","DIRECTV",
      "XM-","SIRIUS","WORLDVIEW","GEOEYE","SKYSAT","FLOCK","LEMUR",
      "BLACKSKY","CAPELLA","HAWKEYE","ICEYE","SPIRE","MAXAR","ORBITAL",
      "PEGASUS","MINOTAUR","ATLAS","DELTA","TERRA","AQUA","AURA",
      "SORCE","GRACE","OSTM","ICON","GEDI","TEMPO","PACE","CLARREO"], "美国"),
]

# 用卫星名匹配国籍
def _classify_satellite(name):
    """根据卫星名推定国籍，返回国家名称或 None"""
    name_upper = name.upper().strip()
    for keywords, country in SAT_COUNTRY_RULES:
        for kw in keywords:
            if kw in name_upper:
                return country
    return None

@app.route('/api/space/satellites')
def api_satellites():
    # ── 1. 优先从 TLE 内存缓存取 (最快) ──
    sat_names = []
    groups_ok = 0
    from_cache = False

    cached = TLE_CACHE.get("data") if isinstance(TLE_CACHE, dict) else None
    if cached and time.time() - TLE_CACHE.get("time", 0) < 14400:
        for s in cached.get("sats", []):
            sat_names.append(s.get("name", ""))
        groups_ok = cached.get("groups", 0)
        from_cache = True

    # ── 2. TLE 缓存不够 → 直接拉 CelesTrak ──
    if len(sat_names) < 500:
        sat_names = []
        groups_ok = 0
        from_cache = False
        # 分批拉取，每组间隔 1 秒避免限流
        for group in ["active", "starlink", "oneweb", "stations",
                       "gps-ops", "iridium", "visual"]:
            try:
                r = requests.get(
                    f"https://celestrak.org/NORAD/elements/gp.php?GROUP={group}&FORMAT=tle",
                    timeout=15, headers={"User-Agent": USER_AGENT})
                lines = r.text.strip().split('\n')
                if _is_valid_tle(lines):
                    for i in range(0, len(lines) - 2, 3):
                        sat_names.append(lines[i].strip())
                    groups_ok += 1
            except Exception:
                pass

    # ── 3. 持久磁盘缓存：成功拉取时保存，限流/数据不足时读取 ──
    if sat_names and not from_cache and len(sat_names) > 3000:
        # 只有直接拉取 CelesTrak 且数据足够多才覆盖磁盘缓存
        try:
            save_data = {"names": sat_names, "time": time.time(), "groups": groups_ok}
            with open(SAT_CACHE_FILE, "w", encoding="utf-8") as f:
                json.dump(save_data, f, ensure_ascii=False)
        except Exception:
            pass

    # 当前数据不足 → 尝试磁盘缓存
    if len(sat_names) < 1000:
        try:
            if SAT_CACHE_FILE.exists():
                with open(SAT_CACHE_FILE, "r", encoding="utf-8") as f:
                    saved = json.load(f)
                if saved.get("names") and len(saved["names"]) > len(sat_names):
                    sat_names = saved["names"]
                    groups_ok = saved.get("groups", 0)
                    from_cache = True
        except Exception:
            pass

    # ── 4. 按国籍归类 ──
    country_counts = {}
    uncategorized = 0
    for name in sat_names:
        country = _classify_satellite(name)
        if country:
            country_counts[country] = country_counts.get(country, 0) + 1
        else:
            uncategorized += 1

    if sat_names:
        total_live = len(sat_names)
        total_str = f"{total_live:,}"
        if from_cache:
            total_source = f"CelesTrak 磁盘缓存 ({groups_ok}组, {total_live:,}颗, 限流恢复)"
        else:
            total_source = f"CelesTrak 实时拉取 ({groups_ok}组, {total_live:,}颗)"
        countries_source = "基于卫星名称推定国籍"
    else:
        total_str = "~9,900"
        total_source = "CelesTrak 不可用，使用估计值"
        countries_source = "静态参考 (CelesTrak 离线时)"

    total_str_clean = total_str.replace(",", "")

    # ── 3. 构建国家列表 (按卫星数降序) ──
    # 排序: 合并已知国家 + 未分类归入"其他"
    sorted_countries = sorted(country_counts.items(), key=lambda x: -x[1])

    # 国家 → 坐标/代码 映射
    COUNTRY_META = {
        "美国":     ("US", 38.9, -77.0),
        "中国":     ("CN", 39.9, 116.4),
        "俄罗斯":   ("RU", 55.8, 37.6),
        "英国":     ("GB", 51.5, -0.1),
        "日本":     ("JP", 35.7, 139.8),
        "印度":     ("IN", 28.6, 77.2),
        "欧盟/ESA": ("EU", 48.9, 2.3),
        "加拿大":   ("CA", 45.4, -75.7),
        "韩国":     ("KR", 37.6, 127.0),
        "法国":     ("FR", 48.9, 2.3),
        "德国":     ("DE", 52.5, 13.4),
        "巴西":     ("BR", -15.8, -47.9),
        "澳大利亚": ("AU", -35.3, 149.1),
        "阿联酋":   ("AE", 24.5, 54.4),
        "以色列":   ("IL", 31.8, 35.2),
        "阿根廷":   ("AR", -34.6, -58.4),
        "台湾":     ("TW", 25.0, 121.5),
    }

    countries = []
    for name, count in sorted_countries:
        meta = COUNTRY_META.get(name, ("OT", 0, 0))
        countries.append({
            "name": name,
            "code": meta[0],
            "count": count,
            "lat": meta[1],
            "lon": meta[2],
        })

    # 未分类 → "其他"
    if uncategorized > 0:
        countries.append({
            "name": "其他",
            "code": "OT",
            "count": uncategorized,
            "lat": 0,
            "lon": 0,
        })
    elif not sat_names:
        # CelesTrak 完全离线 → 保留最小硬编码兜底避免空白
        countries = [
            {"name":"美国","code":"US","count":8300,"lat":38.9,"lon":-77.0},
            {"name":"中国","code":"CN","count":620,"lat":39.9,"lon":116.4},
            {"name":"俄罗斯","code":"RU","count":175,"lat":55.8,"lon":37.6},
            {"name":"其他","code":"OT","count":805,"lat":0,"lon":0},
        ]

    return jsonify({
        "total": total_str,
        "total_source": total_source,
        "countries_source": countries_source,
        "countries": countries,
        "groups_fetched": groups_ok,
        "_source": "celestrak" if sat_names else "static",
    })

# ═══════════════════════════════════════════════════
#  ISS Pass Detail
# ═══════════════════════════════════════════════════
@app.route('/api/space/iss-pass-detail')
def api_iss_pass_detail():
    return jsonify({
        "current_distance_km": 58.7,
        "in_window": True,
        "next_passes": predict_passes()[:3],
        "moon_phase": moon_phase(),
    })

# ═══════════════════════════════════════════════════
#  [新] APOD — NASA 每日天文图
# ═══════════════════════════════════════════════════
APOD_CACHE = {"data": None, "date": None, "ttl": 3600}

@app.route('/api/space/apod')
def api_apod():
    global APOD_CACHE
    now = datetime.now(timezone.utc)
    today_str = now.strftime("%Y-%m-%d")
    if APOD_CACHE["date"] == today_str and APOD_CACHE["data"]:
        return jsonify(APOD_CACHE["data"])
    # NASA APOD 现在强制要求 API Key，直接带 Key 请求
    if NASA_KEY != "DEMO":
        try:
            data = safe_fetch(f"https://api.nasa.gov/planetary/apod?api_key={NASA_KEY}", timeout=8)
            if data and data.get("url"):
                result = {
                    "title": data.get("title", "?"),
                    "date": data.get("date", today_str),
                    "explanation": (data.get("explanation", "") or "")[:600],
                    "imageUrl": data.get("hdurl") or data.get("url", ""),
                    "media_type": data.get("media_type", "image"),
                    "copyright": data.get("copyright", "NASA"),
                    "_source": "live",
                }
                APOD_CACHE = {"data": result, "date": today_str, "ttl": 3600}
                return jsonify(result)
        except Exception: pass
    # 兜底硬编码
    return jsonify({
        "title": "创生之柱 — 鹰状星云 (M16)",
        "date": today_str,
        "explanation": "哈勃太空望远镜于1995年拍摄的经典影像。这些高达数光年的宇宙尘埃与气体柱位于鹰状星云核心，正在被附近年轻大质量恒星的强烈紫外线雕刻，是银河系最活跃的恒星形成区之一。",
        "imageUrl": "https://upload.wikimedia.org/wikipedia/commons/thumb/6/68/Pillars_of_creation_2014_HST_WFC3-UVIS_full-res_denoised.jpg/800px-Pillars_of_creation_2014_HST_WFC3-UVIS_full-res_denoised.jpg",
        "media_type": "image",
        "copyright": "NASA/ESA/HST",
        "_source": "demo",
    })

# ═══════════════════════════════════════════════════
#  [新] NEO — 近地小行星追踪
# ═══════════════════════════════════════════════════
@app.route('/api/space/neo')
def api_neo():
    if NASA_KEY != "DEMO":
        try:
            data = safe_fetch(f"https://api.nasa.gov/neo/rest/v1/feed?api_key={NASA_KEY}", timeout=10)
            if data and data.get("near_earth_objects"):
                objects = []
                for date_key, neos in list(data["near_earth_objects"].items())[:3]:
                    for neo in neos[:5]:
                        d = neo.get("estimated_diameter", {}).get("kilometers", {}).get("estimated_diameter_max", 0)
                        v = neo.get("close_approach_data", [{}])[0].get("relative_velocity", {}).get("kilometers_per_hour", "0")
                        m = neo.get("close_approach_data", [{}])[0].get("miss_distance", {}).get("lunar", "0")
                        objects.append({
                            "name": neo.get("name", "?"),
                            "diameter_km": round(d, 3) if d else 0,
                            "velocity_kph": round(float(v), 0) if v else 0,
                            "miss_distance_lunar": round(float(m), 1) if m else 0,
                            "hazardous": neo.get("is_potentially_hazardous_asteroid", False),
                            "approach_date": neo.get("close_approach_data", [{}])[0].get("close_approach_date", "?"),
                        })
                if objects:
                    return jsonify({"count": len(objects), "objects": objects[:12], "_source": "live"})
        except Exception:
            pass
    return jsonify({
        "count": 8,
        "objects": [
            {"name":"(2024 MK)","diameter_km":0.182,"velocity_kph":42100,"miss_distance_lunar":2.8,"hazardous":False,"approach_date":"2026-06-20"},
            {"name":"(2026 LE4)","diameter_km":0.067,"velocity_kph":38500,"miss_distance_lunar":5.1,"hazardous":False,"approach_date":"2026-06-21"},
            {"name":"(2023 BU)","diameter_km":0.005,"velocity_kph":33200,"miss_distance_lunar":0.9,"hazardous":False,"approach_date":"2026-06-21"},
            {"name":"(2026 OC1)","diameter_km":0.312,"velocity_kph":51200,"miss_distance_lunar":4.3,"hazardous":True,"approach_date":"2026-06-22"},
            {"name":"(2025 NT7)","diameter_km":0.445,"velocity_kph":28400,"miss_distance_lunar":7.6,"hazardous":False,"approach_date":"2026-06-23"},
            {"name":"(2026 PK)","diameter_km":0.098,"velocity_kph":46200,"miss_distance_lunar":3.2,"hazardous":False,"approach_date":"2026-06-23"},
            {"name":"(2024 YR4)","diameter_km":0.520,"velocity_kph":38900,"miss_distance_lunar":6.8,"hazardous":True,"approach_date":"2026-06-24"},
            {"name":"(2026 AQ3)","diameter_km":0.034,"velocity_kph":29500,"miss_distance_lunar":1.5,"hazardous":False,"approach_date":"2026-06-25"},
        ],
        "_source": "demo",
    })

# ═══════════════════════════════════════════════════
#  [新] Mars Weather — 火星天气 (Curiosity REMS · Gale Crater)
#  ═══════════════════════════════════════════════════
@app.route('/api/space/mars-weather')
def api_mars_weather():
    # NASA InSight 已于 2022-12 退役 → 改用 Curiosity REMS (CAB/NASA 持续更新)
    try:
        data = safe_fetch(
            "https://mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json",
            timeout=12,
            headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
        if data and data.get("soles"):
            sols = []
            for s in data["soles"][:7]:
                # REMS temperatures are already in Celsius
                max_t = s.get("max_temp", "--")
                min_t = s.get("min_temp", "--")
                # Ground temp (GTS) as fallback if air temp missing
                if max_t == "--":
                    max_t = s.get("max_gts_temp", "--")
                if min_t == "--":
                    min_t = s.get("min_gts_temp", "--")
                pressure = s.get("pressure", "--")
                # Convert to numbers where possible
                try: max_t_c = float(max_t)
                except (ValueError, TypeError): max_t_c = None
                try: min_t_c = float(min_t)
                except (ValueError, TypeError): min_t_c = None
                try: pressure_pa = float(pressure)
                except (ValueError, TypeError): pressure_pa = None
                # Wind rarely available via REMS outreach feed
                wind = s.get("wind_speed", "--")
                try: wind_mps = float(wind)
                except (ValueError, TypeError): wind_mps = None
                sols.append({
                    "sol": s.get("sol", "?"),
                    "season": s.get("season", "?"),
                    "max_temp_c": round(max_t_c, 1) if max_t_c is not None else None,
                    "min_temp_c": round(min_t_c, 1) if min_t_c is not None else None,
                    "pressure_pa": round(pressure_pa, 1) if pressure_pa is not None else None,
                    "wind_mps": round(wind_mps, 1) if wind_mps is not None else None,
                    "atmo_opacity": s.get("atmo_opacity", "--"),
                    "terrestrial_date": s.get("terrestrial_date", "?"),
                    "uv_index": s.get("local_uv_irradiance_index", "--"),
                })
            return jsonify({
                "sols": sols,
                "station": f"Gale Crater · Curiosity ({data.get('soles', [])[0].get('sol', '?') if data.get('soles') else '?'})",
                "_source": "live",
            })
    except Exception:
        pass
    # 硬编码兜底 (所有 API 均不可用时)
    return jsonify({
        "sols": [
            {"sol":"4927","season":"Month 11","max_temp_c":0.0,"min_temp_c":-69.0,"pressure_pa":804.0,"wind_mps":None,"atmo_opacity":"Sunny","terrestrial_date":"2026-06-16","uv_index":"Moderate"},
            {"sol":"4926","season":"Month 11","max_temp_c":-2.0,"min_temp_c":-72.0,"pressure_pa":809.0,"wind_mps":None,"atmo_opacity":"Sunny","terrestrial_date":"2026-06-15","uv_index":"Moderate"},
            {"sol":"4925","season":"Month 11","max_temp_c":-4.0,"min_temp_c":-72.0,"pressure_pa":806.0,"wind_mps":None,"atmo_opacity":"Sunny","terrestrial_date":"2026-06-14","uv_index":"Moderate"},
            {"sol":"4924","season":"Month 11","max_temp_c":-2.0,"min_temp_c":-66.0,"pressure_pa":805.0,"wind_mps":None,"atmo_opacity":"Sunny","terrestrial_date":"2026-06-13","uv_index":"Moderate"},
            {"sol":"4923","season":"Month 11","max_temp_c":1.0,"min_temp_c":-72.0,"pressure_pa":807.0,"wind_mps":None,"atmo_opacity":"Sunny","terrestrial_date":"2026-06-12","uv_index":"Moderate"},
        ],
        "station": "Gale Crater · Curiosity Rover (REMS)",
        "_source": "demo",
    })

# ═══════════════════════════════════════════════════
#  [新] Space News — 航天新闻聚合
# ═══════════════════════════════════════════════════
@app.route('/api/space/news')
def api_space_news():
    try:
        data = safe_fetch("https://api.spaceflightnewsapi.net/v4/articles/?limit=6", timeout=8)
        if data and data.get("results"):
            articles = []
            for a in data["results"][:6]:
                articles.append({
                    "title": a.get("title", "?"),
                    "url": a.get("url", "#"),
                    "source": a.get("news_site", "?"),
                    "summary": (a.get("summary", "") or "")[:200],
                    "published": (a.get("published_at", "") or "")[:10],
                    "imageUrl": a.get("image_url", ""),
                })
            if articles:
                return jsonify({"articles": articles, "_source": "live"})
    except Exception: pass
    return jsonify({
        "articles": [
            {"title":"SpaceX Successfully Launches 23 Starlink v2 Satellites from Cape Canaveral","url":"#","source":"SpaceNews","summary":"Falcon 9 booster B1069 completed its 15th flight and successfully landed on droneship. This marks SpaceX's 62nd orbital mission of 2026.","published":"2026-06-19","imageUrl":"https://images.unsplash.com/photo-1517976487492-5750f3195933?w=400"},
            {"title":"NASA's Artemis III Moon Landing Preparations Advance with New Spacesuit Tests","url":"#","source":"NASA.gov","summary":"Axiom Space and NASA completed critical mobility tests of the next-generation lunar spacesuit in simulated 1/6 gravity environment.","published":"2026-06-18","imageUrl":"https://images.unsplash.com/photo-1446776811953-b23d57bd21aa?w=400"},
            {"title":"Webb Telescope Reveals New Details About TRAPPIST-1 Exoplanet Atmospheres","url":"#","source":"ESA","summary":"JWST's MIRI instrument detected potential biosignatures in the atmosphere of TRAPPIST-1e, the most Earth-like exoplanet candidate.","published":"2026-06-17","imageUrl":"https://images.unsplash.com/photo-1614313913007-cf1e7db5f8bb?w=400"},
            {"title":"China's Chang'e Program Targets Far Side Sample Return by 2027","url":"#","source":"CNSA","summary":"Following Chang'e-6 success, CNSA announces accelerated timeline for Chang'e-7 south pole mission with sample return capability.","published":"2026-06-16","imageUrl":"https://images.unsplash.com/photo-1444703686981-a3abbc4d4fe3?w=400"},
            {"title":"ESA's JUICE Spacecraft Completes Earth-Moon Gravity Assist Flyby","url":"#","source":"ESA.int","summary":"The Jupiter Icy Moons Explorer successfully executed a dual gravity assist maneuver, using both Moon and Earth to slingshot toward Jupiter.","published":"2026-06-15","imageUrl":"https://images.unsplash.com/photo-1614642264762-d0a3b8bf3700?w=400"},
            {"title":"First Commercial Space Station Module Passes Critical Design Review","url":"#","source":"Space.com","summary":"Axiom Space's first commercial module for the ISS passed its CDR, clearing the way for manufacturing and a planned 2028 launch.","published":"2026-06-15","imageUrl":"https://images.unsplash.com/photo-1614728263952-84ea256f9679?w=400"},
        ],
        "_source": "demo",
    })

# ═══════════════════════════════════════════════════
#  [新] Upcoming Launches — 即将发射任务
# ═══════════════════════════════════════════════════
@app.route('/api/space/launches')
def api_launches():
    try:
        data = safe_fetch("https://ll.thespacedevs.com/2.2.0/launch/upcoming/?limit=8", timeout=8)
        if data and data.get("results"):
            launches = []
            for L in data["results"][:8]:
                utc = L.get("net", "")
                rd = f"{utc[:10]} {utc[11:16]}" if len(utc) >= 16 else utc
                launches.append({
                    "name": L.get("name", "?"),
                    "window_start": rd,
                    "rocket": (L.get("rocket") or {}).get("configuration", {}).get("full_name", "?"),
                    "pad": (L.get("pad") or {}).get("name", "?"),
                    "agency": (L.get("launch_service_provider") or {}).get("name", "?"),
                    "mission_type": L.get("mission", {}).get("type", "?") if L.get("mission") else "?",
                    "status": L.get("status", {}).get("name", "?"),
                })
            if launches:
                return jsonify({"count": len(launches), "launches": launches, "_source": "live"})
    except Exception: pass
    return jsonify({
        "count": 6,
        "launches": [
            {"name":"Falcon 9 Block 5 | Starlink Group 6-36","window_start":"2026-06-20 14:30","rocket":"Falcon 9 Block 5","pad":"SLC-40, Cape Canaveral","agency":"SpaceX","mission_type":"Communications","status":"Go for Launch"},
            {"name":"Long March 2D | Yaogan-39 Group 06","window_start":"2026-06-21 04:15","rocket":"Long March 2D","pad":"LC-9, Taiyuan Satellite Launch Center","agency":"CASC","mission_type":"Earth Observation","status":"TBD"},
            {"name":"Electron | 'Owl Night Long' (StriX-3)","window_start":"2026-06-22 11:45","rocket":"Electron","pad":"Rocket Lab LC-1B, Mahia Peninsula","agency":"Rocket Lab","mission_type":"Earth Observation","status":"Go for Launch"},
            {"name":"Atlas V 551 | USSF-51 (GSSAP 7 & 8)","window_start":"2026-06-24 08:00","rocket":"Atlas V 551","pad":"SLC-41, Cape Canaveral","agency":"ULA","mission_type":"Military","status":"TBD"},
            {"name":"Soyuz 2.1a | Progress MS-29 (90P)","window_start":"2026-06-26 19:38","rocket":"Soyuz 2.1a","pad":"Site 31/6, Baikonur Cosmodrome","agency":"Roscosmos","mission_type":"ISS Resupply","status":"Go for Launch"},
            {"name":"Falcon 9 Block 5 | Transporter-11 (SSO Rideshare)","window_start":"2026-06-28 06:00","rocket":"Falcon 9 Block 5","pad":"SLC-4E, Vandenberg","agency":"SpaceX","mission_type":"Dedicated Rideshare","status":"TBD"},
        ],
        "_source": "demo",
    })

# ═══════════════════════════════════════════════════
#  [新] Exoplanets — NASA 系外行星档案馆实时查询
# ═══════════════════════════════════════════════════
@app.route('/api/space/exoplanets')
def api_exoplanets():
    try:
        # NASA Exoplanet Archive TAP API — 免 Key，即时同步最新科学数据
        query = "pl_name,hostname,sy_dist,pl_orbper,pl_masse,pl_rade,disc_facility,pl_bmasse"
        url = f"https://exoplanetarchive.ipac.caltech.edu/TAP/sync?query=SELECT+TOP+20+{query}+FROM+ps+WHERE+default_flag=1+ORDER+BY+sy_dist+ASC&format=json"
        data = safe_fetch(url, timeout=15)
        if data and isinstance(data, list) and len(data) > 0:
            planets = []
            for p in data[:20]:
                dist = p.get("sy_dist")
                mass = p.get("pl_masse")
                planets.append({
                    "name": p.get("pl_name","?"),
                    "star": p.get("hostname","?"),
                    "distance_ly": round(dist, 1) if dist else None,
                    "mass_earth": round(mass, 2) if mass else None,
                    "orbit_days": round(p.get("pl_orbper", 0), 2) if p.get("pl_orbper") else None,
                    "radius_earth": round(p.get("pl_rade",0), 2) if p.get("pl_rade") else None,
                    "facility": p.get("disc_facility","?"),
                })
            return jsonify({
                "count": len(planets),
                "description": "NASA Exoplanet Archive — 实时系外行星科学数据库",
                "planets": planets,
                "_source": "live",
            })
    except Exception: pass

    # 硬编码兜底（NASA API 不可用时）
    return jsonify({
        "count": 12, "description": "精选太阳系外行星 — 高科学价值目标",
        "planets": [
            {"name":"Proxima Centauri b","distance_ly":4.24,"mass_earth":1.27,"orbit_days":11.2,"star":"Proxima Centauri","facility":"ESO-HARPS"},
            {"name":"TRAPPIST-1e","distance_ly":39.5,"mass_earth":0.77,"orbit_days":6.1,"star":"TRAPPIST-1","facility":"Spitzer"},
            {"name":"55 Cancri e","distance_ly":41,"mass_earth":8.08,"orbit_days":0.74,"star":"55 Cancri","facility":"Keck"},
            {"name":"LHS 1140 b","distance_ly":48.8,"mass_earth":6.98,"orbit_days":24.7,"star":"LHS 1140","facility":"MEarth"},
            {"name":"HD 189733 b","distance_ly":64.5,"mass_earth":361,"orbit_days":2.2,"star":"HD 189733","facility":"ELODIE"},
            {"name":"TOI-700 d","distance_ly":101.4,"mass_earth":1.72,"orbit_days":37.4,"star":"TOI-700","facility":"TESS"},
            {"name":"K2-18 b","distance_ly":124,"mass_earth":8.63,"orbit_days":32.9,"star":"K2-18","facility":"Kepler"},
            {"name":"HD 209458 b","distance_ly":159,"mass_earth":219,"orbit_days":3.5,"star":"HD 209458","facility":"STARE"},
            {"name":"Kepler-186f","distance_ly":582,"mass_earth":1.4,"orbit_days":129.9,"star":"Kepler-186","facility":"Kepler"},
            {"name":"Kepler-452b","distance_ly":1402,"mass_earth":5.0,"orbit_days":384.8,"star":"Kepler-452","facility":"Kepler"},
            {"name":"WASP-12b","distance_ly":1410,"mass_earth":445,"orbit_days":1.1,"star":"WASP-12","facility":"SuperWASP"},
            {"name":"Gliese 667 Cc","distance_ly":23.6,"mass_earth":3.7,"orbit_days":28.1,"star":"Gliese 667C","facility":"ESO-HARPS"},
        ],
        "_source": "demo",
    })

# ═══════════════════════════════════════════════════
#  [新] Moon Calendar — 月相月历
# ═══════════════════════════════════════════════════
@app.route('/api/space/moon-calendar')
def api_moon_calendar():
    mp = moon_phase()
    now_utc = datetime.now(timezone.utc)
    days_since = (now_utc - LUNAR_REF).total_seconds() / 86400
    current_lunation = days_since % LUNAR_DAYS
    next_full = LUNAR_DAYS * 0.5 - current_lunation
    if next_full < 0: next_full += LUNAR_DAYS
    next_new = LUNAR_DAYS - current_lunation
    if next_new < 0: next_new += LUNAR_DAYS

    events = []
    PHASE_NAMES = ["New Moon", "Waxing Crescent", "First Quarter", "Waxing Gibbous",
                   "Full Moon", "Waning Gibbous", "Last Quarter", "Waning Crescent"]
    for i in range(6):
        d = now_utc + timedelta(days=i * 7)
        days_from_ref = (d - LUNAR_REF).total_seconds() / 86400
        ang = (days_from_ref % LUNAR_DAYS) / LUNAR_DAYS * 360
        ill = round((1 - math.cos(math.radians(ang))) / 2 * 100, 1)
        idx = int(((ang + 22.5) % 360) / 45)
        events.append({
            "date": d.strftime("%Y-%m-%d"),
            "phase": PHASE_NAMES[idx % 8],
            "illumination": ill,
            "phase_angle": round(ang, 1),
        })

    return jsonify({
        "current_phase": mp["phase_name"],
        "current_illumination": mp["illumination_pct"],
        "days_to_full_moon": round(next_full, 1),
        "days_to_new_moon": round(next_new, 1),
        "lunation_days": round(current_lunation, 1),
        "forecast": events,
        "_source": "local",
    })

# ═══════════════════════════════════════════════════
#  [新] Observing Forecast (预设观测点: 澳门)
# ═══════════════════════════════════════════════════
@app.route('/api/space/observing')
def api_observing():
    mp = moon_phase()
    now_hkt = datetime.now(timezone.utc) + timedelta(hours=8)
    hour = now_hkt.hour

    # Calculate score based on moon phase (darker = better), time of day
    moon_score = 100 - mp["illumination_pct"] * 0.7  # Less moon = better
    time_score = 0
    if 20 <= hour <= 23 or 0 <= hour <= 5: time_score = 100
    elif 18 <= hour < 20 or 5 < hour <= 6: time_score = 60
    else: time_score = 10  # daytime

    total_score = round(moon_score * 0.5 + time_score * 0.5, 1)
    if total_score >= 80: grade = "A (Excellent)"
    elif total_score >= 60: grade = "B (Good)"
    elif total_score >= 40: grade = "C (Fair)"
    else: grade = "D (Poor)"

    visible_planets = []
    current_month = now_hkt.month
    if current_month in [5, 6, 7]:
        visible_planets = ["Venus (evening W)", "Mars (evening SE)", "Jupiter (morning E)", "Saturn (morning SE)"]
    elif current_month in [8, 9]:
        visible_planets = ["Venus (evening W)", "Jupiter (all night)", "Saturn (all night)", "Mars (late evening)"]
    else:
        visible_planets = ["Venus (dusk)", "Mars (variable)", "Jupiter (variable)", "Saturn (variable)"]

    return jsonify({
        "location": "Macau (22.1989N, 113.5491E) — Default Observation Point",
        "local_time": now_hkt.strftime("%Y-%m-%d %H:%M HKT"),
        "moon_phase": mp["phase_name"],
        "moon_illumination": f"{mp['illumination_pct']}%",
        "observing_score": total_score,
        "grade": grade,
        "visible_planets": visible_planets,
        "recommendation": "Good for deep-sky" if mp["illumination_pct"] < 30 else "Bright objects only" if mp["illumination_pct"] < 70 else "Moon observation ideal",
        "tip": "Coloane heights offer darkest skies in Macau — best spot is near Hac Sa Reservoir facing south. (Default observation point)",
        "_source": "local",
    })

# ═══════════════════════════════════════════════════
#  [超级升级] CelesTrak 真实卫星 TLE — 多组聚合拉取
# ═══════════════════════════════════════════════════

TLE_CACHE = {"data": None, "time": 0}

# CelesTrak 各组独立限流配额，聚合可获 10,000+ 真实卫星
TLE_GROUPS = [
    "active",     # ~10,000 (主组，可能被限流)
    "starlink",   # ~10,600 (星链)
    "visual",     # ~150 (最亮可视卫星)
    "stations",   # ~25 (空间站: ISS/天宫)
    "gps-ops",    # ~32 (GPS 运行卫星)
    "oneweb",     # ~600 (OneWeb)
    "iridium",    # ~80 (铱星)
]

def _is_valid_tle(lines):
    """验证 CelesTrak 返回的是真实 TLE 数据而非限流警告"""
    if not lines or len(lines) < 3:
        return False
    l1 = lines[1].strip() if len(lines) > 1 else ""
    l2 = lines[2].strip() if len(lines) > 2 else ""
    return l1.startswith("1 ") and l2.startswith("2 ")

def _fetch_tle_group(group):
    """拉取单个 CelesTrak group，返回卫星列表或 None"""
    try:
        r = requests.get(
            f"https://celestrak.org/NORAD/elements/gp.php?GROUP={group}&FORMAT=tle",
            timeout=15, headers={"User-Agent": USER_AGENT})
        lines = r.text.strip().split('\n')
        if not _is_valid_tle(lines):
            return None  # 限流或无效
        sats = []
        for i in range(0, len(lines)-2, 3):
            sats.append({
                "name": lines[i].strip(),
                "tle1": lines[i+1].strip(),
                "tle2": lines[i+2].strip()
            })
        return sats
    except Exception:
        return None

@app.route('/api/space/tle')
def api_tle():
    global TLE_CACHE
    if TLE_CACHE["data"] and time.time() - TLE_CACHE["time"] < 14400:
        return jsonify(TLE_CACHE["data"])

    cached = TLE_CACHE["data"]

    # 多组聚合拉取（去重：按 TLE 行1 的 NORAD ID）
    all_sats = []
    seen_norad = set()
    live_groups = 0

    for group in TLE_GROUPS:
        sats = _fetch_tle_group(group)
        if sats:
            for s in sats:
                # 用 TLE line1 第3-7位字符作为 NORAD ID 去重
                norad_id = s["tle1"][2:7].strip() if len(s["tle1"]) > 7 else s["name"]
                if norad_id not in seen_norad:
                    seen_norad.add(norad_id)
                    all_sats.append(s)
            live_groups += 1

    if all_sats:
        # 限制前端性能，最多 6000 颗
        capped = all_sats[:6000]
        TLE_CACHE = {
            "data": {"count": len(capped), "sats": capped, "_source": "celestrak", "groups": live_groups},
            "time": time.time()
        }
        return jsonify(TLE_CACHE["data"])

    # 所有组都失败了 — 用缓存或本地模拟
    if cached:
        return jsonify(cached)

    import random, math
    mock_sats = []
    for k in range(3000):
        inc = random.uniform(50.0, 98.0)
        alt = random.uniform(350.0, 1200.0)
        period_min = 84.5 + (alt - 200.0) * 0.018
        mean_motion = 1440.0 / period_min
        raan = random.uniform(0.0, 360.0)
        ecc = random.uniform(0.0001, 0.002)
        arg_p = random.uniform(0.0, 360.0)
        mean_an = random.uniform(0.0, 360.0)
        sat_num = 40000 + k
        tle1 = f"1 {sat_num:05d}U 26001A   26170.50000000  .00001000  00000-0  10000-3 0  999{k%10}"
        tle2 = f"2 {sat_num:05d} {inc:8.4f} {raan:8.4f} {int(ecc*10000000):07d} {arg_p:8.4f} {mean_an:8.4f} {mean_motion:11.8f}{k%10}"
        mock_sats.append({
            "name": f"ORBIT-MOCK-{k:04d}",
            "tle1": tle1,
            "tle2": tle2
        })
    mock_data = {"count": len(mock_sats), "sats": mock_sats, "_source": "local_simulated_fallback"}
    TLE_CACHE = {"data": mock_data, "time": time.time()}
    return jsonify(mock_data)

# ═══════════════════════════════════════════════════
#  [新] Planet Info — Solar System OpenData API
# ═══════════════════════════════════════════════════
SOLAR_CACHE = {"data": None, "time": 0}
SOLAR_FAIL  = {"time": 0}  # le-systeme 最近一次失败时间；失败时短期内直接用本地兜底，避免每次请求卡顿

# 中文名 → API English Name 映射
PLANET_NAME_MAP = {
    "太阳": "Sun", "水星": "Mercury", "金星": "Venus",
    "地球": "Earth", "火星": "Mars", "木星": "Jupiter",
    "土星": "Saturn", "天王星": "Uranus", "海王星": "Neptune",
}

# 本地真实行星数据兜底（le-systeme 不可达时使用，字段与 Solar System OpenData API 对齐；键用小写英文名，与前端 planet-info 参数一致）
PLANET_FALLBACK = {
    "sun": {"bodyType":"Star","meanRadius":696340,"mass":{"massValue":1.989,"massExponent":30},
             "sideralRotation":609.12,"axialTilt":7.25,"gravity":274.0,"density":1.408,
             "avgTemp":5778,"escape":617500,"moons":0},
    "mercury": {"bodyType":"Planet","isPlanet":True,"meanRadius":2439.7,"mass":{"massValue":3.301,"massExponent":23},
             "sideralOrbit":87.97,"sideralRotation":1407.6,"axialTilt":0.034,"gravity":3.70,
             "density":5.427,"avgTemp":440,"escape":4250,"moons":0},
    "venus": {"bodyType":"Planet","isPlanet":True,"meanRadius":6051.8,"mass":{"massValue":4.867,"massExponent":24},
             "sideralOrbit":224.70,"sideralRotation":5832.5,"axialTilt":177.36,"gravity":8.87,
             "density":5.243,"avgTemp":737,"escape":10360,"moons":0},
    "earth": {"bodyType":"Planet","isPlanet":True,"meanRadius":6371.0,"mass":{"massValue":5.972,"massExponent":24},
             "sideralOrbit":365.25,"sideralRotation":23.93,"axialTilt":23.44,"gravity":9.807,
             "density":5.513,"avgTemp":288,"escape":11186,"moons":1},
    "mars": {"bodyType":"Planet","isPlanet":True,"meanRadius":3389.5,"mass":{"massValue":6.417,"massExponent":23},
             "sideralOrbit":686.98,"sideralRotation":24.62,"axialTilt":25.19,"gravity":3.721,
             "density":3.933,"avgTemp":210,"escape":5027,"moons":2},
    "jupiter": {"bodyType":"Planet","isPlanet":True,"meanRadius":69911,"mass":{"massValue":1.898,"massExponent":27},
             "sideralOrbit":4332.59,"sideralRotation":9.93,"axialTilt":3.13,"gravity":24.79,
             "density":1.326,"avgTemp":165,"escape":59500,"moons":95},
    "saturn": {"bodyType":"Planet","isPlanet":True,"meanRadius":58232,"mass":{"massValue":5.683,"massExponent":26},
             "sideralOrbit":10759.22,"sideralRotation":10.66,"axialTilt":26.73,"gravity":10.44,
             "density":0.687,"avgTemp":134,"escape":35500,"moons":146},
    "uranus": {"bodyType":"Planet","isPlanet":True,"meanRadius":25362,"mass":{"massValue":8.681,"massExponent":25},
               "sideralOrbit":30688.5,"sideralRotation":17.24,"axialTilt":97.77,"gravity":8.87,
               "density":1.271,"avgTemp":76,"escape":21300,"moons":27},
    "neptune": {"bodyType":"Planet","isPlanet":True,"meanRadius":24622,"mass":{"massValue":1.024,"massExponent":26},
               "sideralOrbit":60182.0,"sideralRotation":16.11,"axialTilt":28.32,"gravity":11.15,
               "density":1.638,"avgTemp":72,"escape":23500,"moons":14},
}

# 英文名(首字母大写) → 中文名（用于信息卡显示）
REV_MAP = {v: k for k, v in PLANET_NAME_MAP.items()}

def _planet_fallback(planet):
    """le-systeme 不可达时返回内置真实行星数据；成功返回 {"info": ...}，否则 None"""
    en = PLANET_NAME_MAP.get(planet, planet)        # 中文名→英文名，英文名保持不变
    key = en.lower()                                # 前端传小写英文名，统一小写查表
    data = PLANET_FALLBACK.get(key)
    if not data:
        return None
    cn = REV_MAP.get(en) or REV_MAP.get(en.title()) or planet
    return {"info": _format_planet_info(data, cn)}


def _format_planet_info(p, cn_name):
    """将 Solar System API 返回的行星数据格式化为繁体中文简介"""
    # 基本参数
    moons = p.get("moons")
    moon_count = len(moons) if isinstance(moons, list) else (moons or 0)
    gravity = p.get("gravity")
    density = p.get("density")
    radius = p.get("meanRadius")
    temp_k = p.get("avgTemp")
    mass = p.get("mass", {})
    mass_kg = None
    if mass and mass.get("massValue"):
        mass_kg = f"{mass['massValue']}×10^{mass['massExponent']} kg"
    orbit_days = p.get("sideralOrbit")
    rot_hours = p.get("sideralRotation")
    axis_tilt = p.get("axialTilt")
    escape_vel = p.get("escape")

    parts = [f"{cn_name}"]
    # 分类描述
    body_type = p.get("bodyType", "")
    if body_type == "Star":
        parts.append("恒星")
    elif p.get("isPlanet"):
        if density and density < 2:
            parts.append("气态巨行星" if radius and radius > 50000 else "冰巨星")
        else:
            parts.append("岩石行星")

    # 物理指标
    if gravity:
        parts.append(f"重力 {gravity} m/s²")
    if density:
        parts.append(f"密度 {density} g/cm³")
    if radius:
        parts.append(f"半径 {radius:,.0f} km")
    if mass_kg:
        parts.append(f"质量 {mass_kg}")
    if temp_k:
        parts.append(f"均温 {temp_k} K")
    if moon_count:
        parts.append(f"{moon_count} 颗已知卫星")
    if orbit_days:
        parts.append(f"公转 {orbit_days:.1f} 天" if orbit_days > 100 else f"公转 {orbit_days:.2f} 天")
    if rot_hours and rot_hours > 0:
        parts.append(f"自转 {rot_hours:.1f} 小时")
    if axis_tilt is not None:
        parts.append(f"轴倾角 {axis_tilt}°")
    if escape_vel:
        parts.append(f"逃逸速度 {escape_vel/1000:.1f} km/s")

    return " | ".join(parts)

@app.route('/api/space/planet-info')
def api_planet_info():
    planet = request.args.get("planet", "太阳")
    global SOLAR_CACHE, SOLAR_FAIL

    # 近期已知 le-systeme 不可达 → 直接返回本地真实数据，避免每次请求卡 8~15 秒
    if SOLAR_FAIL["time"] and (time.time() - SOLAR_FAIL["time"]) < 600:
        fb = _planet_fallback(planet)
        if fb:
            return jsonify({"planet": planet, "info": fb["info"], "source": "local-cache"})

    # ── 1. 尝试 Solar System OpenData API ──
    try:
        now = time.time()
        # 缓存 1 小时（所有天体一次拉取）
        if not SOLAR_CACHE["data"] or now - SOLAR_CACHE["time"] > 3600:
            resp = requests.get(SOLAR_API_URL,
                timeout=10,
                headers={"User-Agent": USER_AGENT,
                         "Authorization": f"Bearer {SOLAR_SYS_KEY}"})
            if resp.status_code == 200:
                SOLAR_CACHE = {"data": resp.json(), "time": now}
            else:
                SOLAR_FAIL["time"] = now
        if SOLAR_CACHE["data"]:
            en_name = PLANET_NAME_MAP.get(planet, planet)
            bodies = SOLAR_CACHE["data"].get("bodies", [])
            for b in bodies:
                if b.get("englishName") == en_name:
                    info = _format_planet_info(b, planet)
                    return jsonify({"planet": planet, "info": info, "source": "Solar-System-OpenData-API"})
    except Exception:
        SOLAR_FAIL["time"] = time.time()

    # ── 2. API 不可用 → 使用内置真实行星数据兜底 ──
    fb = _planet_fallback(planet)
    if fb:
        return jsonify({"planet": planet, "info": fb["info"], "source": "local-cache"})
    return jsonify({"planet": planet, "info": f"{planet} | 数据暂时不可用。", "source": "error"})

# ═══════════════════════════════════════════════════
#  启动
# ═══════════════════════════════════════════════════
if __name__ == "__main__":
    print(f"""
+==========================================================+
|  轨道之眼 OrbitEye  v1.0                                  |
|                                                          |
|  Server:  http://127.0.0.1:{PORT}                              |
|  NASA Key: {"CONFIGURED" if NASA_KEY!="DEMO" else "DEMO (offline fallback)"} |
|                                                          |
|  Pages: [1] 遥测仪表盘  [2] 太阳系手势控制                |
+==========================================================+
    """)
    app.run(host="0.0.0.0", port=PORT, debug=False, use_reloader=False)
