import { analyzeProfile, getCapabilities } from "./api-client.js"

export const AI_CONSENT_STORAGE_KEY = "xinchao.ai-consent.v1"
export const PROFILE_STORAGE_KEY = "xinchao.reflective-profile.v1"
export const AI_POLICY_VERSION = "2026-07-18-local-api"

export const DEFAULT_API_CAPABILITIES = Object.freeze({
  max_images: 4,
  max_image_bytes: 8 * 1024 * 1024,
  accepted_image_types: ["image/jpeg", "image/png", "image/webp"]
})

const DEFAULT_CONSENT = Object.freeze({
  serviceProcessing: false,
  profilePersonalization: false,
  prompted: false,
  policyVersion: AI_POLICY_VERSION
})

const PIPELINE_META_PATTERN = /(本次没有新增|第一人称近况|此前获授权|此前摘要|主要依据仍是|用于画像的|较稳妥的更新|延续轻量|把是否展开|交给用户决定)/

function readJson(key) {
  try {
    const raw = globalThis.localStorage?.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch (_error) {
    return null
  }
}

function writeJson(key, value) {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value))
    return Boolean(globalThis.localStorage)
  } catch (_error) {
    return false
  }
}

function removeStored(key) {
  try {
    globalThis.localStorage?.removeItem(key)
    return true
  } catch (_error) {
    return false
  }
}

function normalizeConsent(value) {
  if (!value || typeof value !== "object") return { ...DEFAULT_CONSENT }
  const serviceProcessing = value.serviceProcessing === true
  return {
    serviceProcessing,
    profilePersonalization: serviceProcessing && value.profilePersonalization === true,
    prompted: value.prompted === true,
    policyVersion: AI_POLICY_VERSION
  }
}

function compactText(value, maxLength = 1200, fallback = "") {
  if (typeof value !== "string") return fallback
  const cleaned = value.trim().replace(/\s+/g, " ").slice(0, maxLength)
  return cleaned || fallback
}

function withoutPipelineMeta(value, fallback = "") {
  const text = compactText(value, 1600)
  if (!text) return fallback
  const sentences = text.split(/(?<=[。！？!?])\s*/)
  const kept = sentences.filter((sentence) => !PIPELINE_META_PATTERN.test(sentence))
  return compactText(kept.join(""), 1200, fallback)
}

function uniqueStrings(items, limit, maxLength = 120) {
  const result = []
  Array.from(items || []).forEach((item) => {
    const normalized = compactText(item, maxLength)
    if (normalized && !result.includes(normalized)) result.push(normalized)
  })
  return result.slice(0, limit)
}

function insightEvidenceIds(insight) {
  if (Array.isArray(insight?.evidence_source_ids)) return insight.evidence_source_ids
  if (Array.isArray(insight?.evidence)) {
    return insight.evidence.map((item) => item?.source_id)
  }
  return []
}

function sanitizeInsight(insight) {
  if (!insight || typeof insight !== "object") return null
  const title = withoutPipelineMeta(insight.title)
  if (!title) return null
  const confidence = ["low", "medium", "high"].includes(insight.confidence)
    ? insight.confidence
    : "low"
  return {
    title: title.slice(0, 120),
    description: withoutPipelineMeta(insight.description).slice(0, 500),
    confidence,
    uncertainty: withoutPipelineMeta(insight.uncertainty).slice(0, 300),
    evidence_source_ids: uniqueStrings(insightEvidenceIds(insight), 6, 100)
  }
}

function sanitizeInsights(items) {
  return Array.from(items || []).map(sanitizeInsight).filter(Boolean).slice(0, 4)
}

function sanitizeMultimodalObservation(item) {
  if (!item || typeof item !== "object") return null
  const observation = withoutPipelineMeta(item.observation)
  const contribution = withoutPipelineMeta(item.contribution_to_profile)
  if (!observation || !contribution) return null
  return {
    source_ids: uniqueStrings(item.source_ids, 4, 100),
    modality: item.modality === "cross_modal" ? "cross_modal" : "image",
    observation: observation.slice(0, 600),
    contribution_to_profile: contribution.slice(0, 600),
    uncertainty: withoutPipelineMeta(item.uncertainty).slice(0, 300)
  }
}

