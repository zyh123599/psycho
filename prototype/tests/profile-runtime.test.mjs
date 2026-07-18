import test from "node:test"
import assert from "node:assert/strict"

import { saveApiSettings } from "../api-client.js"
import {
  PROFILE_STORAGE_KEY,
  ProfileRuntime,
  companionProfileContext,
  deriveProfileActions,
  deriveProfileEchoes,
  deriveProfileReport,
  deriveThemeCandidates,
  evidenceFingerprint,
  narrativeProfileContext,
  profileContextForModel
} from "../profile-runtime.js"

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
}

const envelope = {
  local_profile_version: "2.0",
  profile_id: "profile-1",
  generated_at: "2026-07-18T08:30:00Z",
  model: "gpt-5.6",
  modalities_used: ["text", "image"],
  last_evidence_fingerprint: "v1-old",
  profile: {
    analysis_status: "sufficient",
    headline: "在检查与休息之间寻找停点",
    summary: "这是可被新材料修正的暂时性总结。",
    current_state: [{ title: "已经很累", description: "", confidence: "medium", uncertainty: "", evidence_source_ids: ["note:1"] }],
    recurring_patterns: [],
    strengths_and_resources: [{ title: "能够觉察疲惫", description: "", confidence: "medium", uncertainty: "", evidence_source_ids: ["note:1"] }],
    needs_and_preferences: [{ title: "一个清楚的结束边界", description: "", confidence: "medium", uncertainty: "", evidence_source_ids: ["image:1"] }],
    multimodal_observations: [{
      source_ids: ["image:1", "note:1"],
      modality: "cross_modal",
      observation: "作品文字与便贴都出现了暂停。",
      contribution_to_profile: "结束边界值得由用户继续确认。",
      uncertainty: "只代表近期材料。"
    }],
    communication_preferences: ["先被理解"],
    gentle_actions: [
      { title: "设定停点", action: "写下最后一次检查的时间", rationale: "让够用变得可见" }
    ],
    reflection_questions: ["什么样的停点对今天已经够用？"],
    uncertainties: ["只来自一次短会话"]
  }
}

function modelProfile() {
  return {
    analysis_status: "sufficient",
    headline: "为今天留一个清楚的停点",
    summary: "近期文字与图片作品中的明确内容共同指向一个更小的结束边界。",
    current_state: [],
    recurring_patterns: [],
    strengths_and_resources: [],
    needs_and_preferences: [],
    multimodal_observations: [{
      source_ids: ["image:old"],
      modality: "image",
      observation: "作品中写有‘暂停’。",
      contribution_to_profile: "可继续确认用户是否需要结束边界。",
      uncertainty: "作品内容不等于长期状态。"
    }],
    communication_preferences: ["保持简洁"],
    gentle_actions: [{ title: "停点", action: "写下今天的结束时间", rationale: "让边界具体" }],
    reflection_questions: ["什么时间停下已经够用？"],
    uncertainties: ["只反映近期表达"],
    safety_notice: { level: "not_indicated", message: "" }
  }
}

