import {
  ApiError,
  clearApiSettings,
  generateMonthlyReflection,
  generateNarrative,
  hasApiSettings,
  loadApiSettings,
  saveApiSettings,
  sendCompanionMessage,
  testApiConnection
} from "./api-client.js"
import {
  ProfileRuntime,
  companionProfileContext,
  deriveProfileActions,
  deriveProfileEchoes,
  deriveProfileReport,
  deriveThemeCandidates,
  evidenceFingerprint,
  narrativeProfileContext,
  profileContextForModel
} from "./profile-runtime.js"
import {
  AsrError,
  RealtimeAsrSession,
  asrErrorMessage,
  clearAsrSettings,
  hasAsrSettings,
  loadAsrSettings,
  loadSavedAsrSettings,
  saveAsrSettings,
  testAsrConnection
} from "./asr-client.js"

"use strict"

const STORAGE_KEY = "xinchao.future-echoes.v1"
const CARD_STORAGE_KEY = "xinchao.tide-cards.v1"
const QUICK_NOTE_MAX_LENGTH = 200
const QUICK_NOTE_LIMIT = 365
const QUICK_NOTE_STORAGE_KEY = "xinchao.quick-notes.v1"
const MONTHLY_MEMORY_STORAGE_KEY = "xinchao.monthly-memory.v1"
const ANSWER_BOOK_STORAGE_KEY = "xinchao.answer-book.v1"
const ONBOARDING_STORAGE_KEY = "xinchao.onboarding.v1"
const GAME_TUTORIAL_STORAGE_KEY = "xinchao.game-tutorial.v1"
const QUICK_NOTE_IMAGE_MAX_DATA_LENGTH = 650000
const REPORT_FEEDBACK_STORAGE_KEY = "xinchao.report-feedback.v1"
const DAY_MS = 24 * 60 * 60 * 1000

const answerBookCards = [
  "先把最急的声音放低一点，再听真正重要的那一个。",
  "答案不一定在更用力之后，也可能在停一下之后。",
  "今天适合把问题缩小，而不是把自己逼大。",
  "允许一件事暂时没有结论，它仍然可以向前。",
  "你已经知道一部分答案，只是还需要一点安静。",
  "先照顾能被照顾的那一小块，其他可以晚一点。",
  "如果两条路都不确定，选择更能保留余力的那条。",
  "不必证明感受合理，先承认它正在这里。",
  "今天的转机，也许是一句更诚实的话。",
  "把下一步变得足够小，小到此刻就能开始。",
  "有些答案不是找到的，是在生活里慢慢长出来的。",
  "先问自己想守住什么，再决定需要放下什么。"
]

const defaultCards = [
  {
    speaker: "叙事向导 · 林岚",
    role: "陪你换一个角度",
    portrait: "岚",
    tone: "guide",
    prompt: "提交之前，你又发现一个不太确定的地方。此刻，你更想怎么做？",
    whisper: "确定感很诱人，但它不一定会在下一次检查后出现。",
    left: {
      label: "再检查一次",
      result: "你选择多争取一点确定感。",
      signals: { certainty: 2, rest: -1, connection: 0, agency: 0 }
    },
    right: {
      label: "先交出够用版",
      result: "你给“已经够用”留了一个位置。",
      signals: { certainty: -1, rest: 1, connection: 0, agency: 2 }
    }
  },
  {
    speaker: "身体",
    role: "一直在替你记得",
    portrait: "息",
    tone: "body",
    prompt: "肩膀已经绷紧很久了，可事情还没有做完。你会怎样回应这个信号？",
    whisper: "身体没有催你回答，它只是把消息送到。",
    left: {
      label: "做完再休息",
      result: "你决定先守住事情的进度。",
      signals: { certainty: 1, rest: -2, connection: 0, agency: 0 }
    },
    right: {
      label: "先离开两分钟",
      result: "事情仍在那里，你先把自己接了回来。",
      signals: { certainty: 0, rest: 2, connection: 0, agency: 1 }
    }
  },
  {
    speaker: "阿澄",
    role: "一位愿意听的朋友",
    portrait: "澄",
    tone: "friend",
    prompt: "朋友问你最近怎么样。你知道自己并不轻松，却还没有想好要说多少。",
    whisper: "表达不必一次完成，关系也可以从一句话开始。",
    left: {
      label: "说我没事",
      result: "你先保留了自己的空间。",
      signals: { certainty: 1, rest: 0, connection: -2, agency: 0 }
    },
    right: {
      label: "只说一点点",
      result: "你让真实近况有了一个很小的出口。",
      signals: { certainty: 0, rest: 0, connection: 2, agency: 1 }
    }
  },
  {
    speaker: "内在的高标准",
    role: "总想替你避开失望",
    portrait: "准",
    tone: "standard",
    prompt: "它说：“如果没有做到最好，就先别让别人看见。”你想怎样接住这句话？",
    whisper: "严格有时是一种保护，只是代价也会被一起带来。",
    left: {
      label: "听它的，继续改",
      result: "熟悉的保护方式再次接管了方向。",
      signals: { certainty: 2, rest: -1, connection: -1, agency: 0 }
    },
    right: {
      label: "问它在怕什么",
      result: "你没有赶走它，只是把选择权拿回来一点。",
      signals: { certainty: -1, rest: 1, connection: 0, agency: 2 }
    }
  },
  {
    speaker: "明天",
    role: "一个还没有发生的时刻",
    portrait: "明",
    tone: "future",
    prompt: "你无法保证结果，却可以决定今晚怎样结束。哪一种更接近此刻的你？",
    whisper: "不确定不会因为想得更久就自动消失。",
    left: {
      label: "把所有可能想完",
      result: "你试着用准备回应未知。",
      signals: { certainty: 2, rest: -2, connection: 0, agency: 0 }
    },
    right: {
      label: "给今天一个停点",
      result: "你没有消除未知，但划出了今晚的边界。",
      signals: { certainty: -1, rest: 2, connection: 0, agency: 2 }
    }
  },
  {
    speaker: "此刻的你",
    role: "拥有最后决定的人",
    portrait: "我",
    tone: "self",
    prompt: "走到这里，你想把哪一种态度带出这一章？",
    whisper: "这不是结论，只是今天愿意尝试的一种方向。",
    left: {
      label: "再等等，想清楚",
      result: "你为理解自己多留了一点时间。",
      signals: { certainty: 1, rest: 0, connection: 0, agency: -1 }
    },
    right: {
      label: "先走一小步",
      result: "你允许行动比答案更小，也更具体。",
      signals: { certainty: -1, rest: 1, connection: 0, agency: 2 }
    }
  }
]

let cards = defaultCards

const genericThemes = [
  "我想看看，为什么总担心自己做得不够好",
  "我想知道，为什么明明很累却不敢停下来",
  "我想梳理，怎样更真实地表达自己的需要"
]

const themeRules = [
  {
    words: ["工作", "汇报", "检查", "出错", "错误", "完美", "不够", "做好", "搞砸"],
    theme: "我想看看，为什么总担心自己做得不够好"
  },
  {
    words: ["累", "休息", "睡", "撑", "停", "疲惫", "没力气", "肩膀"],
    theme: "我想知道，为什么明明很累却不敢停下来"
  },
  {
    words: ["朋友", "关系", "说", "拒绝", "麻烦", "孤单", "理解", "联系"],
    theme: "我想梳理，怎样更真实地表达自己的需要"
  },
  {
    words: ["选择", "决定", "犹豫", "后悔", "确定", "怎么办", "未来"],
    theme: "我想看清，在不确定里我真正想守住什么"
  }
]

const actionCopy = {
  "one-check": {
    label: "提交前，只做最后一次检查",
    rationale: "给“已经够用”一个明确的停点"
  },
  release: {
    label: "离开屏幕两分钟，松开肩膀",
    rationale: "先让身体收到“可以暂停”的信号"
  },
  "reach-out": {
    label: "给信任的人发一句真实近况",
    rationale: "让关系从一小句真实的话开始"
  }
}

const signalRecommendation = {
  certainty: {
    action: "one-check",
    copy: "刚才你几次选择多确认一下。可以试着把检查次数说清楚，让“够用”有一个看得见的停点。"
  },
  rest: {
    action: "release",
    copy: "刚才你几次为暂停留出了空间。先用两分钟回应身体，可能是此刻负担最小的一步。"
  },
  connection: {
    action: "reach-out",
    copy: "刚才你为真实表达留了一个入口。把近况缩成一句话，会比解释全部更容易开始。"
  },
  agency: {
    action: "one-check",
    copy: "刚才你更愿意保留自己的决定权。给任务设一个明确停点，能让这份主动更具体。"
  }
}

const TIDE_START = 32
const TIDE_THRESHOLD = 88

const tideMeta = {
  insight: {
    label: "觉察",
    symbol: "◐",
    description: "辨认念头、感受与正在发生的模式",
    quotes: [
      "看见正在发生什么，本身就是一点变化。",
      "你不必马上解释自己，先准确地看见就好。",
      "当一个念头被看见，它就不再等于全部的你。"
    ]
  },
  grounding: {
    label: "安定",
    symbol: "⌁",
    description: "为身体、边界与当下留出落脚处",
    quotes: [
      "先让此刻有地方落脚，答案可以晚一点来。",
      "暂停不是离开生活，是把自己也放回生活里。",
      "你可以先稳稳地站在这里，再决定下一步。"
    ]
  },
  connection: {
    label: "联结",
    symbol: "∞",
    description: "与他人，也与内在不同的声音保持联系",
    quotes: [
      "靠近不必一次说完，一句真实也能成为入口。",
      "被听见之前，你可以只说愿意说的那一点。",
      "关系不要求你立刻完整，真实的一小部分也可以。"
    ]
  },
  vitality: {
    label: "精力",
    symbol: "✦",
    description: "照顾当下可用的力气，也允许疲惫存在",
    quotes: [
      "今天留下的一点力气，也属于完成的一部分。",
      "行动不必宏大，留有余力也是一种前进。",
      "不必把力气用尽，才算认真地生活。"
    ]
  }
}

const tideEffects = [
  {
    left: { insight: 28, grounding: 8 },
    right: { vitality: 28, grounding: 12 }
  },
  {
    left: { vitality: 28, insight: 10 },
    right: { grounding: 30, vitality: 10 }
  },
  {
    left: { grounding: 28, insight: 10 },
    right: { connection: 30, insight: 10 }
  },
  {
    left: { insight: 30, vitality: 8 },
    right: { connection: 28, insight: 14 }
  },
  {
    left: { insight: 30, grounding: 8 },
    right: { grounding: 30, vitality: 12 }
  },
  {
    left: { insight: 28, grounding: 12 },
    right: { vitality: 30, grounding: 10 }
  }
]

const neutralTideEffect = { insight: 20, grounding: 8 }

const dailyReportVariants = {
  generic: {
    headline: "今天似乎有一点向前的冲劲，也需要给自己留些余地。",
    basis: ["先聚焦一件事", "给身体留一个停点"],
    quote: "今天不用一次走完，只要把下一步放稳。",
    summary: "今天从几件很小的生活事开始照顾自己就好。不用全部做到，挑一件此刻最顺手的带走。",
    suggestions: [
      ["穿搭", "选一件让身体舒服的衣服；冷热不确定时，带一层能随时穿脱的薄外套。"],
      ["饮品", "给自己准备一杯温水或清淡茶饮，放在伸手可及的地方，想起来就喝两口。"],
      ["社交", "今天只联系一个让你不必逞强的人，哪怕只是发一句简单的近况。"],
      ["向内", "留五分钟不接收新信息，看看此刻更需要被照顾的是身体、情绪还是任务。"],
      ["行动", "把手头的事写成三行，只圈出今天最重要的一件，先做十分钟。"]
    ]
  },
  insight: {
    headline: "今天很适合看清重点，但不必把每个念头都解释完。",
    basis: ["近期主动收藏了觉察潮笺", "这类潮笺靠近观察与命名"],
    quote: "先把问题照亮一角，答案可以慢一点来。",
    summary: "今天可以把生活调得清爽一点，让脑中的声音有地方落下。不用急着想明白全部，只照顾最靠近你的那一件。",
    suggestions: [
      ["穿搭", "选颜色和层次都简单的衣服，少做一个决定，也给思绪留一点空白。"],
      ["饮品", "准备一杯温热、味道清淡的饮品；念头变密时，先慢慢喝一口再继续。"],
      ["社交", "想表达时可以从“我最近注意到……”开始，不必马上组织成完整结论。"],
      ["向内", "把最反复出现的念头写成一句话，再补上一个最接近的感受词。"],
      ["行动", "只挑一个问题看十五分钟，时间到了先去做一件不需要答案的小事。"]
    ]
  },
  grounding: {
    headline: "今天适合把步子放稳一点，先照顾身体和边界。",
    basis: ["近期主动收藏了安定潮笺", "这类潮笺靠近身体与边界"],
    quote: "先让脚底找到地面，答案可以晚一点来。",
    summary: "今天适合让身体先有着落，再处理外面的声音。把步子放稳，不代表你停在原地。",
    suggestions: [
      ["穿搭", "优先选不勒身体的衣服和好走的鞋，让肩颈、腰腹和脚底都轻松一点。"],
      ["饮品", "第一杯先喝几口温水，再决定要不要咖啡或浓茶，不急着把自己催醒。"],
      ["社交", "遇到临时请求，可以先说“让我看一下今天的安排”，不用立刻答应。"],
      ["向内", "坐下时感受脚底和椅子的支撑，慢慢呼气三次，让身体先回到这里。"],
      ["行动", "在两件事之间留十分钟空隙，不把所有安排首尾相接。"]
    ]
  },
  connection: {
    headline: "今天可以靠近一点真实，也保留只说到这里的权利。",
    basis: ["近期主动收藏了联结潮笺", "这类潮笺靠近表达与关系"],
    quote: "真实不必一次说完，关系可以从一句话开始。",
    summary: "今天可以靠近一点人，也留一点空间给自己。真正的联结不需要你时刻热闹或把话一次说完。",
    suggestions: [
      ["穿搭", "带上一件让你觉得“很像自己”的小物或颜色，给今天一点熟悉的陪伴感。"],
      ["饮品", "如果要见人，选一杯自己熟悉的饮品，让聊天开始前先有一点安定。"],
      ["社交", "只联系一个真正想见或想念的人，发一句近况就够了，不必铺陈完整故事。"],
      ["向内", "在开口前问问自己：我希望被听见什么，又有哪些部分想暂时留给自己。"],
      ["行动", "把想说的话缩成一句，发送后先回到自己的生活，不把心悬在回复速度上。"]
    ]
  },
  vitality: {
    headline: "今天有一些向前的力量，也别忘了给自己留下余力。",
    basis: ["近期主动收藏了精力潮笺", "这类潮笺靠近小步行动与恢复"],
    quote: "今天留下的一点力气，也属于完成的一部分。",
    summary: "今天有一点适合向前的力量，但不必把它一次用完。留下来的余力，也会照顾明天的你。",
    suggestions: [
      ["穿搭", "选轻便、方便活动的衣服；包里少带一件不必要的东西，也是在给身体减负。"],
      ["饮品", "开始忙之前先把水放到手边，别等到口渴或疲惫时才想起补充。"],
      ["社交", "把交流留给真正重要的人和事，今天不必回应每一个群聊与邀约。"],
      ["向内", "开始下一件事前停一下，问自己现在更适合推进，还是先恢复一点力气。"],
      ["行动", "只推进一个核心任务，完成一个清楚的小节点后，就允许自己停下来。"]
    ]
  }
}

function createInitialTides() {
  return Object.keys(tideMeta).reduce((levels, key) => {
    levels[key] = TIDE_START
    return levels
  }, {})
}

const byId = (id) => document.getElementById(id)
const screens = Array.from(document.querySelectorAll(".screen"))
const bottomNav = byId("bottom-nav")
const backgroundMusic = byId("background-music")
const backgroundMusicToggle = byId("background-music-toggle")
const storyCard = byId("story-card")
const leftPreview = byId("left-preview")
const rightPreview = byId("right-preview")
const onboardingModal = byId("onboarding-modal")
const gameTutorialModal = byId("game-tutorial-modal")
const voiceModal = byId("voice-modal")
const safetyModal = byId("safety-modal")
const aiConsentModal = byId("ai-consent-modal")
const tideModal = byId("tide-modal")
const cardDetailModal = byId("card-detail-modal")
const topLevelScreens = new Set(["today-screen", "thoughts-screen", "chat-screen", "cards-screen", "echoes-screen", "settings-screen"])
const musicControlScreens = new Set(["today-screen", "thoughts-screen", "cards-screen", "echoes-screen", "settings-screen"])

function createFreshFlow() {
  return {
    notes: ["", ""],
    personalizeNotes: true,
    images: [],
    profiledImageSignatures: [],
    imageRightsConfirmed: false,
    imageError: "",
    themeCandidates: [],
    selectedTheme: "",
    themeSource: "",
    narrativeState: "fallback",
    narrativeMessage: "当前使用内置叙事；配置并启用 AI 后可结合画像生成。",
    narrativeRequest: 0,
    currentCard: 0,
    choices: Array(cards.length).fill(null),
    signals: { certainty: 0, rest: 0, connection: 0, agency: 0 },
    tides: createInitialTides(),
    unlockedTides: [],
    pendingTideQuotes: [],
    activeTideQuote: null,
    keptTideQuotes: [],
    cardStorageFailed: false,
    chatMode: "standalone",
    chatMessages: [],
    chatBusy: false,
    chatCrisis: false,
    chatSeed: "",
    chatSuggestedPrompts: [],
    selectedAction: "",
    selectedEcho: "",
    echoSource: "",
    echoDelay: 1,
    saveEcho: false,
    savedEchoThisRun: false
  }
}

let flow = createFreshFlow()
let activeScreenId = "today-screen"
let locked = false
let dragging = false
let dragStartX = 0
let dragX = 0
let onboardingReturnFocus = null
let gameTutorialReturnFocus = null
let voiceModalReturnFocus = null
let cardDetailReturnFocus = null
let quickNoteRecords = []
let quickNoteDeckOffset = 0
let pendingQuickNoteImage = ""
let pendingQuickNoteVoiceDuration = 0
let quickNoteVoiceStartedAt = 0
let quickNoteRecordingTimer = null
const profiledQuickNoteImageSourceIds = new Set()
let voiceInputActive = false
let activeAsrSession = null
let activeAsrOwner = ""
let activeAsrBaseText = ""
let activeAsrTranscript = ""
let activeAsrAutoStopTimer = null
let chatDraftFromVoice = false
let asrSettingsTestAbortController = null
let ephemeralAnswerRecord = null
let memoryMonthCursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
let memorySelectedDateKey = ""
let memoryReflectionAbortController = null
let memoryReflectionRequest = 0
let memoryReflectionRunningFingerprint = ""
const memoryReflectionFailedFingerprints = new Set()
let aiConsentReturnFocus = null
let pendingAiConsentResolution = null
let pendingAiConsentPromise = null
let chatAbortController = null
let narrativeAbortController = null
let latestProfileStatus = { state: "idle", message: "尚未启用持续画像" }
const runtimeTimers = new Set()

const profileRuntime = new ProfileRuntime({
  snapshot: buildProfileSnapshot,
  onProfile: handleProfileUpdated,
  onStatus: handleProfileStatus
})

function schedule(callback, delay) {
  const timer = window.setTimeout(() => {
    runtimeTimers.delete(timer)
    callback()
  }, delay)
  runtimeTimers.add(timer)
  return timer
}

function cancelRuntimeTimers() {
  runtimeTimers.forEach((timer) => window.clearTimeout(timer))
  runtimeTimers.clear()
}

function activeProfileEnvelope() {
  return profileRuntime.consent.profilePersonalization
    ? profileRuntime.profileEnvelope
    : null
}

function readReportFeedback() {
  try {
    const value = window.localStorage.getItem(REPORT_FEEDBACK_STORAGE_KEY)
    return value === "helpful" || value === "not-me" ? value : null
  } catch (_error) {
    return null
  }
}

function writeReportFeedback(value) {
  try {
    window.localStorage.setItem(REPORT_FEEDBACK_STORAGE_KEY, value)
  } catch (_error) {
    // 反馈仍在当前界面生效；本地存储不可用时不阻断体验。
  }
}

function requestId(prefix) {
  const random = Math.random().toString(36).slice(2, 9)
  return `${prefix}-${Date.now().toString(36)}-${random}`
}

function imageSignature(file) {
  return [file.name, file.type, file.size, file.lastModified].join(":")
}

function createImageEntry(file) {
  return {
    file,
    signature: imageSignature(file),
    sourceId: requestId("image")
  }
}

function quickNoteImageEntry(record) {
  const match = typeof record.imageData === "string"
    ? record.imageData.match(/^data:([^;,]+);base64,(.+)$/)
    : null
  if (!match) return null
  try {
    const binary = window.atob(match[2])
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
    return {
      file: new Blob([bytes], { type: match[1] }),
      signature: `quick-note-image:${record.id}`,
      sourceId: `quick-note-image:${record.id}`,
      context: "用户主动提交的独立图片闪念；只读取明确文字、作品、物体和语境，不根据人脸、身体、穿着或外貌推断心理属性。"
    }
  } catch (_error) {
    return null
  }
}

