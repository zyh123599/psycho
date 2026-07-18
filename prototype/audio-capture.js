const TARGET_SAMPLE_RATE = 16000
const PCM_FRAME_BYTES = 1280

export class AudioCaptureError extends Error {
  constructor(message, { code = "audio_capture_error", cause } = {}) {
    super(message, cause ? { cause } : undefined)
    this.name = "AudioCaptureError"
    this.code = code
  }
}

function concatFloat32(first, second) {
  if (first.length === 0) return second.slice()
  const combined = new Float32Array(first.length + second.length)
  combined.set(first)
  combined.set(second, first.length)
  return combined
}

function concatBytes(first, second) {
  if (first.length === 0) return second.slice()
  const combined = new Uint8Array(first.length + second.length)
  combined.set(first)
  combined.set(second, first.length)
  return combined
}

export function float32ToPcm16(samples) {
  const bytes = new Uint8Array(samples.length * 2)
  const view = new DataView(bytes.buffer)
  samples.forEach((sample, index) => {
    const clamped = Math.max(-1, Math.min(1, Number(sample) || 0))
    const value = Math.round(clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff)
    view.setInt16(index * 2, value, true)
  })
  return bytes
}

export class StreamingPcm16Encoder {
  constructor(sourceSampleRate, targetSampleRate = TARGET_SAMPLE_RATE) {
    if (!Number.isFinite(sourceSampleRate) || sourceSampleRate <= 0) {
      throw new AudioCaptureError("无法确定麦克风采样率", { code: "invalid_sample_rate" })
    }
    this.sourceSampleRate = sourceSampleRate
    this.targetSampleRate = targetSampleRate
    this.step = sourceSampleRate / targetSampleRate
    this.buffer = new Float32Array(0)
    this.position = 0
  }

  push(samples) {
    const incoming = samples instanceof Float32Array ? samples : Float32Array.from(samples || [])
    if (incoming.length === 0) return new Uint8Array(0)
    this.buffer = concatFloat32(this.buffer, incoming)
    const output = []
    while (this.position + 1 < this.buffer.length) {
      const leftIndex = Math.floor(this.position)
      const fraction = this.position - leftIndex
      const left = this.buffer[leftIndex]
      const right = this.buffer[leftIndex + 1]
      output.push(left + (right - left) * fraction)
      this.position += this.step
    }
    const consumed = Math.min(this.buffer.length, Math.floor(this.position + 1e-7))
    if (consumed > 0) {
      this.buffer = this.buffer.slice(consumed)
      this.position = Math.max(0, this.position - consumed)
    }
    return float32ToPcm16(output)
  }

  flush() {
    const output = []
    while (this.buffer.length > 0 && this.position < this.buffer.length) {
      const leftIndex = Math.min(this.buffer.length - 1, Math.floor(this.position))
      const rightIndex = Math.min(this.buffer.length - 1, leftIndex + 1)
      const fraction = this.position - leftIndex
      output.push(this.buffer[leftIndex] + (this.buffer[rightIndex] - this.buffer[leftIndex]) * fraction)
      this.position += this.step
    }
    this.buffer = new Float32Array(0)
    this.position = 0
    return float32ToPcm16(output)
  }
}

export class PcmFrameChunker {
  constructor(frameBytes = PCM_FRAME_BYTES) {
    this.frameBytes = frameBytes
    this.buffer = new Uint8Array(0)
  }

  push(bytes) {
    const incoming = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || 0)
    if (incoming.length > 0) this.buffer = concatBytes(this.buffer, incoming)
    const frames = []
    while (this.buffer.length >= this.frameBytes) {
      frames.push(this.buffer.slice(0, this.frameBytes))
      this.buffer = this.buffer.slice(this.frameBytes)
    }
    return frames
  }

  flush() {
    const remaining = this.buffer
    this.buffer = new Uint8Array(0)
    return remaining
  }
}

function microphoneError(error) {
  const names = {
    NotAllowedError: ["microphone_denied", "没有获得麦克风权限"],
    SecurityError: ["microphone_insecure", "麦克风只可在 HTTPS 或 localhost 使用"],
    NotFoundError: ["microphone_missing", "没有找到可用麦克风"],
    NotReadableError: ["microphone_busy", "麦克风正被其他应用占用"]
  }
  const [code, message] = names[error?.name] || ["microphone_unavailable", "暂时无法使用麦克风"]
  return new AudioCaptureError(message, { code, cause: error })
}