function sanitizeAction(item) {
  if (!item || typeof item !== "object") return null
  const action = withoutPipelineMeta(item.action)
  if (!action) return null
  return {
    title: withoutPipelineMeta(item.title, "一小步").slice(0, 100),
    action: action.slice(0, 220),
    rationale: withoutPipelineMeta(item.rationale).slice(0, 300)
  }
}

function validStoredProfile(value) {
  return Boolean(
    value &&
    value.local_profile_version === "2.0" &&
    typeof value.profile_id === "string" &&
    typeof value.generated_at === "string" &&
    value.profile &&
    typeof value.profile.headline === "string" &&
    typeof value.profile.summary === "string"
  )
}

function migrateStoredProfile(value) {
  if (validStoredProfile(value)) return value
  if (!value || value.local_profile_version !== "1.0" || !value.profile) return null
  const profile = value.profile
  const headline = withoutPipelineMeta(profile.headline)
  const summary = withoutPipelineMeta(profile.summary)
  if (!headline || !summary) return null
  return {
    local_profile_version: "2.0",
    profile_id: value.profile_id,
    generated_at: value.generated_at,
    model: value.model || "unknown",
    modalities_used: uniqueStrings(value.modalities_used, 3, 30),
    last_evidence_fingerprint: null,
    profile: {
      analysis_status: profile.analysis_status === "sufficient" ? "sufficient" : "limited",
      headline,
      summary,
      current_state: sanitizeInsights(profile.current_state),
      recurring_patterns: sanitizeInsights(profile.recurring_patterns),
      strengths_and_resources: sanitizeInsights(profile.strengths_and_resources),
      needs_and_preferences: sanitizeInsights(profile.needs_and_preferences),
      multimodal_observations: [],
      communication_preferences: uniqueStrings(profile.communication_preferences, 5, 160),
      gentle_actions: Array.from(profile.gentle_actions || []).map(sanitizeAction).filter(Boolean).slice(0, 4),
      reflection_questions: uniqueStrings(profile.reflection_questions, 4, 220),
      uncertainties: uniqueStrings(profile.uncertainties, 6, 240)
    }
  }
}

function sanitizeProfileEnvelope(response, fingerprint, previousEnvelope) {
  const profile = response.profile || {}
  const previousModalities = Array.isArray(previousEnvelope?.modalities_used)
    ? previousEnvelope.modalities_used
    : []
  const fallbackSummary = "这份暂时性画像会随着你之后主动提供的线索继续修正。"
  const headline = withoutPipelineMeta(profile.headline, "一份仍可继续修正的当下观察")
  const summary = withoutPipelineMeta(profile.summary, fallbackSummary)
  return {
    local_profile_version: "2.0",
    profile_id: response.profile_id,
    generated_at: response.generated_at,
    model: response.model,
    modalities_used: uniqueStrings([
      ...previousModalities,
      ...(Array.isArray(response.modalities_used) ? response.modalities_used : [])
    ], 3, 30),
    last_evidence_fingerprint: fingerprint,
    profile: {
      analysis_status: profile.analysis_status === "sufficient" ? "sufficient" : "limited",
      headline,
      summary,
      current_state: sanitizeInsights(profile.current_state),
      recurring_patterns: sanitizeInsights(profile.recurring_patterns),
      strengths_and_resources: sanitizeInsights(profile.strengths_and_resources),
      needs_and_preferences: sanitizeInsights(profile.needs_and_preferences),
      multimodal_observations: Array.from(profile.multimodal_observations || [])
        .map(sanitizeMultimodalObservation)
        .filter(Boolean)
        .slice(0, 8),
      communication_preferences: uniqueStrings(profile.communication_preferences, 5, 160),
      gentle_actions: Array.from(profile.gentle_actions || [])
        .map(sanitizeAction)
        .filter(Boolean)
        .slice(0, 4),
      reflection_questions: uniqueStrings(profile.reflection_questions, 4, 220),
      uncertainties: uniqueStrings(profile.uncertainties, 6, 240)
    }
  }
}