function profileFocusFor(reason) {
  const focuses = {
    notes: "根据用户刚刚主动提供的闪念、已确认语音转写和图片更新暂时性画像；转写可能有误，只给出可供用户自行确认的主题线索。",
    choices: "结合本章已确认主题和结构化选择信号，更新暂时性画像；不要把卡片选择解释为人格测评。",
    chat: "结合用户主动允许用于画像的近期对话表达和已确认语音转写，更新沟通偏好、当下需要和低负担行动；不要推断未提供的声音特征。",
    action: "结合用户主动选择或跳过的微行动，更新可执行偏好；不要把跳过解释为抵抗或问题。",
    feedback: "结合用户对日报表达方式的反馈调整不确定性和沟通偏好，不推断心理特征。",
    complete: "为本次章节形成连续但可修正的暂时性反思画像。"
  }
  return focuses[reason] || focuses.complete
}

function buildProfileSnapshot({ reason, previousProfile, capabilities }) {
  const texts = []
  const signals = []

  const recentQuickNotes = readQuickNotes().slice(0, 12)
  recentQuickNotes.slice(0, 6).forEach((record) => {
    const content = record.text.trim()
    if (!content) return
    texts.push({
      source_id: `quick-note:${record.id}`,
      source: record.voiceDuration > 0 ? "voice_transcript" : "note",
      content
    })
  })

  if (flow.personalizeNotes) {
    flow.notes.forEach((note, index) => {
      const content = note.trim()
      if (!content) return
      texts.push({ source_id: `note:${index + 1}`, source: "note", content })
    })
  }

  if (flow.selectedTheme) {
    texts.push({ source_id: "theme:confirmed", source: "theme", content: flow.selectedTheme })
  }

  const userMessages = flow.chatCrisis
    ? []
    : flow.chatMessages.filter((message) => message.role === "user").slice(-6)
  userMessages.forEach((message, index) => {
    texts.push({
      source_id: message.id ? `chat:${message.id}` : `response:${index + 1}`,
      source: message.inputMode === "voice_transcript" ? "voice_transcript" : "response",
      content: message.text
    })
  })

  flow.choices.forEach((choice, index) => {
    if (!choice) return
    signals.push({
      source_id: `choice:${index + 1}`,
      source: "card_choice",
      name: `chapter_card_${index + 1}`,
      value: choice.direction,
      context: choice.label
    })
  })

  if (flow.selectedAction) {
    const action = currentActionOptions().find((item) => item.id === flow.selectedAction)
    signals.push({
      source_id: "action:selected",
      source: "selected_action",
      name: "selected_micro_action",
      value: action ? action.label : "skipped_or_custom",
      context: action ? action.rationale : "用户没有选择预设行动"
    })
  }

  flow.keptTideQuotes.forEach((card, index) => {
    signals.push({
      source_id: `tidecard:${index + 1}`,
      source: "app_interaction",
      name: "kept_tide_card",
      value: card.id
    })
  })

  const feedback = readReportFeedback()
  if (feedback) {
    signals.push({
      source_id: "report:feedback",
      source: "app_interaction",
      name: "daily_report_feedback",
      value: feedback
    })
  }

  const maxImages = Math.max(0, Number(capabilities.max_images) || 0)
  const quickNoteImages = recentQuickNotes
    .filter((record) => record.imageRightsConfirmed === true)
    .map(quickNoteImageEntry)
    .filter(Boolean)
  const pendingQuickNoteImages = quickNoteImages
    .filter((entry) => !profiledQuickNoteImageSourceIds.has(entry.sourceId))
  const chapterImages = flow.personalizeNotes && flow.imageRightsConfirmed
    ? flow.images
      .filter((entry) => !flow.profiledImageSignatures.includes(entry.signature))
    : []
  const images = [...pendingQuickNoteImages, ...chapterImages].slice(0, maxImages)
  const image_contexts = images.map((entry) => ({
    source_id: entry.sourceId,
    signature: entry.signature,
    description: entry.context || "用户主动选择的个人记录图片；只读取其中明确文字、作品、物体或用户给出的语境，不根据人脸、身体、穿着或外貌推断心理属性。"
  }))
  const activeImageEvidence = images.map((entry) => ({
    source_id: entry.sourceId,
    signature: entry.signature
  }))

  if (texts.length === 0 && signals.length === 0 && images.length === 0) return null
  const fingerprint = evidenceFingerprint({
    texts,
    signals,
    active_images: activeImageEvidence
  })
  return {
    evidenceFingerprint: fingerprint,
    payload: {
      consent: {
        profile_generation: true,
        ai_processing: true,
        subject_is_requester: true,
        media_rights_confirmed: images.length > 0
      },
      locale: "zh-CN",
      client_request_id: requestId("profile"),
      analysis_focus: profileFocusFor(reason),
      texts,
      signals,
      image_contexts,
      previous_profile_context: profileContextForModel(previousProfile)
    },
    images
  }
}

function handleProfileStatus(status) {
  latestProfileStatus = status
  renderAiState()
}

function handleProfileUpdated(envelope, _reason, rawResponse) {
  const safetyLevel = rawResponse?.profile?.safety_notice?.level
  if (safetyLevel && safetyLevel !== "not_indicated") {
    openSafety(null)
    return
  }
  if (Array.isArray(rawResponse?.processed_image_source_ids)) {
    const processed = new Set(rawResponse.processed_image_source_ids)
    const signatures = flow.images
      .filter((entry) => processed.has(entry.sourceId))
      .map((entry) => entry.signature)
    flow.profiledImageSignatures = [...new Set([...flow.profiledImageSignatures, ...signatures])]
    processed.forEach((sourceId) => {
      if (sourceId.startsWith("quick-note-image:")) profiledQuickNoteImageSourceIds.add(sourceId)
    })
    const hasPendingQuickNoteImages = readQuickNotes().some((record) => (
      Boolean(record.imageData) &&
      record.imageRightsConfirmed === true &&
      !profiledQuickNoteImageSourceIds.has(`quick-note-image:${record.id}`)
    ))
    const hasPendingChapterImages = flow.personalizeNotes && flow.imageRightsConfirmed && flow.images.some((entry) => (
      !flow.profiledImageSignatures.includes(entry.signature)
    ))
    if (hasPendingQuickNoteImages || hasPendingChapterImages) void queueProfileRefresh("notes")
  }
  applyProfileToVisibleExperience(envelope)
}

function applyProfileToVisibleExperience(envelope) {
  if (!envelope) {
    renderAiState()
    renderTodayReport()
    return
  }
  if (activeScreenId === "theme-screen" && !flow.selectedTheme) {
    flow.themeCandidates = deriveThemeCandidates(envelope, generateLocalThemeCandidates())
    renderThemeOptions()
  }
  if (activeScreenId === "action-screen") renderActionRecommendation()
  if (activeScreenId === "echo-screen") renderEchoCandidates()
  if (activeScreenId === "overview-screen" && flow.choices.every((choice) => !choice)) {
    void generateNarrativeForFlow()
  }
  if (activeScreenId === "settings-screen") {
    renderInitialImpression()
    renderMemoryArchive()
  }
  renderTodayReport()
  renderAiState()
}

function queueProfileRefresh(reason) {
  return profileRuntime.refresh(reason)
}

function apiSettingsFromForm() {
  return {
    baseUrl: byId("custom-api-base-url").value,
    apiKey: byId("custom-api-key").value,
    model: byId("custom-api-model").value,
    imageDetail: byId("custom-api-image-detail").value
  }
}

function setApiSettingsStatus(message, state = "idle") {
  const node = byId("custom-api-status")
  if (!node) return
  node.textContent = message
  node.dataset.state = state
}

function renderApiSettings() {
  const settings = loadApiSettings()
  byId("custom-api-base-url").value = settings.baseUrl
  byId("custom-api-key").value = settings.apiKey
  byId("custom-api-model").value = settings.model
  byId("custom-api-image-detail").value = settings.imageDetail
  setApiSettingsStatus(
    hasApiSettings(settings)
      ? "配置只保存在这台设备；可先测试连接。"
      : "尚未配置。保存后，浏览器会直接向该端点发送请求。",
    hasApiSettings(settings) ? "ready" : "idle"
  )
}

function saveCustomApiSettings() {
  try {
    const settings = saveApiSettings(apiSettingsFromForm())
    renderApiSettings()
    setApiSettingsStatus(`已保存到本机：${settings.model}`, "ready")
    renderAiState()
    if (activeScreenId === "settings-screen") renderMemoryArchive()
  } catch (error) {
    setApiSettingsStatus(error?.message || "配置保存失败", "error")
  }
}

async function testCustomApiSettings() {
  const button = byId("custom-api-test")
  button.disabled = true
  setApiSettingsStatus("正在测试地址、鉴权与浏览器跨域访问…", "updating")
  try {
    const result = await testApiConnection({ settings: apiSettingsFromForm() })
    setApiSettingsStatus(
      result.modelAvailable
        ? "连接成功，当前模型可用。保存后即可启用 AI。"
        : "连接成功，但模型列表中未发现当前模型名；请核对后再保存。",
      result.modelAvailable ? "ready" : "warning"
    )
  } catch (error) {
    setApiSettingsStatus(error?.message || "连接测试失败", "error")
  } finally {
    button.disabled = false
  }
}

function clearCustomApiSettings() {
  memoryReflectionAbortController?.abort()
  memoryReflectionRequest += 1
  memoryReflectionRunningFingerprint = ""
  clearApiSettings()
  if (profileRuntime.consent.serviceProcessing) {
    profileRuntime.setConsent({ serviceProcessing: false, profilePersonalization: false })
  }
  renderApiSettings()
  setApiSettingsStatus("本机 API 地址、模型名和 Key 已清除；现有本机画像未自动删除。", "idle")
  renderAiState()
  if (activeScreenId === "settings-screen") renderMemoryArchive()
}

function asrSettingsFromForm() {
  return {
    appId: byId("custom-asr-app-id").value,
    apiKey: byId("custom-asr-api-key").value,
    apiSecret: byId("custom-asr-api-secret").value
  }
}

function setAsrSettingsStatus(message, state = "idle") {
  const node = byId("custom-asr-status")
  if (!node) return
  node.textContent = message
  node.dataset.state = state
}

function renderAsrSettings() {
  const saved = loadSavedAsrSettings()
  byId("custom-asr-app-id").value = saved.appId
  byId("custom-asr-api-key").value = saved.apiKey
  byId("custom-asr-api-secret").value = saved.apiSecret
  document.querySelectorAll("[data-credential-target]").forEach((button) => {
    const input = byId(button.dataset.credentialTarget)
    input.type = "password"
    button.textContent = "显示"
    button.setAttribute("aria-label", `显示 ${input.id.endsWith("secret") ? "APISecret" : "APIKey"}`)
  })
  if (hasAsrSettings(saved)) {
    setAsrSettingsStatus("自定义讯飞凭据已保存在这台设备；可先测试连接。", "ready")
  } else if (hasAsrSettings(loadAsrSettings())) {
    setAsrSettingsStatus("当前使用构建或运行时默认凭据；保存表单后会优先使用本机配置。", "warning")
  } else {
    setAsrSettingsStatus("尚未配置。保存后，三个现有麦克风入口会使用这组凭据。", "idle")
  }
}

function cancelAsrSettingsTest() {
  asrSettingsTestAbortController?.abort()
  asrSettingsTestAbortController = null
  byId("custom-asr-test").disabled = false
}

function saveCustomAsrSettings() {
  cancelAsrSettingsTest()
  try {
    saveAsrSettings(asrSettingsFromForm())
    renderAsrSettings()
    setAsrSettingsStatus("讯飞 APPID、APIKey 和 APISecret 已保存到本机。", "ready")
  } catch (error) {
    setAsrSettingsStatus(error?.message || "语音转写配置保存失败", "error")
  }
}

async function testCustomAsrSettings() {
  cancelAsrSettingsTest()
  const button = byId("custom-asr-test")
  const controller = new AbortController()
  asrSettingsTestAbortController = controller
  button.disabled = true
  setAsrSettingsStatus("正在测试签名与讯飞 WebSocket 连接；不会启用麦克风…", "updating")
  try {
    await testAsrConnection({ settings: asrSettingsFromForm(), signal: controller.signal })
    if (controller !== asrSettingsTestAbortController) return
    setAsrSettingsStatus("连接成功。保存后，现有麦克风入口即可使用。", "ready")
  } catch (error) {
    if (controller !== asrSettingsTestAbortController || error?.code === "asr_test_cancelled") return
    setAsrSettingsStatus(asrErrorMessage(error), "error")
  } finally {
    if (controller === asrSettingsTestAbortController) {
      asrSettingsTestAbortController = null
      button.disabled = false
    }
  }
}

function clearCustomAsrSettings() {
  cancelAsrSettingsTest()
  if (activeAsrSession) cancelActiveAsrImmediately(activeAsrOwner)
  clearAsrSettings()
  renderAsrSettings()
  setAsrSettingsStatus(
    hasAsrSettings(loadAsrSettings())
      ? "本机自定义凭据已清除；当前仍有构建或运行时默认凭据。"
      : "本机讯飞 APPID、APIKey 和 APISecret 已清除。",
    hasAsrSettings(loadAsrSettings()) ? "warning" : "idle"
  )
}

function toggleCredentialVisibility(event) {
  const button = event.currentTarget
  const input = byId(button.dataset.credentialTarget)
  const reveal = input.type === "password"
  input.type = reveal ? "text" : "password"
  button.textContent = reveal ? "隐藏" : "显示"
  const credential = input.id.endsWith("secret") ? "APISecret" : "APIKey"
  button.setAttribute("aria-label", `${reveal ? "隐藏" : "显示"} ${credential}`)
}

function renderAiState() {
  const consent = profileRuntime.consent
  const envelope = profileRuntime.profileEnvelope
  const serviceToggle = byId("ai-service-consent")
  const profileToggle = byId("ai-profile-consent")
  const configured = hasApiSettings()
  if (serviceToggle) {
    serviceToggle.checked = consent.serviceProcessing
    serviceToggle.disabled = !configured
  }
  if (profileToggle) {
    profileToggle.checked = consent.profilePersonalization
    profileToggle.disabled = !configured || !consent.serviceProcessing
  }

  const statusNodes = [byId("settings-ai-status"), byId("notes-ai-status")].filter(Boolean)
  statusNodes.forEach((node) => {
    node.textContent = latestProfileStatus.message
    node.dataset.state = latestProfileStatus.state
  })

  const preview = byId("settings-profile-preview")
  if (preview) {
    preview.hidden = !envelope
    if (envelope) {
      byId("settings-profile-headline").textContent = envelope.profile.headline
      byId("settings-profile-summary").textContent = envelope.profile.summary
      const observationCount = envelope.profile.multimodal_observations?.length || 0
      const modalityCopy = envelope.modalities_used?.includes("image")
        ? ` · 含 ${observationCount} 条图片/文本观察`
        : " · 当前来自文字与互动"
      byId("settings-profile-time").textContent = `最近更新：${new Intl.DateTimeFormat("zh-CN", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      }).format(new Date(envelope.generated_at))}${modalityCopy}`
    }
  }
  const clearButton = byId("settings-clear-profile")
  if (clearButton) clearButton.disabled = !envelope

  const privacyLine = byId("today-privacy-line")
  if (privacyLine) {
    privacyLine.lastChild.textContent = consent.serviceProcessing
      ? " AI 内容直达你配置的服务商；本机不保存原始聊天 · 随时可以关闭"
      : " AI 尚未启用；当前使用本地内容 · 随时可以停下"
  }
}

function requestAiConsent({ profileRequested = false, reason = "使用 AI 功能" } = {}) {
  const consent = profileRuntime.consent
  if (consent.serviceProcessing && (!profileRequested || consent.profilePersonalization)) {
    return Promise.resolve(consent)
  }
  if (pendingAiConsentPromise) return pendingAiConsentPromise

  aiConsentReturnFocus = document.activeElement
  byId("ai-consent-reason").textContent = reason
  const configured = hasApiSettings()
  byId("ai-consent-config-warning").hidden = configured
  byId("enable-ai-consent").disabled = false
  const profileCheckbox = byId("consent-profile-personalization")
  profileCheckbox.checked = consent.profilePersonalization
  byId("ai-profile-consent-row").classList.toggle("is-requested", profileRequested)
  aiConsentModal.hidden = false
  window.requestAnimationFrame(() => byId("enable-ai-consent").focus())

  pendingAiConsentPromise = new Promise((resolve) => {
    pendingAiConsentResolution = resolve
  })
  return pendingAiConsentPromise
}

function closeAiConsent({ accepted }) {
  if (aiConsentModal.hidden) return
  const requestedProfile = byId("consent-profile-personalization").checked
  if (accepted) {
    profileRuntime.setConsent({
      serviceProcessing: true,
      profilePersonalization: requestedProfile
    })
  } else {
    profileRuntime.setConsent({ prompted: true })
  }
  aiConsentModal.hidden = true
  renderAiState()
  const result = profileRuntime.consent
  if (pendingAiConsentResolution) pendingAiConsentResolution(result)
  pendingAiConsentResolution = null
  pendingAiConsentPromise = null
  const returnScreen = aiConsentReturnFocus && aiConsentReturnFocus.closest(".screen")
  if (aiConsentReturnFocus && aiConsentReturnFocus.isConnected && !returnScreen?.hidden) {
    aiConsentReturnFocus.focus({ preventScroll: true })
  } else {
    focusScreenHeading(byId(activeScreenId))
  }
  aiConsentReturnFocus = null
}

