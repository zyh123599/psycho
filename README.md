# 心潮 · 无后端产品原型

这是「心潮」心理叙事产品的纯前端演示分支，用于评审交互、视觉和完整产品主线。它不连接账号、远程模型或服务端数据库，也不需要启动 Python/FastAPI 服务。

当前体验位于 [`prototype/`](prototype/)，包含：

- 首页今日潮汐、答案之书与未来回响入口；
- 可组合文字、图片和语音演示的堆叠闪念卡；
- Reigns 式六张情境选择与「觉察、安定、联结、精力」四股潮向；
- 满潮潮笺、开放式陪伴对话演示、微行动与章节回顾；
- 「我的」中的初印象、潮笺卡槽和按日期整理的时光卡；
- 用户主动控制的雨声背景音乐。

所有个性化、图片、语音和聊天均为本地原型逻辑或界面演示，不会调用真实 AI。该产品用于自我梳理，不构成心理诊断、治疗或专业服务。

## 本地启动

```bash
npm ci
npm run dev
```

Vite 以 `prototype/` 为入口，默认会输出一个本地预览地址。生产构建：

```bash
npm run build
```

生成的 Web 文件位于 `dist/`，同时也是 Capacitor 的 `webDir`。

## 数据边界

本分支没有后端。闪念、章节选择、潮位、聊天和未保存回响主要存在于当前页面内存；少量明确需要跨页面回顾的演示数据使用浏览器 `localStorage`。

具体交互、存储范围和产品安全边界见：

- [`prototype/README.md`](prototype/README.md)
- [`prototype/TIDE_SYSTEM.md`](prototype/TIDE_SYSTEM.md)
- [`prototype/BACKEND_CONTRACT.md`](prototype/BACKEND_CONTRACT.md)

上游 `main` 的自定义模型 API 版本不包含在这个无后端分支中，避免原型评审时误传内容或要求填写密钥。
