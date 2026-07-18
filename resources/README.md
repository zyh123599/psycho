# App 图标与启动图资源

这个目录是 App **图标 / 启动图的唯一源文件目录**。放好源图后,用一条命令即可生成
iOS 与 Android 所有尺寸,不需要手动去动 `android/`、`ios/` 里的图片。

## 需要放的文件

| 文件 | 尺寸 | 说明 |
| --- | --- | --- |
| `resources/icon.png` | **1024×1024** | App 图标源图(必需)。正方形,不要留系统圆角,系统会自动裁切。 |
| `resources/splash.png` | **2732×2732** | 启动图源图(可选)。主要内容居中,四周留安全边距。 |
| `resources/splash-dark.png` | 2732×2732 | 深色模式启动图(可选)。 |

> 把你的图标命名为 `resources/icon.png` 放进本目录即可——这就是「更改 App 图标」要替换的那个文件。

## 生成到各平台

```bash
# 1. 安装依赖(首次)
npm install

# 2. 添加原生平台(如果 android/ ios/ 目录还不存在)
npx cap add ios
npx cap add android

# 3. 由源图生成所有尺寸
npm run generate:assets      # 等价于 npx capacitor-assets generate
```

生成结果会写入:

- iOS:`ios/App/App/Assets.xcassets/AppIcon.appiconset/`
- Android:`android/app/src/main/res/mipmap-*/ic_launcher*.png`

以后换图标只需替换 `resources/icon.png` 再跑一次 `npm run generate:assets`。

## 网页 / PWA 标签页图标(可选)

网页版的浏览器标签图标不走这里。它属于 Web 根目录 `prototype/`:

1. 放一张 `prototype/favicon.png`;
2. 在 `prototype/index.html` 的 `<head>` 里加:
   ```html
   <link rel="icon" href="./favicon.png" />
   ```