function goToApiSettings() {
  showScreen("connections-screen")
  const field = byId("custom-api-base-url")
  if (field) window.requestAnimationFrame(() => field.focus())
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function addNoteImages(fileList) {
  const capabilities = profileRuntime.capabilities
  const accepted = new Set(capabilities.accepted_image_types)
  const maxImages = Number(capabilities.max_images) || 4
  const maxBytes = Number(capabilities.max_image_bytes) || 8 * 1024 * 1024
  const next = [...flow.images]
  const errors = []

  Array.from(fileList).forEach((file) => {
    if (!accepted.has(file.type)) {
      errors.push(`${file.name} 格式不支持`)
      return
    }
    if (file.size > maxBytes) {
      errors.push(`${file.name} 超过 ${formatBytes(maxBytes)}`)
      return
    }
    if (next.length >= maxImages) {
      errors.push(`最多选择 ${maxImages} 张图片`)
      return
    }
    const signature = imageSignature(file)
    const duplicate = next.some((item) => item.signature === signature)
    if (!duplicate) next.push(createImageEntry(file))
  })

  flow.images = next
  flow.imageError = errors[0] || ""
  if (flow.images.length === 0) flow.imageRightsConfirmed = false
  renderNoteImages()
}

function renderNoteImages() {
  const list = byId("note-image-list")
  if (!list) return
  list.replaceChildren()
  flow.images.forEach((entry, index) => {
    const file = entry.file
    const item = document.createElement("div")
    item.className = "note-image-item"
    const copy = document.createElement("span")
    const name = document.createElement("strong")
    name.textContent = file.name
    const size = document.createElement("small")
    size.textContent = formatBytes(file.size)
    copy.append(name, size)
    const remove = document.createElement("button")
    remove.type = "button"
    remove.textContent = "×"
    remove.setAttribute("aria-label", `移除图片 ${file.name}`)
    remove.addEventListener("click", () => {
      flow.images.splice(index, 1)
      if (flow.images.length === 0) flow.imageRightsConfirmed = false
      renderNoteImages()
    })
    item.append(copy, remove)
    list.append(item)
  })

  const rightsRow = byId("image-rights-row")
  rightsRow.hidden = flow.images.length === 0
  byId("images-rights-confirmed").checked = flow.imageRightsConfirmed
  const status = byId("note-image-status")
  if (flow.imageError) {
    status.textContent = flow.imageError
    status.dataset.state = "error"
  } else if (flow.images.length > 0) {
    const pendingCount = flow.images.filter((entry) => !flow.profiledImageSignatures.includes(entry.signature)).length
    status.textContent = pendingCount > 0
      ? `已选择 ${flow.images.length} 张，其中 ${pendingCount} 张将在授权后发送一次；本机只保存模型形成的文字观察`
      : `这 ${flow.images.length} 张已形成文字观察；原图仍只在本次页面内存中`
    status.dataset.state = "ready"
  } else {
    status.textContent = `可选，最多 ${profileRuntime.capabilities.max_images} 张；图片不会写入本地存储`
    status.dataset.state = "idle"
  }
}

function renderEchoCandidates() {
  const candidates = buildEchoCandidates()
  document.querySelectorAll("[data-echo-index]").forEach((button) => {
    const index = Number(button.dataset.echoIndex)
    button.querySelector("strong").textContent = candidates[index] || "今天先不留下结论。"
  })
  updateEchoSelection()
}

function initializeAiIntegration() {
  renderApiSettings()
  renderAsrSettings()
  if (!hasApiSettings() && profileRuntime.consent.serviceProcessing) {
    profileRuntime.setConsent({ serviceProcessing: false, profilePersonalization: false })
  }
  renderAiState()
  renderNoteImages()
  profileRuntime.initialize().then(() => {
    renderNoteImages()
    renderAiState()
  })
}

function focusScreenHeading(screen) {
  const heading = screen.querySelector("h1[tabindex='-1']")
  if (!heading) return
  window.requestAnimationFrame(() => heading.focus({ preventScroll: true }))
}

function updateBottomNavigation(screenId) {
  bottomNav.hidden = !topLevelScreens.has(screenId)
  const musicSlot = byId(screenId)?.querySelector("[data-music-slot]")
  const showMusicControl = musicControlScreens.has(screenId) && musicSlot
  if (showMusicControl && backgroundMusicToggle.parentElement !== musicSlot) {
    musicSlot.prepend(backgroundMusicToggle)
  }
  backgroundMusicToggle.hidden = !showMusicControl
  bottomNav.querySelectorAll("[data-nav-target]").forEach((button) => {
    if (button.dataset.navTarget === screenId) {
      button.setAttribute("aria-current", "page")
    } else {
      button.removeAttribute("aria-current")
    }
  })
}

function syncBackgroundMusicButton() {
  const isPlaying = !backgroundMusic.paused
  backgroundMusicToggle.classList.toggle("is-playing", isPlaying)
  backgroundMusicToggle.setAttribute("aria-pressed", String(isPlaying))
  backgroundMusicToggle.setAttribute("aria-label", isPlaying ? "暂停雨声背景音乐" : "播放雨声背景音乐")
  byId("background-music-status").textContent = isPlaying ? "播放中" : "播放"
}

async function toggleBackgroundMusic() {
  if (backgroundMusic.paused) {
    backgroundMusic.volume = 0.22
    try {
      await backgroundMusic.play()
    } catch (_error) {
      backgroundMusicToggle.disabled = true
      backgroundMusicToggle.setAttribute("aria-label", "雨声背景音乐暂时无法播放")
      byId("background-music-status").textContent = "不可用"
      return
    }
  } else {
    backgroundMusic.pause()
  }
  syncBackgroundMusicButton()
}

function showScreen(screenOrId, options = {}) {
  cancelRuntimeTimers()
  const target = typeof screenOrId === "string" ? byId(screenOrId) : screenOrId
  if (!target) return
  if (activeScreenId === "chat-screen" && target.id !== "chat-screen") {
    if (["chat", "voice-modal"].includes(activeAsrOwner)) cancelActiveAsrImmediately(activeAsrOwner)
    if (chatAbortController) {
      chatAbortController.abort()
      chatAbortController = null
    }
    flow.chatBusy = false
    setVoiceInputState(false)
    if (flow.chatMode === "standalone") {
      flow.chatMessages = []
      flow.chatSeed = ""
      chatDraftFromVoice = false
      byId("chat-input").value = ""
    }
  }
  if (activeScreenId === "thoughts-screen" && target.id !== "thoughts-screen") {
    resetQuickNoteComposer()
  }

  screens.forEach((screen) => {
    screen.hidden = screen !== target
  })
  activeScreenId = target.id
  updateBottomNavigation(target.id)
  target.scrollTop = 0

  if (target.id === "today-screen") {
    updateDueEchoCard()
    renderTodayReport()
    renderAnswerBook()
  }
  if (target.id === "report-screen") renderDailyReport()
  if (target.id === "thoughts-screen") {
    renderQuickNotes()
    byId("quick-note-library-status").textContent = ""
  }
  if (target.id === "chat-screen") renderChat()
  if (target.id === "cards-screen") renderTideCardLibrary()
  if (target.id === "echoes-screen") renderEchoLibrary()
  if (["settings-screen", "connections-screen"].includes(target.id)) updateSettingsStorageState()
  if (options.focus !== false) focusScreenHeading(target)
}

function startFlow(seedNote = "") {
  narrativeAbortController?.abort()
  narrativeAbortController = null
  cards = defaultCards
  flow = createFreshFlow()
  if (seedNote.trim()) flow.notes = [seedNote.trim().slice(0, 120), ""]
  locked = false
  dragging = false
  tideModal.hidden = true
  byId("notes-personalize").checked = true
  byId("custom-theme").value = ""
  byId("custom-echo").value = ""
  byId("save-echo").checked = false
  renderNotes(seedNote.trim() ? 1 : -1)
  renderNoteImages()
  showScreen("notes-screen")
}

function startNewFlow() {
  startFlow()
}

function countFilledNotes() {
  return flow.notes.filter((note) => note.trim().length > 0).length
}

function updateNoteControls() {
  const filled = countFilledNotes()
  byId("add-note").disabled = flow.notes.length >= 4
  byId("notes-continue").disabled = filled < 2
  byId("notes-hint").textContent = filled < 2
    ? `再写 ${2 - filled} 张，就可以继续`
    : `已接住 ${filled} 张闪念，可以继续`
}

function renderNotes(focusIndex = -1) {
  const list = byId("note-list")
  list.replaceChildren()

  flow.notes.forEach((note, index) => {
    const item = document.createElement("div")
    item.className = "note-item"

    const number = document.createElement("span")
    number.className = "note-index"
    number.textContent = String(index + 1).padStart(2, "0")

    const input = document.createElement("textarea")
    input.className = "note-input"
    input.rows = 2
    input.maxLength = 120
    input.placeholder = index === 0 ? "例如：刚才又担心自己做得不够好" : "写下另一句掠过脑海的话"
    input.setAttribute("aria-label", `闪念便贴 ${index + 1}`)
    input.value = note
    input.addEventListener("input", () => {
      flow.notes[index] = input.value
      updateNoteControls()
    })

    const remove = document.createElement("button")
    remove.className = "remove-note"
    remove.type = "button"
    remove.textContent = "×"
    remove.setAttribute("aria-label", `删除第 ${index + 1} 张便贴`)
    remove.hidden = flow.notes.length <= 2
    remove.addEventListener("click", () => {
      if (flow.notes.length <= 2) return
      flow.notes.splice(index, 1)
      renderNotes(Math.min(index, flow.notes.length - 1))
    })

    item.append(number, input, remove)
    list.append(item)
  })

  updateNoteControls()
  if (focusIndex >= 0) {
    const inputs = list.querySelectorAll(".note-input")
    if (inputs[focusIndex]) inputs[focusIndex].focus()
  }
}

function generateLocalThemeCandidates() {
  if (!flow.personalizeNotes) return [...genericThemes]

  const source = flow.notes.map((note) => note.trim().toLowerCase()).join(" ")
  const ranked = themeRules
    .map((rule) => ({
      theme: rule.theme,
      score: rule.words.reduce((total, word) => total + (source.includes(word) ? 1 : 0), 0)
    }))
    .sort((a, b) => b.score - a.score)

  const candidates = []
  ranked.forEach(({ theme, score }) => {
    if (score > 0 && !candidates.includes(theme)) candidates.push(theme)
  })
  genericThemes.forEach((theme) => {
    if (!candidates.includes(theme)) candidates.push(theme)
  })
  return candidates.slice(0, 3)
}

function generateThemeCandidates() {
  const localCandidates = generateLocalThemeCandidates()
  if (!flow.personalizeNotes) return localCandidates
  return deriveThemeCandidates(activeProfileEnvelope(), localCandidates)
}

function updateThemeControls() {
  document.querySelectorAll("[data-theme-index]").forEach((button) => {
    const selected = flow.themeSource === "candidate" && flow.selectedTheme === button.querySelector("strong").textContent
    button.setAttribute("aria-pressed", String(selected))
    button.classList.toggle("is-selected", selected)
  })
  const hasCustomText = byId("custom-theme").value.trim().length > 0
  byId("choose-custom-theme").disabled = !hasCustomText
  byId("theme-continue").disabled = flow.selectedTheme.length === 0
  byId("theme-hint").textContent = flow.selectedTheme
    ? "这只是本次线索，你之后仍然可以重新选择"
    : "请选择或写下一条本次线索"
}

function renderThemeOptions() {
  if (flow.themeCandidates.length === 0) flow.themeCandidates = generateThemeCandidates()
  document.querySelectorAll("[data-theme-index]").forEach((button) => {
    const index = Number(button.dataset.themeIndex)
    button.querySelector("strong").textContent = flow.themeCandidates[index] || genericThemes[index]
  })
  updateThemeControls()
}

function narrativeText(value, fallback, maxLength = 300) {
  return typeof value === "string" && value.trim()
    ? value.trim().replace(/\s+/g, " ").slice(0, maxLength)
    : fallback
}

function mergeGeneratedCards(generatedCards) {
  return defaultCards.map((fallback, index) => {
    const generated = generatedCards[index] || {}
    return {
      speaker: narrativeText(generated.speaker, fallback.speaker, 40),
      role: narrativeText(generated.role, fallback.role, 60),
      portrait: narrativeText(generated.portrait, fallback.portrait, 1),
      tone: ["guide", "body", "friend", "standard", "future", "self"].includes(generated.tone)
        ? generated.tone
        : fallback.tone,
      prompt: narrativeText(generated.prompt, fallback.prompt, 260),
      whisper: narrativeText(generated.whisper, fallback.whisper, 180),
      left: {
        label: narrativeText(generated.left?.label, fallback.left.label, 40),
        result: narrativeText(generated.left?.result, fallback.left.result, 160),
        signals: fallback.left.signals
      },
      right: {
        label: narrativeText(generated.right?.label, fallback.right.label, 40),
        result: narrativeText(generated.right?.result, fallback.right.result, 160),
        signals: fallback.right.signals
      }
    }
  })
}

function renderNarrativeState() {
  const status = byId("narrative-status")
  if (status) {
    status.textContent = flow.narrativeMessage
    status.dataset.state = flow.narrativeState
  }
}

async function generateNarrativeForFlow() {
  if (!flow.selectedTheme || activeScreenId !== "overview-screen") return null
  if (flow.choices.some(Boolean)) return null
  if (!profileRuntime.consent.serviceProcessing || !hasApiSettings()) {
    flow.narrativeState = "fallback"
    flow.narrativeMessage = "当前使用内置叙事；可在“我的”配置并启用自定义 API。"
    renderNarrativeState()
    return null
  }

  narrativeAbortController?.abort()
  narrativeAbortController = new AbortController()
  const request = ++flow.narrativeRequest
  const theme = flow.selectedTheme
  const hadGeneratedCards = flow.narrativeState === "ready"
  flow.narrativeState = "updating"
  flow.narrativeMessage = activeProfileEnvelope()
    ? "正在后台结合本机画像生成这一章；你仍可返回修改主题。"
    : "正在后台根据本次主题生成这一章；画像准备好后还会继续修正。"
  renderNarrativeState()

  try {
    const response = await generateNarrative({
      theme,
      profileContext: narrativeProfileContext(activeProfileEnvelope()),
      signal: narrativeAbortController.signal
    })
    if (
      request !== flow.narrativeRequest ||
      theme !== flow.selectedTheme ||
      activeScreenId !== "overview-screen" ||
      flow.choices.some(Boolean)
    ) return null
    cards = mergeGeneratedCards(response.result.cards)
    flow.choices = Array(cards.length).fill(null)
    byId("overview-title").textContent = narrativeText(
      response.result.title,
      "在反复确认之前，先听见自己",
      90
    )
    byId("overview-narrative-intro").textContent = narrativeText(
      response.result.intro,
      "这六个情境会沿着本次线索展开，没有标准答案。",
      180
    )
    const includesImage = activeProfileEnvelope()?.modalities_used?.includes("image")
    flow.narrativeState = "ready"
    flow.narrativeMessage = includesImage
      ? "本章由自定义模型结合本机多模态文字画像生成；潮向规则仍由本地固定逻辑控制。"
      : "本章由自定义模型结合主题与本机文字画像生成；潮向规则仍由本地固定逻辑控制。"
    renderNarrativeState()
    return response
  } catch (error) {
    if (error instanceof ApiError && error.code === "client_aborted") return null
    if (!hadGeneratedCards) cards = defaultCards
    flow.narrativeState = hadGeneratedCards ? "ready" : "fallback"
    flow.narrativeMessage = hadGeneratedCards
      ? "画像更新后的叙事刷新暂时失败，已保留刚才生成的版本。"
      : `自定义叙事暂时不可用，已使用内置版本：${error?.message || "未知错误"}`
    renderNarrativeState()
    return null
  } finally {
    if (request === flow.narrativeRequest) narrativeAbortController = null
  }
}

function resetDownstreamFlow() {
  flow.currentCard = 0
  flow.choices = Array(cards.length).fill(null)
  flow.signals = { certainty: 0, rest: 0, connection: 0, agency: 0 }
  flow.tides = createInitialTides()
  flow.unlockedTides = []
  flow.pendingTideQuotes = []
  flow.activeTideQuote = null
  flow.keptTideQuotes = []
  flow.cardStorageFailed = false
  flow.chatMode = "flow"
  flow.chatMessages = []
  flow.chatBusy = false
  flow.chatSeed = ""
  flow.selectedAction = ""
  flow.selectedEcho = ""
  flow.echoSource = ""
  flow.echoDelay = 1
  flow.saveEcho = false
  flow.savedEchoThisRun = false
}

function showOverview() {
  narrativeAbortController?.abort()
  narrativeAbortController = null
  cards = defaultCards
  byId("overview-theme").textContent = `“${flow.selectedTheme}”`
  byId("overview-title").textContent = "在反复确认之前，先听见自己"
  byId("overview-narrative-intro").textContent = "这六个情境会沿着本次线索展开，没有标准答案。"
  flow.narrativeState = "fallback"
  flow.narrativeMessage = "当前使用内置叙事；正在检查是否可以调用你的自定义模型。"
  resetDownstreamFlow()
  showScreen("overview-screen")
  renderNarrativeState()
  void generateNarrativeForFlow()
}

function recomputeSignals() {
  const next = { certainty: 0, rest: 0, connection: 0, agency: 0 }
  flow.choices.forEach((decision, index) => {
    if (!decision) return
    const option = decision.direction === "neutral" ? null : cards[index][decision.direction]
    if (!option) {
      next.agency += 1
      return
    }
    Object.entries(option.signals).forEach(([key, value]) => {
      next[key] += value
    })
  })
  flow.signals = next
}

function tideEffectFor(cardIndex, direction) {
  if (direction === "neutral") return neutralTideEffect
  return tideEffects[cardIndex] && tideEffects[cardIndex][direction]
    ? tideEffects[cardIndex][direction]
    : neutralTideEffect
}

function describeTideEffect(effect) {
  return Object.entries(effect)
    .sort((a, b) => b[1] - a[1])
    .map(([key]) => `${tideMeta[key].symbol} ${tideMeta[key].label}`)
    .join(" · ")
}

function renderTideMeters(stirredKeys = []) {
  Object.entries(tideMeta).forEach(([key, meta]) => {
    const meter = document.querySelector(`[data-tide="${key}"]`)
    if (!meter) return
    const value = Math.round(flow.tides[key])
    const fill = meter.querySelector(".tide-track span")
    fill.style.width = `${value}%`
    meter.setAttribute("aria-valuenow", String(value))
    meter.setAttribute("aria-valuetext", value >= 100 ? `${meta.label}已经满格` : `${meta.label}正在积累`)
    meter.classList.toggle("is-full", flow.unlockedTides.includes(key))
    meter.classList.remove("is-stirred")

    if (stirredKeys.includes(key)) {
      void meter.offsetWidth
      meter.classList.add("is-stirred")
      schedule(() => meter.classList.remove("is-stirred"), 720)
    }
  })
}

function buildTideQuote(key) {
  const meta = tideMeta[key]
  const unlockedIndex = flow.unlockedTides.indexOf(key)
  const quoteIndex = (flow.currentCard + Math.max(0, unlockedIndex)) % meta.quotes.length
  return {
    id: `${key}-${quoteIndex}`,
    key,
    label: meta.label,
    symbol: meta.symbol,
    description: meta.description,
    text: meta.quotes[quoteIndex]
  }
}

function allTideCards() {
  return Object.entries(tideMeta).flatMap(([key, meta]) => (
    meta.quotes.map((text, quoteIndex) => ({
      id: `${key}-${quoteIndex}`,
      key,
      quoteIndex,
      label: meta.label,
      symbol: meta.symbol,
      description: meta.description,
      text
    }))
  ))
}

function tideCardFromId(id) {
  return allTideCards().find((card) => card.id === id) || null
}

function isValidTideCardRecord(record) {
  return Boolean(
    record &&
    typeof record.id === "string" &&
    tideCardFromId(record.id) &&
    Number.isFinite(record.collectedAt)
  )
}

function readTideCardRecords() {
  try {
    const raw = window.localStorage.getItem(CARD_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const seen = new Set()
    return parsed.filter((record) => {
      if (!isValidTideCardRecord(record) || seen.has(record.id)) return false
      seen.add(record.id)
      return true
    })
  } catch (_error) {
    return []
  }
}

function writeTideCardRecords(records) {
  try {
    window.localStorage.setItem(CARD_STORAGE_KEY, JSON.stringify(records))
    return true
  } catch (_error) {
    return false
  }
}

function collectTideCard(card) {
  const records = readTideCardRecords()
  if (records.some((record) => record.id === card.id)) return true
  records.push({ id: card.id, collectedAt: Date.now() })
  return writeTideCardRecords(records)
}

function formatDailyDate() {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "short"
  }).format(new Date())
}

function buildDailyReport() {
  const date = formatDailyDate()
  const profileReport = deriveProfileReport(activeProfileEnvelope(), date)
  const windowStart = Date.now() - 30 * DAY_MS
  const records = readTideCardRecords().filter((record) => record.collectedAt >= windowStart)
  const quickNotes = readQuickNotes().filter((record) => record.createdAt >= windowStart)
  const counts = Object.keys(tideMeta).reduce((result, key) => {
    result[key] = 0
    return result
  }, {})
  const latestByTide = {}
  let cardSignalCount = 0
  let noteSignalCount = 0

  records.forEach((record) => {
    const card = tideCardFromId(record.id)
    if (!card) return
    counts[card.key] += 1
    cardSignalCount += 1
    latestByTide[card.key] = Math.max(latestByTide[card.key] || 0, record.collectedAt)
  })

  const notePatterns = {
    insight: /想|觉得|发现|为什么|意识到|原来|反复想/,
    grounding: /焦虑|担心|害怕|不安|紧张|身体|边界|停一下/,
    connection: /朋友|家人|同事|关系|孤独|想念|陪伴|沟通/,
    vitality: /累|疲惫|休息|睡|撑不住|没力气|行动|开始/
  }
  quickNotes.forEach((record) => {
    Object.entries(notePatterns).forEach(([key, pattern]) => {
      if (!pattern.test(record.text)) return
      counts[key] += 1
      noteSignalCount += 1
      latestByTide[key] = Math.max(latestByTide[key] || 0, record.createdAt)
    })
  })

  const ranked = Object.entries(counts).sort((a, b) => {
    const countDifference = b[1] - a[1]
    if (countDifference !== 0) return countDifference
    return (latestByTide[b[0]] || 0) - (latestByTide[a[0]] || 0)
  })
  const dominant = ranked[0] && ranked[0][1] > 0 ? ranked[0][0] : "generic"
  const variant = dailyReportVariants[dominant]
  const signalSources = [
    noteSignalCount > 0 ? "闪念主题" : "",
    cardSignalCount > 0 ? "主动收藏的潮笺类型" : ""
  ].filter(Boolean)
  if (profileReport) {
    return {
      ...profileReport,
      summary: variant.summary,
      suggestions: variant.suggestions,
      dominant: dominant === "generic" ? "profile" : dominant,
      signalSources
    }
  }
  return {
    ...variant,
    basis: dominant === "generic"
      ? variant.basis
      : [
          noteSignalCount > 0 ? "近期闪念里出现了可解释的主题线索" : "",
          cardSignalCount > 0 ? "近期主动收藏了相关潮笺" : "",
          `这些线索更靠近「${tideMeta[dominant].label}」`
        ].filter(Boolean).slice(0, 2),
    summary: variant.summary,
    dominant,
    personalized: dominant !== "generic",
    mode: dominant === "generic" ? "基础日报" : `根据近期${signalSources.join("与")}`,
    signalSources,
    date
  }
}

function renderReportBasis(container, basis, compact = false) {
  container.replaceChildren()
  basis.forEach((item) => {
    const element = document.createElement("span")
    element.textContent = compact ? item : item
    container.append(element)
  })
}

function renderTodayReport() {
  const report = buildDailyReport()
  byId("today-date").textContent = report.date.toUpperCase()
  byId("today-report-mode").textContent = report.mode
  byId("today-report-headline").textContent = report.headline
  byId("today-report-quote").textContent = `“${report.quote}”`
  renderReportBasis(byId("today-report-basis"), report.basis, true)
}

function renderDailyReport() {
  const report = buildDailyReport()
  byId("report-date").textContent = report.date
  byId("report-mode").textContent = report.mode
  byId("report-headline").textContent = report.headline
  byId("report-quote").textContent = `“${report.quote}”`
  byId("report-summary").textContent = report.summary
  renderReportBasis(byId("report-basis"), report.basis)

  const suggestions = byId("report-suggestions")
  suggestions.replaceChildren()
  report.suggestions.forEach(([label, copy], index) => {
    const article = document.createElement("article")
    article.className = "report-suggestion"
    const number = document.createElement("span")
    number.textContent = String(index + 1).padStart(2, "0")
    const content = document.createElement("div")
    const heading = document.createElement("strong")
    heading.textContent = label
    const paragraph = document.createElement("p")
    paragraph.textContent = copy
    content.append(heading, paragraph)
    article.append(number, content)
    suggestions.append(article)
  })

  byId("report-source-copy").textContent = report.profileDriven
    ? "这份日报由你明确开启的本机多模态文字画像生成。画像可被新输入修正；原图和聊天原文不会写入画像存储，也不会显示心理分数。可在「我的」中关闭或删除。"
    : (report.personalized
      ? `这份日报根据近 30 天的${report.signalSources.join("与")}生成，不展示隐藏分数。当前相对突出的可解释信号是「${tideMeta[report.dominant].label}」。`
      : "目前还没有足够的可解释信号，所以显示通用基础版。留下闪念或主动收藏潮笺后，日报会逐渐贴近近期需要。")
}

