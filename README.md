# psycho

「心潮」心理叙事产品原型。

## 原型版本

| 版本 | 目录 | 体验重点 |
| --- | --- | --- |
| V0.1 | [`prototype-v1/`](prototype-v1/) | Reigns 式二元选择卡与公开四维状态，作为冻结对比基线 |
| V0.2 | [`prototype/`](prototype/) | 闪念便贴、主题确认、多章节选择、三轮回应、微行动与未来回响 |

两个版本都是无需构建的 HTML/CSS/JavaScript 原型。具体预览方式、数据处理和安全边界见各目录 README。

## Android 应用

当前 V0.2 已接入 Capacitor 8，Android 原生工程位于 `android/`，应用 ID 为
`com.xinchao.psycho`。首次拉取代码后安装依赖并构建调试包：

```bash
npm install
npm run android:build
```

生成的 APK 位于 `android/app/build/outputs/apk/debug/app-debug.apk`。该文件使用
Android 调试证书签名，可直接用于本地安装测试；发布到应用商店前需要配置正式签名、
应用图标和发布版本号。