export class BrowserPcmCapture {
  constructor({
    onFrame,
    mediaDevices = globalThis.navigator?.mediaDevices,
    AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext,
    AudioWorkletNodeClass = globalThis.AudioWorkletNode
  } = {}) {
    this.onFrame = typeof onFrame === "function" ? onFrame : () => {}
    this.mediaDevices = mediaDevices
    this.AudioContextClass = AudioContextClass
    this.AudioWorkletNodeClass = AudioWorkletNodeClass
    this.stream = null
    this.context = null
    this.source = null
    this.processor = null
    this.mute = null
    this.encoder = null
    this.chunker = new PcmFrameChunker()
    this.started = false
  }

  async acquire() {
    if (globalThis.isSecureContext === false) {
      throw new AudioCaptureError("麦克风只可在 HTTPS 或 localhost 使用", { code: "microphone_insecure" })
    }
    if (!this.mediaDevices?.getUserMedia) {
      throw new AudioCaptureError("当前浏览器不支持麦克风采集", { code: "microphone_unsupported" })
    }
    if (this.stream) return this.stream
    try {
      this.stream = await this.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: false
      })
      return this.stream
    } catch (error) {
      throw microphoneError(error)
    }
  }

  #consume(samples) {
    const bytes = this.encoder.push(samples)
    this.chunker.push(bytes).forEach((frame) => this.onFrame(frame))
  }

  async start() {
    if (this.started) return
    await this.acquire()
    if (!this.AudioContextClass) {
      await this.stop({ flush: false })
      throw new AudioCaptureError("当前浏览器不支持实时音频处理", { code: "audio_context_unsupported" })
    }
    try {
      try {
        this.context = new this.AudioContextClass({ latencyHint: "interactive", sampleRate: TARGET_SAMPLE_RATE })
      } catch (_error) {
        this.context = new this.AudioContextClass({ latencyHint: "interactive" })
      }
      if (this.context.state === "suspended") await this.context.resume()
      this.encoder = new StreamingPcm16Encoder(this.context.sampleRate)
      this.source = this.context.createMediaStreamSource(this.stream)

      let workletReady = false
      if (this.context.audioWorklet && this.AudioWorkletNodeClass) {
        try {
          await this.context.audioWorklet.addModule(new URL("./asr-pcm-worklet.js", import.meta.url))
          this.processor = new this.AudioWorkletNodeClass(this.context, "xinchao-pcm-capture", {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            outputChannelCount: [1]
          })
          this.processor.port.onmessage = (event) => this.#consume(event.data)
          workletReady = true
        } catch (_error) {
          this.processor = null
        }
      }

      if (!workletReady) {
        if (typeof this.context.createScriptProcessor !== "function") {
          throw new AudioCaptureError("当前浏览器缺少实时音频处理能力", { code: "audio_processor_unsupported" })
        }
        this.processor = this.context.createScriptProcessor(2048, 1, 1)
        this.processor.onaudioprocess = (event) => {
          const channel = event.inputBuffer.getChannelData(0)
          this.#consume(channel.slice())
        }
      }

      this.mute = this.context.createGain()
      this.mute.gain.value = 0
      this.source.connect(this.processor)
      this.processor.connect(this.mute)
      this.mute.connect(this.context.destination)
      this.started = true
    } catch (error) {
      await this.stop({ flush: false })
      if (error instanceof AudioCaptureError) throw error
      throw new AudioCaptureError("无法启动实时音频处理", { code: "audio_start_failed", cause: error })
    }
  }

  async stop({ flush = true } = {}) {
    this.started = false
    if (this.processor?.port) this.processor.port.onmessage = null
    if (this.processor && "onaudioprocess" in this.processor) this.processor.onaudioprocess = null
    for (const node of [this.source, this.processor, this.mute]) {
      try { node?.disconnect() } catch (_error) { /* already disconnected */ }
    }
    this.source = null
    this.processor = null
    this.mute = null

    this.stream?.getTracks?.().forEach((track) => track.stop())
    this.stream = null
    if (this.context && this.context.state !== "closed") {
      try { await this.context.close() } catch (_error) { /* already closed */ }
    }
    this.context = null

    if (!flush || !this.encoder) {
      this.encoder = null
      this.chunker = new PcmFrameChunker()
      return new Uint8Array(0)
    }
    this.chunker.push(this.encoder.flush()).forEach((frame) => this.onFrame(frame))
    const tail = this.chunker.flush()
    this.encoder = null
    return tail
  }
}

export const AUDIO_TARGETS = Object.freeze({
  sampleRate: TARGET_SAMPLE_RATE,
  frameBytes: PCM_FRAME_BYTES,
  frameDurationMs: 40
})