function recomputeTides(stirredKeys = []) {
  const next = createInitialTides()
  flow.choices.forEach((decision) => {
    if (!decision || !decision.tides) return
    Object.entries(decision.tides).forEach(([key, value]) => {
      next[key] += value
    })
  })

  flow.unlockedTides.forEach((key) => {
    next[key] = 100
  })

  const newlyUnlocked = []
  Object.keys(tideMeta).forEach((key) => {
    if (flow.unlockedTides.includes(key) || next[key] < TIDE_THRESHOLD) return
    flow.unlockedTides.push(key)
    next[key] = 100
    newlyUnlocked.push(buildTideQuote(key))
  })

  Object.keys(next).forEach((key) => {
    next[key] = Math.max(0, Math.min(100, next[key]))
  })
  flow.tides = next
  renderTideMeters(stirredKeys)
  return newlyUnlocked
}

function continueAfterTideQuotes() {
  tideModal.hidden = true
  flow.activeTideQuote = null
  if (flow.currentCard >= cards.length) {
    beginChat()
    return
  }
  renderCard()
  storyCard.focus({ preventScroll: true })
}

function showNextTideQuote() {
  const quote = flow.pendingTideQuotes.shift()
  if (!quote) {
    continueAfterTideQuotes()
    return
  }

  flow.activeTideQuote = quote
  byId("tide-reward-symbol").textContent = quote.symbol
  byId("tide-reward-label").textContent = quote.label
  byId("tide-reward-title").textContent = `${quote.label}，已经来到潮面。`
  byId("tide-reward-quote").textContent = `“${quote.text}”`
  byId("tide-reward-description").textContent = quote.description
  tideModal.dataset.tide = quote.key
  tideModal.hidden = false
  window.requestAnimationFrame(() => byId("keep-tide-quote").focus())
}

function closeTideQuote(keep) {
  if (tideModal.hidden || !flow.activeTideQuote) return
  if (keep && !flow.keptTideQuotes.some((quote) => quote.id === flow.activeTideQuote.id)) {
    flow.keptTideQuotes.push(flow.activeTideQuote)
    if (!collectTideCard(flow.activeTideQuote)) flow.cardStorageFailed = true
  }
  tideModal.hidden = true
  flow.activeTideQuote = null
  if (flow.pendingTideQuotes.length > 0) {
    window.requestAnimationFrame(showNextTideQuote)
  } else {
    continueAfterTideQuotes()
  }
}

function advanceAfterChoice(newlyUnlocked) {
  flow.currentCard += 1
  if (newlyUnlocked.length > 0) {
    flow.pendingTideQuotes.push(...newlyUnlocked)
    showNextTideQuote()
    return
  }
  continueAfterTideQuotes()
}

function resetCardPosition() {
  dragging = false
  dragX = 0
  storyCard.classList.remove("is-dragging", "exit-left", "exit-right", "exit-neutral", "enter")
  storyCard.style.transform = ""
  storyCard.style.opacity = ""
  leftPreview.style.opacity = "0"
  rightPreview.style.opacity = "0"
}

function setCardControlsDisabled(disabled) {
  byId("left-button").disabled = disabled
  byId("right-button").disabled = disabled
  byId("neutral-button").disabled = disabled
}

function renderCard() {
  cancelRuntimeTimers()
  const card = cards[flow.currentCard]
  if (!card) {
    beginChat()
    return
  }

  locked = false
  setCardControlsDisabled(false)
  resetCardPosition()
  byId("speaker").textContent = card.speaker
  byId("speaker-role").textContent = card.role
  byId("portrait").textContent = card.portrait
  byId("scene").dataset.tone = card.tone
  byId("prompt").textContent = card.prompt
  byId("card-whisper").textContent = card.whisper
  byId("card-count").textContent = `${flow.currentCard + 1} / ${cards.length}`
  byId("card-progress").style.width = `${((flow.currentCard + 1) / cards.length) * 100}%`
  byId("game-theme").textContent = `本次线索 · ${flow.selectedTheme}`
  leftPreview.textContent = card.left.label
  rightPreview.textContent = card.right.label
  byId("left-button-label").textContent = card.left.label
  byId("right-button-label").textContent = card.right.label
  const leftEffect = tideEffectFor(flow.currentCard, "left")
  const rightEffect = tideEffectFor(flow.currentCard, "right")
  byId("left-tide-hint").textContent = describeTideEffect(leftEffect)
  byId("right-tide-hint").textContent = describeTideEffect(rightEffect)
  byId("left-button").setAttribute("aria-label", `${card.left.label}；牵动 ${describeTideEffect(leftEffect)}`)
  byId("right-button").setAttribute("aria-label", `${card.right.label}；牵动 ${describeTideEffect(rightEffect)}`)
  byId("neutral-button").setAttribute("aria-label", `两个都不像；牵动 ${describeTideEffect(neutralTideEffect)}`)
  renderTideMeters()
  storyCard.classList.add("enter")
  schedule(() => storyCard.classList.remove("enter"), 500)
}

function beginGame() {
  narrativeAbortController?.abort()
  narrativeAbortController = null
  if (flow.choices.every(Boolean)) {
    beginChat()
    return
  }
  const nextUnanswered = flow.choices.findIndex((choice) => !choice)
  flow.currentCard = nextUnanswered < 0 ? 0 : nextUnanswered
  showScreen("game-screen", { focus: false })
  renderCard()
  if (shouldAutoOpenGameTutorial()) openGameTutorial()
  else storyCard.focus({ preventScroll: true })
}

function chooseCard(direction) {
  if (locked || !cards[flow.currentCard]) return
  cancelRuntimeTimers()
  locked = true
  setCardControlsDisabled(true)

  const card = cards[flow.currentCard]
  const option = direction === "neutral" ? null : card[direction]
  const result = option ? option.result : "不必勉强自己落在两个选项里，这也是一条有效线索。"
  const tides = tideEffectFor(flow.currentCard, direction)
  flow.choices[flow.currentCard] = {
    direction,
    label: option ? option.label : "两个都不像",
    result,
    tides
  }
  recomputeSignals()
  const newlyUnlocked = recomputeTides(Object.keys(tides))
  const answered = flow.choices.filter(Boolean).length
  if (answered === 3 || answered === cards.length) {
    void queueProfileRefresh("choices")
  }

  if (direction === "left") storyCard.classList.add("exit-left")
  if (direction === "right") storyCard.classList.add("exit-right")
  if (direction === "neutral") {
    storyCard.classList.add("exit-neutral")
    storyCard.style.transform = "translateY(42px) scale(.97)"
    storyCard.style.opacity = "0"
  }

  const toast = byId("result-toast")
  toast.textContent = result
  toast.classList.add("show")
  schedule(() => toast.classList.remove("show"), 660)
  schedule(() => advanceAfterChoice(newlyUnlocked), 940)
}

function cancelDrag() {
  dragging = false
  dragX = 0
  storyCard.classList.remove("is-dragging")
  storyCard.style.transform = ""
  leftPreview.style.opacity = "0"
  rightPreview.style.opacity = "0"
}

function dominantSignal() {
  const entries = Object.entries(flow.signals)
  entries.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
  const [key, value] = entries[0]
  if (key === "rest" && value < 0) return "rest"
  if (key === "connection" && value < 0) return "connection"
  return key || "agency"
}

function countChoiceLabels(labels) {
  return flow.choices.filter((choice) => choice && labels.includes(choice.label)).length
}

function flowChatOpening() {
  const pauses = countChoiceLabels(["先交出够用版", "先离开两分钟", "给今天一个停点", "先走一小步"])
  const lastChoice = flow.choices.filter(Boolean).at(-1)
  const thread = flow.selectedTheme || "今天正在心里打转的事"
  if (pauses > 0) {
    return `刚才一路看下来，你有 ${pauses} 次为暂停或一小步留出了位置。关于“${thread}”，此刻最想先说的是哪一部分？`
  }
  return `最后一张卡里，你选择了“${lastChoice ? lastChoice.label : "两个都不像"}”。关于“${thread}”，我可以先听你说说，不急着给建议。`
}

function standaloneChatOpening() {
  if (flow.chatSeed === "report") {
    return "我们可以从今天的日报聊起。哪一句像你，哪一句又不太像？你也可以完全不按日报说。"
  }
  return "我在这里。你可以只说一件刚刚发生的小事，也可以告诉我：此刻只想被听见，不需要建议。"
}

function ensureChatStarted() {
  if (flow.chatMessages.length > 0) return
  flow.chatMessages.push({
    role: "bot",
    text: flow.chatMode === "flow" ? flowChatOpening() : standaloneChatOpening()
  })
}

function renderChat() {
  ensureChatStarted()
  const isFlow = flow.chatMode === "flow"
  byId("chat-kicker").textContent = isFlow ? "第二章 · 对话" : "自由探索 · 对话"
  byId("chat-subtitle").textContent = isFlow
    ? "刚才的主题会参与本次开场；你可以随时结束。"
    : "想说多少都可以；离开后本次内容会清除。"
  byId("end-chat").querySelector("span").textContent = isFlow ? "聊到这里，继续" : "结束这次对话"

  const log = byId("chat-log")
  log.replaceChildren()
  flow.chatMessages.forEach((message) => {
    const article = document.createElement("article")
    article.className = `chat-message ${message.role === "user" ? "is-user" : "is-bot"}`
    const paragraph = document.createElement("p")
    paragraph.textContent = message.text
    const meta = document.createElement("small")
    meta.textContent = message.role === "user"
      ? "你"
      : (message.source === "ai"
        ? "潮伴 · AI"
        : (message.source === "fallback" ? "潮伴 · 本地降级" : "潮伴"))
    article.append(paragraph, meta)
    log.append(article)
  })

  if (flow.chatBusy) {
    const typing = document.createElement("article")
    typing.className = "chat-message is-bot is-typing"
    typing.textContent = "•••"
    typing.setAttribute("aria-label", "潮伴正在回应")
    log.append(typing)
  }

  byId("chat-crisis-panel").hidden = !flow.chatCrisis
  byId("chat-quick-prompts").hidden = flow.chatCrisis
  const promptButtons = Array.from(document.querySelectorAll("[data-chat-prompt]"))
  if (flow.chatSuggestedPrompts.length > 0) {
    promptButtons.forEach((button, index) => {
      const prompt = flow.chatSuggestedPrompts[index]
      if (!prompt) return
      button.dataset.chatPrompt = prompt
      button.textContent = prompt
    })
  }
  const input = byId("chat-input")
  const chatAsrActive = activeAsrSession && ["chat", "voice-modal"].includes(activeAsrOwner)
  input.disabled = flow.chatCrisis
  input.readOnly = Boolean(chatAsrActive)
  input.placeholder = flow.chatCrisis ? "普通陪聊已暂停" : "此刻最想说的是……"
  byId("chat-form").classList.toggle("is-paused", flow.chatCrisis)
  byId("send-chat").disabled = flow.chatCrisis || flow.chatBusy || chatAsrActive || input.value.trim().length === 0
  byId("voice-input").disabled = flow.chatCrisis || flow.chatBusy || (activeAsrSession && activeAsrOwner !== "chat")
  byId("chat-status").textContent = flow.chatCrisis
    ? "普通陪聊已暂停，请优先使用上方的即时支持路径"
    : (voiceInputActive
      ? "正在实时转写；音频直达讯飞且不会保存在本机"
      : (flow.chatBusy
        ? "潮伴正在组织一句回应……"
        : (profileRuntime.consent.serviceProcessing
          ? "消息按次直达你配置的 AI 服务商；本机不保存对话原文"
          : "AI 尚未启用；回复会使用本地降级规则")))

  window.requestAnimationFrame(() => {
    log.scrollTop = log.scrollHeight
  })
}

function containsCrisisLanguage(text) {
  return /(不想活|不想再活|活不下去|活着没意思|想死|想去死|自杀|自殘|自残|轻生|輕生|结束生命|結束生命|结束这一切|傷害自己|伤害自己|傷害別人|伤害别人|杀了自己|殺了自己|杀人|殺人|马上去死|立即危险|立即危險)/.test(text)
}

function demoChatReply(text) {
  const userTurns = flow.chatMessages.filter((message) => message.role === "user").length
  if (/(不需要建议|不要建议|只想说说|只想被听)/.test(text)) {
    return "好，我先不提建议。你可以慢慢说，我会先跟着你正在经历的部分。"
  }
  if (/(累|撑不住|没力气|疲惫)/.test(text)) {
    return userTurns < 2
      ? "听起来你已经撑了一段时间。现在这份累，更靠近身体没力气，还是心里一直不敢停？"
      : "先不用解决全部。要不要只替接下来的十分钟选一件最轻的事，其他先放下？"
  }
  if (/(压力|焦虑|担心|害怕|失控)/.test(text)) {
    return userTurns < 2
      ? "这份压力像是把很多事情同时推到了眼前。哪一件最让你觉得不能出错？"
      : "我听见你既想把事情守住，也不想继续被它耗尽。我们可以先把“必须现在完成”的范围缩小一点。"
  }
  if (userTurns === 1) return "谢谢你把这一点说出来。这里面最让你难受的，是发生了什么，还是你不得不一直撑住的感觉？"
  if (userTurns === 2) return "我听见这不只是一件事，也牵动了你怎么要求自己。此刻你更需要被理解，还是一起把下一步拆小？"
  return "我们可以先停在这里，不急着得出结论。如果愿意，带走一个很小的动作就够了。"
}

function companionMode() {
  if (flow.chatMode === "flow") return "chapter"
  if (flow.chatSeed === "report") return "report"
  return "standalone"
}

function companionMessages() {
  return flow.chatMessages
    .filter((message) => !message.safety)
    .slice(-8)
    .map((message) => ({
      role: message.role === "user" ? "user" : "assistant",
      content: message.text
    }))
}

async function sendChatMessage(rawText, options = {}) {
  const text = rawText.trim()
  if (!text || flow.chatBusy || (activeAsrSession && ["chat", "voice-modal"].includes(activeAsrOwner))) return
  const inputMode = options.inputMode || (chatDraftFromVoice ? "voice_transcript" : "text")
  setVoiceInputState(false)
  flow.chatMessages.push({
    id: requestId("message"),
    role: "user",
    text,
    inputMode
  })
  chatDraftFromVoice = false
  byId("chat-input").value = ""

  if (containsCrisisLanguage(text)) {
    flow.chatCrisis = true
    flow.chatMessages.push({
      role: "bot",
      safety: true,
      text: "谢谢你告诉我。现在先不继续普通对话：请确认你是否处于立即危险，并尽快联系所在地紧急服务、危机支持资源，或一位能马上来到你身边的人。"
    })
    renderChat()
    return
  }
  flow.chatBusy = true
  renderChat()

  const consent = await requestAiConsent({
    reason: "陪伴对话需要把你本次发送的消息交给 AI 生成回应。"
  })
  if (activeScreenId !== "chat-screen") {
    flow.chatBusy = false
    return
  }

  try {
    if (!consent.serviceProcessing) {
      flow.chatMessages.push({ role: "bot", source: "fallback", text: demoChatReply(text) })
    } else {
      chatAbortController = new AbortController()
      const profileContext = consent.profilePersonalization
        ? companionProfileContext(activeProfileEnvelope())
        : null
      const request = {
        consent: { ai_processing: true, use_profile: profileContext !== null },
        mode: companionMode(),
        locale: "zh-CN",
        client_request_id: requestId("chat"),
        messages: companionMessages(),
        profile_context: profileContext
      }
      const response = await sendCompanionMessage(request, {
        signal: chatAbortController.signal
      })
      const result = response.result
      flow.chatSuggestedPrompts = Array.isArray(result.suggested_prompts)
        ? result.suggested_prompts
        : []
      const urgent = result.safety_notice?.level === "urgent_support_recommended"
      flow.chatMessages.push({
        role: "bot",
        source: "ai",
        safety: urgent,
        text: result.reply
      })
      if (urgent) flow.chatCrisis = true
    }
  } catch (error) {
    if (!(error instanceof ApiError && error.code === "client_aborted")) {
      const prefix = error instanceof ApiError
        ? `AI 服务暂时不可用（${error.code}）。`
        : "AI 服务暂时不可用。"
      flow.chatMessages.push({
        role: "bot",
        source: "fallback",
        text: `${prefix}以下是本地降级回应：${demoChatReply(text)}`
      })
    }
  } finally {
    chatAbortController = null
    flow.chatBusy = false
    if (activeScreenId === "chat-screen") {
      renderChat()
      byId("chat-input").focus({ preventScroll: true })
    }
    const userTurns = flow.chatMessages.filter((message) => message.role === "user").length
    if (!flow.chatCrisis && (userTurns === 1 || userTurns % 2 === 0)) {
      void queueProfileRefresh("chat")
    }
  }
}

function beginChat() {
  flow.chatMode = "flow"
  flow.chatMessages = []
  flow.chatBusy = false
  flow.chatCrisis = false
  flow.chatSeed = ""
  chatDraftFromVoice = false
  byId("chat-input").value = ""
  setVoiceInputState(false)
  flow.chatSuggestedPrompts = []
  showScreen("chat-screen")
}

function openStandaloneChat(options = {}) {
  const shouldReset = flow.chatMode !== "standalone" || options.fromReport || options.reset
  flow.chatMode = "standalone"
  if (shouldReset) {
    flow.chatMessages = []
    flow.chatBusy = false
    flow.chatCrisis = false
    flow.chatSeed = options.fromReport ? "report" : ""
    flow.chatSuggestedPrompts = []
    chatDraftFromVoice = false
    byId("chat-input").value = ""
  }
  setVoiceInputState(false)
  showScreen("chat-screen")
}

function setVoiceInputState(active, options = {}) {
  voiceInputActive = active
  const button = byId("voice-input")
  button.setAttribute("aria-pressed", String(active))
  button.setAttribute("aria-label", active ? "结束实时语音转写" : "开始实时语音转写")
  button.classList.toggle("is-listening", active)
  const input = byId("chat-input")
  input.readOnly = active
  byId("send-chat").disabled = active || flow.chatBusy || input.value.trim().length === 0
  if (options.message) byId("chat-status").textContent = options.message
}

function joinedAsrDraft(baseText, transcript, maxLength) {
  const base = typeof baseText === "string" ? baseText : ""
  const spoken = typeof transcript === "string" ? transcript : ""
  const separator = base && spoken && !/[\s\n]$/.test(base) ? "\n" : ""
  return `${base}${separator}${spoken}`.slice(0, maxLength)
}

function resizeDraftInput(input, maxHeight) {
  input.style.height = "auto"
  input.style.height = `${Math.min(input.scrollHeight, maxHeight)}px`
}

function applyActiveAsrTranscript(owner, snapshot) {
  if (owner !== activeAsrOwner) return
  activeAsrTranscript = snapshot?.text || ""
  if (owner === "quick-note") {
    const input = byId("quick-note-input")
    input.value = joinedAsrDraft(activeAsrBaseText, activeAsrTranscript, QUICK_NOTE_MAX_LENGTH)
    byId("quick-note-count").textContent = `${input.value.length} / ${QUICK_NOTE_MAX_LENGTH}`
    resizeDraftInput(input, 96)
    updateQuickNoteSaveState()
    const current = snapshot?.interimText || activeAsrTranscript
    byId("quick-note-status").textContent = current
      ? `实时转写：${current.slice(-42)}`
      : "正在听你说；音频实时直达讯飞，不在本机保存"
    return
  }

  const input = byId("chat-input")
  input.value = joinedAsrDraft(activeAsrBaseText, activeAsrTranscript, 400)
  resizeDraftInput(input, 82)
  chatDraftFromVoice = Boolean(activeAsrTranscript.trim())
  byId("send-chat").disabled = true
  const current = snapshot?.interimText || activeAsrTranscript
  if (owner === "voice-modal") {
    byId("voice-call-status").textContent = current
      ? `实时转写：${current.slice(-46)}`
      : "正在听你说；原音频不会保存在本机"
  } else {
    byId("chat-status").textContent = current
      ? `实时转写：${current.slice(-46)}`
      : "正在听你说；音频实时直达讯飞，不在本机保存"
  }
}

function clearActiveAsrTimers() {
  if (activeAsrAutoStopTimer) window.clearTimeout(activeAsrAutoStopTimer)
  activeAsrAutoStopTimer = null
  if (quickNoteRecordingTimer) window.clearInterval(quickNoteRecordingTimer)
  quickNoteRecordingTimer = null
}

function cancelActiveAsrImmediately(owner = activeAsrOwner) {
  if (!activeAsrSession || activeAsrOwner !== owner) return false
  const session = activeAsrSession
  finishAsrOwnerUi(owner, { cancelled: true })
  activeAsrSession = null
  activeAsrOwner = ""
  activeAsrBaseText = ""
  activeAsrTranscript = ""
  clearActiveAsrTimers()
  void session.cancel()
  return true
}