function completion(profile = modelProfile()) {
  return new Response(JSON.stringify({
    id: "completion-runtime",
    choices: [{ message: { content: JSON.stringify(profile) } }]
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  })
}

function configureStorage() {
  globalThis.localStorage = new MemoryStorage()
  saveApiSettings({
    baseUrl: "https://relay.example.test/v1",
    apiKey: "test-only-key",
    model: "gpt-5.6",
    imageDetail: "high"
  })
}

test("画像派生内容保持有限且可解释，并携带多模态文字上下文", () => {
  const themes = deriveThemeCandidates(envelope, ["本地后备主题"])
  assert.equal(themes.length, 3)
  assert.match(themes[0], /停点/)

  const actions = deriveProfileActions(envelope)
  assert.deepEqual(actions[0], {
    id: "profile-action-0",
    label: "写下最后一次检查的时间",
    title: "设定停点",
    rationale: "让够用变得可见"
  })

  const report = deriveProfileReport(envelope, "7月18日")
  assert.equal(report.profileDriven, true)
  assert.match(report.mode, /多模态/)
  assert.equal(report.suggestions[0][1], "写下最后一次检查的时间")
  assert.match(deriveProfileEchoes(envelope)[0], /停点/)

  const companion = companionProfileContext(envelope)
  assert.equal(companion.multimodal_observations.length, 1)
  assert.equal("observation" in companion.multimodal_observations[0], false)
  const narrative = narrativeProfileContext(envelope)
  assert.match(narrative.multimodal_observations[0].contribution_to_profile, /结束边界/)
  const previous = profileContextForModel(envelope)
  assert.equal(previous.profile.multimodal_observations[0].source_ids[0], "image:1")
  assert.equal("safety_notice" in previous.profile, false)
})

test("证据指纹与对象键顺序无关，但会随真实证据变化", () => {
  const first = evidenceFingerprint({ texts: [{ id: 1, text: "有点累" }], signals: [] })
  const reordered = evidenceFingerprint({ signals: [], texts: [{ text: "有点累", id: 1 }] })
  const changed = evidenceFingerprint({ texts: [{ id: 1, text: "今天轻松一点" }], signals: [] })
  assert.equal(first, reordered)
  assert.notEqual(first, changed)
  assert.doesNotMatch(first, /有点累/)
})

test("旧版本机画像可迁移到 v2，且不会把安全事件带入上下文", (t) => {
  const originalStorage = globalThis.localStorage
  globalThis.localStorage = new MemoryStorage()
  t.after(() => { globalThis.localStorage = originalStorage })
  globalThis.localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify({
    local_profile_version: "1.0",
    profile_id: "legacy-profile",
    generated_at: "2026-07-17T08:00:00Z",
    model: "legacy-model",
    modalities_used: ["text"],
    profile: {
      analysis_status: "limited",
      headline: "想把事情做稳，也需要休息",
      summary: "这是一条仍可修正的近期观察。",
      current_state: [],
      recurring_patterns: [],
      strengths_and_resources: [],
      needs_and_preferences: [],
      communication_preferences: [],
      gentle_actions: [],
      reflection_questions: [],
      uncertainties: [],
      safety_notice: { level: "not_indicated", evidence: ["不应保留"] }
    }
  }))

  const runtime = new ProfileRuntime({ snapshot: () => null })
  assert.equal(runtime.profileEnvelope.local_profile_version, "2.0")
  assert.deepEqual(runtime.profileEnvelope.profile.multimodal_observations, [])
  assert.equal(JSON.stringify(profileContextForModel(runtime.profileEnvelope)).includes("不应保留"), false)
})

test("删除闪念来源会同步移除画像中的相关证据与多模态观察", (t) => {
  const originalStorage = globalThis.localStorage
  globalThis.localStorage = new MemoryStorage()
  t.after(() => { globalThis.localStorage = originalStorage })
  globalThis.localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(envelope))

  const runtime = new ProfileRuntime({ snapshot: () => null })
  runtime.forgetSources(["image:1"])

  assert.equal(runtime.profileEnvelope.profile.multimodal_observations.length, 0)
  assert.equal(runtime.profileEnvelope.profile.needs_and_preferences.length, 0)
  assert.equal(runtime.profileEnvelope.last_evidence_fingerprint, null)
  assert.match(JSON.stringify(runtime.profileEnvelope.profile.uncertainties), /用户已删除部分来源/)
})

