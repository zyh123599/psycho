import test from "node:test"
import assert from "node:assert/strict"

import {
  AsrTranscriptAccumulator,
  RealtimeAsrSession,
  buildAsrWebSocketUrl,
  buildSigningBaseString,
  formatBeijingTimestamp,
  parseAsrServerMessage
} from "../asr-client.js"

const settings = {
  appId: "test-app",
  apiKey: "test-key",
  apiSecret: "test-secret"
}

test("讯飞签名严格使用排序参数、HMAC-SHA1 与北京时区", async () => {
  const uuid = "123e4567-e89b-12d3-a456-426614174000"
  const now = new Date("2025-09-04T07:38:07.000Z")
  const parameters = {
    accessKeyId: settings.apiKey,
    appId: settings.appId,
    audio_encode: "pcm_s16le",
    lang: "autodialect",
    samplerate: "16000",
    utc: "2025-09-04T15:38:07+0800",
    uuid
  }
  assert.equal(formatBeijingTimestamp(now), parameters.utc)
  assert.equal(
    buildSigningBaseString(parameters),
    "accessKeyId=test-key&appId=test-app&audio_encode=pcm_s16le&lang=autodialect&samplerate=16000&utc=2025-09-04T15%3A38%3A07%2B0800&uuid=123e4567-e89b-12d3-a456-426614174000"
  )

  const url = new URL(await buildAsrWebSocketUrl(settings, { now, uuid }))
  assert.equal(url.protocol, "wss:")
  assert.equal(url.pathname, "/ast/communicate/v1")
  assert.equal(url.searchParams.get("signature"), "KHzOPKSuLqCRaRE6qad8VjPGPVY=")
  assert.equal(url.searchParams.get("utc"), parameters.utc)
  assert.equal(url.search.includes("test-secret"), false)
})

function asrResult({ segmentId, text, type = "1", last = false }) {
  return JSON.stringify({
    msg_type: "result",
    res_type: "asr",
    data: {
      seg_id: segmentId,
      ls: last,
      cn: {
        st: {
          type,
          rt: [{ ws: [...text].map((character) => ({ cw: [{ w: character }] })) }]
        }
      }
    }
  })
}

test("讯飞 action、对象或字符串 data 与错误包都可解析", () => {
  assert.deepEqual(
    parseAsrServerMessage(JSON.stringify({ msg_type: "action", data: { sessionId: "session-1" } })),
    { kind: "started", sessionId: "session-1" }
  )
  assert.equal(
    parseAsrServerMessage({ action: "result", data: JSON.stringify({
      seg_id: 2,
      ls: true,
      cn: { st: { type: "0", rt: [{ ws: [{ cw: [{ w: "你好。" }] }] }] } }
    }) }).text,
    "你好。"
  )
  const error = parseAsrServerMessage({ action: "error", code: "35001", desc: "鉴权失败" })
  assert.equal(error.kind, "error")
  assert.equal(error.error.code, "xfyun_35001")
  const forceError = parseAsrServerMessage({ msg_type: "result", res_type: "frc", data: { normal: false, desc: "功能异常" } })
  assert.equal(forceError.kind, "error")
})

test("同一 seg_id 的中间结果只替换不累加，确定结果不会被迟到中间帧覆盖", () => {
  const accumulator = new AsrTranscriptAccumulator()
  accumulator.apply(parseAsrServerMessage(asrResult({ segmentId: 1, text: "世界", type: "0" })))
  accumulator.apply(parseAsrServerMessage(asrResult({ segmentId: 0, text: "你", type: "1" })))
  assert.equal(accumulator.snapshot().text, "你世界")
  accumulator.apply(parseAsrServerMessage(asrResult({ segmentId: 0, text: "你好", type: "0" })))
  accumulator.apply(parseAsrServerMessage(asrResult({ segmentId: 0, text: "你号", type: "1" })))
  assert.deepEqual(accumulator.snapshot(), {
    text: "你好世界",
    confirmedText: "你好世界",
    interimText: ""
  })
})

class FakeWebSocket {
  static OPEN = 1
  static instances = []

  constructor(url) {
    this.url = url
    this.readyState = FakeWebSocket.OPEN
    this.bufferedAmount = 0
    this.sent = []
    FakeWebSocket.instances.push(this)
    queueMicrotask(() => {
      this.onmessage?.({ data: JSON.stringify({ msg_type: "action", data: { sessionId: "session-test" } }) })
    })
  }

