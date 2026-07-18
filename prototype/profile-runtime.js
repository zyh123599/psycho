import { analyzeProfile, getCapabilities } from "./api-client.js"

export const AI_CONSENT_STORAGE_KEY = "xinchao.ai-consent.v1"
export const PROFILE_STORAGE_KEY = "xinchao.reflective-profile.v1"
export const AI_POLICY_VERSION = "2026-07-18"

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

function readJson(key) {
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch (_error) {
    return null
  }
}

function writeJson(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch (_error) {
    return false
  }
}

function removeStored(key) {
  try {
    window.localStorage.removeItem(key)
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

function validStoredProfile(value) {
  return Boolean(
    value &&
    value.local_profile_version === "1.0" &&
    typeof value.profile_id === "string" &&
    typeof value.generated_at === "string" &&
    value.profile &&
    typeof value.profile.headline === "string" &&
    typeof value.profile.summary === "string"
  )
}

function stripInsightEvidence(insight) {
  return {
    title: insight.title,
    description: insight.description,
    confidence: insight.confidence,
    uncertainty: insight.uncertainty,
    evidence_source_ids: Array.isArray(insight.evidence)
      ? insight.evidence.map((item) => item.source_id).filter(Boolean)
      : []
  }
}

function sanitizeProfileEnvelope(response) {
  const profile = response.profile
  const mapInsights = (items) => Array.isArray(items) ? items.map(stripInsightEvidence) : []
  return {
    local_profile_version: "1.0",
    profile_id: response.profile_id,
    generated_at: response.generated_at,
    model: response.model,
    modalities_used: Array.isArray(response.modalities_used) ? response.modalities_used : [],
    profile: {
      analysis_status: profile.analysis_status,
      headline: profile.headline,
      summary: profile.summary,
      current_state: mapInsights(profile.current_state),
      recurring_patterns: mapInsights(profile.recurring_patterns),
      strengths_and_resources: mapInsights(profile.strengths_and_resources),
      needs_and_preferences: mapInsights(profile.needs_and_preferences),
      communication_preferences: Array.isArray(profile.communication_preferences)
        ? profile.communication_preferences.slice(0, 5)
        : [],
      gentle_actions: Array.isArray(profile.gentle_actions)
        ? profile.gentle_actions.map((item) => ({
          title: item.title,
          action: item.action,
          rationale: item.rationale
        }))
        : [],
      reflection_questions: Array.isArray(profile.reflection_questions)
        ? profile.reflection_questions.slice(0, 4)
        : [],
      uncertainties: Array.isArray(profile.uncertainties) ? profile.uncertainties.slice(0, 6) : []
    }
  }
}

export class ProfileRuntime {
  constructor({ snapshot, onProfile = () => {}, onStatus = () => {} }) {
    this.snapshot = snapshot
    this.onProfile = onProfile
    this.onStatus = onStatus
    this.consent = normalizeConsent(readJson(AI_CONSENT_STORAGE_KEY))
    const stored = readJson(PROFILE_STORAGE_KEY)
    this.profileEnvelope = validStoredProfile(stored) ? stored : null
    this.capabilities = { ...DEFAULT_API_CAPABILITIES }
    this.running = null
    this.queuedReason = null
    this.controller = null
  }

  async initialize() {
    try {
      const capabilities = await getCapabilities({ timeoutMs: 5000 })
      this.capabilities = {
        ...DEFAULT_API_CAPABILITIES,
        ...capabilities,
        accepted_image_types: Array.isArray(capabilities.accepted_image_types)
          ? capabilities.accepted_image_types
          : DEFAULT_API_CAPABILITIES.accepted_image_types
      }
    } catch (_error) {
      this.capabilities = { ...DEFAULT_API_CAPABILITIES }
    }
    const message = this.consent.profilePersonalization
      ? (this.profileEnvelope ? "已加载本机结构化画像" : "持续画像已启用，等待新的可用线索")
      : (this.consent.serviceProcessing ? "AI 服务已启用；持续画像未启用" : "AI 尚未启用")
    this.onStatus({ state: "idle", message })
    return this.capabilities
  }

  setConsent(changes) {
    this.consent = normalizeConsent({ ...this.consent, ...changes, prompted: true })
    writeJson(AI_CONSENT_STORAGE_KEY, this.consent)
    if (!this.consent.serviceProcessing) {
      this.queuedReason = null
      if (this.controller) this.controller.abort()
    }
    this.onStatus({ state: "consent", message: "AI 授权设置已更新" })
    return this.consent
  }

  clearProfile() {
    this.profileEnvelope = null
    removeStored(PROFILE_STORAGE_KEY)
    this.onProfile(null, "cleared", null)
    this.onStatus({ state: "idle", message: "本机结构化画像已删除" })
  }

  refresh(reason = "interaction") {
    if (!this.consent.serviceProcessing || !this.consent.profilePersonalization) {
      return Promise.resolve(null)
    }
    if (this.running) {
      this.queuedReason = reason
      this.onStatus({ state: "queued", message: "新变化已合并到下一次画像更新", reason })
      return this.running
    }
    this.running = this.#run(reason)
    return this.running
  }

  async #run(reason) {
    this.controller = new AbortController()
    this.onStatus({ state: "updating", message: "正在后台更新本机画像…", reason })
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
      const response = await analyzeProfile({
        ...request,
        signal: this.controller.signal
      })
      if (!this.consent.profilePersonalization) return null
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
      const sanitized = sanitizeProfileEnvelope(response)
      this.profileEnvelope = sanitized
      writeJson(PROFILE_STORAGE_KEY, sanitized)
      this.onProfile(sanitized, reason, response)
      this.onStatus({
        state: "ready",
        message: "画像已在后台更新；原始输入未写入本机画像",
        reason,
        generatedAt: sanitized.generated_at
      })
      return sanitized
    } catch (error) {
      if (error && (error.name === "AbortError" || error.code === "client_aborted")) {
        this.onStatus({ state: "idle", message: "画像更新已取消", reason })
        return null
      }
      this.onStatus({
        state: "error",
        message: error && error.message ? error.message : "画像更新暂时失败",
        reason,
        error
      })
      return null
    } finally {
      this.controller = null
      this.running = null
      const queued = this.queuedReason
      this.queuedReason = null
      if (queued && this.consent.profilePersonalization) {
        window.queueMicrotask(() => this.refresh(queued))
      }
    }
  }
}