test("相同证据不会重复请求，画像只把结构化文字结果写入本机", async (t) => {
  const originalStorage = globalThis.localStorage
  const originalFetch = globalThis.fetch
  configureStorage()
  let calls = 0
  globalThis.fetch = async () => {
    calls += 1
    return completion()
  }
  t.after(() => {
    globalThis.localStorage = originalStorage
    globalThis.fetch = originalFetch
  })

  const fingerprint = evidenceFingerprint({ texts: ["今天有点累"] })
  const runtime = new ProfileRuntime({
    snapshot: ({ previousProfile }) => ({
      evidenceFingerprint: fingerprint,
      payload: {
        texts: [{ source_id: "note:1", source: "note", content: "今天有点累" }],
        signals: [],
        image_contexts: [],
        previous_profile_context: profileContextForModel(previousProfile)
      },
      images: []
    })
  })
  runtime.setConsent({ serviceProcessing: true, profilePersonalization: true })

  await runtime.refresh("notes")
  await runtime.refresh("complete")

  assert.equal(calls, 1)
  assert.equal(runtime.profileEnvelope.local_profile_version, "2.0")
  assert.equal(runtime.profileEnvelope.last_evidence_fingerprint, fingerprint)
  assert.equal(runtime.profileEnvelope.profile.multimodal_observations.length, 1)
  const stored = globalThis.localStorage.getItem(PROFILE_STORAGE_KEY)
  assert.match(stored, /作品中写有/)
  assert.doesNotMatch(stored, /data:image|今天有点累/)
})

test("删除画像会取消在途结果，迟到响应不能让画像复活", async (t) => {
  const originalStorage = globalThis.localStorage
  const originalFetch = globalThis.fetch
  configureStorage()
  let resolveFetch
  globalThis.fetch = () => new Promise((resolve) => { resolveFetch = resolve })
  t.after(() => {
    globalThis.localStorage = originalStorage
    globalThis.fetch = originalFetch
  })

  const runtime = new ProfileRuntime({
    snapshot: () => ({
      evidenceFingerprint: "v1-inflight",
      payload: {
        texts: [{ source_id: "note:1", source: "note", content: "一条在途输入" }],
        signals: [],
        image_contexts: [],
        previous_profile_context: null
      },
      images: []
    })
  })
  runtime.setConsent({ serviceProcessing: true, profilePersonalization: true })
  const pending = runtime.refresh("notes")
  await new Promise((resolve) => setImmediate(resolve))
  runtime.clearProfile()
  resolveFetch(completion())
  await pending

  assert.equal(runtime.profileEnvelope, null)
  assert.equal(globalThis.localStorage.getItem(PROFILE_STORAGE_KEY), null)
})

test("删除来源期间的新画像请求会在旧请求结束后从当前代重新运行", async (t) => {
  const originalStorage = globalThis.localStorage
  const originalFetch = globalThis.fetch
  configureStorage()
  let resolveFirst
  let calls = 0
  globalThis.fetch = () => {
    calls += 1
    if (calls === 1) return new Promise((resolve) => { resolveFirst = resolve })
    return Promise.resolve(completion({
      ...modelProfile(),
      headline: "只根据删除后的剩余线索重建"
    }))
  }
  t.after(() => {
    globalThis.localStorage = originalStorage
    globalThis.fetch = originalFetch
  })

  let evidenceVersion = "before-delete"
  const runtime = new ProfileRuntime({
    snapshot: ({ previousProfile }) => ({
      evidenceFingerprint: `v1-${evidenceVersion}`,
      payload: {
        texts: [{ source_id: "note:remaining", source: "note", content: "保留下来的线索" }],
        signals: [],
        image_contexts: [],
        previous_profile_context: profileContextForModel(previousProfile)
      },
      images: []
    })
  })
  runtime.setConsent({ serviceProcessing: true, profilePersonalization: true })

  const first = runtime.refresh("notes")
  await new Promise((resolve) => setImmediate(resolve))
  evidenceVersion = "after-delete"
  runtime.clearProfile()
  void runtime.refresh("notes")
  resolveFirst(completion())
  await first
  await new Promise((resolve) => setImmediate(resolve))
  if (runtime.running) await runtime.running

  assert.equal(calls, 2)
  assert.equal(runtime.profileEnvelope.last_evidence_fingerprint, "v1-after-delete")
  assert.equal(runtime.profileEnvelope.profile.headline, "只根据删除后的剩余线索重建")
})
