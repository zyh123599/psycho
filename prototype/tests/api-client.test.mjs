import test from "node:test"
import assert from "node:assert/strict"

import {
  API_SETTINGS_STORAGE_KEY,
  analyzeProfile,
  clearApiSettings,
  generateMonthlyReflection,
  generateNarrative,
  hasApiSettings,
  loadApiSettings,
  saveApiSettings,
  sendCompanionMessage,
  testApiConnection
} from "../api-client.js"

const settings = {
  baseUrl: "https://relay.example.test/v1",
  apiKey: "test-key-not-a-real-secret",
  model: "gpt-5.6",
  imageDetail: "high"
}

class MemoryStorage {
  constructor() {
    this.values = new Map()
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null
  }

  setItem(key, value) {
    this.values.set(key, String(value))
  }

  removeItem(key) {
    this.values.delete(key)
  }

  clear() {
    this.values.clear()
  }
}

function completion(content, extra = {}) {
  return new Response(JSON.stringify({
    id: "completion-1",
    choices: [{ message: { role: "assistant", content: JSON.stringify(content) } }],
    usage: { prompt_tokens: 10, completion_tokens: 20 },
    ...extra
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  })
}

function profileResult() {
  return {
    analysis_status: "sufficient",
    headline: "在忙碌里辨认自己的停点",
    summary: "文字与作品中的明确线索共同指向：此刻更需要一个低负担的结束边界。",
    current_state: [],
    recurring_patterns: [],
    strengths_and_resources: [],
    needs_and_preferences: [],
    multimodal_observations: [{
      source_ids: ["image:stable"],
      modality: "cross_modal",
      observation: "图片中的手写词语与便贴都提到了暂停。",
      contribution_to_profile: "这使结束边界成为可供确认的主题。",
      uncertainty: "无法知道这些词是否代表长期状态。"
    }],
    communication_preferences: ["先简洁回应"],
    gentle_actions: [],
    reflection_questions: ["今天怎样才算已经够用？"],
    uncertainties: ["材料只反映近期片段"],
    safety_notice: { level: "not_indicated", message: "" }
  }
}

function narrativeResult() {
  const tones = ["guide", "body", "friend", "standard", "future", "self"]
  return {
    title: "在忙碌里，留一个停点",
    intro: "六个具体时刻，没有标准答案。",
    cards: tones.map((tone, index) => ({
      speaker: `声音 ${index + 1}`,
      role: "陪你看一眼",
      portrait: "潮",
      tone,
      prompt: `情境 ${index + 1}，你更想怎样回应？`,
      whisper: "两边都可以是此刻真实的选择。",
      left: { label: "先等等", result: "你为理解多留了一点时间。" },
      right: { label: "走一小步", result: "你选择先试一个很小的动作。" }
    }))
  }
}

test("自定义 API 配置只写入本机存储并可清除", (t) => {
  const original = globalThis.localStorage
  globalThis.localStorage = new MemoryStorage()
  t.after(() => { globalThis.localStorage = original })

  assert.equal(hasApiSettings(), false)
  const saved = saveApiSettings(settings)
  assert.equal(saved.baseUrl, settings.baseUrl)
  assert.equal(loadApiSettings().apiKey, settings.apiKey)
  assert.equal(hasApiSettings(), true)
  assert.match(globalThis.localStorage.getItem(API_SETTINGS_STORAGE_KEY), /relay\.example\.test/)

  assert.equal(clearApiSettings(), true)
  assert.equal(loadApiSettings().apiKey, "")
  assert.equal(hasApiSettings(), false)
})

test("陪伴请求直达 chat/completions，使用 Bearer 与严格结构化输出", async (t) => {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    return completion({
      reply: "我先听见这份累，不急着把它解释完。",
      suggested_prompts: ["我只想先说说"],
      safety_notice: { level: "not_indicated", message: "" }
    })
  }
  t.after(() => { globalThis.fetch = originalFetch })

  const response = await sendCompanionMessage({
    mode: "standalone",
    messages: [{ role: "user", content: "我有点累" }],
    profile_context: null
  }, { settings })

  assert.equal(response.result.reply.includes("这份累"), true)
  assert.equal(calls[0].url, "https://relay.example.test/v1/chat/completions")
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${settings.apiKey}`)
  assert.equal(calls[0].options.credentials, "omit")
  const body = JSON.parse(calls[0].options.body)
  assert.equal(body.model, "gpt-5.6")
  assert.equal(body.response_format.type, "json_schema")
  assert.equal(body.response_format.json_schema.strict, true)
  assert.equal(body.response_format.json_schema.schema.additionalProperties, false)
})

test("画像请求把图片作为 data URL 发送并保留文字化多模态观察", async (t) => {
  const originalFetch = globalThis.fetch
  let requestBody
  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body)
    return completion(profileResult())
  }
  t.after(() => { globalThis.fetch = originalFetch })

  const image = new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" })
  const response = await analyzeProfile({
    settings,
    payload: {
      client_request_id: "profile-test",
      locale: "zh-CN",
      analysis_focus: "融合文字与图片中的明确内容。",
      texts: [{ source_id: "note:1", source: "note", content: "我想给今天一个停点" }],
      signals: [],
      image_contexts: [{ source_id: "image:stable", description: "一张用户主动提供的作品" }],
      previous_profile_context: {
        profile_id: "profile-existing",
        modalities_used: ["text"],
        profile: { headline: "旧画像只作为连续性上下文" }
      }
    },
    images: [{ file: image, sourceId: "image:stable" }]
  })

  const userContent = requestBody.messages[1].content
  assert.equal(userContent[0].type, "text")
  assert.match(userContent[1].image_url.url, /^data:image\/png;base64,/)
  assert.equal(userContent[1].image_url.detail, "high")
  const prompt = JSON.parse(userContent[0].text)
  assert.equal(prompt.fresh_evidence.texts.some((item) => item.source_id === "profile:previous"), false)
  assert.equal(prompt.previous_profile_context.profile_id, "profile-existing")
  assert.deepEqual(response.processed_image_source_ids, ["image:stable"])
  assert.deepEqual(response.modalities_used.sort(), ["image", "text"])
  assert.equal(response.profile.multimodal_observations[0].modality, "cross_modal")
})

test("一批图片必须逐张出现在多模态文字观察后才标记为已处理", async (t) => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => completion(profileResult())
  t.after(() => { globalThis.fetch = originalFetch })

  const first = new Blob([new Uint8Array([1])], { type: "image/png" })
  const second = new Blob([new Uint8Array([2])], { type: "image/png" })
  await assert.rejects(
    analyzeProfile({
      settings,
      payload: {
        client_request_id: "profile-batch-test",
        texts: [],
        signals: [],
        image_contexts: [
          { source_id: "image:stable", description: "第一张作品" },
          { source_id: "image:missing", description: "第二张作品" }
        ],
        previous_profile_context: null
      },
      images: [
        { file: first, sourceId: "image:stable" },
        { file: second, sourceId: "image:missing" }
      ]
    }),
    (error) => error?.code === "missing_multimodal_observation" &&
      error?.details?.missing_source_ids?.includes("image:missing")
  )
})

test("叙事生成固定返回六张卡，连接测试使用 models 端点", async (t) => {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    if (url.endsWith("/models")) {
      return new Response(JSON.stringify({ data: [{ id: "gpt-5.6" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    }
    return completion(narrativeResult())
  }
  t.after(() => { globalThis.fetch = originalFetch })

  const narrative = await generateNarrative({
    theme: "我想在忙碌里留一个停点",
    profileContext: { headline: "正在寻找边界" },
    settings
  })
  const connection = await testApiConnection({ settings })

  assert.equal(narrative.result.cards.length, 6)
  assert.equal(calls[0].url, "https://relay.example.test/v1/chat/completions")
  assert.equal(calls[1].url, "https://relay.example.test/v1/models")
  assert.equal(calls[1].options.method, "GET")
  assert.equal(connection.modelAvailable, true)
})

test("月度回顾只发送选中月份并使用独立严格结构", async (t) => {
  const originalFetch = globalThis.fetch
  let requestBody
  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body)
    return completion({
      analysis_status: "limited",
      title: "七月留下了几个愿意停一下的片段",
      summary: "这些内容只代表本月主动留下的有限记录。",
      highlights: [{ label: "停点", reflection: "几条闪念提到了把事情缩小。" }],
      gentle_question: "哪一天值得轻轻记住？",
      uncertainty: "没有覆盖本月所有经历。",
      safety_notice: { level: "not_indicated", message: "" }
    })
  }
  t.after(() => { globalThis.fetch = originalFetch })

  const response = await generateMonthlyReflection({
    month: "2026-07",
    entries: [
      { date: "2026-07-01", type: "thought", label: "闪念", copy: "最早且应被容量边界省略的片段" },
      ...Array.from({ length: 29 }, (_, index) => ({
        date: `2026-07-${String(index + 2).padStart(2, "0")}`,
        type: "thought",
        label: "闪念",
        copy: `当月片段 ${index + 2}`
      })),
      { date: "2026-07-20", type: "echo", label: "未解封回响", copy: "当月有一条仍在封存的未来回响" }
    ],
    profileContext: { headline: "正在寻找结束边界" },
    settings
  })

  const bodyText = JSON.stringify(requestBody)
  assert.match(bodyText, /xinchao_monthly_reflection/)
  assert.match(bodyText, /2026-07/)
  assert.match(bodyText, /仍在封存/)
  assert.doesNotMatch(bodyText, /最早且应被容量边界省略/)
  assert.doesNotMatch(bodyText, /data:image/)
  assert.equal(requestBody.response_format.json_schema.strict, true)
  assert.deepEqual(
    requestBody.response_format.json_schema.schema.properties.analysis_status.enum,
    ["limited", "sufficient"]
  )
  assert.equal(JSON.parse(requestBody.messages[1].content).saved_month_entries.length, 30)
  assert.equal(response.result.analysis_status, "limited")
  assert.equal(response.result.highlights.length, 1)
})
