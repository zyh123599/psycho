import { AUDIO_TARGETS, AudioCaptureError, BrowserPcmCapture } from "./audio-capture.js"

export const ASR_ENDPOINT = "wss://office-api-ast-dx.iflyaisol.com/ast/communicate/v1"
export const ASR_SETTINGS_STORAGE_KEY = "xinchao.custom-asr.v1"
export const DEFAULT_ASR_SETTINGS = Object.freeze({ appId: "", apiKey: "", apiSecret: "" })
const ASR_READY_TIMEOUT_MS = 10000
const ASR_FINAL_TIMEOUT_MS = 7000
const ASR_MAX_BUFFERED_AMOUNT = 256 * 1024
const ASR_MAX_QUEUED_FRAMES = 50

export class AsrError extends Error {
  constructor(message, { code = "asr_error", retryable = false, details, cause } = {}) {
    super(message, cause ? { cause } : undefined)
    this.name = "AsrError"
    this.code = code
    this.retryable = retryable
    this.details = details
  }
}

function cleanCredential(value, maxLength = 256) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : ""
}

function localStorageOrNull() {
  try {
    return globalThis.localStorage || null
  } catch (_error) {
    return null
  }
}

function normalizedAsrSettings(value, { requireComplete = true } = {}) {
  const settings = {
    appId: cleanCredential(value?.appId, 80),
    apiKey: cleanCredential(value?.apiKey),
    apiSecret: cleanCredential(value?.apiSecret)
  }
  if (Object.values(settings).some((credential) => /[\r\n\0]/.test(credential))) {
    throw new AsrError("语音转写凭据格式无效", { code: "invalid_asr_settings" })
  }
  if (requireComplete && !hasAsrSettings(settings)) {
    throw new AsrError("请完整填写 APPID、APIKey 和 APISecret", { code: "asr_not_configured" })
  }
  return settings
}

export function loadSavedAsrSettings() {
  const storage = localStorageOrNull()
  if (!storage) return { ...DEFAULT_ASR_SETTINGS }
  try {
    const parsed = JSON.parse(storage.getItem(ASR_SETTINGS_STORAGE_KEY) || "null")
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ...DEFAULT_ASR_SETTINGS }
    return normalizedAsrSettings(parsed, { requireComplete: false })
  } catch (_error) {
    return { ...DEFAULT_ASR_SETTINGS }
  }
}

export function saveAsrSettings(value) {
  const settings = normalizedAsrSettings(value)
  const storage = localStorageOrNull()
  if (!storage) {
    throw new AsrError("当前环境无法使用本地存储", { code: "storage_unavailable" })
  }
  try {
    storage.setItem(ASR_SETTINGS_STORAGE_KEY, JSON.stringify(settings))
  } catch (cause) {
    throw new AsrError("语音转写配置无法保存到本机", { code: "storage_unavailable", cause })
  }
  return { ...settings }
}

export function clearAsrSettings() {
  const storage = localStorageOrNull()
  if (!storage) return false
  try {
    storage.removeItem(ASR_SETTINGS_STORAGE_KEY)
    return true
  } catch (_error) {
    return false
  }
}

export function loadAsrSettings(overrides = {}) {
  const saved = loadSavedAsrSettings()
  const runtime = globalThis.__XINCHAO_ASR_CONFIG__ || {}
  const env = import.meta.env || {}
  const candidates = [
    overrides,
    saved,
    runtime,
    {
      appId: env.VITE_XFYUN_ASR_APP_ID,
      apiKey: env.VITE_XFYUN_ASR_API_KEY,
      apiSecret: env.VITE_XFYUN_ASR_API_SECRET
    }
  ].map((candidate) => normalizedAsrSettings(candidate, { requireComplete: false }))
  return candidates.find((candidate) => hasAsrSettings(candidate)) || { ...DEFAULT_ASR_SETTINGS }
}

export function hasAsrSettings(settings = loadAsrSettings()) {
  return Boolean(settings.appId && settings.apiKey && settings.apiSecret)
}

function requireAsrSettings(settings) {
  return normalizedAsrSettings(settings)
}

export function formatBeijingTimestamp(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new AsrError("无法生成语音服务时间戳", { code: "invalid_timestamp" })
  }
  const beijing = new Date(date.getTime() + 8 * 60 * 60 * 1000)
  const year = beijing.getUTCFullYear()
  const month = String(beijing.getUTCMonth() + 1).padStart(2, "0")
  const day = String(beijing.getUTCDate()).padStart(2, "0")
  const hour = String(beijing.getUTCHours()).padStart(2, "0")
  const minute = String(beijing.getUTCMinutes()).padStart(2, "0")
  const second = String(beijing.getUTCSeconds()).padStart(2, "0")
  return `${year}-${month}-${day}T${hour}:${minute}:${second}+0800`
}

