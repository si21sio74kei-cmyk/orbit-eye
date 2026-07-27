# Vercel Serverless 入口：导出 Flask WSGI app 供平台运行
# Vercel 的 Python runtime 会在 api/ 下寻找名为 app 的可调用对象。
import sys, os

# 确保项目根目录在模块搜索路径中（Serverless 环境的工作目录结构不同）
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from Space_Data_Center import app  # noqa: E402

# 仅本地直接运行 python api/index.py 时生效；Vercel 不会走这里
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "5500")))