function finishAsrOwnerUi(owner, { cancelled = false, errorMessage = "" } = {}) {
  const hasTranscript = Boolean(activeAsrTranscript.trim())
  clearActiveAsrTimers()
  if (owner === "quick-note") {
    const elapsed = quickNoteVoiceStartedAt
      ? Math.max(1, Math.round((Date.now() - quickNoteVoiceStartedAt) / 1000))
      : 0
    quickNoteVoiceStartedAt = 0
    const button = byId("quick-note-voice")
    button.classList.remove("is-recording")
    button.setAttribute("aria-pressed", "false")
    button.setAttribute("aria-label", "开始实时语音转写闪念")
    byId("quick-note-input").readOnly = false
    pendingQuickNoteVoiceDuration = !cancelled && hasTranscript ? Math.min(300, elapsed) : 0
    byId("quick-note-voice-duration").textContent = formatVoiceDuration(pendingQuickNoteVoiceDuration || 1)
    byId("quick-note-voice-preview").querySelector("strong").textContent = hasTranscript ? "语音已转成文字" : "语音闪念"
    byId("quick-note-voice-preview").hidden = !hasTranscript
    byId("quick-note-status").textContent = errorMessage || (cancelled
      ? "已取消语音转写"
      : (hasTranscript ? "已转成可编辑文字；提交闪念后才会进入画像" : "没有识别到可用文字"))
    updateQuickNoteSaveState()
  } else {
    setVoiceInputState(false)
    byId("chat-input").readOnly = false
    if (owner === "voice-modal") setVoiceCallState(false)
    const message = errorMessage || (cancelled
      ? "已取消语音转写"
      : (hasTranscript ? "已转成可编辑文字；发送后才会进入对话与画像" : "没有识别到可用文字"))
    if (owner === "voice-modal") byId("voice-call-status").textContent = message
    else byId("chat-status").textContent = message
  }
}

function handleAsrState(owner, session, state) {
  if (session !== activeAsrSession || owner !== activeAsrOwner) return
  const messages = {
    permission: "等待麦克风授权；授权后音频将实时直达讯飞……",
    connecting: "正在连接讯飞实时转写……",
    recording: "正在实时转写；再点一次结束",
    stopping: "正在结束录音并发送剩余音频……",
    awaiting_final: "正在等待最后一段转写……"
  }
  if (owner === "chat") setVoiceInputState(true, { message: messages[state] })
  if (owner === "voice-modal") {
    setVoiceCallState(true)
    byId("chat-input").readOnly = true
    byId("send-chat").disabled = true
    byId("voice-call-status").textContent = messages[state] || byId("voice-call-status").textContent
  }
  if (owner === "quick-note") {
    const button = byId("quick-note-voice")
    const active = ["permission", "connecting", "recording", "stopping", "awaiting_final"].includes(state)
    button.classList.toggle("is-recording", active)
    button.setAttribute("aria-pressed", String(active))
    button.setAttribute("aria-label", active ? "结束实时语音转写闪念" : "开始实时语音转写闪念")
    byId("quick-note-input").readOnly = active
    byId("quick-note-voice-preview").hidden = false
    byId("quick-note-voice-preview").querySelector("strong").textContent = state === "recording" ? "正在实时转写" : "准备语音转写"
    byId("quick-note-status").textContent = messages[state] || byId("quick-note-status").textContent
    if (state === "recording" && !quickNoteVoiceStartedAt) {
      quickNoteVoiceStartedAt = Date.now()
      const updateDuration = () => {
        if (!quickNoteVoiceStartedAt) return
        const elapsed = Math.max(1, Math.floor((Date.now() - quickNoteVoiceStartedAt) / 1000))
        byId("quick-note-voice-duration").textContent = formatVoiceDuration(elapsed)
      }
      updateDuration()
      quickNoteRecordingTimer = window.setInterval(updateDuration, 500)
    }
    updateQuickNoteSaveState()
  }
}

async function startRealtimeAsr(owner) {
  if (activeAsrSession) await stopRealtimeAsr({ cancel: true })
  const settings = loadAsrSettings()
  if (!hasAsrSettings(settings)) {
    const message = "实时语音转写尚未配置，请到“我的”保存讯飞凭据"
    if (owner === "quick-note") byId("quick-note-status").textContent = message
    else if (owner === "voice-modal") byId("voice-call-status").textContent = message
    else byId("chat-status").textContent = message
    return false
  }

  activeAsrOwner = owner
  activeAsrBaseText = byId(owner === "quick-note" ? "quick-note-input" : "chat-input").value
  activeAsrTranscript = ""
  const session = new RealtimeAsrSession({
    settings,
    onState: ({ state }) => handleAsrState(owner, session, state),
    onTranscript: (snapshot) => {
      if (session === activeAsrSession) applyActiveAsrTranscript(owner, snapshot)
    },
    onError: (error) => {
      if (session !== activeAsrSession) return
      finishAsrOwnerUi(owner, { errorMessage: asrErrorMessage(error) })
      activeAsrSession = null
      activeAsrOwner = ""
      activeAsrBaseText = ""
      activeAsrTranscript = ""
    }
  })
  activeAsrSession = session
  activeAsrAutoStopTimer = window.setTimeout(() => {
    if (session === activeAsrSession) void stopRealtimeAsr()
  }, 5 * 60 * 1000)
  try {
    await session.start()
    return session === activeAsrSession
  } catch (error) {
    if (session === activeAsrSession) {
      const cancelled = error instanceof AsrError && error.code === "asr_cancelled"
      finishAsrOwnerUi(owner, { cancelled, errorMessage: cancelled ? "" : asrErrorMessage(error) })
      activeAsrSession = null
      activeAsrOwner = ""
      activeAsrBaseText = ""
      activeAsrTranscript = ""
    }
    return false
  }
}

async function stopRealtimeAsr({ cancel = false } = {}) {
  const session = activeAsrSession
  const owner = activeAsrOwner
  if (!session || !owner) return null
  try {
    const snapshot = cancel ? await session.cancel() : await session.stop()
    if (session !== activeAsrSession) return snapshot
    if (!cancel) applyActiveAsrTranscript(owner, snapshot)
    finishAsrOwnerUi(owner, { cancelled: cancel })
    return snapshot
  } catch (error) {
    if (session === activeAsrSession) {
      finishAsrOwnerUi(owner, { errorMessage: asrErrorMessage(error) })
    }
    return null
  } finally {
    if (session === activeAsrSession) {
      activeAsrSession = null
      activeAsrOwner = ""
      activeAsrBaseText = ""
      activeAsrTranscript = ""
    }
  }
}

async function toggleVoiceInput() {
  if (activeAsrOwner === "chat") await stopRealtimeAsr()
  else await startRealtimeAsr("chat")
}

function endChat() {
  if (flow.chatMode === "flow") {
    showActionScreen()
  } else {
    showScreen("today-screen")
  }
}

function currentActionOptions() {
  const generated = deriveProfileActions(activeProfileEnvelope())
  const fallback = Object.entries(actionCopy).map(([id, item]) => ({
    id,
    label: item.label,
    title: item.label,
    rationale: item.rationale
  }))
  return [...generated, ...fallback]
    .filter((item, index, items) => items.findIndex((candidate) => candidate.label === item.label) === index)
    .slice(0, 3)
}

function renderActionRecommendation() {
  const options = currentActionOptions()
  const generated = options[0] && options[0].id.startsWith("profile-action-")
  const localRecommendation = signalRecommendation[dominantSignal()] || signalRecommendation.agency
  const recommendation = generated
    ? {
      action: options[0].id,
      copy: `结合最近一次授权画像，先推荐「${options[0].title}」。它仍只是可跳过的低负担建议。`
    }
    : localRecommendation

  document.querySelectorAll(".action-option").forEach((button, index) => {
    const option = options[index]
    if (!option) return
    button.dataset.actionId = option.id
    button.querySelector("strong").textContent = option.label
    button.querySelector("small").textContent = option.rationale
    const selected = button.dataset.actionId === flow.selectedAction
    button.setAttribute("aria-pressed", String(selected))
    button.classList.toggle("is-selected", selected)
    button.classList.toggle("is-recommended", button.dataset.actionId === recommendation.action)
  })
  if (flow.selectedAction && !options.some((item) => item.id === flow.selectedAction)) {
    flow.selectedAction = ""
  }
  byId("action-rationale").textContent = recommendation.copy
  byId("action-continue").disabled = !flow.selectedAction
}

function showActionScreen() {
  byId("action-theme").textContent = flow.selectedTheme
  showScreen("action-screen")
  renderActionRecommendation()
}

function buildEchoCandidates() {
  const action = currentActionOptions().find((item) => item.id === flow.selectedAction)
  const tideQuotes = flow.keptTideQuotes
    .slice()
    .reverse()
    .map((quote) => quote.text)
  const profileEchoes = deriveProfileEchoes(activeProfileEnvelope())
  const defaults = [
    "今天的我已经停下来，认真听了一会儿自己。",
    action ? `提醒自己：${action.label}。` : "不行动也可以是今天诚实的选择。",
    "答案可以慢一点，我不必现在把一切想清楚。"
  ]
  return Array.from(new Set([...tideQuotes, ...profileEchoes, ...defaults]))
    .map((item) => item.slice(0, 120))
    .slice(0, 3)
}

function updateEchoSelection() {
  const candidates = buildEchoCandidates()
  document.querySelectorAll("[data-echo-index]").forEach((button) => {
    const index = Number(button.dataset.echoIndex)
    const selected = flow.echoSource === "candidate" && flow.selectedEcho === candidates[index]
    button.setAttribute("aria-pressed", String(selected))
    button.classList.toggle("is-selected", selected)
  })

  document.querySelectorAll("[data-delay]").forEach((button) => {
    const selected = Number(button.dataset.delay) === flow.echoDelay
    button.setAttribute("aria-pressed", String(selected))
    button.classList.toggle("is-selected", selected)
  })

  const consent = byId("save-echo")
  consent.checked = flow.saveEcho
  const canSave = flow.selectedEcho.trim().length > 0
  const finish = byId("finish-flow")
  const finishLabel = finish.querySelector("span")

  if (flow.saveEcho) {
    finish.disabled = !canSave
    finishLabel.textContent = canSave ? "保存回响，完成本次梳理" : "先选择一句想保存的话"
    byId("echo-hint").textContent = canSave
      ? "只会保存这句话与解封日期，其他本次内容不会写入本地"
      : "请先选择候选句，或写下自己的话"
  } else {
    finish.disabled = false
    finishLabel.textContent = "不保存，完成本次梳理"
    byId("echo-hint").textContent = "不勾选也可以完成，本次内容会在离开后消失"
  }
}

function showEchoScreen() {
  flow.selectedEcho = ""
  flow.echoSource = ""
  flow.echoDelay = 1
  flow.saveEcho = false
  byId("custom-echo").value = ""
  byId("save-echo").checked = false

  showScreen("echo-screen")
  renderEchoCandidates()
}

function todayStorageKey(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function readAnswerBookRecord() {
  if (ephemeralAnswerRecord && ephemeralAnswerRecord.date === todayStorageKey()) {
    return ephemeralAnswerRecord
  }
  try {
    const parsed = JSON.parse(window.localStorage.getItem(ANSWER_BOOK_STORAGE_KEY) || "null")
    if (
      parsed &&
      parsed.date === todayStorageKey() &&
      Number.isInteger(parsed.index) &&
      parsed.index >= 0 &&
      parsed.index < answerBookCards.length
    ) {
      return parsed
    }
  } catch (_error) {
    return null
  }
  return null
}

function renderAnswerBook() {
  const record = readAnswerBookRecord()
  const dateLabel = new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric" }).format(new Date())
  byId("answer-book-date").textContent = dateLabel
  byId("answer-book-result").hidden = !record
  byId("answer-book-result").textContent = record ? `“${answerBookCards[record.index]}”` : ""
  byId("answer-book-prompt").hidden = Boolean(record)
  byId("draw-answer").disabled = Boolean(record)
  byId("draw-answer").querySelector("span").textContent = record ? "今天已经抽过" : "抽取今日答案"
  byId("answer-book-status").textContent = record
    ? "这张卡会留到今天结束，明天可以再抽一次"
    : "每天一次，不记录你想的问题"
}

function drawAnswerBookCard() {
  if (readAnswerBookRecord()) return
  const record = {
    date: todayStorageKey(),
    index: Math.floor(Math.random() * answerBookCards.length)
  }
  ephemeralAnswerRecord = record
  try {
    window.localStorage.setItem(ANSWER_BOOK_STORAGE_KEY, JSON.stringify(record))
  } catch (_error) {
    // The answer still remains available for this page session.
  }
  renderAnswerBook()
}

function renderInitialImpression() {
  const aiEnvelope = activeProfileEnvelope()
  if (aiEnvelope?.profile) {
    const profile = aiEnvelope.profile
    const chips = [
      ...(profile.current_state || []).map((item) => item.title),
      ...(profile.needs_and_preferences || []).map((item) => item.title),
      ...(profile.strengths_and_resources || []).map((item) => item.title)
    ].filter((item, index, items) => item && items.indexOf(item) === index)
    if (aiEnvelope.modalities_used?.includes("image")) chips.unshift("结合了图片与文字观察")
    byId("impression-title").textContent = profile.headline
    byId("impression-summary").textContent = `${profile.summary} 这仍是可被你纠正的暂时性观察，不是固定标签。`
    const container = byId("impression-chips")
    container.replaceChildren()
    chips.slice(0, 3).forEach((copy) => {
      const chip = document.createElement("span")
      chip.textContent = copy
      container.append(chip)
    })
    return
  }

  const quickNotes = readQuickNotes()
  const noteCount = quickNotes.length
  const tideRecords = readTideCardRecords()
  const echoCount = readEchoes().length
  const tideCounts = tideRecords.reduce((counts, record) => {
    const key = record.id.split("-")[0]
    counts[key] = (counts[key] || 0) + 1
    return counts
  }, {})
  const dominantTide = Object.entries(tideCounts).sort((a, b) => b[1] - a[1])[0]?.[0]
  const noteText = quickNotes.map((record) => record.text).join(" ")
  const noteSignals = [
    { pattern: /累|疲惫|休息|睡|撑不住|没力气/, chip: "近期更需要恢复精力", title: "最近的闪念里，休息和恢复正在更常被提起。" },
    { pattern: /担心|焦虑|害怕|不安|紧张|不够好|失败/, chip: "正在寻找更多安定感", title: "最近的闪念里，确定感与安定感似乎很重要。" },
    { pattern: /朋友|家人|同事|关系|孤独|想念|陪伴/, chip: "在意关系里的靠近与边界", title: "最近的闪念里，关系与联结出现得更多。" },
    { pattern: /想|觉得|发现|为什么|意识到|原来/, chip: "愿意观察正在发生的念头", title: "你正在给一闪而过的念头更多被看见的机会。" }
  ].filter((signal) => signal.pattern.test(noteText))
  const chips = []

  noteSignals.forEach((signal) => chips.push(signal.chip))
  if (quickNotes.some((record) => record.imageData || record.hadImage)) chips.push("会用画面保存当下")
  if (quickNotes.some((record) => record.voiceDuration > 0)) chips.push("愿意用声音表达感受")
  if (noteCount > 0 && chips.length === 0) chips.push("会接住一闪而过的想法")
  if (dominantTide && tideMeta[dominantTide]) chips.push(`最近更靠近「${tideMeta[dominantTide].label}」`)
  if (echoCount > 0) chips.push("愿意和未来的自己对话")
  if (readAnswerBookRecord()) chips.push("愿意给直觉一点空间")
  if (chips.length === 0) chips.push("愿意慢慢认识自己", "不急着给出结论")

  byId("impression-title").textContent = noteSignals[0]?.title || (dominantTide && tideMeta[dominantTide]
    ? `你的近期收藏里，「${tideMeta[dominantTide].label}」正在多一点。`
    : (noteCount > 0 ? "你似乎愿意先把想法放下来，再慢慢看清。" : "第一次见面，先按你的节奏慢慢认识。"))
  byId("impression-summary").textContent = "这段初印象会参考你提交的闪念、表达方式与主动收藏，不是心理诊断，也会随着新内容继续变化。"
  const container = byId("impression-chips")
  container.replaceChildren()
  chips.slice(0, 3).forEach((copy) => {
    const chip = document.createElement("span")
    chip.textContent = copy
    container.append(chip)
  })
}

function resetQuickNoteComposer() {
  if (activeAsrOwner === "quick-note") cancelActiveAsrImmediately("quick-note")
  void clearQuickNoteVoice()
  byId("quick-note-input").value = ""
  byId("quick-note-input").style.height = ""
  byId("quick-note-count").textContent = `0 / ${QUICK_NOTE_MAX_LENGTH}`
  byId("quick-note-status").textContent = ""
  clearQuickNotePhoto()
  closeQuickNoteComposer()
}

function setQuickNoteAttachmentInputsEnabled(enabled) {
  const inputIds = ["quick-note-photo-input", "quick-note-camera-input"]
  inputIds.forEach((id) => {
    byId(id).disabled = !enabled
  })
}

function openQuickNoteComposer() {
  const menu = byId("quick-note-attachment-menu")
  const button = byId("quick-note-add-attachment")
  setQuickNoteAttachmentInputsEnabled(true)
  menu.hidden = false
  button.setAttribute("aria-expanded", "true")
  button.classList.add("is-open")
}

function closeQuickNoteComposer() {
  setQuickNoteAttachmentInputsEnabled(false)
  byId("quick-note-attachment-menu").hidden = true
  byId("quick-note-add-attachment").setAttribute("aria-expanded", "false")
  byId("quick-note-add-attachment").classList.remove("is-open")
}

function toggleQuickNoteComposer() {
  if (byId("quick-note-attachment-menu").hidden) openQuickNoteComposer()
  else closeQuickNoteComposer()
}

function syncQuickNoteComposerPreview() {
  byId("quick-note-composer-preview").hidden = !pendingQuickNoteImage && pendingQuickNoteVoiceDuration === 0 && !quickNoteVoiceStartedAt
}

function updateQuickNoteSaveState() {
  const hasText = byId("quick-note-input").value.trim().length > 0
  byId("save-quick-note").disabled = activeAsrOwner === "quick-note" || (
    !hasText && !pendingQuickNoteImage && pendingQuickNoteVoiceDuration === 0
  )
  syncQuickNoteComposerPreview()
}

function clearQuickNotePhoto() {
  pendingQuickNoteImage = ""
  byId("quick-note-photo-input").value = ""
  byId("quick-note-camera-input").value = ""
  byId("quick-note-photo-image").removeAttribute("src")
  byId("quick-note-photo-preview").hidden = true
  byId("quick-note-image-rights-confirmed").checked = false
  byId("quick-note-image-rights-row").hidden = true
  updateQuickNoteSaveState()
}

function formatVoiceDuration(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}

async function clearQuickNoteVoice() {
  if (activeAsrOwner === "quick-note") await stopRealtimeAsr({ cancel: true })
  if (quickNoteRecordingTimer) window.clearInterval(quickNoteRecordingTimer)
  quickNoteRecordingTimer = null
  quickNoteVoiceStartedAt = 0
  pendingQuickNoteVoiceDuration = 0
  byId("quick-note-voice").classList.remove("is-recording")
  byId("quick-note-voice").setAttribute("aria-pressed", "false")
  byId("quick-note-voice").setAttribute("aria-label", "开始实时语音转写闪念")
  byId("quick-note-input").readOnly = false
  byId("quick-note-voice-preview").hidden = true
  byId("quick-note-voice-duration").textContent = "0:01"
  updateQuickNoteSaveState()
}

async function toggleQuickNoteVoiceRecording() {
  if (activeAsrOwner === "quick-note") await stopRealtimeAsr()
  else await startRealtimeAsr("quick-note")
}

function loadImageElement(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error("无法读取图片"))
    image.src = dataUrl
  })
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ""))
    reader.onerror = () => reject(new Error("无法读取图片"))
    reader.readAsDataURL(file)
  })
}

async function compressQuickNotePhoto(file) {
  if (!file || !file.type.startsWith("image/")) throw new Error("请选择一张图片")
  if (file.size > 12 * 1024 * 1024) throw new Error("图片太大，请选择 12MB 以内的图片")
  const source = await readFileAsDataUrl(file)
  const image = await loadImageElement(source)
  const maxSide = 720
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight))
  const canvas = document.createElement("canvas")
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
  const context = canvas.getContext("2d")
  if (!context) throw new Error("当前浏览器暂时无法处理图片")
  context.fillStyle = "#fffaf0"
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  let output = canvas.toDataURL("image/jpeg", 0.78)
  if (output.length > QUICK_NOTE_IMAGE_MAX_DATA_LENGTH) output = canvas.toDataURL("image/jpeg", 0.56)
  if (output.length > QUICK_NOTE_IMAGE_MAX_DATA_LENGTH) throw new Error("图片压缩后仍然太大，请换一张试试")
  return output
}

async function handleQuickNotePhoto(file) {
  closeQuickNoteComposer()
  byId("quick-note-status").textContent = "正在准备图片……"
  try {
    pendingQuickNoteImage = await compressQuickNotePhoto(file)
    byId("quick-note-photo-image").src = pendingQuickNoteImage
    byId("quick-note-photo-preview").hidden = false
    byId("quick-note-image-rights-confirmed").checked = false
    byId("quick-note-image-rights-row").hidden = false
    byId("quick-note-status").textContent = "图片已加入；如需用于持续画像，请在下方单独确认图片处理权利"
  } catch (error) {
    clearQuickNotePhoto()
    byId("quick-note-status").textContent = error instanceof Error ? error.message : "暂时无法添加图片"
  }
  updateQuickNoteSaveState()
}