function encodeQueryPart(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, (character) => (
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  ))
}

export function buildSigningBaseString(parameters) {
  return Object.entries(parameters || {})
    .filter(([key, value]) => key !== "signature" && value !== undefined && value !== null && value !== "")
    .sort(([left], [right]) => left.localeCompare(right, "en"))
    .map(([key, value]) => `${encodeQueryPart(key)}=${encodeQueryPart(value)}`)
    .join("&")
}

function buildQueryString(parameters) {
  return Object.entries(parameters || {})
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .sort(([left], [right]) => left.localeCompare(right, "en"))
    .map(([key, value]) => `${encodeQueryPart(key)}=${encodeQueryPart(value)}`)
    .join("&")
}

function bytesToBase64(bytes) {
  let binary = ""
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return globalThis.btoa(binary)
}

async function signHmacSha1(secret, text) {
  if (!globalThis.crypto?.subtle) {
    throw new AsrError("当前环境不支持语音鉴权签名", { code: "web_crypto_unsupported" })
  }
  const encoder = new TextEncoder()
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  )
  const signature = await globalThis.crypto.subtle.sign("HMAC", key, encoder.encode(text))
  return bytesToBase64(new Uint8Array(signature))
}

export async function buildAsrWebSocketUrl(settingsInput = loadAsrSettings(), {
  now = new Date(),
  uuid = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
} = {}) {
  const settings = requireAsrSettings(settingsInput)
  const parameters = {
    accessKeyId: settings.apiKey,
    appId: settings.appId,
    audio_encode: "pcm_s16le",
    lang: "autodialect",
    samplerate: String(AUDIO_TARGETS.sampleRate),
    utc: formatBeijingTimestamp(now),
    uuid
  }
  const signature = await signHmacSha1(settings.apiSecret, buildSigningBaseString(parameters))
  const query = buildQueryString({ ...parameters, signature })
  return `${ASR_ENDPOINT}?${query}`
}

function parseMaybeJson(value) {
  if (typeof value !== "string") return value
  try { return JSON.parse(value) } catch (_error) { return value }
}

function resultText(data) {
  const turns = Array.isArray(data?.cn?.st?.rt) ? data.cn.st.rt : []
  return turns.flatMap((turn) => Array.isArray(turn?.ws) ? turn.ws : [])
    .map((word) => Array.isArray(word?.cw) ? word.cw[0]?.w : "")
    .filter((word) => typeof word === "string")
    .join("")
}

function providerError(message, data) {
  const code = String(message?.code || data?.code || data?.detail?.code || "provider_error")
  const description = message?.desc || data?.desc || data?.message || "讯飞语音服务返回异常"
  return new AsrError(description, {
    code: `xfyun_${code}`,
    retryable: !/^(35001|35002|35004|35005|35010|35017|35022|35031|100002|100013|100016|100019|100020)$/.test(code),
    details: { provider_code: code }
  })
}

export function parseAsrServerMessage(rawMessage) {
  const message = parseMaybeJson(rawMessage)
  if (!message || typeof message !== "object") return { kind: "noop" }
  const data = parseMaybeJson(message.data)
  const code = message.code === undefined || message.code === null ? "0" : String(message.code)
  const dataCode = data?.code === undefined || data?.code === null ? "0" : String(data.code)
  if (code !== "0" || dataCode !== "0" || message.action === "error") {
    return { kind: "error", error: providerError(message, data) }
  }
  if (message.res_type === "frc" && data?.normal === false) {
    return { kind: "error", error: providerError(message, data) }
  }

  const sessionId = data?.sessionId || message.sessionId || message.sid
  if (message.action === "started" || (message.msg_type === "action" && sessionId)) {
    return { kind: "started", sessionId: String(sessionId || "") }
  }

  const isAsrResult = message.res_type === "asr" || data?.cn?.st
  if (isAsrResult) {
    const sentence = data?.cn?.st || {}
    return {
      kind: "result",
      segmentId: Number.isFinite(Number(data?.seg_id)) ? Number(data.seg_id) : 0,
      text: resultText(data),
      finalSegment: String(sentence.type) === "0",
      finalSession: data?.ls === true
    }
  }
  return { kind: "noop" }
}

