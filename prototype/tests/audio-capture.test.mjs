import test from "node:test"
import assert from "node:assert/strict"

import {
  PcmFrameChunker,
  StreamingPcm16Encoder,
  float32ToPcm16
} from "../audio-capture.js"

test("Float32 音频会钳位并编码为小端 PCM16", () => {
  const bytes = float32ToPcm16(Float32Array.from([-2, -1, 0, 0.5, 1, 2]))
  const view = new DataView(bytes.buffer)
  assert.deepEqual(
    Array.from({ length: 6 }, (_, index) => view.getInt16(index * 2, true)),
    [-32768, -32768, 0, 16384, 32767, 32767]
  )
})

function sineWave(sampleRate, seconds = 1) {
  return Float32Array.from({ length: sampleRate * seconds }, (_, index) => (
    Math.sin(2 * Math.PI * 440 * index / sampleRate) * 0.4
  ))
}

function encodeInChunks(samples, sampleRate, chunkSizes) {
  const encoder = new StreamingPcm16Encoder(sampleRate)
  const parts = []
  let offset = 0
  let chunkIndex = 0
  while (offset < samples.length) {
    const size = chunkSizes[chunkIndex % chunkSizes.length]
    parts.push(encoder.push(samples.slice(offset, offset + size)))
    offset += size
    chunkIndex += 1
  }
  parts.push(encoder.flush())
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const combined = new Uint8Array(total)
  let cursor = 0
  parts.forEach((part) => {
    combined.set(part, cursor)
    cursor += part.length
  })
  return combined
}

test("48k 与 44.1k 流式重采样到 16k，随机分块不会造成漂移", () => {
  for (const sampleRate of [48000, 44100]) {
    const samples = sineWave(sampleRate)
    const single = encodeInChunks(samples, sampleRate, [samples.length])
    const chunked = encodeInChunks(samples, sampleRate, [127, 2048, 511, 73, 4096])
    assert.equal(single.length, 16000 * 2)
    assert.deepEqual(chunked, single)
  }
})

test("PCM 队列按每 40ms 的 1280 字节切帧并保留尾帧", () => {
  const chunker = new PcmFrameChunker()
  const first = chunker.push(new Uint8Array(1000).fill(1))
  assert.equal(first.length, 0)
  const second = chunker.push(new Uint8Array(1700).fill(2))
  assert.equal(second.length, 2)
  assert.equal(second[0].length, 1280)
  assert.equal(second[1].length, 1280)
  const tail = chunker.flush()
  assert.equal(tail.length, 140)
})
