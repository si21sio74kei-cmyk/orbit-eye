# OrbitEye 项目长期记忆

## 架构关键点
- Flask 单入口 + Vercel serverless：`api/index.py` 导入根目录 `Space_Data_Center.py` 的 app；`vercel.json` 用通配 rewrite 把所有请求转到 `/api/index?__path=$1`，后端靠中间件(还原 PATH_INFO)+`api_entry`(url_map.match 分发)处理真实路径。**这套网关契约不要破坏**。
- 前端在 `web/`：`web/dashboard.html`(仪表盘)、`web/solar-system.html`(3D页)、`web/static/{css,js,textures}`。前端 URL 一律 `/static/...` 绝对路径，由后端 `/static/<path>` 路由映射到 `web/static`，所以物理移动文件不影响部署 URL。
- `app = Flask(__name__, static_folder=None)`：必须关掉 Flask 默认 /static 路由，否则它抢占自定义 `/static/<path>` 路由、指向旧目录导致静态资源全 404（2026-11-19 踩过）。

## 用户偏好（高中生，高中期末项目）
- 视觉：减法 + 克制 + 单一强调色(青蓝) + 充足留白；讨厌霓虹/故障/glitch/彩虹徽章/满屏 emoji/AI 味。审美参考 animejs.com。
- 3D 手势太阳系页是 DSM 命名版，与 dashboard 的 OrbitEye 命名不一致是用户**有意选择**，内容严格不动（可挪路径不改代码）。用户说"不要改"时按字面严格照办。
- 交付方式：先出一版看效果再迭代，不追求一次到位。
- 部署：GitHub push 即触发 Vercel 重部署。用户会在 GitHub Web UI 手动上传/删文件，推送前先 `git fetch`+`pull --rebase`，勿 force。

## 视觉系统（2026-11-19 升级后）
- datav.css 强调色 #6cb6e8，中性灰阶；字体 Space Grotesk(标题)/Inter+Noto Sans SC(正文)/Share Tech Mono(数字)。启动页标题 Clash Display 保留。功能 class：shimmer/hidden/on/d/w/g/l/tilt/card-entrance/src-tag 全部要保留，JS 靠它们工作。

## 验证环境
- 本机全局 Python 有 playwright，Chrome 在 `C:\Program Files\Google\Chrome\Application\chrome.exe`；venv 无 playwright。
- 内置浏览器沙箱访问不到宿主机 localhost。截图验证须用本机 Playwright，且在同一 bash 命令内起服务→截图→关服务（单独命令起的后台服务会被清理）。