export async function testAsrConnection({
  settings = loadAsrSettings(),
  WebSocketClass = globalThis.WebSocket,
  timeoutMs = ASR_READY_TIMEOUT_MS,
  signal
} = {}) {
  const normalized = requireAsrSettings(settings)
  if (!WebSocketClass) {
    throw new AsrError("当前浏览器不支持实时语音连接", { code: "websocket_unsupported" })
  }
  if (signal?.aborted) {
    throw new AsrError("语音连接测试已取消", { code: "asr_test_cancelled" })
  }
  const url = await buildAsrWebSocketUrl(normalized)
  return new Promise((resolve, reject) => {
    let socket
    let settled = false
    let abortHandler
    const finish = (error, result) => {
      if (settled) return
      settled = true
      globalThis.clearTimeout(timer)
      signal?.removeEventListener?.("abort", abortHandler)
      if (socket) {
        socket.onmessage = null
        socket.onerror = null
        socket.onclose = null
        try { socket.close(1000, "connection test complete") } catch (_error) { /* already closed */ }
      }
      if (error) reject(error)
      else resolve(result)
    }
    const timer = globalThis.setTimeout(() => {
      finish(new AsrError("语音服务连接测试超时", { code: "asr_ready_timeout", retryable: true }))
    }, Math.max(1000, Number(timeoutMs) || ASR_READY_TIMEOUT_MS))
    abortHandler = () => finish(new AsrError("语音连接测试已取消", { code: "asr_test_cancelled" }))
    signal?.addEventListener?.("abort", abortHandler, { once: true })
    if (signal?.aborted) abortHandler()
    if (settled) return
    try {
      socket = new WebSocketClass(url)
      socket.onmessage = (event) => {
        const parsed = parseAsrServerMessage(event.data)
        if (parsed.kind === "error") finish(parsed.error)
        if (parsed.kind === "started") {
          finish(null, { connected: true, sessionId: parsed.sessionId || "" })
        }
      }
      socket.onerror = () => finish(new AsrError("语音服务连接失败", {
        code: "asr_socket_error",
        retryable: true
      }))
      socket.onclose = () => finish(new AsrError("语音服务在完成测试前关闭了连接", {
        code: "asr_socket_closed",
        retryable: true
      }))
    } catch (cause) {
      finish(new AsrError("无法建立语音服务连接", { code: "asr_socket_error", retryable: true, cause }))
    }
  })
}

export class AsrTranscriptAccumulator {
  constructor() {
    this.segments = new Map()
  }

  apply(event) {
    if (event?.kind === "result") {
      const previous = this.segments.get(event.segmentId)
      if (!previous?.final || event.finalSegment) {
        this.segments.set(event.segmentId, {
          text: typeof event.text === "string" ? event.text : "",
          final: Boolean(event.finalSegment)
        })
      }
    }
    return this.snapshot()
  }

  snapshot() {
    const ordered = [...this.segments.entries()].sort(([left], [right]) => left - right)
    return {
      text: ordered.map(([, segment]) => segment.text).join(""),
      confirmedText: ordered.filter(([, segment]) => segment.final).map(([, segment]) => segment.text).join(""),
      interimText: ordered.filter(([, segment]) => !segment.final).map(([, segment]) => segment.text).join("")
    }
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds))
}

function socketOpen(socket, WebSocketClass) {
  return socket?.readyState === (WebSocketClass?.OPEN ?? 1)
}

export class RealtimeAsrSession {
  constructor({
    settings = loadAsrSettings(),
    WebSocketClass = globalThis.WebSocket,
    captureFactory = (options) => new BrowserPcmCapture(options),
    uuidFactory = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    now = () => new Date(),
    onState = () => {},
    onTranscript = () => {},
    onError = () => {}
  } = {}) {
    this.settings = settings
    this.WebSocketClass = WebSocketClass
    this.captureFactory = captureFactory
    this.uuidFactory = uuidFactory
    this.now = now
    this.onState = onState
    this.onTranscript = onTranscript
    this.onError = onError
    this.state = "idle"
    this.socket = null
    this.capture = null
    this.uuid = ""
    this.sessionId = ""
    this.frameQueue = []
    this.pumpTimer = null
    this.sentAudioChunks = 0
    this.transcript = new AsrTranscriptAccumulator()
    this.readyResolve = null
    this.readyReject = null
    this.finalResolve = null
    this.stopPromise = null
    this.closing = false
    this.cancelRequested = false
  }

