# 心潮

「心潮」是一个 Ionic + Capacitor 心理叙事原型。当前 V0.6 为纯前端实现：仓库中不再包含 FastAPI、Python 服务或服务端数据库。

当前体验位于 [`prototype/`](prototype/)，包含：

- 答案之书、统一图文闪念、雨声背景与语音交互演示；
- 文字与图片共同参与的持续反思画像；
- 画像驱动的主题、日报、行动、回响与六张叙事卡；
- 支持性 AI 对话；
- 网络不可用或未授权时的完整本地降级流程；
- 潮笺与未来回响的本机存储。

这些内容用于自我梳理，不是心理诊断、治疗、危机评估或专业服务。

## 启动

```bash
npm ci
npm run dev
```

构建与测试：

```bash
npm run test:frontend
npm run build
```

Vite 以 `prototype/` 为入口，生产文件输出到 `dist/`。Capacitor 的 `webDir` 也是 `dist/`。

## 配置自定义 API

启动前端后打开「我的 → 自定义模型 API」，填写：

1. OpenAI 兼容的 Base URL，例如 `https://provider.example/v1`；
2. API Key；
3. 服务商实际提供的模型名；
4. 图片理解精度。

先点「测试当前表单」，再点「保存到本机」。地址、模型名和 API Key 只写入当前站点的 `localStorage`，不会进入源码或构建产物。前端会直接访问自定义服务商的 `/models` 与 `/chat/completions`。

浏览器直连有三个硬性条件：

- 服务商必须允许 `Origin`、`Authorization` 和 `Content-Type` 的 CORS 预检；
- HTTPS 页面只能访问 HTTPS API，不能访问 HTTP 中转站；
- 本地保存的 API Key 能被同源脚本、浏览器扩展或持有该设备的人读取，因此不要在公共设备上保存高权限 Key。

完整兼容契约见 [`prototype/CUSTOM_API.md`](prototype/CUSTOM_API.md)。

## 本机数据边界

| 数据 | 持久化位置 | 说明 |
| --- | --- | --- |
| 自定义 API 配置 | `localStorage` | Base URL、模型、图片精度和 API Key；可在「我的」清除 |
| 多模态文字画像 | `localStorage` | 保存模型从文字、图片内容与互动形成的结构化文字观察；不保存原图 |
| 潮笺卡槽 | `localStorage` | 只保存内置卡片 ID 和收藏时间 |
| 未来回响 | `localStorage` | 仅在用户明确勾选后保存 |
| 答案之书 | `localStorage` | 只保存当天卡片序号，不收集用户心里的问题 |
| 闪念、原图、聊天原文、章节选择 | 页面内存 | 刷新或离开当前流程后消失；授权调用时会发送给自定义模型服务商 |

画像更新采用异步单飞队列：同一时间只运行一个请求，新变化合并到下一次更新；相同证据使用不可逆指纹去重；撤销授权或删除画像会取消在途请求并阻止迟到结果重新写入。

## 目录

- [`prototype/`](prototype/)：当前 V0.6 应用与测试；
- [`dist/`](dist/)：构建产物；
- [`prototype/DESIGN_PLAN_DEARAURA.md`](prototype/DESIGN_PLAN_DEARAURA.md)：早期设计研究记录，不代表当前数据架构。