function uniqueStrings(items, limit, maxLength = 120) {
  const result = []
  items.forEach((item) => {
    if (typeof item !== "string") return
    const normalized = item.trim().replace(/\s+/g, " ").slice(0, maxLength)
    if (normalized && !result.includes(normalized)) result.push(normalized)
  })
  return result.slice(0, limit)
}

export function deriveThemeCandidates(envelope, fallback = []) {
  const profile = envelope && envelope.profile
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
  const actions = envelope && envelope.profile && envelope.profile.gentle_actions
  if (!Array.isArray(actions)) return []
  return actions.slice(0, 3).map((item, index) => ({
    id: `profile-action-${index}`,
    label: item.action.slice(0, 180),
    title: item.title.slice(0, 100),
    rationale: item.rationale.slice(0, 180)
  }))
}

export function deriveProfileReport(envelope, date) {
  const profile = envelope && envelope.profile
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
    mode: "AI 画像日报 · 本机",
    date
  }
}

export function deriveProfileEchoes(envelope) {
  const profile = envelope && envelope.profile
  if (!profile) return []
  const strengths = (profile.strengths_and_resources || []).map((item) => item.title)
  return uniqueStrings([
    profile.headline,
    ...strengths.map((item) => `我愿意记得：${item}。`)
  ], 2, 120)
}

export function companionProfileContext(envelope) {
  const profile = envelope && envelope.profile
  if (!profile) return null
  return {
    profile_id: envelope.profile_id,
    generated_at: envelope.generated_at,
    headline: profile.headline,
    summary: profile.summary,
    communication_preferences: profile.communication_preferences || [],
    needs_and_preferences: (profile.needs_and_preferences || []).map((item) => item.title),
    gentle_actions: (profile.gentle_actions || []).map((item) => item.action),
    uncertainties: profile.uncertainties || []
  }
}