  send(value) {
    this.sent.push(value)
    if (typeof value === "string" && JSON.parse(value).end === true) {
      queueMicrotask(() => this.onmessage?.({
        data: asrResult({ segmentId: 0, text: "实时文字", type: "0", last: true })
      }))
    }
  }

  close() {
    this.readyState = 3
  }
}

class FakeCapture {
  constructor({ onFrame }) {
    this.onFrame = onFrame
    this.acquired = 0
    this.started = 0
    this.stopped = []
  }

  async acquire() { this.acquired += 1 }
  async start() { this.started += 1 }
  emit(frame) { this.onFrame(frame) }
  async stop(options) {
    this.stopped.push(options)
    return new Uint8Array(0)
  }
}

test("会话等待 action 后录音，按二进制发送并在最终帧后关闭", async () => {
  FakeWebSocket.instances = []
  let capture
  const transcripts = []
  const session = new RealtimeAsrSession({
    settings,
    WebSocketClass: FakeWebSocket,
    captureFactory: (options) => {
      capture = new FakeCapture(options)
      return capture
    },
    uuidFactory: () => "session-uuid",
    now: () => new Date("2025-09-04T07:38:07.000Z"),
    onTranscript: (snapshot) => transcripts.push(snapshot)
  })

  await session.start()
  assert.equal(session.state, "recording")
  assert.equal(capture.acquired, 1)
  assert.equal(capture.started, 1)
  capture.emit(new Uint8Array(1280).fill(7))
  await new Promise((resolve) => setTimeout(resolve, 55))
  const result = await session.stop()

  const socket = FakeWebSocket.instances[0]
  assert.equal(socket.sent.filter((value) => value instanceof ArrayBuffer).length, 1)
  const endMessages = socket.sent.filter((value) => typeof value === "string").map((value) => JSON.parse(value))
  assert.deepEqual(endMessages, [{ end: true, sessionId: "session-test" }])
  assert.equal(result.text, "实时文字")
  assert.equal(transcripts.at(-1).text, "实时文字")
  assert.equal(session.state, "closed")
})

test("取消会话会释放采集但不会发送 end 或提交文字", async () => {
  FakeWebSocket.instances = []
  let capture
  const session = new RealtimeAsrSession({
    settings,
    WebSocketClass: FakeWebSocket,
    captureFactory: (options) => {
      capture = new FakeCapture(options)
      return capture
    }
  })
  await session.start()
  await session.cancel()
  assert.equal(session.state, "cancelled")
  assert.equal(FakeWebSocket.instances[0].sent.length, 0)
  assert.equal(capture.stopped.some((options) => options.flush === false), true)
})

test("等待最终帧时再次取消，会立即结束而不等待最终帧超时", async () => {
  FakeWebSocket.instances = []
  let capture
  class NoFinalWebSocket extends FakeWebSocket {
    send(value) {
      this.sent.push(value)
    }
  }
  const session = new RealtimeAsrSession({
    settings,
    WebSocketClass: NoFinalWebSocket,
    captureFactory: (options) => {
      capture = new FakeCapture(options)
      return capture
    }
  })
  await session.start()
  capture.emit(new Uint8Array(1280).fill(3))
  await new Promise((resolve) => setTimeout(resolve, 55))
  const stopping = session.stop()
  while (session.state !== "awaiting_final") await new Promise((resolve) => setImmediate(resolve))
  const cancelling = session.cancel()
  const result = await Promise.race([
    stopping,
    new Promise((_, reject) => setTimeout(() => reject(new Error("取消未及时结束停止流程")), 250))
  ])
  await cancelling
  assert.equal(result.text, "")
  assert.equal(session.state, "cancelled")
})

test("麦克风授权尚未返回时取消，不会迟到建立 WebSocket", async () => {
  FakeWebSocket.instances = []
  let releasePermission
  let capture
  class PendingPermissionCapture extends FakeCapture {
    async acquire() {
      this.acquired += 1
      await new Promise((resolve) => { releasePermission = resolve })
    }
  }
  const session = new RealtimeAsrSession({
    settings,
    WebSocketClass: FakeWebSocket,
    captureFactory: (options) => {
      capture = new PendingPermissionCapture(options)
      return capture
    }
  })
  const starting = session.start()
  await new Promise((resolve) => setImmediate(resolve))
  await session.cancel()
  releasePermission()
  await assert.rejects(starting, (error) => error?.code === "asr_cancelled")
  assert.equal(FakeWebSocket.instances.length, 0)
  assert.equal(capture.stopped.length >= 1, true)
})