function isValidQuickNoteRecord(record) {
  const hasImage = Boolean(
    record?.hadImage === true ||
    (typeof record?.imageData === "string" && record.imageData.startsWith("data:image/"))
  )
  return Boolean(
    record &&
    typeof record.id === "string" &&
    typeof record.text === "string" &&
    (record.text.trim().length > 0 || hasImage || record.voiceDuration > 0) &&
    record.text.length <= QUICK_NOTE_MAX_LENGTH &&
    (record.imageData === undefined || (
      typeof record.imageData === "string" &&
      record.imageData.length <= QUICK_NOTE_IMAGE_MAX_DATA_LENGTH &&
      (record.imageData === "" || record.imageData.startsWith("data:image/"))
    )) &&
    Number.isFinite(record.createdAt) &&
    (record.dateKey === undefined || /^\d{4}-\d{2}-\d{2}$/.test(record.dateKey)) &&
    (record.voiceDuration === undefined || (Number.isFinite(record.voiceDuration) && record.voiceDuration >= 0 && record.voiceDuration <= 300))
  )
}

function loadStoredQuickNotes() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(QUICK_NOTE_STORAGE_KEY) || "[]")
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isValidQuickNoteRecord).slice(0, QUICK_NOTE_LIMIT).map((record) => ({
      id: record.id,
      text: record.text,
      imageData: "",
      hadImage: record.hadImage === true,
      imageRightsConfirmed: false,
      voiceDuration: Number(record.voiceDuration) || 0,
      createdAt: record.createdAt,
      dateKey: typeof record.dateKey === "string" ? record.dateKey : memoryDateKey(record.createdAt)
    }))
  } catch (_error) {
    return []
  }
}

function persistQuickNotes(records) {
  const stored = records.map((record) => ({
    id: record.id,
    text: record.text,
    hadImage: record.hadImage === true || Boolean(record.imageData),
    voiceDuration: Number(record.voiceDuration) || 0,
    createdAt: record.createdAt,
    dateKey: typeof record.dateKey === "string" ? record.dateKey : memoryDateKey(record.createdAt)
  }))
  try {
    const serialized = JSON.stringify(stored)
    window.localStorage.setItem(QUICK_NOTE_STORAGE_KEY, serialized)
    return window.localStorage.getItem(QUICK_NOTE_STORAGE_KEY) === serialized
  } catch (_error) {
    return false
  }
}

function removeStoredQuickNotes() {
  try {
    window.localStorage.removeItem(QUICK_NOTE_STORAGE_KEY)
    return window.localStorage.getItem(QUICK_NOTE_STORAGE_KEY) === null
  } catch (_error) {
    return false
  }
}

function readQuickNotes() {
  return quickNoteRecords
    .filter(isValidQuickNoteRecord)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, QUICK_NOTE_LIMIT)
}

function writeQuickNotes(records) {
  const next = records.filter(isValidQuickNoteRecord).slice(0, QUICK_NOTE_LIMIT)
  if (!persistQuickNotes(next)) return false
  quickNoteRecords = next
  return true
}

function rebuildProfileAfterQuickNoteDeletion() {
  const shouldRefresh = profileRuntime.consent.profilePersonalization
  profileRuntime.clearProfile()
  if (shouldRefresh) void queueProfileRefresh("notes")
}

function formatQuickNoteDate(timestamp) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(timestamp))
}

function saveQuickNote(text, imageData = "", voiceDuration = 0, imageRightsConfirmed = false) {
  const normalized = text.trim()
  if (!normalized && !imageData && !voiceDuration) return false
  const now = Date.now()
  const randomPart = Math.random().toString(36).slice(2, 9)
  const record = {
    id: `note-${now}-${randomPart}`,
    text: normalized.slice(0, QUICK_NOTE_MAX_LENGTH),
    imageData,
    hadImage: Boolean(imageData),
    imageRightsConfirmed: Boolean(imageData) && imageRightsConfirmed,
    voiceDuration,
    createdAt: now,
    dateKey: memoryDateKey(now)
  }
  quickNoteDeckOffset = 0
  const saved = writeQuickNotes([record, ...readQuickNotes()])
  if (saved) clearMonthlyMemoryCache()
  return saved
}

function removeQuickNote(id) {
  const records = readQuickNotes()
  const next = records.filter((record) => record.id !== id)
  if (next.length === records.length) return
  if (writeQuickNotes(next)) {
    clearMonthlyMemoryCache()
    profiledQuickNoteImageSourceIds.delete(`quick-note-image:${id}`)
    rebuildProfileAfterQuickNoteDeletion()
    quickNoteDeckOffset = next.length > 0 ? quickNoteDeckOffset % next.length : 0
    byId("quick-note-library-status").textContent = "已移除这条闪念，初印象也会随之更新"
    renderQuickNotes()
    renderInitialImpression()
    updateSettingsStorageState()
  } else {
    byId("quick-note-library-status").textContent = "浏览器未能删除这条本机闪念，请检查站点存储权限后重试"
  }
}

function clearAllQuickNotes(event) {
  const records = readQuickNotes()
  if (records.length === 0) {
    renderQuickNotes()
    updateSettingsStorageState()
    return
  }

  const button = event && event.currentTarget instanceof HTMLButtonElement
    ? event.currentTarget
    : null
  if (button && button.dataset.confirming !== "true") {
    const original = button.textContent
    button.dataset.confirming = "true"
    button.textContent = "再次点击，确认清空闪念"
    schedule(() => {
      if (!button.isConnected) return
      button.dataset.confirming = "false"
      button.textContent = original
    }, 4000)
    return
  }

  if (removeStoredQuickNotes()) {
    quickNoteRecords = []
    clearMonthlyMemoryCache()
    profiledQuickNoteImageSourceIds.clear()
    rebuildProfileAfterQuickNoteDeletion()
    quickNoteDeckOffset = 0
    renderQuickNotes()
    renderInitialImpression()
    updateSettingsStorageState()
  } else {
    byId("quick-note-library-status").textContent = "浏览器未能删除本机闪念，请检查站点存储权限后重试"
    if (button) button.textContent = "删除失败，请重试"
  }
}

function requestRemoveQuickNote(id, button) {
  if (button.dataset.confirming === "true") {
    removeQuickNote(id)
    return
  }
  button.dataset.confirming = "true"
  button.textContent = "确认删除"
  button.setAttribute("aria-label", "再次点击，确认删除这张闪念便签")
  schedule(() => {
    if (!button.isConnected) return
    button.dataset.confirming = "false"
    button.textContent = "删除"
    button.setAttribute("aria-label", "删除这张闪念便签")
  }, 4000)
}

function renderQuickNotes() {
  const records = readQuickNotes()
  const list = byId("quick-note-list")
  list.replaceChildren()
  quickNoteDeckOffset = records.length > 0 ? quickNoteDeckOffset % records.length : 0
  const orderedRecords = records.length > 0
    ? records.slice(quickNoteDeckOffset).concat(records.slice(0, quickNoteDeckOffset))
    : []
  const visibleRecords = orderedRecords.slice(0, 4)
  const frontRecord = visibleRecords[0]
  list.hidden = records.length === 0
  list.classList.toggle("has-photo-front", Boolean(frontRecord?.imageData))
  list.classList.toggle("has-voice-front", Boolean(frontRecord?.voiceDuration))

  visibleRecords.forEach((record, index) => {
    const article = document.createElement("article")
    article.className = "quick-note-card"
    article.classList.add(record.imageData ? "is-photo" : "is-text")
    if (record.voiceDuration > 0) article.classList.add("has-voice")
    if (index > 0) article.classList.add("is-behind")
    article.dataset.stackPosition = String(index)
    article.style.setProperty("--note-tilt", index === 0 ? "-0.35deg" : "0deg")
    article.style.setProperty("--stack-index", String(5 - index))

    if (index > 0) {
      const revealCard = () => {
        quickNoteDeckOffset = records.findIndex((item) => item.id === record.id)
        renderQuickNotes()
      }
      article.tabIndex = 0
      article.setAttribute("role", "button")
      article.setAttribute("aria-label", `把第 ${index + 1} 张闪念移到最上层`)
      article.addEventListener("click", (event) => {
        if (!event.target.closest("button")) revealCard()
      })
      article.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return
        event.preventDefault()
        revealCard()
      })
    }

    const visual = document.createElement("div")
    visual.className = "quick-note-card-visual"
    if (record.imageData) {
      const image = document.createElement("img")
      image.src = record.imageData
      image.alt = record.text.trim() ? `闪念随手拍：${record.text}` : "闪念随手拍"
      image.loading = "lazy"
      visual.append(image)
    }

    const sheet = document.createElement("div")
    sheet.className = "quick-note-card-sheet"

    const meta = document.createElement("div")
    meta.className = "quick-note-card-meta"
    const label = document.createElement("span")
    const modalities = []
    if (record.text.trim()) modalities.push("文字")
    if (record.imageData || record.hadImage) modalities.push("图片")
    if (record.voiceDuration > 0) modalities.push("语音")
    label.textContent = `${modalities.join(" · ")}闪念`
    const time = document.createElement("time")
    time.dateTime = new Date(record.createdAt).toISOString()
    time.textContent = formatQuickNoteDate(record.createdAt)
    meta.append(label, time)

    const content = document.createElement("blockquote")
    content.textContent = record.text.trim() || (record.voiceDuration > 0
      ? "一段还没有转成文字的声音。"
      : "一张图片闪念（原图未保存）。")
    sheet.append(meta, content)
    if (record.voiceDuration > 0) {
      const voice = document.createElement("div")
      voice.className = "quick-note-card-voice"
      const play = document.createElement("span")
      play.textContent = "▶"
      play.setAttribute("aria-hidden", "true")
      const waveform = document.createElement("i")
      waveform.setAttribute("aria-hidden", "true")
      for (let barIndex = 0; barIndex < 11; barIndex += 1) waveform.append(document.createElement("b"))
      const duration = document.createElement("small")
      duration.textContent = formatVoiceDuration(record.voiceDuration)
      voice.append(play, waveform, duration)
      sheet.append(voice)
    }
    visual.append(sheet)

    const actions = document.createElement("div")
    actions.className = "quick-note-card-actions"
    const useButton = document.createElement("button")
    useButton.className = "quick-note-use"
    useButton.type = "button"
    useButton.textContent = "用它开始梳理"
    useButton.addEventListener("click", () => startFlow(record.text || (record.voiceDuration > 0 ? "我想从这段语音开始梳理" : "我想从这张照片开始梳理")))
    const removeButton = document.createElement("button")
    removeButton.className = "quick-note-delete"
    removeButton.type = "button"
    removeButton.textContent = "删除"
    removeButton.setAttribute("aria-label", "删除这张闪念便签")
    removeButton.addEventListener("click", () => requestRemoveQuickNote(record.id, removeButton))
    actions.append(useButton, removeButton)

    article.append(visual, actions)
    list.append(article)
  })

  byId("quick-note-total").textContent = `${records.length} 条`
  byId("quick-note-stack-empty").hidden = records.length > 0
  byId("quick-note-deck-nav").hidden = records.length <= 1
  byId("quick-note-deck-position").textContent = records.length > 0
    ? `${quickNoteDeckOffset + 1} / ${records.length}`
    : "0 / 0"
}

function stepQuickNoteDeck(direction) {
  const records = readQuickNotes()
  if (records.length <= 1) return
  quickNoteDeckOffset = (quickNoteDeckOffset + direction + records.length) % records.length
  renderQuickNotes()
}

function makeEchoRecord(text, days) {
  const now = Date.now()
  const randomPart = Math.random().toString(36).slice(2, 9)
  return {
    id: `${now}-${randomPart}`,
    text,
    createdAt: now,
    dueAt: now + days * DAY_MS,
    delayDays: days
  }
}

function isValidEchoRecord(record) {
  return Boolean(
    record &&
    typeof record.id === "string" &&
    typeof record.text === "string" &&
    record.text.length > 0 &&
    record.text.length <= 120 &&
    Number.isFinite(record.createdAt) &&
    Number.isFinite(record.dueAt)
  )
}

function readEchoes() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(isValidEchoRecord) : []
  } catch (_error) {
    return []
  }
}

function writeEchoes(records) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records))
    return true
  } catch (_error) {
    return false
  }
}

function saveSelectedEcho() {
  if (!flow.saveEcho || !flow.selectedEcho.trim()) return false
  const records = readEchoes()
  records.push(makeEchoRecord(flow.selectedEcho.trim(), flow.echoDelay))
  return writeEchoes(records)
}

function formatEchoDate(timestamp) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric"
  }).format(new Date(timestamp))
}

function delayLabel(days) {
  if (days === 1) return "明天"
  return `${days} 天后`
}

function finishFlow() {
  if (flow.saveEcho && !flow.selectedEcho.trim()) return
  flow.savedEchoThisRun = false

  if (flow.saveEcho) {
    const saved = saveSelectedEcho()
    if (!saved) {
      byId("echo-hint").textContent = "这台浏览器暂时无法保存，请取消勾选后完成，或检查本地存储权限"
      return
    }
    flow.savedEchoThisRun = true
  }

  byId("complete-theme").textContent = `“${flow.selectedTheme}”`
  const selectedAction = currentActionOptions().find((item) => item.id === flow.selectedAction)
  byId("complete-action").textContent = selectedAction
    ? selectedAction.label
    : "今天没有带走行动（这也可以）"
  if (flow.savedEchoThisRun) {
    byId("complete-echo").textContent = `${delayLabel(flow.echoDelay)}回到这里`
  } else if (flow.selectedEcho) {
    byId("complete-echo").textContent = "本次看见，但没有保存"
  } else {
    byId("complete-echo").textContent = "这次没有留下回响"
  }

  renderCompleteTideCards()
  showScreen("complete-screen")
  void queueProfileRefresh("complete")
}

function formatTideCardDate(timestamp) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric"
  }).format(new Date(timestamp))
}

function openCardDetail(card, trigger, collectedAt = null) {
  cardDetailReturnFocus = trigger instanceof HTMLElement ? trigger : document.activeElement
  byId("card-detail-symbol").textContent = card.symbol
  byId("card-detail-label").textContent = card.label
  byId("card-detail-title").textContent = `${card.label}潮笺`
  byId("card-detail-quote").textContent = `“${card.text}”`
  byId("card-detail-description").textContent = card.description
  byId("card-detail-date").textContent = collectedAt
    ? `${formatTideCardDate(collectedAt)} 收进卡槽`
    : "本章刚刚收下"
  cardDetailModal.dataset.tide = card.key
  cardDetailModal.hidden = false
  window.requestAnimationFrame(() => byId("close-card-detail").focus())
}

function closeCardDetail() {
  if (cardDetailModal.hidden) return
  cardDetailModal.hidden = true
  if (
    cardDetailReturnFocus &&
    typeof cardDetailReturnFocus.focus === "function" &&
    cardDetailReturnFocus.isConnected
  ) {
    cardDetailReturnFocus.focus({ preventScroll: true })
  }
  cardDetailReturnFocus = null
}

function renderTideCardLibrary() {
  const records = readTideCardRecords()
  const recordsById = new Map(records.map((record) => [record.id, record]))
  const cards = allTideCards().sort((a, b) => {
    const ownedDifference = Number(recordsById.has(b.id)) - Number(recordsById.has(a.id))
    return ownedDifference
  })
  const grid = byId("tide-card-grid")
  grid.replaceChildren()

  byId("card-slot-count").textContent = `${records.length} / ${cards.length}`
  byId("card-slot-copy").textContent = records.length === 0
    ? "满潮时选择收进卡槽，第一张潮笺就会出现在这里。"
    : `已经遇见 ${records.length} 张潮笺。未收集的位置仍保持留白。`

  cards.forEach((card) => {
    const record = recordsById.get(card.id)
    const item = document.createElement(record ? "button" : "article")
    item.className = "slot-card"
    item.classList.toggle("is-locked", !record)
    item.dataset.tide = card.key

    const meta = document.createElement("p")
    meta.className = "slot-card-meta"
    const symbol = document.createElement("span")
    symbol.textContent = card.symbol
    symbol.setAttribute("aria-hidden", "true")
    const label = document.createElement("strong")
    label.textContent = card.label
    meta.append(symbol, label)

    const quote = document.createElement("blockquote")
    quote.textContent = record ? `“${card.text}”` : "尚未遇见"

    const footer = document.createElement("small")
    footer.textContent = record ? `${formatTideCardDate(record.collectedAt)} 收进卡槽` : "满潮时可能来到这里"

    item.append(meta, quote, footer)
    if (record) {
      item.type = "button"
      item.setAttribute("aria-label", `打开${card.label}潮笺：${card.text}`)
      item.addEventListener("click", () => openCardDetail(card, item, record.collectedAt))
    } else {
      item.setAttribute("aria-label", `${card.label}潮笺，尚未收集`)
    }
    grid.append(item)
  })
}

function renderCompleteTideCards() {
  const section = byId("complete-tide-collection")
  const list = byId("complete-tide-cards")
  list.replaceChildren()
  section.hidden = flow.keptTideQuotes.length === 0
  if (flow.keptTideQuotes.length === 0) return

  const recordsById = new Map(readTideCardRecords().map((record) => [record.id, record]))
  flow.keptTideQuotes.forEach((card) => {
    const button = document.createElement("button")
    button.className = "complete-tide-card"
    button.type = "button"
    button.dataset.tide = card.key
    button.setAttribute("aria-label", `回顾${card.label}潮笺：${card.text}`)

    const symbol = document.createElement("span")
    symbol.textContent = card.symbol
    symbol.setAttribute("aria-hidden", "true")
    const copy = document.createElement("span")
    const label = document.createElement("small")
    label.textContent = card.label
    const text = document.createElement("strong")
    text.textContent = card.text
    copy.append(label, text)
    button.append(symbol, copy)

    const record = recordsById.get(card.id)
    button.addEventListener("click", () => openCardDetail(card, button, record ? record.collectedAt : null))
    list.append(button)
  })

  byId("complete-tide-note").textContent = flow.cardStorageFailed
    ? "本章已经收下这些潮笺，但浏览器未能写入本机卡槽。"
    : "这些卡片已收入本机卡槽；只保存内置卡片编号与收藏时间。"
}

function clearAllTideCards(event) {
  const records = readTideCardRecords()
  if (records.length === 0) {
    renderTideCardLibrary()
    updateSettingsStorageState()
    return
  }

  const button = event && event.currentTarget instanceof HTMLButtonElement
    ? event.currentTarget
    : null
  if (button && button.dataset.confirming !== "true") {
    const original = button.textContent
    button.dataset.confirming = "true"
    button.textContent = "再次点击，确认清空卡槽"
    window.setTimeout(() => {
      if (!button.isConnected) return
      button.dataset.confirming = "false"
      button.textContent = original
    }, 4000)
    return
  }

  if (writeTideCardRecords([])) {
    renderTideCardLibrary()
    updateSettingsStorageState()
  }
}

function removeEchoRecord(id) {
  const records = readEchoes()
  const next = records.filter((record) => record.id !== id)
  if (next.length === records.length) return
  if (writeEchoes(next)) {
    clearMonthlyMemoryCache()
    renderEchoLibrary()
    updateDueEchoCard()
    updateSettingsStorageState()
  }
}

function requestRemoveEchoRecord(id, button) {
  if (button.dataset.confirming === "true") {
    removeEchoRecord(id)
    return
  }

  button.dataset.confirming = "true"
  button.textContent = "确认删除"
  button.setAttribute("aria-label", "再次点击，确认删除这条回响")
  schedule(() => {
    if (!button.isConnected) return
    button.dataset.confirming = "false"
    button.textContent = "删除"
    button.setAttribute("aria-label", "删除这条回响")
  }, 4000)
}

function clearAllEchoes(event) {
  const records = readEchoes()
  if (records.length === 0) {
    renderEchoLibrary()
    updateSettingsStorageState()
    return
  }

  const button = event && event.currentTarget instanceof HTMLButtonElement
    ? event.currentTarget
    : null
  if (button && button.dataset.confirming !== "true") {
    const original = button.textContent
    button.dataset.confirming = "true"
    button.textContent = "再次点击，确认清空"
    schedule(() => {
      if (!button.isConnected) return
      button.dataset.confirming = "false"
      button.textContent = original
    }, 4000)
    return
  }

  if (writeEchoes([])) {
    clearMonthlyMemoryCache()
    renderEchoLibrary()
    updateDueEchoCard()
    updateSettingsStorageState()
  }
}

function renderEchoLibrary() {
  const records = readEchoes().sort((a, b) => a.dueAt - b.dueAt)
  const list = byId("echo-list")
  const now = Date.now()
  list.replaceChildren()

  records.forEach((record) => {
    const due = record.dueAt <= now
    const article = document.createElement("article")
    article.className = "echo-record"
    article.classList.toggle("is-sealed", !due)

    const status = document.createElement("p")
    status.className = "echo-status"
    status.textContent = due ? "已经回到今天" : `封存至 ${formatEchoDate(record.dueAt)}`

    const content = document.createElement("blockquote")
    content.textContent = due ? `“${record.text}”` : "这句话仍在封存中，到约定日期再打开。"

    const meta = document.createElement("div")
    meta.className = "echo-record-meta"
    const date = document.createElement("time")
    date.dateTime = new Date(record.createdAt).toISOString()
    date.textContent = `${formatEchoDate(record.createdAt)} 留下`
    meta.append(date)

    const remove = document.createElement("button")
    remove.className = "delete-echo"
    remove.type = "button"
    remove.textContent = "删除"
    remove.setAttribute("aria-label", due ? "删除这条回响" : "删除这条封存中的回响")
    remove.addEventListener("click", () => {
      requestRemoveEchoRecord(record.id, remove)
    })

    article.append(status, content, meta, remove)
    list.append(article)
  })

  const isEmpty = records.length === 0
  byId("echo-empty").hidden = !isEmpty
  byId("clear-echoes").hidden = isEmpty
}

