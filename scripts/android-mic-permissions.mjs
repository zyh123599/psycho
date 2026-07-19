#!/usr/bin/env node
// 向生成的 Android 工程注入麦克风相关权限（Approach A）。
//
// 背景：android/ 目录是 `cap add android` 的生成物，且被 .gitignore 忽略
// （"Capacitor native projects are generated in CI or locally"）。因此权限声明
// 不能只手改本地 manifest —— 换机器 / CI 重新生成就会丢。本脚本在每次
// `cap add` / `cap sync` 之后运行，幂等地把权限写进 AndroidManifest.xml。
//
// 重要：本脚本只碰生成出来的原生工程，绝不改动 prototype/ 下的任何网页/录音代码。
// 录音仍然走网页 getUserMedia（prototype/audio-capture.js），一行都不用变——
// Capacitor 的 WebChromeClient 会在 getUserMedia 触发时读取下面这些声明，
// 自动弹出系统授权框并放行 WebView 的录音请求。

import { readFile, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const MANIFEST = resolve(scriptDir, "..", "android", "app", "src", "main", "AndroidManifest.xml")

// Android WebView 里让 getUserMedia 录音跑通所需的权限：
//  - RECORD_AUDIO         系统录音权限；Capacitor 据此在运行时弹窗并放行 WebView 请求
//  - MODIFY_AUDIO_SETTINGS 允许应用管理音频路由/回声消除，录音类应用惯例一起声明
//  - INTERNET             讯飞 ASR 走 wss://，默认模板已带，这里兜底确保存在
const REQUIRED = [
  "android.permission.RECORD_AUDIO",
  "android.permission.MODIFY_AUDIO_SETTINGS",
  "android.permission.INTERNET"
]

async function main() {
  let xml
  try {
    xml = await readFile(MANIFEST, "utf8")
  } catch (_error) {
    console.error(
      "[android-mic-permissions] 找不到 AndroidManifest.xml：\n" +
        `  ${MANIFEST}\n` +
        "请先生成 Android 工程：npm run cap:add:android"
    )
    process.exitCode = 1
    return
  }

  const missing = REQUIRED.filter((name) => !xml.includes(`android:name="${name}"`))
  if (missing.length === 0) {
    console.log("[android-mic-permissions] 录音相关权限已齐全，无需改动。")
    return
  }

  const closing = xml.lastIndexOf("</manifest>")
  if (closing === -1) {
    console.error("[android-mic-permissions] AndroidManifest.xml 结构异常：缺少 </manifest>。")
    process.exitCode = 1
    return
  }

  const lines = missing.map((name) => `    <uses-permission android:name="${name}" />`).join("\n")
  const block = `\n    <!-- 录音权限（由 scripts/android-mic-permissions.mjs 注入，勿手改） -->\n${lines}\n`
  const next = xml.slice(0, closing) + block + xml.slice(closing)

  await writeFile(MANIFEST, next, "utf8")
  console.log("[android-mic-permissions] 已注入权限：\n" + missing.map((name) => "  + " + name).join("\n"))
}

main()