  #setState(state, details) {
    this.state = state
    this.onState({ state, details })
  }

  #enqueueFrame(frame) {
    if (!frame?.length || !["recording", "stopping"].includes(this.state)) return
    if (this.frameQueue.length >= ASR_MAX_QUEUED_FRAMES) {
      void this.#fail(new AsrError("页面暂时无法实时发送音频，请重新开始", {
        code: "asr_audio_backpressure",
        retryable: true
      }))
      return
    }
    this.frameQueue.push(frame)
  }

  #sendFrame(frame) {
    if (!socketOpen(this.socket, this.WebSocketClass) || !frame?.length) return false
    if (this.socket.bufferedAmount > ASR_MAX_BUFFERED_AMOUNT) return false
    const bytes = frame instanceof Uint8Array ? frame : new Uint8Array(frame)
    this.socket.send(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
    this.sentAudioChunks += 1
    return true
  }

  #startPump() {
    this.pumpTimer = globalThis.setInterval(() => {
      if (this.frameQueue.length === 0) return
      if (this.#sendFrame(this.frameQueue[0])) this.frameQueue.shift()
    }, AUDIO_TARGETS.frameDurationMs)
  }

  #clearPump() {
    if (this.pumpTimer) globalThis.clearInterval(this.pumpTimer)
    this.pumpTimer = null
  }

  #handleMessage(rawMessage) {
    const event = parseAsrServerMessage(rawMessage)
    if (event.kind === "error") {
      void this.#fail(event.error)
      return
    }
    if (event.kind === "started") {
      this.sessionId = event.sessionId || this.uuid
      this.readyResolve?.(event)
      this.readyResolve = null
      this.readyReject = null
      return
    }
    if (event.kind === "result") {
      const snapshot = this.transcript.apply(event)
      this.onTranscript({ ...snapshot, finalSession: event.finalSession })
      if (event.finalSession) this.finalResolve?.(snapshot)
    }
  }

  async #waitUntilReady() {
    return new Promise((resolve, reject) => {
      this.readyResolve = resolve
      this.readyReject = reject
      const timer = globalThis.setTimeout(() => {
        if (!this.readyReject) return
        this.readyResolve = null
        this.readyReject = null
        reject(new AsrError("语音服务连接超时", { code: "asr_ready_timeout", retryable: true }))
      }, ASR_READY_TIMEOUT_MS)
      const settle = (callback) => (value) => {
        globalThis.clearTimeout(timer)
        callback(value)
      }
      this.readyResolve = settle(resolve)
      this.readyReject = settle(reject)
    })
  }

  async start() {
    if (this.state !== "idle") return this
    requireAsrSettings(this.settings)
    if (!this.WebSocketClass) {
      throw new AsrError("当前浏览器不支持实时语音连接", { code: "websocket_unsupported" })
    }
    const capture = this.captureFactory({ onFrame: (frame) => this.#enqueueFrame(frame) })
    this.capture = capture
    try {
      this.#setState("permission")
      await capture.acquire()
      if (this.state === "cancelled" || this.cancelRequested) {
        await capture.stop({ flush: false })
        throw new AsrError("语音转写已取消", { code: "asr_cancelled" })
      }
      this.uuid = this.uuidFactory()
      const url = await buildAsrWebSocketUrl(this.settings, { now: this.now(), uuid: this.uuid })
      if (this.state === "cancelled" || this.cancelRequested) {
        await capture.stop({ flush: false })
        throw new AsrError("语音转写已取消", { code: "asr_cancelled" })
      }
      this.#setState("connecting")
      const ready = this.#waitUntilReady()
      this.socket = new this.WebSocketClass(url)
      this.socket.binaryType = "arraybuffer"
      this.socket.onmessage = (event) => this.#handleMessage(event.data)
      this.socket.onerror = () => {
        void this.#fail(new AsrError("语音服务连接失败", { code: "asr_socket_error", retryable: true }))
      }
      this.socket.onclose = () => {
        if (this.closing || ["closed", "cancelled", "error"].includes(this.state)) return
        if (this.state === "awaiting_final") {
          this.finalResolve?.(this.transcript.snapshot())
        } else {
          void this.#fail(new AsrError("语音服务连接已中断", { code: "asr_socket_closed", retryable: true }))
        }
      }
      await ready
      if (this.state === "cancelled" || this.cancelRequested) {
        await capture.stop({ flush: false })
        throw new AsrError("语音转写已取消", { code: "asr_cancelled" })
      }
      await capture.start()
      this.#setState("recording")
      this.#startPump()
      return this
    } catch (error) {
      const normalized = error instanceof AsrError
        ? error
        : (error instanceof AudioCaptureError
          ? new AsrError(error.message, { code: error.code, cause: error })
          : new AsrError("无法启动实时语音转写", { code: "asr_start_failed", cause: error }))
      if (normalized.code === "asr_cancelled" || this.state === "cancelled") {
        if (this.state !== "cancelled") await this.#close("cancelled")
      } else {
        await this.#fail(normalized)
      }
      throw normalized
    }
  }

  async #drainFrames(tail) {
    if (tail?.length) this.frameQueue.push(tail)
    const deadline = Date.now() + 5000
    while (
      this.frameQueue.length > 0 &&
      socketOpen(this.socket, this.WebSocketClass) &&
      Date.now() < deadline
    ) {
      if (this.#sendFrame(this.frameQueue[0])) {
        this.frameQueue.shift()
        if (this.frameQueue.length > 0) await delay(AUDIO_TARGETS.frameDurationMs)
      } else {
        await delay(AUDIO_TARGETS.frameDurationMs)
      }
    }
    if (this.frameQueue.length > 0) {
      throw new AsrError("音频发送队列未能及时排空", {
        code: "asr_audio_backpressure",
        retryable: true
      })
    }
  }

  async stop() {
    if (this.stopPromise) return this.stopPromise
    this.stopPromise = this.#stopGracefully().catch(async (error) => {
      const normalized = error instanceof AsrError
        ? error
        : new AsrError("无法结束实时语音转写", { code: "asr_stop_failed", cause: error })
      await this.#fail(normalized)
      throw normalized
    })
    return this.stopPromise
  }

  async #stopGracefully() {
    if (["idle", "closed", "cancelled", "error"].includes(this.state)) return this.transcript.snapshot()
    if (["permission", "connecting"].includes(this.state)) {
      await this.cancel()
      return this.transcript.snapshot()
    }
    this.#setState("stopping")
    this.#clearPump()
    const tail = await this.capture?.stop({ flush: true })
    await this.#drainFrames(tail)
    if (this.cancelRequested) return this.transcript.snapshot()
    if (!socketOpen(this.socket, this.WebSocketClass) || this.sentAudioChunks === 0) {
      await this.#close("closed")
      return this.transcript.snapshot()
    }

    this.#setState("awaiting_final")
    this.socket.send(JSON.stringify({ end: true, sessionId: this.sessionId || this.uuid }))
    const snapshot = await new Promise((resolve) => {
      const timer = globalThis.setTimeout(() => {
        this.finalResolve = null
        resolve(this.transcript.snapshot())
      }, ASR_FINAL_TIMEOUT_MS)
      this.finalResolve = (value) => {
        globalThis.clearTimeout(timer)
        this.finalResolve = null
        resolve(value)
      }
    })
    this.finalResolve = null
    if (this.cancelRequested) return snapshot
    await this.#close("closed")
    return snapshot
  }

  async cancel() {
    if (["closed", "cancelled"].includes(this.state)) return this.transcript.snapshot()
    this.cancelRequested = true
    const snapshot = this.transcript.snapshot()
    this.readyReject?.(new AsrError("语音转写已取消", { code: "asr_cancelled" }))
    this.readyResolve = null
    this.readyReject = null
    this.finalResolve?.(snapshot)
    this.finalResolve = null
    this.frameQueue = []
    await this.capture?.stop({ flush: false })
    await this.#close("cancelled")
    return snapshot
  }

  async #fail(error) {
    if (this.state === "error" || this.closing) return
    this.readyReject?.(error)
    this.readyResolve = null
    this.readyReject = null
    this.finalResolve?.(this.transcript.snapshot())
    this.finalResolve = null
    this.#setState("error", { code: error.code })
    this.onError(error)
    this.frameQueue = []
    await this.capture?.stop({ flush: false })
    await this.#close("error", { preserveState: true })
  }

  async #close(state, { preserveState = false } = {}) {
    this.closing = true
    this.#clearPump()
    this.frameQueue = []
    await this.capture?.stop({ flush: false })
    this.capture = null
    if (this.socket) {
      this.socket.onmessage = null
      this.socket.onerror = null
      this.socket.onclose = null
      try { this.socket.close(1000, "client complete") } catch (_error) { /* already closed */ }
    }
    this.socket = null
    if (!preserveState) this.#setState(state)
    this.closing = false
  }
}

export function asrErrorMessage(error) {
  if (!(error instanceof AsrError)) return "实时语音转写暂时不可用"
  const providerCode = error.details?.provider_code
  if (/^(35001|35004|35010|35017|100002|100013|100016|100020)$/.test(providerCode)) {
    return "讯飞语音凭据或签名无效，请检查环境配置"
  }
  if (/^(35002|35006|35022|37002)$/.test(providerCode)) {
    return "讯飞语音额度或并发暂时不可用"
  }
  return error.message
}