function updateDueEchoCard() {
  const hasDue = readEchoes().some((record) => record.dueAt <= Date.now())
  byId("due-echo-card").hidden = !hasDue
}

function memoryDateKey(timestamp) {
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function memoryMonthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
}

function memoryArchiveEntries() {
  const now = Date.now()
  const entries = []

  readQuickNotes().forEach((record) => {
    let copy = record.text.trim()
    if (!copy && (record.imageData || record.hadImage)) copy = "一张图片闪念（原图未保存）"
    if (!copy && record.voiceDuration > 0) copy = `一段 ${formatVoiceDuration(record.voiceDuration)} 的语音闪念`
    entries.push({
      id: `thought-${record.id}`,
      sourceId: `quick-note:${record.id}`,
      dateKey: record.dateKey || memoryDateKey(record.createdAt),
      timestamp: record.createdAt,
      type: "thought",
      label: "闪念",
      copy
    })
  })

  readEchoes().forEach((record) => {
    const isDue = record.dueAt <= now
    const createdKey = memoryDateKey(record.createdAt)
    const dueKey = memoryDateKey(record.dueAt)
    entries.push({
      id: `echo-created-${record.id}`,
      sourceId: `echo:${record.id}`,
      dateKey: createdKey,
      timestamp: record.createdAt,
      type: "echo",
      label: "留给未来",
      copy: isDue ? record.text : `一条回响正在封存，将在 ${formatEchoDate(record.dueAt)} 打开`,
      sealed: !isDue
    })
    if (dueKey !== createdKey) {
      entries.push({
        id: `echo-due-${record.id}`,
        sourceId: `echo:${record.id}`,
        dateKey: dueKey,
        timestamp: record.dueAt,
        type: "echo",
        label: isDue ? "回到今天" : "等待回响",
        copy: isDue ? record.text : "这一天，会有一句话重新回到这里",
        sealed: !isDue
      })
    }
  })

  readTideCardRecords().forEach((record) => {
    const card = tideCardFromId(record.id)
    if (!card) return
    entries.push({
      id: `card-${record.id}`,
      sourceId: `tide-card:${record.id}`,
      dateKey: memoryDateKey(record.collectedAt),
      timestamp: record.collectedAt,
      type: "card",
      label: `潮笺 · ${card.label}`,
      copy: card.text
    })
  })

  return entries.sort((a, b) => a.timestamp - b.timestamp)
}

function renderMemoryDay(entries) {
  const selectedDate = memorySelectedDateKey
    ? new Date(`${memorySelectedDateKey}T12:00:00`)
    : new Date()
  byId("memory-day-label").textContent = new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "short"
  }).format(selectedDate)
  byId("memory-day-count").textContent = `${entries.length} 个片段`

  const list = byId("memory-day-items")
  list.replaceChildren()
  if (entries.length === 0) {
    const empty = document.createElement("p")
    empty.className = "memory-day-empty"
    empty.textContent = "这一天还没有存档。写下一点什么，它就会在这里亮起来。"
    list.append(empty)
  } else {
    entries.slice(0, 3).forEach((entry) => {
      const item = document.createElement("article")
      item.className = "memory-day-item"
      item.dataset.type = entry.type
      const marker = document.createElement("span")
      marker.setAttribute("aria-hidden", "true")
      marker.textContent = entry.type === "echo" ? "⌁" : entry.type === "card" ? "▱" : "＋"
      const content = document.createElement("div")
      const label = document.createElement("strong")
      label.textContent = entry.label
      const copy = document.createElement("p")
      copy.textContent = entry.copy
      content.append(label, copy)
      item.append(marker, content)
      list.append(item)
    })
  }
  const more = byId("memory-day-more")
  more.hidden = entries.length <= 3
  more.textContent = entries.length > 3 ? `还有 ${entries.length - 3} 个片段，可从闪念、回响或卡槽入口查看。` : ""
}

function readMonthlyMemoryCache() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(MONTHLY_MEMORY_STORAGE_KEY) || "[]")
    return Array.isArray(parsed) ? parsed.filter((item) => (
      item && /^\d{4}-\d{2}$/.test(item.month) && typeof item.fingerprint === "string" && item.result
    )).slice(0, 24) : []
  } catch (_error) {
    return []
  }
}

function writeMonthlyMemoryCache(records) {
  try {
    window.localStorage.setItem(MONTHLY_MEMORY_STORAGE_KEY, JSON.stringify(records.slice(0, 24)))
    return true
  } catch (_error) {
    return false
  }
}

function clearMonthlyMemoryCache() {
  memoryReflectionAbortController?.abort()
  memoryReflectionAbortController = null
  memoryReflectionRequest += 1
  memoryReflectionRunningFingerprint = ""
  memoryReflectionFailedFingerprints.clear()
  try {
    window.localStorage.removeItem(MONTHLY_MEMORY_STORAGE_KEY)
  } catch (_error) {
    // The current local fallback remains available.
  }
}

function monthlyReflectionText(value, maxLength, fallback = "") {
  return typeof value === "string" && value.trim()
    ? value.trim().replace(/\s+/g, " ").slice(0, maxLength)
    : fallback
}

function sanitizeMonthlyReflection(result) {
  return {
    analysis_status: result?.analysis_status === "sufficient" ? "sufficient" : "limited",
    title: monthlyReflectionText(result?.title, 120, "这个月留下了一些可继续理解的片段"),
    summary: monthlyReflectionText(result?.summary, 1000, "这些片段只代表当月主动留下的内容。"),
    highlights: Array.from(result?.highlights || []).slice(0, 3).map((item) => ({
      label: monthlyReflectionText(item?.label, 50, "一个片段"),
      reflection: monthlyReflectionText(item?.reflection, 260)
    })).filter((item) => item.reflection),
    gentle_question: monthlyReflectionText(result?.gentle_question, 220),
    uncertainty: monthlyReflectionText(result?.uncertainty, 260, "这份回顾只依据当月主动保存的有限片段。")
  }
}

function renderMonthlyReflectionContent(result, statusMessage, state = "ready") {
  byId("memory-ai-title").textContent = result.title
  byId("memory-ai-summary").textContent = result.summary
  const highlights = byId("memory-ai-highlights")
  highlights.replaceChildren()
  result.highlights.forEach((item) => {
    const article = document.createElement("article")
    const label = document.createElement("strong")
    label.textContent = item.label
    const copy = document.createElement("span")
    copy.textContent = item.reflection
    article.append(label, copy)
    highlights.append(article)
  })
  const question = byId("memory-ai-question")
  question.hidden = !result.gentle_question
  question.textContent = result.gentle_question ? `“${result.gentle_question}”` : ""
  const status = byId("memory-ai-status")
  status.textContent = `${statusMessage}${result.uncertainty ? ` · ${result.uncertainty}` : ""}`
  status.dataset.state = state
}

function localMonthlyReflection(month, entries) {
  const thoughts = entries.filter((entry) => entry.type === "thought")
  const echoIds = new Set(entries.filter((entry) => entry.type === "echo").map((entry) => entry.sourceId))
  const activeDays = new Set(entries.map((entry) => entry.dateKey)).size
  return {
    title: `${month.replace("-", " 年 ")} 月，留下 ${activeDays} 个有记录的日子`,
    summary: thoughts.length + echoIds.size > 0
      ? `本月日历里有 ${thoughts.length} 条闪念和 ${echoIds.size} 个未来回响。这里只做数量与日期整理，不推断你的心理状态。`
      : "这个月还没有主动保存的片段，先保持空白也可以。",
    highlights: [],
    gentle_question: "这个月，有哪一天是你愿意轻轻记住的？",
    uncertainty: "本地版本只整理日期和数量。"
  }
}

function monthlyEntriesForModel(entries) {
  const seenEchoes = new Set()
  return entries.filter((entry) => {
    if (entry.type !== "echo") return true
    if (seenEchoes.has(entry.sourceId)) return false
    seenEchoes.add(entry.sourceId)
    return true
  }).map((entry) => ({
    date: entry.dateKey,
    type: entry.type,
    label: entry.type === "echo" ? (entry.sealed ? "未解封回响" : "已解封回响") : "闪念",
    copy: entry.type === "echo"
      ? (entry.sealed ? "当月有一条仍在封存的未来回响" : "当月有一条已经解封的未来回响")
      : entry.copy
  })).slice(-30)
}

function monthlyReflectionEvidence(month, entries) {
  const modelEntries = monthlyEntriesForModel(entries)
  const envelope = activeProfileEnvelope()
  const profileForMonth = envelope?.generated_at?.slice(0, 7) === month
    ? narrativeProfileContext(envelope)
    : null
  return {
    modelEntries,
    profileForMonth,
    fingerprint: evidenceFingerprint({ month, entries: modelEntries, profile: profileForMonth })
  }
}

function renderStoredOrLocalMonthlyReflection(month, entries) {
  const { fingerprint } = monthlyReflectionEvidence(month, entries)
  const cached = readMonthlyMemoryCache().find((item) => item.month === month && item.fingerprint === fingerprint)
  const refreshButton = byId("memory-ai-refresh")
  refreshButton.disabled = entries.length === 0
  if (cached) {
    refreshButton.textContent = "更新"
    renderMonthlyReflectionContent(
      sanitizeMonthlyReflection(cached.result),
      `由 ${cached.model || "自定义模型"} 生成并保存在本机`
    )
    return
  }
  refreshButton.textContent = "生成"
  renderMonthlyReflectionContent(
    localMonthlyReflection(month, entries),
    entries.length > 0
      ? "当前仅显示本地整理；点“生成”后才会按授权发送当月文字化片段"
      : "没有片段，因此不需要调用模型",
    "idle"
  )
}

async function maybeGenerateMonthlyReflection(month, entries, { force = false } = {}) {
  const { modelEntries, profileForMonth, fingerprint } = monthlyReflectionEvidence(month, entries)
  const cached = readMonthlyMemoryCache().find((item) => item.month === month && item.fingerprint === fingerprint)
  if (cached && !force) {
    renderMonthlyReflectionContent(sanitizeMonthlyReflection(cached.result), `由 ${cached.model || "自定义模型"} 生成并保存在本机`)
    return cached
  }

  const fallback = localMonthlyReflection(month, entries)
  if (modelEntries.length === 0) {
    renderMonthlyReflectionContent(fallback, "没有片段，因此没有调用模型", "idle")
    return null
  }
  if (!profileRuntime.consent.serviceProcessing || !profileRuntime.consent.profilePersonalization || !hasApiSettings()) {
    renderMonthlyReflectionContent(fallback, "开启自定义 API 与持续画像后可生成月度回顾", "idle")
    return null
  }
  if (force) memoryReflectionFailedFingerprints.delete(fingerprint)
  if (!force && memoryReflectionFailedFingerprints.has(fingerprint)) {
    renderMonthlyReflectionContent(fallback, "上次模型生成失败；可点“更新”手动重试", "error")
    return null
  }
  if (!force && memoryReflectionRunningFingerprint === fingerprint) return null

  memoryReflectionAbortController?.abort()
  memoryReflectionAbortController = new AbortController()
  memoryReflectionRunningFingerprint = fingerprint
  const request = ++memoryReflectionRequest
  renderMonthlyReflectionContent(fallback, "正在后台生成本月回顾；日历仍可继续使用", "updating")
  byId("memory-ai-refresh").disabled = true
  try {
    const response = await generateMonthlyReflection({
      month,
      entries: modelEntries,
      profileContext: profileForMonth,
      signal: memoryReflectionAbortController.signal
    })
    if (
      request !== memoryReflectionRequest ||
      memoryMonthKey(memoryMonthCursor) !== month ||
      !profileRuntime.consent.serviceProcessing ||
      !profileRuntime.consent.profilePersonalization
    ) {
      return null
    }
    if (response.result?.safety_notice?.level && response.result.safety_notice.level !== "not_indicated") {
      renderMonthlyReflectionContent(fallback, "模型内容已转为安全支持提示，未写入本机回顾缓存", "warning")
      openSafety(null)
      return null
    }
    const result = sanitizeMonthlyReflection(response.result)
    const records = readMonthlyMemoryCache().filter((item) => item.month !== month)
    records.unshift({ month, fingerprint, generatedAt: response.generated_at, model: response.model, result })
    writeMonthlyMemoryCache(records)
    if (request === memoryReflectionRequest && memoryMonthKey(memoryMonthCursor) === month) {
      renderMonthlyReflectionContent(result, `由 ${response.model} 生成并保存在本机`)
    }
    return result
  } catch (error) {
    if (!(error instanceof ApiError && error.code === "client_aborted") && request === memoryReflectionRequest) {
      memoryReflectionFailedFingerprints.add(fingerprint)
      renderMonthlyReflectionContent(
        cached ? sanitizeMonthlyReflection(cached.result) : fallback,
        `模型回顾暂时不可用：${error?.message || "未知错误"}`,
        "error"
      )
    }
    return null
  } finally {
    if (request === memoryReflectionRequest) {
      memoryReflectionAbortController = null
      memoryReflectionRunningFingerprint = ""
      byId("memory-ai-refresh").disabled = false
    }
  }
}

function renderMemoryArchive({ forceReflection = false, generateReflection = false } = {}) {
  const year = memoryMonthCursor.getFullYear()
  const month = memoryMonthCursor.getMonth()
  const prefix = memoryMonthKey(memoryMonthCursor)
  const entries = memoryArchiveEntries()
  const entriesInMonth = entries.filter((entry) => entry.dateKey.startsWith(prefix))
  const entriesByDate = new Map()
  entriesInMonth.forEach((entry) => {
    const dayEntries = entriesByDate.get(entry.dateKey) || []
    dayEntries.push(entry)
    entriesByDate.set(entry.dateKey, dayEntries)
  })

  const todayKey = memoryDateKey(Date.now())
  if (!memorySelectedDateKey.startsWith(prefix)) {
    const activeDates = Array.from(entriesByDate.keys()).sort()
    memorySelectedDateKey = todayKey.startsWith(prefix)
      ? todayKey
      : (activeDates[activeDates.length - 1] || `${prefix}-01`)
  }

  byId("memory-month-label").textContent = `${year} / ${month + 1}`
  byId("memory-calendar").setAttribute("aria-label", `${year}年${month + 1}月时光记录`)
  const calendar = byId("memory-calendar")
  calendar.replaceChildren()
  const leadingDays = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  for (let index = 0; index < leadingDays; index += 1) {
    const spacer = document.createElement("span")
    spacer.className = "memory-day-spacer"
    spacer.setAttribute("aria-hidden", "true")
    calendar.append(spacer)
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateKey = `${prefix}-${String(day).padStart(2, "0")}`
    const dayEntries = entriesByDate.get(dateKey) || []
    const button = document.createElement("button")
    button.type = "button"
    button.className = "memory-day"
    button.classList.toggle("has-thought", dayEntries.some((entry) => entry.type === "thought"))
    button.classList.toggle("has-echo", dayEntries.some((entry) => entry.type === "echo"))
    button.classList.toggle("has-card", dayEntries.some((entry) => entry.type === "card"))
    button.classList.toggle("is-today", dateKey === todayKey)
    button.classList.toggle("is-selected", dateKey === memorySelectedDateKey)
    button.setAttribute("role", "gridcell")
    button.setAttribute("aria-selected", String(dateKey === memorySelectedDateKey))
    button.setAttribute("aria-label", `${month + 1}月${day}日，${dayEntries.length}个片段`)
    const number = document.createElement("span")
    number.textContent = String(day)
    button.append(number)
    button.addEventListener("click", () => {
      memorySelectedDateKey = dateKey
      renderMemoryArchive()
    })
    calendar.append(button)
  }

  const thoughtCount = entriesInMonth.filter((entry) => entry.type === "thought").length
  const echoCount = new Set(entriesInMonth.filter((entry) => entry.type === "echo").map((entry) => entry.sourceId)).size
  const cardCount = entriesInMonth.filter((entry) => entry.type === "card").length
  const totalParts = []
  if (thoughtCount) totalParts.push(`${thoughtCount} 条闪念`)
  if (echoCount) totalParts.push(`${echoCount} 个回响`)
  if (cardCount) totalParts.push(`${cardCount} 张潮笺`)
  byId("memory-month-total").textContent = totalParts.length > 0
    ? totalParts.join(" · ")
    : "这个月还没有留下记录"
  byId("memory-month-next").disabled = prefix >= memoryMonthKey(new Date())
  renderMemoryDay(entriesByDate.get(memorySelectedDateKey) || [])
  if (generateReflection) {
    void maybeGenerateMonthlyReflection(prefix, entriesInMonth, { force: forceReflection })
  } else {
    renderStoredOrLocalMonthlyReflection(prefix, entriesInMonth)
  }
}

function shiftMemoryMonth(offset) {
  const next = new Date(memoryMonthCursor.getFullYear(), memoryMonthCursor.getMonth() + offset, 1)
  if (memoryMonthKey(next) > memoryMonthKey(new Date())) return
  memoryReflectionAbortController?.abort()
  memoryReflectionRequest += 1
  memoryReflectionRunningFingerprint = ""
  memoryMonthCursor = next
  memorySelectedDateKey = ""
  renderMemoryArchive()
}

function updateSettingsStorageState() {
  const button = byId("settings-clear-echoes")
  const count = readEchoes().length
  button.disabled = count === 0
  button.textContent = count === 0 ? "没有已保存的回响" : `删除全部已保存回响（${count}）`

  const cardButton = byId("settings-clear-tide-cards")
  const cardCount = readTideCardRecords().length
  cardButton.disabled = cardCount === 0
  cardButton.textContent = cardCount === 0 ? "卡槽目前为空" : `清空潮笺卡槽（${cardCount}）`
  const quickNoteButton = byId("settings-clear-quick-notes")
  const quickNoteCount = readQuickNotes().length
  quickNoteButton.disabled = quickNoteCount === 0
  quickNoteButton.textContent = quickNoteCount === 0 ? "闪念目前为空" : `清空随手闪念（${quickNoteCount}）`
  byId("my-card-slot-count").textContent = cardCount === 0 ? "还没有收下潮笺" : `已经收下 ${cardCount} 张潮笺`
  byId("my-echo-count").textContent = count === 0 ? "还没有留给未来的话" : `已经保存 ${count} 条回响`
  renderInitialImpression()
  renderMemoryArchive()
  renderAiState()
}

function openOnboarding(event) {
  onboardingReturnFocus = event && event.currentTarget instanceof HTMLElement
    ? event.currentTarget
    : document.activeElement
  onboardingModal.hidden = false
  window.requestAnimationFrame(() => byId("close-onboarding").focus())
}

function closeOnboarding(remember = true) {
  if (onboardingModal.hidden) return
  onboardingModal.hidden = true
  if (remember) {
    try {
      window.localStorage.setItem(ONBOARDING_STORAGE_KEY, "seen")
    } catch (_error) {
      // The tutorial can still be dismissed for this page session.
    }
  }
  if (
    onboardingReturnFocus &&
    typeof onboardingReturnFocus.focus === "function" &&
    onboardingReturnFocus.isConnected
  ) {
    onboardingReturnFocus.focus({ preventScroll: true })
  }
  onboardingReturnFocus = null
}

function shouldAutoOpenOnboarding() {
  try {
    return window.localStorage.getItem(ONBOARDING_STORAGE_KEY) !== "seen"
  } catch (_error) {
    return true
  }
}

function openGameTutorial(event) {
  gameTutorialReturnFocus = event && event.currentTarget instanceof HTMLElement
    ? event.currentTarget
    : storyCard
  gameTutorialModal.hidden = false
  window.requestAnimationFrame(() => byId("close-game-tutorial").focus())
}

function closeGameTutorial(remember = true) {
  if (gameTutorialModal.hidden) return
  gameTutorialModal.hidden = true
  if (remember) {
    try {
      window.localStorage.setItem(GAME_TUTORIAL_STORAGE_KEY, "seen")
    } catch (_error) {
      // The tutorial can still be dismissed for this page session.
    }
  }
  if (
    gameTutorialReturnFocus &&
    typeof gameTutorialReturnFocus.focus === "function" &&
    gameTutorialReturnFocus.isConnected
  ) {
    gameTutorialReturnFocus.focus({ preventScroll: true })
  }
  gameTutorialReturnFocus = null
}

function shouldAutoOpenGameTutorial() {
  try {
    return window.localStorage.getItem(GAME_TUTORIAL_STORAGE_KEY) !== "seen"
  } catch (_error) {
    return true
  }
}

function setVoiceCallState(active) {
  const button = byId("voice-call-toggle")
  button.setAttribute("aria-pressed", String(active))
  button.setAttribute("aria-label", active ? "结束实时语音转写" : "开始实时语音转写")
  button.classList.toggle("is-active", active)
}

