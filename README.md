# psycho

「心潮」心理叙事产品原型。

## 原型版本

| 版本 | 目录 | 体验重点 |
| --- | --- | --- |
| V0.1 | [`prototype-v1/`](prototype-v1/) | Reigns 式二元选择卡与公开四维状态，作为冻结对比基线 |
| 当前 V0.5 | [`prototype/`](prototype/) | V0.4 完整体验 + FastAPI 多模态持续画像、支持性 AI 对话和画像驱动内容 |

`prototype-v1/` 只作为冻结对比基线；后续产品设计都在 `prototype/` 增量更新，不再为每个小版本复制新目录。当前 `prototype/` 同时作为 Ionic + Capacitor 应用的 Web 源码；具体数据处理和安全边界见目录 README。

## FastAPI 后端

多模态、非诊断性反思画像与支持性对话后端位于 [`backend/`](backend/)，使用 Python 3.12、uv、
FastAPI 和 Pydantic v2。它支持文本、图片、App 结构化交互信号与无持久化对话，并已提供 Swagger/ReDoc、
完整 API 文档和可复用的前端调用示例：

```bash
cd backend
uv sync --all-groups
uv run uvicorn psycho_backend.main:app --reload --host 127.0.0.1 --port 8000
```

详细配置、安全边界和启动方式见 [`backend/README.md`](backend/README.md)，前端接口契约见
[`backend/docs/API.md`](backend/docs/API.md)。真实模型密钥只放在被 Git 忽略的 `backend/.env`，
不能写入网页或 Android 包。

## Ionic + Capacitor 应用

当前 V0.5 已按 Capacitor 官方的 Ionic 集成流程整理为跨平台项目：

- `prototype/`：HTML/CSS/JavaScript 界面源码
- `dist/`：Vite 生成的 Web 构建产物，不提交到 Git
- `capacitor.config.json`：应用名、应用 ID 和 Web 资源目录
- `.github/workflows/mobile-build.yml`：在云端临时生成 Android、iOS 工程并打包

仓库不保存 `android/` 和 `ios/` 目录。每次移动端构建都由 GitHub Actions 根据
Capacitor 配置重新生成原生工程，避免在仓库里维护大量平台文件。

应用 ID 为 `com.xinchao.psycho`。首次拉取代码后安装依赖：

```bash
npm install
cp prototype/.env.example prototype/.env
```

本地浏览器默认连接 `http://127.0.0.1:8000`。Capacitor 真机/生产构建需把
`VITE_API_BASE_URL` 配置为设备可访问的 HTTPS FastAPI 地址；不要把中转站密钥放进前端环境变量。

### Web 开发

```bash
npm run dev
npm run build
```

### GitHub Actions 移动端打包

进入 GitHub 仓库的 **Actions → Build mobile apps → Run workflow**，一次运行会并行生成：

- `xinchao-android-debug`：包含可安装的 Android 调试 APK
- `xinchao-ios-simulator`：包含可在 iOS Simulator 运行的 `.app` 压缩包

推送名称以 `v` 开头的 Git 标签（例如 `v0.1.0`）也会自动触发构建。完成后在该次
Action 页面底部的 **Artifacts** 区域下载产物。

iOS 真机安装包和 App Store 包必须使用 Apple 证书及 Provisioning Profile 签名。
当前工作流不保存签名密钥，因此默认产出无需签名的模拟器版本；Android 默认产出调试版 APK。

项目已安装 Ionic Framework，以及官方指南推荐的 `app`、`haptics`、`keyboard`、
`status-bar` 四个 Capacitor 插件。相关命令来自
[Using Capacitor with Ionic Framework](https://capacitorjs.com/docs/getting-started/with-ionic)。