function stableSerialize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`
  return `{${Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => (
    `${JSON.stringify(key)}:${stableSerialize(value[key])}`
  )).join(",")}}`
}

export function evidenceFingerprint(value) {
  const text = stableSerialize(value)
  let first = 0x811c9dc5
  let second = 0x9e3779b9
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    first ^= code
    first = Math.imul(first, 0x01000193)
    second ^= code + index
    second = Math.imul(second, 0x85ebca6b)
  }
  return `v1-${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`
}

export function profileContextForModel(envelope) {
  if (!envelope?.profile) return null
  const profile = envelope.profile
  return {
    profile_id: envelope.profile_id,
    generated_at: envelope.generated_at,
    modalities_used: Array.isArray(envelope.modalities_used) ? envelope.modalities_used : [],
    profile: {
      analysis_status: profile.analysis_status,
      headline: profile.headline,
      summary: profile.summary,
      current_state: profile.current_state || [],
      recurring_patterns: profile.recurring_patterns || [],
      strengths_and_resources: profile.strengths_and_resources || [],
      needs_and_preferences: profile.needs_and_preferences || [],
      multimodal_observations: profile.multimodal_observations || [],
      communication_preferences: profile.communication_preferences || [],
      gentle_actions: profile.gentle_actions || [],
      reflection_questions: profile.reflection_questions || [],
      uncertainties: profile.uncertainties || []
    }
  }
}

export class ProfileRuntime {
  constructor({ snapshot, onProfile = () => {}, onStatus = () => {} }) {
    this.snapshot = snapshot
    this.onProfile = onProfile
    this.onStatus = onStatus
    this.consent = normalizeConsent(readJson(AI_CONSENT_STORAGE_KEY))
    const migrated = migrateStoredProfile(readJson(PROFILE_STORAGE_KEY))
    this.profileEnvelope = migrated
    if (migrated) writeJson(PROFILE_STORAGE_KEY, migrated)
    this.capabilities = { ...DEFAULT_API_CAPABILITIES }
    this.running = null
    this.queuedReason = null
    this.queuedGeneration = null
    this.controller = null
    this.generation = 0
  }

  async initialize() {
    const capabilities = await getCapabilities()
    this.capabilities = {
      ...DEFAULT_API_CAPABILITIES,
      ...capabilities,
      accepted_image_types: Array.isArray(capabilities.accepted_image_types)
        ? capabilities.accepted_image_types
        : DEFAULT_API_CAPABILITIES.accepted_image_types
    }
    const message = this.consent.profilePersonalization
      ? (this.profileEnvelope ? "已加载本机多模态文字画像" : "持续画像已启用，等待新的可用线索")
      : (this.consent.serviceProcessing ? "AI 服务已启用；持续画像未启用" : "AI 尚未启用")
    this.onStatus({ state: "idle", message })
    return this.capabilities
  }

  setConsent(changes) {
    const previous = this.consent
    this.consent = normalizeConsent({ ...this.consent, ...changes, prompted: true })
    writeJson(AI_CONSENT_STORAGE_KEY, this.consent)
    const revoked = previous.serviceProcessing && !this.consent.serviceProcessing
      || previous.profilePersonalization && !this.consent.profilePersonalization
    if (revoked) {
      this.queuedReason = null
      this.queuedGeneration = null
      this.generation += 1
      this.controller?.abort()
    }
    this.onStatus({ state: "consent", message: "AI 授权设置已更新" })
    return this.consent
  }

  clearProfile() {
    this.queuedReason = null
    this.queuedGeneration = null
    this.generation += 1
    this.controller?.abort()
    this.profileEnvelope = null
    removeStored(PROFILE_STORAGE_KEY)
    this.onProfile(null, "cleared", null)
    this.onStatus({ state: "idle", message: "本机多模态文字画像已删除" })
  }

  forgetSources(sourceIds) {
    const removed = new Set(Array.from(sourceIds || []).filter((item) => typeof item === "string" && item))
    if (removed.size === 0) return this.profileEnvelope
    this.queuedReason = null
    this.queuedGeneration = null
    this.generation += 1
    this.controller?.abort()
    if (!this.profileEnvelope?.profile) return this.profileEnvelope
    const profile = this.profileEnvelope.profile
    const scrubInsights = (items) => Array.from(items || []).map((item) => {
      const original = Array.isArray(item.evidence_source_ids) ? item.evidence_source_ids : []
      const evidenceSourceIds = original.filter((sourceId) => !removed.has(sourceId))
      if (original.length > 0 && evidenceSourceIds.length === 0) return null
      return { ...item, evidence_source_ids: evidenceSourceIds }
    }).filter(Boolean)
    const next = {
      ...this.profileEnvelope,
      last_evidence_fingerprint: null,
      profile: {
        ...profile,
        current_state: scrubInsights(profile.current_state),
        recurring_patterns: scrubInsights(profile.recurring_patterns),
        strengths_and_resources: scrubInsights(profile.strengths_and_resources),
        needs_and_preferences: scrubInsights(profile.needs_and_preferences),
        multimodal_observations: Array.from(profile.multimodal_observations || []).filter((item) => (
          !Array.from(item.source_ids || []).some((sourceId) => removed.has(sourceId))
        )),
        uncertainties: uniqueStrings([
          ...(profile.uncertainties || []),
          "用户已删除部分来源，相关观察已从本机画像中移除；整体总结将在下一次更新时继续修正。"
        ], 6, 240)
      }
    }
    this.profileEnvelope = next
    writeJson(PROFILE_STORAGE_KEY, next)
    this.onProfile(next, "source-deleted", null)
    this.onStatus({ state: "ready", message: "已从本机画像移除被删除来源的相关观察" })
    return next
  }

  refresh(reason = "interaction") {
    if (!this.consent.serviceProcessing || !this.consent.profilePersonalization) {
      return Promise.resolve(null)
    }
    if (this.running) {
      this.queuedReason = reason
      this.queuedGeneration = this.generation
      this.onStatus({ state: "queued", message: "新变化已合并到下一次画像更新", reason })
      return this.running
    }
    this.running = this.#run(reason)
    return this.running
  }

  async #run(reason) {
    this.controller = new AbortController()
    const generation = this.generation
    this.onStatus({ state: "updating", message: "正在后台更新本机多模态文字画像…", reason })
    try {
      const request = this.snapshot({
        reason,
        previousProfile: this.profileEnvelope,
        capabilities: this.capabilities
      })
      if (!request) {
        this.onStatus({ state: "idle", message: "目前没有新的可用线索", reason })
        return null
      }
      const fingerprint = request.evidenceFingerprint || evidenceFingerprint({
        texts: request.payload?.texts || [],
        signals: request.payload?.signals || [],
        image_source_ids: (request.images || []).map((image) => image?.sourceId || null)
      })
      if (fingerprint === this.profileEnvelope?.last_evidence_fingerprint) {
        this.onStatus({ state: "idle", message: "画像已是最新，没有重复发送相同线索", reason })
        return this.profileEnvelope
      }
      const response = await analyzeProfile({
        payload: request.payload,
        images: request.images,
        signal: this.controller.signal
      })
      if (
        generation !== this.generation ||
        !this.consent.serviceProcessing ||
        !this.consent.profilePersonalization
      ) return null

      const safetyLevel = response.profile?.safety_notice?.level
      if (safetyLevel && safetyLevel !== "not_indicated") {
        this.queuedReason = null
        this.onProfile(this.profileEnvelope, reason, response)
        this.onStatus({
          state: "safety",
          message: "普通画像更新已暂停，请先查看安全支持说明",
          reason
        })
        return null
      }
      const sanitized = sanitizeProfileEnvelope(response, fingerprint, this.profileEnvelope)
      this.profileEnvelope = sanitized
      writeJson(PROFILE_STORAGE_KEY, sanitized)
      this.onProfile(sanitized, reason, response)
      this.onStatus({
        state: "ready",
        message: "画像已更新；保存的是图片与文本形成的文字观察，不保存原图",
        reason,
        generatedAt: sanitized.generated_at
      })
      return sanitized
    } catch (error) {
      if (error && (error.name === "AbortError" || error.code === "client_aborted")) {
        if (generation === this.generation) {
          this.onStatus({ state: "idle", message: "画像更新已取消", reason })
        }
        return null
      }
      if (generation === this.generation) {
        this.onStatus({
          state: "error",
          message: error?.message || "画像更新暂时失败",
          reason,
          error
        })
      }
      return null
    } finally {
      this.controller = null
      this.running = null
      const queued = this.queuedReason
      const queuedGeneration = this.queuedGeneration
      this.queuedReason = null
      this.queuedGeneration = null
      if (queued && this.consent.profilePersonalization && queuedGeneration === this.generation) {
        globalThis.queueMicrotask(() => this.refresh(queued))
      }
    }
  }
}

export function deriveThemeCandidates(envelope, fallback = []) {
  const profile = envelope?.profile
  if (!profile) return fallback.slice(0, 3)
  const titled = [
    ...(profile.current_state || []),
    ...(profile.needs_and_preferences || []),
    ...(profile.recurring_patterns || [])
  ].map((item) => item.title)
  const questions = (profile.reflection_questions || []).map((question) => {
    const clean = question.replace(/[？?]+$/, "")
    return clean.startsWith("我") ? clean : `我想梳理：${clean}`
  })
  return uniqueStrings([...questions, ...titled.map((title) => `我想梳理：${title}`), ...fallback], 3, 80)
}

export function deriveProfileActions(envelope) {
  const actions = envelope?.profile?.gentle_actions
  if (!Array.isArray(actions)) return []
  return actions.slice(0, 3).map((item, index) => ({
    id: `profile-action-${index}`,
    label: item.action.slice(0, 180),
    title: item.title.slice(0, 100),
    rationale: item.rationale.slice(0, 180)
  }))
}

export function deriveProfileReport(envelope, date) {
  const profile = envelope?.profile
  if (!profile) return null
  const insights = [
    ...(profile.current_state || []),
    ...(profile.needs_and_preferences || []),
    ...(profile.strengths_and_resources || [])
  ]
  const actions = deriveProfileActions(envelope)
  if (actions.length === 0) return null
  const basis = uniqueStrings(insights.map((item) => item.title), 2, 36)
  return {
    headline: profile.headline,
    basis: basis.length > 0 ? basis : ["来自最近一次授权画像"],
    quote: (profile.reflection_questions || [])[0] || "今天只带走一个足够小的下一步。",
    summary: profile.summary,
    suggestions: actions.map((item) => [item.title, item.label]),
    dominant: "profile",
    personalized: true,
    profileDriven: true,
    mode: envelope.modalities_used?.includes("image") ? "多模态画像日报 · 本机" : "AI 画像日报 · 本机",
    date
  }
}

export function deriveProfileEchoes(envelope) {
  const profile = envelope?.profile
  if (!profile) return []
  const strengths = (profile.strengths_and_resources || []).map((item) => item.title)
  return uniqueStrings([
    profile.headline,
    ...strengths.map((item) => `我愿意记得：${item}。`)
  ], 2, 120)
}

export function companionProfileContext(envelope) {
  const profile = envelope?.profile
  if (!profile) return null
  return {
    profile_id: envelope.profile_id,
    generated_at: envelope.generated_at,
    headline: profile.headline,
    summary: profile.summary,
    communication_preferences: profile.communication_preferences || [],
    needs_and_preferences: (profile.needs_and_preferences || []).map((item) => item.title),
    gentle_actions: (profile.gentle_actions || []).map((item) => item.action),
    multimodal_observations: (profile.multimodal_observations || []).slice(0, 4).map((item) => ({
      contribution_to_profile: item.contribution_to_profile,
      uncertainty: item.uncertainty
    })),
    uncertainties: profile.uncertainties || []
  }
}

export function narrativeProfileContext(envelope) {
  const profile = envelope?.profile
  if (!profile) return null
  return {
    headline: profile.headline,
    summary: profile.summary,
    current_state: (profile.current_state || []).map((item) => item.title),
    strengths_and_resources: (profile.strengths_and_resources || []).map((item) => item.title),
    needs_and_preferences: (profile.needs_and_preferences || []).map((item) => item.title),
    communication_preferences: profile.communication_preferences || [],
    multimodal_observations: (profile.multimodal_observations || []).slice(0, 5).map((item) => ({
      contribution_to_profile: item.contribution_to_profile,
      uncertainty: item.uncertainty
    })),
    uncertainties: profile.uncertainties || []
  }
}