function openVoiceMode(event) {
  voiceModalReturnFocus = event && event.currentTarget instanceof HTMLElement
    ? event.currentTarget
    : document.activeElement
  if (activeAsrOwner === "chat") cancelActiveAsrImmediately("chat")
  setVoiceCallState(false)
  byId("voice-call-status").textContent = "点麦克风开始；转写会放进当前对话输入框"
  voiceModal.hidden = false
  window.requestAnimationFrame(() => byId("close-voice-mode").focus())
}

function closeVoiceMode() {
  if (voiceModal.hidden) return
  if (activeAsrOwner === "voice-modal") void stopRealtimeAsr()
  voiceModal.hidden = true
  setVoiceCallState(false)
  if (
    voiceModalReturnFocus &&
    typeof voiceModalReturnFocus.focus === "function" &&
    voiceModalReturnFocus.isConnected
  ) {
    voiceModalReturnFocus.focus({ preventScroll: true })
  }
  voiceModalReturnFocus = null
}

async function toggleVoiceCall() {
  if (activeAsrOwner === "voice-modal") await stopRealtimeAsr()
  else await startRealtimeAsr("voice-modal")
}

function trapModalFocus(event) {
  if (event.key !== "Tab") return
  const activeModal = !voiceModal.hidden
    ? voiceModal
    : (!onboardingModal.hidden
      ? onboardingModal
      : (!gameTutorialModal.hidden
        ? gameTutorialModal
        : (!cardDetailModal.hidden
          ? cardDetailModal
          : (!tideModal.hidden
            ? tideModal
            : (!aiConsentModal.hidden ? aiConsentModal : (!safetyModal.hidden ? safetyModal : null))))))
  if (!activeModal) return
  const focusable = Array.from(activeModal.querySelectorAll(
    "button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type='hidden']), a[href]"
  ))
  if (focusable.length === 0) return
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

document.querySelectorAll("[data-nav-target]").forEach((control) => {
  control.addEventListener("click", (event) => {
    event.preventDefault()
    if (control.dataset.navTarget === "chat-screen") {
      openStandaloneChat()
    } else {
      showScreen(control.dataset.navTarget)
    }
  })
})

document.querySelectorAll("[data-start-new]").forEach((button) => {
  button.addEventListener("click", startNewFlow)
})

byId("start-flow").addEventListener("click", startNewFlow)
byId("restart-flow").addEventListener("click", startNewFlow)
byId("draw-answer").addEventListener("click", drawAnswerBookCard)
byId("open-daily-report").addEventListener("click", () => showScreen("report-screen"))
byId("report-back").addEventListener("click", () => showScreen("today-screen"))
byId("report-start-chat").addEventListener("click", () => openStandaloneChat({ fromReport: true }))
backgroundMusicToggle.addEventListener("click", toggleBackgroundMusic)
backgroundMusic.addEventListener("play", syncBackgroundMusicButton)
backgroundMusic.addEventListener("pause", syncBackgroundMusicButton)
backgroundMusic.addEventListener("error", () => {
  backgroundMusicToggle.disabled = true
  backgroundMusicToggle.classList.remove("is-playing")
  backgroundMusicToggle.setAttribute("aria-pressed", "false")
  backgroundMusicToggle.setAttribute("aria-label", "雨声背景音乐暂时无法播放")
  byId("background-music-status").textContent = "不可用"
})
document.querySelectorAll("[data-report-feedback]").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll("[data-report-feedback]").forEach((item) => {
      item.setAttribute("aria-pressed", String(item === button))
    })
    byId("report-feedback-status").textContent = button.dataset.reportFeedback === "helpful"
      ? "收到。之后会继续保持这种低负担、可解释的表达。"
      : "收到。这不会被当成你的问题，之后会降低这类推断的权重。"
    writeReportFeedback(button.dataset.reportFeedback)
    void queueProfileRefresh("feedback")
  })
})

byId("quick-note-add-attachment").addEventListener("click", toggleQuickNoteComposer)
byId("quick-note-deck-previous").addEventListener("click", () => stepQuickNoteDeck(-1))
byId("quick-note-deck-next").addEventListener("click", () => stepQuickNoteDeck(1))

byId("quick-note-input").addEventListener("input", (event) => {
  const length = event.currentTarget.value.length
  if (!event.currentTarget.value.trim() && pendingQuickNoteVoiceDuration > 0 && activeAsrOwner !== "quick-note") {
    pendingQuickNoteVoiceDuration = 0
    byId("quick-note-voice-preview").hidden = true
  }
  event.currentTarget.style.height = "auto"
  event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 96)}px`
  byId("quick-note-count").textContent = `${length} / ${QUICK_NOTE_MAX_LENGTH}`
  updateQuickNoteSaveState()
  if (!quickNoteVoiceStartedAt) byId("quick-note-status").textContent = ""
})
;[byId("quick-note-photo-input"), byId("quick-note-camera-input")].forEach((input) => {
  input.addEventListener("change", (event) => {
    const file = event.currentTarget.files && event.currentTarget.files[0]
    if (file) handleQuickNotePhoto(file)
  })
})
byId("remove-quick-note-photo").addEventListener("click", () => {
  clearQuickNotePhoto()
  byId("quick-note-status").textContent = "图片已移除，仍可以留下文字或语音"
})
byId("quick-note-image-rights-confirmed").addEventListener("change", (event) => {
  byId("quick-note-status").textContent = event.currentTarget.checked
    ? "已确认：若持续画像已开启，这张图最多发送给自定义模型端点一次"
    : "图片只在本次页面预览，不会发送给模型"
})
byId("quick-note-voice").addEventListener("click", toggleQuickNoteVoiceRecording)
byId("remove-quick-note-voice").addEventListener("click", async () => {
  await clearQuickNoteVoice()
  byId("quick-note-status").textContent = "语音已移除，仍可以留下文字或图片"
})
byId("quick-note-form").addEventListener("submit", async (event) => {
  event.preventDefault()
  if (activeAsrOwner === "quick-note") await stopRealtimeAsr()
  const input = byId("quick-note-input")
  if (!input.value.trim() && !pendingQuickNoteImage && pendingQuickNoteVoiceDuration === 0) return
  if (!saveQuickNote(
    input.value,
    pendingQuickNoteImage,
    pendingQuickNoteVoiceDuration,
    byId("quick-note-image-rights-confirmed").checked
  )) {
    byId("quick-note-status").textContent = "暂时无法提交，请稍后再试"
    return
  }
  byId("quick-note-library-status").textContent = "已提交并收进闪念，初印象已随之更新"
  renderQuickNotes()
  updateSettingsStorageState()
  resetQuickNoteComposer()
  if (profileRuntime.consent.profilePersonalization) void queueProfileRefresh("notes")
})

byId("notes-back").addEventListener("click", () => showScreen("today-screen"))
byId("add-note").addEventListener("click", () => {
  if (flow.notes.length >= 4) return
  flow.notes.push("")
  renderNotes(flow.notes.length - 1)
})
byId("use-note-example").addEventListener("click", () => {
  flow.notes = [
    "刚才又担心自己做得不够好。",
    "明明很累，却还是不敢停下来。",
    "朋友问我怎么样，我差点又说没事。"
  ]
  renderNotes(0)
})
byId("notes-personalize").addEventListener("change", (event) => {
  flow.personalizeNotes = event.currentTarget.checked
})
byId("note-images").addEventListener("change", (event) => {
  addNoteImages(event.currentTarget.files || [])
  event.currentTarget.value = ""
})
byId("images-rights-confirmed").addEventListener("change", (event) => {
  flow.imageRightsConfirmed = event.currentTarget.checked
  renderNoteImages()
})
byId("notes-continue").addEventListener("click", async () => {
  if (countFilledNotes() < 2) return
  flow.themeCandidates = generateThemeCandidates()
  flow.selectedTheme = ""
  flow.themeSource = ""
  byId("custom-theme").value = ""
  renderThemeOptions()
  showScreen("theme-screen")

  if (!flow.personalizeNotes) return
  const consent = await requestAiConsent({
    profileRequested: true,
    reason: "持续画像可以在后台把这些闪念转成可修正的主题、行动和日报。"
  })
  if (consent.profilePersonalization) void queueProfileRefresh("notes")
})

byId("theme-back").addEventListener("click", () => showScreen("notes-screen"))
document.querySelectorAll("[data-theme-index]").forEach((button) => {
  button.addEventListener("click", () => {
    const index = Number(button.dataset.themeIndex)
    flow.selectedTheme = flow.themeCandidates[index]
    flow.themeSource = "candidate"
    updateThemeControls()
  })
})
byId("custom-theme").addEventListener("input", () => {
  if (flow.themeSource === "custom") {
    flow.selectedTheme = ""
    flow.themeSource = ""
  }
  updateThemeControls()
})
byId("choose-custom-theme").addEventListener("click", () => {
  const custom = byId("custom-theme").value.trim()
  if (!custom) return
  flow.selectedTheme = custom
  flow.themeSource = "custom"
  updateThemeControls()
})
byId("theme-continue").addEventListener("click", () => {
  if (!flow.selectedTheme) return
  void queueProfileRefresh("notes")
  showOverview()
})

byId("overview-back").addEventListener("click", () => showScreen("theme-screen"))
byId("overview-start").addEventListener("click", beginGame)
byId("game-back").addEventListener("click", () => {
  cancelDrag()
  showScreen("overview-screen")
})

byId("left-button").addEventListener("click", () => chooseCard("left"))
byId("right-button").addEventListener("click", () => chooseCard("right"))
byId("neutral-button").addEventListener("click", () => chooseCard("neutral"))

storyCard.addEventListener("pointerdown", (event) => {
  if (locked || event.button !== 0) return
  dragging = true
  dragStartX = event.clientX
  dragX = 0
  storyCard.setPointerCapture(event.pointerId)
  storyCard.classList.add("is-dragging")
})

storyCard.addEventListener("pointermove", (event) => {
  if (!dragging || locked) return
  dragX = event.clientX - dragStartX
  const rotation = Math.max(-12, Math.min(12, dragX / 18))
  storyCard.style.transform = `translateX(${dragX}px) rotate(${rotation}deg)`
  leftPreview.style.opacity = String(Math.max(0, Math.min(1, -dragX / 90)))
  rightPreview.style.opacity = String(Math.max(0, Math.min(1, dragX / 90)))
})

storyCard.addEventListener("pointerup", (event) => {
  if (!dragging || locked) return
  if (storyCard.hasPointerCapture(event.pointerId)) storyCard.releasePointerCapture(event.pointerId)
  dragging = false
  storyCard.classList.remove("is-dragging")
  if (Math.abs(dragX) > 86) {
    chooseCard(dragX < 0 ? "left" : "right")
  } else {
    cancelDrag()
  }
})

storyCard.addEventListener("pointercancel", cancelDrag)
storyCard.addEventListener("lostpointercapture", () => {
  if (dragging && !locked) cancelDrag()
})
storyCard.addEventListener("keydown", (event) => {
  const directions = {
    ArrowLeft: "left",
    ArrowRight: "right",
    ArrowDown: "neutral"
  }
  if (!directions[event.key]) return
  event.preventDefault()
  chooseCard(directions[event.key])
})

byId("chat-back").addEventListener("click", () => {
  if (flow.chatMode === "flow") {
    flow.currentCard = cards.length - 1
    showScreen("game-screen")
    renderCard()
  } else {
    showScreen("today-screen")
  }
})
byId("chat-input").addEventListener("input", (event) => {
  if (!event.currentTarget.value.trim()) chatDraftFromVoice = false
  byId("send-chat").disabled = flow.chatBusy || event.currentTarget.value.trim().length === 0
})
byId("voice-input").addEventListener("click", toggleVoiceInput)
byId("open-voice-mode").addEventListener("click", openVoiceMode)
byId("chat-form").addEventListener("submit", async (event) => {
  event.preventDefault()
  if (["chat", "voice-modal"].includes(activeAsrOwner)) await stopRealtimeAsr()
  await sendChatMessage(byId("chat-input").value)
})
document.querySelectorAll("[data-chat-prompt]").forEach((button) => {
  button.addEventListener("click", async () => {
    if (["chat", "voice-modal"].includes(activeAsrOwner)) await stopRealtimeAsr({ cancel: true })
    await sendChatMessage(button.dataset.chatPrompt, { inputMode: "text" })
  })
})
byId("chat-crisis-help").addEventListener("click", () => {
  if (["chat", "voice-modal"].includes(activeAsrOwner)) cancelActiveAsrImmediately(activeAsrOwner)
  cancelRuntimeTimers()
  if (chatAbortController) {
    chatAbortController.abort()
    chatAbortController = null
  }
  flow.chatBusy = false
  flow.chatCrisis = true
  if (!flow.chatMessages.some((message) => message.safety)) {
    flow.chatMessages.push({
      role: "bot",
      safety: true,
      text: "我们先把安全放在最前面。请联系所在地紧急服务、危机支持资源，或一位能马上来到你身边的人。"
    })
  }
  renderChat()
})
byId("end-chat").addEventListener("click", endChat)

document.querySelectorAll("[data-action-id]").forEach((button) => {
  button.addEventListener("click", () => {
    flow.selectedAction = button.dataset.actionId
    renderActionRecommendation()
  })
})
byId("action-back").addEventListener("click", () => {
  if (flow.chatMode === "flow" && flow.chatMessages.length > 0) {
    showScreen("chat-screen")
  } else {
    beginChat()
  }
})
byId("skip-action").addEventListener("click", () => {
  flow.selectedAction = ""
  void queueProfileRefresh("action")
  showEchoScreen()
})
byId("action-continue").addEventListener("click", () => {
  if (!flow.selectedAction) return
  void queueProfileRefresh("action")
  showEchoScreen()
})

document.querySelectorAll("[data-echo-index]").forEach((button) => {
  button.addEventListener("click", () => {
    const index = Number(button.dataset.echoIndex)
    flow.selectedEcho = buildEchoCandidates()[index]
    flow.echoSource = "candidate"
    byId("custom-echo").value = ""
    updateEchoSelection()
  })
})
byId("custom-echo").addEventListener("input", (event) => {
  flow.selectedEcho = event.currentTarget.value.trim()
  flow.echoSource = flow.selectedEcho ? "custom" : ""
  updateEchoSelection()
})
document.querySelectorAll("[data-delay]").forEach((button) => {
  button.addEventListener("click", () => {
    flow.echoDelay = Number(button.dataset.delay)
    updateEchoSelection()
  })
})
byId("save-echo").addEventListener("change", (event) => {
  flow.saveEcho = event.currentTarget.checked
  updateEchoSelection()
})
byId("echo-back").addEventListener("click", showActionScreen)
byId("finish-flow").addEventListener("click", finishFlow)

byId("clear-echoes").addEventListener("click", clearAllEchoes)
byId("settings-clear-echoes").addEventListener("click", clearAllEchoes)
byId("settings-clear-tide-cards").addEventListener("click", clearAllTideCards)
byId("settings-clear-quick-notes").addEventListener("click", clearAllQuickNotes)
byId("memory-month-previous").addEventListener("click", () => shiftMemoryMonth(-1))
byId("memory-month-next").addEventListener("click", () => shiftMemoryMonth(1))
byId("memory-ai-refresh").addEventListener("click", () => renderMemoryArchive({ forceReflection: true, generateReflection: true }))
byId("custom-api-save").addEventListener("click", saveCustomApiSettings)
byId("custom-api-test").addEventListener("click", () => void testCustomApiSettings())
byId("custom-api-clear").addEventListener("click", clearCustomApiSettings)
document.querySelectorAll("[data-custom-api-field]").forEach((field) => {
  field.addEventListener("input", () => {
    setApiSettingsStatus("表单有未保存的修改；测试不会自动保存。", "warning")
  })
})
byId("custom-asr-save").addEventListener("click", saveCustomAsrSettings)
byId("custom-asr-test").addEventListener("click", () => void testCustomAsrSettings())
byId("custom-asr-clear").addEventListener("click", clearCustomAsrSettings)
document.querySelectorAll("[data-custom-asr-field]").forEach((field) => {
  field.addEventListener("input", () => {
    cancelAsrSettingsTest()
    setAsrSettingsStatus("表单有未保存的修改；测试不会自动保存。", "warning")
  })
})
document.querySelectorAll("[data-credential-target]").forEach((button) => {
  button.addEventListener("click", toggleCredentialVisibility)
})
byId("enable-ai-consent").addEventListener("click", () => {
  if (!hasApiSettings()) {
    closeAiConsent({ accepted: false })
    goToApiSettings()
    return
  }
  closeAiConsent({ accepted: true })
})
byId("decline-ai-consent").addEventListener("click", () => closeAiConsent({ accepted: false }))
byId("ai-consent-back").addEventListener("click", () => closeAiConsent({ accepted: false }))
byId("ai-service-consent").addEventListener("change", (event) => {
  profileRuntime.setConsent({
    serviceProcessing: event.currentTarget.checked,
    profilePersonalization: event.currentTarget.checked
      ? profileRuntime.consent.profilePersonalization
      : false
  })
  if (!event.currentTarget.checked) {
    memoryReflectionAbortController?.abort()
    memoryReflectionRequest += 1
    memoryReflectionRunningFingerprint = ""
  }
  renderAiState()
  if (activeScreenId === "settings-screen") renderMemoryArchive()
})
byId("ai-profile-consent").addEventListener("change", (event) => {
  profileRuntime.setConsent({
    serviceProcessing: true,
    profilePersonalization: event.currentTarget.checked
  })
  renderAiState()
  if (event.currentTarget.checked) {
    void queueProfileRefresh("complete")
  } else {
    memoryReflectionAbortController?.abort()
    memoryReflectionRequest += 1
    memoryReflectionRunningFingerprint = ""
  }
  if (activeScreenId === "settings-screen") renderMemoryArchive()
})
byId("settings-clear-profile").addEventListener("click", () => {
  clearMonthlyMemoryCache()
  profileRuntime.clearProfile()
  renderAiState()
  renderTodayReport()
  renderMemoryArchive()
})

byId("keep-tide-quote").addEventListener("click", () => closeTideQuote(true))
byId("skip-tide-quote").addEventListener("click", () => closeTideQuote(false))
byId("close-card-detail").addEventListener("click", closeCardDetail)
cardDetailModal.addEventListener("click", (event) => {
  if (event.target === cardDetailModal) closeCardDetail()
})

byId("open-onboarding").addEventListener("click", openOnboarding)
byId("reopen-onboarding").addEventListener("click", openOnboarding)
byId("open-tutorial-from-settings").addEventListener("click", openOnboarding)
byId("close-onboarding").addEventListener("click", () => closeOnboarding(true))
byId("finish-onboarding").addEventListener("click", () => {
  closeOnboarding(true)
  showScreen("today-screen")
})
onboardingModal.addEventListener("click", (event) => {
  if (event.target === onboardingModal) closeOnboarding(true)
})

byId("open-game-tutorial").addEventListener("click", openGameTutorial)
byId("close-game-tutorial").addEventListener("click", () => closeGameTutorial(true))
byId("finish-game-tutorial").addEventListener("click", () => closeGameTutorial(true))
gameTutorialModal.addEventListener("click", (event) => {
  if (event.target === gameTutorialModal) closeGameTutorial(true)
})

byId("close-voice-mode").addEventListener("click", closeVoiceMode)
byId("voice-call-toggle").addEventListener("click", toggleVoiceCall)
voiceModal.addEventListener("click", (event) => {
  if (event.target === voiceModal) closeVoiceMode()
})
document.addEventListener("click", (event) => {
  const attachmentControl = document.querySelector(".quick-note-attachment-control")
  if (attachmentControl && !attachmentControl.contains(event.target)) closeQuickNoteComposer()
})
document.addEventListener("keydown", (event) => {
  if (!byId("quick-note-attachment-menu").hidden && event.key === "Escape") {
    event.preventDefault()
    closeQuickNoteComposer()
    return
  }
  if (activeAsrOwner === "quick-note" && event.key === "Escape") {
    event.preventDefault()
    void clearQuickNoteVoice()
    byId("quick-note-status").textContent = "已取消实时语音转写"
    return
  }
  if (!voiceModal.hidden && event.key === "Escape") {
    event.preventDefault()
    closeVoiceMode()
    return
  }
  if (!onboardingModal.hidden && event.key === "Escape") {
    event.preventDefault()
    closeOnboarding(true)
    return
  }
  if (!gameTutorialModal.hidden && event.key === "Escape") {
    event.preventDefault()
    closeGameTutorial(true)
    return
  }
  if (!cardDetailModal.hidden && event.key === "Escape") {
    event.preventDefault()
    closeCardDetail()
    return
  }
  if (!tideModal.hidden && event.key === "Escape") {
    event.preventDefault()
    closeTideQuote(false)
    return
  }
  if (!aiConsentModal.hidden && event.key === "Escape") {
    event.preventDefault()
    closeAiConsent({ accepted: false })
    return
  }
  if (!safetyModal.hidden && event.key === "Escape") {
    event.preventDefault()
    closeSafety()
    return
  }
  trapModalFocus(event)
})
window.addEventListener("pagehide", () => {
  cancelAsrSettingsTest()
  if (activeAsrSession) cancelActiveAsrImmediately(activeAsrOwner)
})
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    cancelAsrSettingsTest()
    if (activeAsrSession) cancelActiveAsrImmediately(activeAsrOwner)
  }
})

quickNoteRecords = loadStoredQuickNotes()
renderNotes()
initializeAiIntegration()
updateDueEchoCard()
updateSettingsStorageState()
showScreen(activeScreenId, { focus: false })
if (shouldAutoOpenOnboarding()) window.requestAnimationFrame(() => openOnboarding())
