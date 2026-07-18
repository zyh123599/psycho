# 心潮实时语音转写协议与数据边界

心潮 V0.7 不新增语音页面或设置 UI，而是把现有的聊天麦克风、语音陪伴弹层和闪念麦克风接入讯飞实时语音转写大模型。实现依据为[讯飞官方实时语音转写大模型文档](https://www.xfyun.cn/doc/spark/asr_llm/rtasr_llm.html)。

## 配置

复制 `prototype/.env.example` 为 `prototype/.env.local`：

```dotenv
VITE_XFYUN_ASR_APP_ID=your-app-id
VITE_XFYUN_ASR_API_KEY=your-api-key
VITE_XFYUN_ASR_API_SECRET=your-api-secret
```

`.env.local` 已被 Git 忽略，源码、测试和文档不得出现真实凭据。也可以在页面加载前注入同名运行时对象：

```js
window.__XINCHAO_ASR_CONFIG__ = {
  appId: "...",
  apiKey: "...",
  apiSecret: "..."
}
```

运行时对象优先于构建环境变量，便于未来接入用户自定义配置。无论采用哪种方式，纯前端都无法真正保密 APISecret：HMAC 签名必须在客户端完成，构建变量也会进入浏览器包。生产环境应使用独立、可撤销、限额的凭据，或由服务端只签发短时 WebSocket URL。

## WebSocket 鉴权

固定端点：

```text
wss://office-api-ast-dx.iflyaisol.com/ast/communicate/v1
```

每次连接生成新的 `uuid` 和北京时间 `utc`，参数为：

- `appId`：讯飞 APPID；
- `accessKeyId`：讯飞 APIKey；
- `audio_encode=pcm_s16le`；
- `lang=autodialect`；
- `samplerate=16000`；
- `utc=yyyy-MM-dd'T'HH:mm:ss+0800`；
- `uuid`：每次连接唯一。

除 `signature` 外的非空参数按名称升序，键和值分别进行 RFC 3986 URL 编码，再以 `&` 拼接。使用 APISecret 对该 base string 执行 HMAC-SHA1，结果 Base64 后作为 `signature`。完整查询参数再次 URL 编码。代码不得记录 signed URL。

## 音频与流控

1. 用户点击现有麦克风按钮；界面先说明音频将实时直达讯飞，再请求浏览器麦克风权限。
2. 获得权限后生成新签名并建立 WebSocket；收到包含 `sessionId` 的 action 后才启动音频图。
3. AudioWorklet 读取单声道 Float32；若浏览器不支持则使用 ScriptProcessor 降级。
4. 按 AudioContext 实际采样率连续重采样为 16 kHz，钳位并量化为 16-bit little-endian PCM。
5. 每 40 ms 最多发送一个 1280 字节二进制帧。队列或 WebSocket 背压超过边界时结束本次会话，不突发补传。
6. 正常停止先停止麦克风、排空剩余非空 PCM，再发送一次 `{"end":true,"sessionId":"..."}`；等待 `data.ls=true` 或超时后关闭。
7. 取消、切屏、关闭页面或页面进入后台时立即停止所有 MediaStreamTrack、AudioContext 和 WebSocket，不发送未确认文字。

MediaRecorder 常产生带容器的 WebM/Opus，不能伪装成接口所需的裸 `pcm_s16le`，因此本实现不使用 MediaRecorder。

## 增量转写

解析器兼容官方文档出现的 `action/code/data/sid` 与 `msg_type/res_type/data` 两类外层结构，且兼容 `data` 为对象或 JSON 字符串。

文字从 `data.cn.st.rt[].ws[].cw[0].w` 提取。每个 `seg_id` 保存在 Map 中：`data.cn.st.type=1` 只替换该段中间结果，`type=0` 将该段确定；最终按 `seg_id` 排序拼接，避免重复追加。`data.ls=true` 表示全会话最终帧。`res_type=frc` 且 `normal=false`、`action=error` 或非零错误码都会终止会话并释放麦克风。

## 三个现有入口

- 聊天麦克风：实时写入 `#chat-input`，停止后恢复编辑；用户点击发送后才进入对话、安全检查和画像队列。
- 语音陪伴弹层：实时写入同一个 `#chat-input`，弹层状态只显示最近转写；关闭后用户仍需自行编辑并发送。
- 闪念麦克风：实时写入 `#quick-note-input`；用户提交后才保存转写文字和时长元数据，并在持续画像授权开启时进入画像队列。

三个入口共享一个单飞会话，不能同时占用麦克风。实时中间结果不会触发危机关键词、安全状态、LLM 请求或画像更新。

## 画像与隐私

- 讯飞收到录音期间的实时 PCM；心潮不保存原音频，其服务端保留与计费由讯飞政策决定。
- 未发送的聊天转写和未提交的闪念转写只存在当前页面内存。
- 用户确认提交后，画像请求仅收到文字，source 为 `voice_transcript`；画像模型不会收到音频。
- 系统提示明确标记转写可能误识别，禁止根据语速、音色、停顿或未提供的声学特征推断情绪、人格、诊断或其他心理属性。
- 关闭持续画像不会影响本地实时转写，但转写文字不会触发画像更新。
- 麦克风需要 HTTPS、localhost 或受信任应用 WebView；浏览器拒绝权限、设备缺失、设备占用、签名失败、额度不足或网络中断都会在现有状态文本中提示。

## 验证

```bash
npm run test:frontend
npm run build
```

测试覆盖签名固定向量、北京时间、增量段替换、错误包、48 kHz/44.1 kHz 连续重采样、PCM16LE、40 ms 切帧、握手后采集、正常结束与取消释放。真实凭据只允许存在于被忽略的 `.env.local`。
