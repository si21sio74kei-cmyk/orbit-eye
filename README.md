# 轨道之眼 · OrbitEye — 太空数据中心 / Space Data Center

## 多页面 · 3D 行星 (GPU Shader) · MediaPipe 手势交互的太空遥测平台

![Python](https://img.shields.io/badge/python-3.9+-blue.svg)
![Three.js](https://img.shields.io/badge/3D-Three.js-orange.svg)
![MediaPipe](https://img.shields.io/badge/Gesture-MediaPipe-red.svg)
![Version](https://img.shields.io/badge/version-1.0-blue.svg)

> **"立足地球，仰望星空 — 全球太空环境实时监测 + 手势交互太阳系"**

---

## Quick Start (Teacher One-Click Demo)

```bash
pip install -r requirements.txt
python Space_Data_Center.py
# Open http://127.0.0.1:5500 in your browser
# Solar system: http://127.0.0.1:5500/solar
```

**API keys are read from environment variables / `.env`** (see `.env.example`). Falls back to built-in demo keys if unset — teacher demo works with zero configuration.
**兜底数据已内置在代码中** — 不联网也能完整运行（外部 API 失败时自动回退到内置真实/演示数据）。

---

## 太阳系 3D 手势页（Page 2）

### Solar System 3D (Page 2)

| Feature | Description |
|---------|-------------|
| ☄️ **Asteroid Belt** | 8,192 particles between Mars & Jupiter, slowly rotating |
| 🌙 **Earth's Moon** | Orbiting satellite with glow halo, realistic orbital period |
| ☀️ **Sun Corona Field** | 256 plasma particles boiling around the Sun with pulsing opacity |
| 💫 **Shooting Stars** | Random meteor streaks across the starfield (12 max, auto-spawning) |
| 🏷️ **Always-Visible Labels** | Planet names rendered as CSS overlays with glow effects |
| 🪐 **Saturn Rings** | GPU-shader rendered ring system with Cassini/Encke divisions |

---

## Project Highlights

### 1. Multi-Page Architecture (Page Navigation)

Two independent pages with smooth CSS transitions and multiple navigation methods:

| Page | Name | Key Features |
|------|------|-------------|
| **Page 1** | Telemetry Dashboard | 3D Earth globe with ISS tracking, 5 real-time data cards (ISS orbit, SpaceX launch, celestial imaging, Macau weather/AQI, solar storm) |
| **Page 2** | Interactive Galaxy | 8,192-particle spiral galaxy with Three.js. **MediaPipe hand gesture control**. Mouse/touch fallback. |


**Navigation methods:**
- Sidebar tabs (click)
- Keyboard shortcuts (`1`, `2`)
- Touch swipe (mobile)
- Hand swipe on Page 2 (MediaPipe — move hand to screen edge)

### 2. MediaPipe Hand Gesture Control (Page 2)

When the camera is enabled on Page 2, the system uses Google MediaPipe Hands to track hand movements:

| Gesture | Action |
|---------|--------|
| **Palm movement** | Rotate the 3D particle galaxy in real-time |
| **Pinch (thumb + index)** | Select the nearest star cluster — detail popup appears |
| **Hand to screen edge** | Swipe left/right to switch between pages |
| **No camera available** | Automatically falls back to mouse/touch control |

The webcam feed appears in a small Picture-in-Picture overlay. Camera permission is requested only when the user clicks "CAMERA".

### 3. 自动兜底（稳如老狗的容错）

任意一个外部 API 失败（断网、超时、服务器出错）时，系统会自动回退到**代码内置的真实 / 演示数据**：

```
实时 API 请求 → 成功? → 显示真实数据
              ↓ 失败
              → 回退内置兜底数据 → 显示兜底数据（绝不会出现空白 / 报错）
```

**兜底覆盖：**
- ISS 位置：复用上一次真实坐标（绿点留在真实轨道，不会跳到澳门）
- SpaceX 发射、地球/火星/月球影像、新闻、系外行星等均有内置示例
- 天气：26 个城市的内置示例（澳门、香港、广州、深圳、北京、上海、台北…）
- 太阳风暴：平静太阳演示值（NOAA + NASA DONKI 都连不上时才用）

**老师演示时永远能看到完整可用的仪表盘** —— 即使完全断网。

### 4. Industrial-Grade Backend

- **Multi-source data fusion**: Open-Meteo → Open-Meteo Air Quality → Demo (3-layer fallback)
- **Dual solar monitoring**: NOAA SWPC solar wind → NASA DONKI CME → Demo
- **ISS pass prediction**: Mathematical model based on 92.68-min orbit, 51.6deg inclination
- **Moon phase calculation**: Synodic month (29.53-day) algorithm
- **Parallel data aggregation**: `/api/space/dashboard` uses ThreadPoolExecutor (6 concurrent workers)
- **File-based TTL cache**: Reduces API calls, no Redis dependency

---

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Serves the multi-page dashboard |
| `/api/space/iss` | GET | ISS position + 与澳门直线距离 + pass predictions |
| `/api/space/spacex` | GET | Latest SpaceX launch mission details |
| `/api/space/space-body?type=` | GET | Celestial images (earth/mars/moon) |
| `/api/space/weather?city=` | GET | Weather + AQI with multi-source fallback |
| `/api/space/solar-storm` | GET | Solar wind + CME monitoring |
| `/api/space/dashboard` | GET | All data aggregated in parallel |
| `/api/space/health` | GET | System health + demo mode status |


---

## File Structure

```
project/
  Space_Data_Center.py   Main Flask server (reads keys from .env)
  dashboard.html         Multi-page frontend (2 pages, Three.js, MediaPipe)
  solar-system.html      Gesture-controlled 3D solar system
  requirements.txt       Python dependencies (3 packages)
  README.md              This documentation
  static/
    css/
      datav.css          Dashboard + startup screen styles
      solar.css          Solar system page styles
    js/
      dashboard.js       Dashboard core application logic
      solar.js           Solar system 3D + gesture code
      planet_shaders.js  GLSL procedural planet shaders (9 planets)
    textures/             Planet texture maps (14 files)
```

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `1` | Switch to Telemetry Dashboard |
| `2` | Switch to Interactive Galaxy |

| `Ctrl+R` | Refresh all data |
| `Esc` | Close any open popup |

---

## Data Sources

| API | URL | Role |
|-----|-----|------|

| NASA EPIC | api.nasa.gov | Earth full-disk images (DSCOVR) |
| NASA Mars Rover | api.nasa.gov | Curiosity surface photos |
| NASA DONKI | api.nasa.gov | Coronal Mass Ejection events |
| NOAA SWPC | services.swpc.noaa.gov | Real-time solar wind plasma data |
| ISS Now | api.wheretheiss.at | ISS real-time position |
| Launch Library 2 | ll.thespacedevs.com | SpaceX launch missions |
| Open-Meteo | api.open-meteo.com | City weather + AQI (primary) |
| Open-Meteo | api.open-meteo.com | Free weather API (backup) |
| Astronomy API | api.le-systeme-solaire.net | Lunar orbital parameters |

---

## Developer

- High School Computer Science Final Project — Grade 11 Science Stream
- Tech Stack: Python (Flask) + HTML/CSS/JS (Three.js, MediaPipe Hands) + NASA/NOAA APIs
- Version: 1.0（高中期末项目）
