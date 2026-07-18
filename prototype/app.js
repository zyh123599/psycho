"use strict"

const STORAGE_KEY = "xinchao.future-echoes.v1"
const CARD_STORAGE_KEY = "xinchao.tide-cards.v1"
const QUICK_NOTE_STORAGE_KEY = "xinchao.quick-notes.v1"
const QUICK_NOTE_MAX_LENGTH = 200
const QUICK_NOTE_LIMIT = 50
const DAY_MS = 24 * 60 * 60 * 1000

const cards = [
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
    label: "照见",
    symbol: "◐",
    description: "辨认念头、感受与正在发生的模式",
    quotes: [
      "看见正在发生什么，本身就是一点变化。",
      "你不必马上解释自己，先准确地看见就好。",
      "当一个念头被看见，它就不再等于全部的你。"
    ]
  },
  grounding: {
    label: "安住",
    symbol: "⌁",
    description: "为身体、边界与当下留出落脚处",
    quotes: [
      "先让此刻有地方落脚，答案可以晚一点来。",
      "暂停不是离开生活，是把自己也放回生活里。",
      "你可以先稳稳地站在这里，再决定下一步。"
    ]
  },
  connection: {
    label: "相连",
    symbol: "∞",
    description: "与他人，也与内在不同的声音保持联系",
    quotes: [
      "靠近不必一次说完，一句真实也能成为入口。",
      "被听见之前，你可以只说愿意说的那一点。",
      "关系不要求你立刻完整，真实的一小部分也可以。"
    ]
  },
  vitality: {
    label: "余力",
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
    summary: "目前还没有足够的近期信号，所以这是一份基础日报。它不会假装读懂你，只提供几条低负担的生活节奏建议。",
    suggestions: [
      ["节奏", "先选一件今天最重要的事，完成后再决定是否继续。"],
      ["身体", "连续专注一段时间后，离开屏幕两分钟，让肩膀和呼吸先回来。"],
      ["联结", "如果想找人聊聊，可以只发一句真实近况，不必一次解释完整。"]
    ]
  },
  insight: {
    headline: "今天很适合看清重点，但不必把每个念头都解释完。",
    basis: ["近期主动收藏了照见潮笺", "这类潮笺靠近观察与命名"],
    quote: "先把问题照亮一角，答案可以慢一点来。",
    summary: "你近期主动收进卡槽的内容包含「照见」潮笺。它只提供一个可解释的内容线索，不代表固定人格。",
    suggestions: [
      ["聚焦", "把脑中的问题写成一句话，只处理最想看清的那一部分。"],
      ["停笔", "反复分析超过十分钟时，先做一件不需要答案的小事。"],
      ["表达", "用“我注意到……”开头，描述事实，不急着给自己下结论。"]
    ]
  },
  grounding: {
    headline: "今天适合把步子放稳一点，先照顾身体和边界。",
    basis: ["近期主动收藏了安住潮笺", "这类潮笺靠近身体与边界"],
    quote: "先让脚底找到地面，答案可以晚一点来。",
    summary: "你近期主动收下的内容更靠近「安住」。日报因此把建议放在减速、边界和身体信号上。",
    suggestions: [
      ["节奏", "给今天安排一个明确停点，到了就先离开正在做的事。"],
      ["身体", "喝水、松开肩膀，再确认自己是否真的需要继续硬撑。"],
      ["边界", "面对临时请求，先说“让我看一下安排”，不必立刻答应。"]
    ]
  },
  connection: {
    headline: "今天可以靠近一点真实，也保留只说到这里的权利。",
    basis: ["近期主动收藏了相连潮笺", "这类潮笺靠近表达与联结"],
    quote: "真实不必一次说完，关系可以从一句话开始。",
    summary: "你近期主动收下的内容更靠近「相连」。这份日报会优先提供表达、倾听和关系边界方面的小建议。",
    suggestions: [
      ["表达", "想联系谁时，先发一句近况，不必组织成完整故事。"],
      ["倾听", "聊天前可以先说清楚：此刻更需要陪伴，还是一起想办法。"],
      ["边界", "对方没有及时回应，不等于你的表达不重要。先把注意力带回今天。"]
    ]
  },
  vitality: {
    headline: "今天有一些向前的力量，也别忘了给自己留下余力。",
    basis: ["近期主动收藏了余力潮笺", "这类潮笺靠近小步行动与恢复"],
    quote: "今天留下的一点力气，也属于完成的一部分。",
    summary: "你近期主动收下的内容更靠近「余力」。这份日报会提醒你推进一件事，同时避免把可用的力气一次耗尽。",
    suggestions: [
      ["行动", "只推进一个核心任务，其他事项先放进稍后清单。"],
      ["恢复", "在还有力气的时候就安排休息，而不是等到完全耗尽。"],
      ["期待", "把今天的完成标准写小一点，让行动可以真实发生。"]
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
const storyCard = byId("story-card")
const leftPreview = byId("left-preview")
const rightPreview = byId("right-preview")
const safetyModal = byId("safety-modal")
const tideModal = byId("tide-modal")
const cardDetailModal = byId("card-detail-modal")
const topLevelScreens = new Set(["today-screen", "thoughts-screen", "chat-screen", "cards-screen", "echoes-screen", "settings-screen"])

function createFreshFlow() {
  return {
    notes: ["", ""],
    personalizeNotes: true,
    themeCandidates: [],
    selectedTheme: "",
    themeSource: "",
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
let modalReturnFocus = null
let cardDetailReturnFocus = null
const runtimeTimers = new Set()

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

function focusScreenHeading(screen) {
  const heading = screen.querySelector("h1[tabindex='-1']")
  if (!heading) return
  window.requestAnimationFrame(() => heading.focus({ preventScroll: true }))
}

function updateBottomNavigation(screenId) {
  bottomNav.hidden = !topLevelScreens.has(screenId)
  bottomNav.querySelectorAll("[data-nav-target]").forEach((button) => {
    if (button.dataset.navTarget === screenId) {
      button.setAttribute("aria-current", "page")
    } else {
      button.removeAttribute("aria-current")
    }
  })
}

function showScreen(screenOrId, options = {}) {
  cancelRuntimeTimers()
  const target = typeof screenOrId === "string" ? byId(screenOrId) : screenOrId
  if (!target) return
  if (activeScreenId === "chat-screen" && target.id !== "chat-screen") {
    flow.chatBusy = false
    if (flow.chatMode === "standalone") {
      flow.chatMessages = []
      flow.chatCrisis = false
      flow.chatSeed = ""
      byId("chat-input").value = ""
    }
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
  }
  if (target.id === "report-screen") renderDailyReport()
  if (target.id === "thoughts-screen") {
    renderQuickNotes()
    byId("quick-note-status").textContent = "不会自动进入日报、画像或聊天"
  }
  if (target.id === "chat-screen") renderChat()
  if (target.id === "cards-screen") renderTideCardLibrary()
  if (target.id === "echoes-screen") renderEchoLibrary()
  if (target.id === "settings-screen") updateSettingsStorageState()
  if (options.focus !== false) focusScreenHeading(target)
}

function startFlow(seedNote = "") {
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

function generateThemeCandidates() {
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
  flow.chatCrisis = false
  flow.chatSeed = ""
  flow.selectedAction = ""
  flow.selectedEcho = ""
  flow.echoSource = ""
  flow.echoDelay = 1
  flow.saveEcho = false
  flow.savedEchoThisRun = false
}

function showOverview() {
  byId("overview-theme").textContent = `“${flow.selectedTheme}”`
  resetDownstreamFlow()
  showScreen("overview-screen")
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
  const windowStart = Date.now() - 30 * DAY_MS
  const records = readTideCardRecords().filter((record) => record.collectedAt >= windowStart)
  const counts = Object.keys(tideMeta).reduce((result, key) => {
    result[key] = 0
    return result
  }, {})
  const latestByTide = {}

  records.forEach((record) => {
    const card = tideCardFromId(record.id)
    if (!card) return
    counts[card.key] += 1
    latestByTide[card.key] = Math.max(latestByTide[card.key] || 0, record.collectedAt)
  })

  const ranked = Object.entries(counts).sort((a, b) => {
    const countDifference = b[1] - a[1]
    if (countDifference !== 0) return countDifference
    return (latestByTide[b[0]] || 0) - (latestByTide[a[0]] || 0)
  })
  const dominant = ranked[0] && ranked[0][1] > 0 ? ranked[0][0] : "generic"
  const variant = dailyReportVariants[dominant]
  return {
    ...variant,
    dominant,
    personalized: dominant !== "generic",
    mode: dominant === "generic" ? "基础日报" : `根据近 30 天${tideMeta[dominant].label}潮笺`,
    date: formatDailyDate()
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

  byId("report-source-copy").textContent = report.personalized
    ? `这份日报只根据近 30 天内你主动收进本机卡槽的潮笺类型生成，没有读取闪念、聊天原文或隐藏分数。当前相对突出的可解释信号是「${tideMeta[report.dominant].label}」。`
    : "目前还没有足够的可解释信号，所以显示通用基础版。完成章节并主动收藏潮笺后，日报才会逐渐贴近近期倾向。"
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
  if (flow.choices.every(Boolean)) {
    beginChat()
    return
  }
  const nextUnanswered = flow.choices.findIndex((choice) => !choice)
  flow.currentCard = nextUnanswered < 0 ? 0 : nextUnanswered
  showScreen("game-screen", { focus: false })
  renderCard()
  storyCard.focus({ preventScroll: true })
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
  schedule(() => advanceAfterChoice(newlyUnlocked), 760)
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
    meta.textContent = message.role === "user" ? "你" : "潮伴 · 本地演示"
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
  const input = byId("chat-input")
  input.disabled = flow.chatCrisis
  input.placeholder = flow.chatCrisis ? "普通陪聊已暂停" : "此刻最想说的是……"
  byId("chat-form").classList.toggle("is-paused", flow.chatCrisis)
  byId("send-chat").disabled = flow.chatCrisis || flow.chatBusy || input.value.trim().length === 0
  byId("chat-status").textContent = flow.chatCrisis
    ? "普通陪聊已暂停，请优先使用上方的即时支持路径"
    : (flow.chatBusy ? "潮伴正在组织一句回应……" : "当前原型不上传或持久保存聊天内容")

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

function sendChatMessage(rawText) {
  const text = rawText.trim()
  if (!text || flow.chatBusy || flow.chatCrisis) return
  flow.chatMessages.push({ role: "user", text })
  byId("chat-input").value = ""

  if (containsCrisisLanguage(text)) {
    flow.chatCrisis = true
    flow.chatMessages.push({
      role: "bot",
      text: "谢谢你告诉我。现在先不继续普通对话：请确认你是否处于立即危险，并尽快联系所在地紧急服务、危机支持资源，或一位能马上来到你身边的人。"
    })
    renderChat()
    return
  }

  flow.chatBusy = true
  renderChat()
  schedule(() => {
    flow.chatBusy = false
    flow.chatMessages.push({ role: "bot", text: demoChatReply(text) })
    renderChat()
    byId("chat-input").focus({ preventScroll: true })
  }, 650)
}

function beginChat() {
  flow.chatMode = "flow"
  flow.chatMessages = []
  flow.chatBusy = false
  flow.chatCrisis = false
  flow.chatSeed = ""
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
  }
  showScreen("chat-screen")
}

function endChat() {
  if (flow.chatMode === "flow") {
    showActionScreen()
  } else {
    showScreen("today-screen")
  }
}

function renderActionRecommendation() {
  const recommendation = signalRecommendation[dominantSignal()] || signalRecommendation.agency
  document.querySelectorAll("[data-action-id]").forEach((button) => {
    const selected = button.dataset.actionId === flow.selectedAction
    button.setAttribute("aria-pressed", String(selected))
    button.classList.toggle("is-selected", selected)
    button.classList.toggle("is-recommended", button.dataset.actionId === recommendation.action)
  })
  byId("action-rationale").textContent = recommendation.copy
  byId("action-continue").disabled = !flow.selectedAction
}

function showActionScreen() {
  byId("action-theme").textContent = flow.selectedTheme
  showScreen("action-screen")
  renderActionRecommendation()
}

function buildEchoCandidates() {
  const action = actionCopy[flow.selectedAction]
  const tideQuotes = flow.keptTideQuotes
    .slice()
    .reverse()
    .map((quote) => quote.text)
  const defaults = [
    "今天的我已经停下来，认真听了一会儿自己。",
    action ? `提醒自己：${action.label}。` : "不行动也可以是今天诚实的选择。",
    "答案可以慢一点，我不必现在把一切想清楚。"
  ]
  return Array.from(new Set([...tideQuotes, ...defaults])).slice(0, 3)
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

  const candidates = buildEchoCandidates()
  document.querySelectorAll("[data-echo-index]").forEach((button) => {
    const index = Number(button.dataset.echoIndex)
    button.querySelector("strong").textContent = candidates[index]
  })
  showScreen("echo-screen")
  updateEchoSelection()
}

function isValidQuickNoteRecord(record) {
  return Boolean(
    record &&
    typeof record.id === "string" &&
    typeof record.text === "string" &&
    record.text.trim().length > 0 &&
    record.text.length <= QUICK_NOTE_MAX_LENGTH &&
    Number.isFinite(record.createdAt)
  )
}

function readQuickNotes() {
  try {
    const raw = window.localStorage.getItem(QUICK_NOTE_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const seen = new Set()
    return parsed
      .filter((record) => {
        if (!isValidQuickNoteRecord(record) || seen.has(record.id)) return false
        seen.add(record.id)
        return true
      })
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, QUICK_NOTE_LIMIT)
  } catch (_error) {
    return []
  }
}

function writeQuickNotes(records) {
  try {
    window.localStorage.setItem(QUICK_NOTE_STORAGE_KEY, JSON.stringify(records.slice(0, QUICK_NOTE_LIMIT)))
    return true
  } catch (_error) {
    return false
  }
}

function formatQuickNoteDate(timestamp) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(timestamp))
}

function saveQuickNote(text) {
  const normalized = text.trim()
  if (!normalized) return false
  const now = Date.now()
  const randomPart = Math.random().toString(36).slice(2, 9)
  const record = {
    id: `note-${now}-${randomPart}`,
    text: normalized.slice(0, QUICK_NOTE_MAX_LENGTH),
    createdAt: now
  }
  return writeQuickNotes([record, ...readQuickNotes()])
}

function removeQuickNote(id) {
  const records = readQuickNotes()
  const next = records.filter((record) => record.id !== id)
  if (next.length === records.length) return
  if (writeQuickNotes(next)) {
    byId("quick-note-status").textContent = "已删除这张便签"
    renderQuickNotes()
    updateSettingsStorageState()
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

  records.forEach((record) => {
    const article = document.createElement("article")
    article.className = "quick-note-card"

    const meta = document.createElement("div")
    meta.className = "quick-note-card-meta"
    const label = document.createElement("span")
    label.textContent = "闪念便签"
    const time = document.createElement("time")
    time.dateTime = new Date(record.createdAt).toISOString()
    time.textContent = formatQuickNoteDate(record.createdAt)
    meta.append(label, time)

    const content = document.createElement("blockquote")
    content.textContent = record.text

    const actions = document.createElement("div")
    actions.className = "quick-note-card-actions"
    const useButton = document.createElement("button")
    useButton.className = "quick-note-use"
    useButton.type = "button"
    useButton.textContent = "用它开始梳理"
    useButton.addEventListener("click", () => startFlow(record.text))
    const removeButton = document.createElement("button")
    removeButton.className = "quick-note-delete"
    removeButton.type = "button"
    removeButton.textContent = "删除"
    removeButton.setAttribute("aria-label", "删除这张闪念便签")
    removeButton.addEventListener("click", () => requestRemoveQuickNote(record.id, removeButton))
    actions.append(useButton, removeButton)

    article.append(meta, content, actions)
    list.append(article)
  })

  byId("quick-note-total").textContent = `${records.length} 张`
  byId("quick-note-empty").hidden = records.length > 0
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

  if (writeQuickNotes([])) {
    byId("quick-note-status").textContent = "已清空留在本机的闪念"
    renderQuickNotes()
    updateSettingsStorageState()
  }
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
  byId("complete-action").textContent = flow.selectedAction
    ? actionCopy[flow.selectedAction].label
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

function updateSettingsStorageState() {
  const quickNoteButton = byId("settings-clear-quick-notes")
  const quickNoteCount = readQuickNotes().length
  quickNoteButton.disabled = quickNoteCount === 0
  quickNoteButton.textContent = quickNoteCount === 0
    ? "没有已保存的闪念"
    : `清空已保存闪念（${quickNoteCount}）`

  const button = byId("settings-clear-echoes")
  const count = readEchoes().length
  button.disabled = count === 0
  button.textContent = count === 0 ? "没有已保存的回响" : `删除全部已保存回响（${count}）`

  const cardButton = byId("settings-clear-tide-cards")
  const cardCount = readTideCardRecords().length
  cardButton.disabled = cardCount === 0
  cardButton.textContent = cardCount === 0 ? "卡槽目前为空" : `清空潮笺卡槽（${cardCount}）`
}

function openSafety(event) {
  modalReturnFocus = event && event.currentTarget instanceof HTMLElement
    ? event.currentTarget
    : document.activeElement
  safetyModal.hidden = false
  window.requestAnimationFrame(() => byId("close-safety").focus())
}

function closeSafety() {
  if (safetyModal.hidden) return
  safetyModal.hidden = true
  if (modalReturnFocus && typeof modalReturnFocus.focus === "function" && modalReturnFocus.isConnected) {
    modalReturnFocus.focus({ preventScroll: true })
  }
  modalReturnFocus = null
}

function trapModalFocus(event) {
  if (event.key !== "Tab") return
  const activeModal = !cardDetailModal.hidden
    ? cardDetailModal
    : (!tideModal.hidden ? tideModal : (!safetyModal.hidden ? safetyModal : null))
  if (!activeModal) return
  const focusable = Array.from(activeModal.querySelectorAll("button:not([disabled])"))
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

document.querySelectorAll("[data-open-safety]").forEach((button) => {
  button.addEventListener("click", openSafety)
})

byId("start-flow").addEventListener("click", startNewFlow)
byId("restart-flow").addEventListener("click", startNewFlow)
byId("open-quick-notes").addEventListener("click", () => {
  showScreen("thoughts-screen")
  window.requestAnimationFrame(() => byId("quick-note-input").focus({ preventScroll: true }))
})
byId("open-chat").addEventListener("click", () => openStandaloneChat({ reset: true }))
byId("open-daily-report").addEventListener("click", () => showScreen("report-screen"))
byId("report-back").addEventListener("click", () => showScreen("today-screen"))
byId("report-start-chat").addEventListener("click", () => openStandaloneChat({ fromReport: true }))
document.querySelectorAll("[data-report-feedback]").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll("[data-report-feedback]").forEach((item) => {
      item.setAttribute("aria-pressed", String(item === button))
    })
    byId("report-feedback-status").textContent = button.dataset.reportFeedback === "helpful"
      ? "收到。之后会继续保持这种低负担、可解释的表达。"
      : "收到。这不会被当成你的问题，之后会降低这类推断的权重。"
  })
})

byId("quick-note-input").addEventListener("input", (event) => {
  const length = event.currentTarget.value.length
  byId("quick-note-count").textContent = `${length} / ${QUICK_NOTE_MAX_LENGTH}`
  byId("save-quick-note").disabled = event.currentTarget.value.trim().length === 0
  byId("quick-note-status").textContent = "不会自动进入日报、画像或聊天"
})
byId("quick-note-form").addEventListener("submit", (event) => {
  event.preventDefault()
  const input = byId("quick-note-input")
  if (!input.value.trim()) return
  if (!saveQuickNote(input.value)) {
    byId("quick-note-status").textContent = "这台浏览器暂时无法保存，请检查本地存储权限"
    return
  }
  input.value = ""
  byId("quick-note-count").textContent = `0 / ${QUICK_NOTE_MAX_LENGTH}`
  byId("save-quick-note").disabled = true
  byId("quick-note-status").textContent = "已经收好；只有你主动选择时，它才会进入章节"
  renderQuickNotes()
  updateSettingsStorageState()
  input.focus({ preventScroll: true })
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
byId("notes-continue").addEventListener("click", () => {
  if (countFilledNotes() < 2) return
  flow.themeCandidates = generateThemeCandidates()
  flow.selectedTheme = ""
  flow.themeSource = ""
  byId("custom-theme").value = ""
  renderThemeOptions()
  showScreen("theme-screen")
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
  byId("send-chat").disabled = flow.chatCrisis || flow.chatBusy || event.currentTarget.value.trim().length === 0
})
byId("chat-form").addEventListener("submit", (event) => {
  event.preventDefault()
  sendChatMessage(byId("chat-input").value)
})
document.querySelectorAll("[data-chat-prompt]").forEach((button) => {
  button.addEventListener("click", () => sendChatMessage(button.dataset.chatPrompt))
})
byId("chat-crisis-help").addEventListener("click", () => {
  cancelRuntimeTimers()
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
  showEchoScreen()
})
byId("action-continue").addEventListener("click", () => {
  if (!flow.selectedAction) return
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
byId("settings-clear-quick-notes").addEventListener("click", clearAllQuickNotes)
byId("settings-clear-echoes").addEventListener("click", clearAllEchoes)
byId("settings-clear-tide-cards").addEventListener("click", clearAllTideCards)

byId("keep-tide-quote").addEventListener("click", () => closeTideQuote(true))
byId("skip-tide-quote").addEventListener("click", () => closeTideQuote(false))
byId("close-card-detail").addEventListener("click", closeCardDetail)
cardDetailModal.addEventListener("click", (event) => {
  if (event.target === cardDetailModal) closeCardDetail()
})

byId("close-safety").addEventListener("click", closeSafety)
byId("acknowledge-safety").addEventListener("click", closeSafety)
safetyModal.addEventListener("click", (event) => {
  if (event.target === safetyModal) closeSafety()
})
document.addEventListener("keydown", (event) => {
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
  if (!safetyModal.hidden && event.key === "Escape") {
    event.preventDefault()
    closeSafety()
    return
  }
  trapModalFocus(event)
})

renderNotes()
updateDueEchoCard()
updateSettingsStorageState()
showScreen(activeScreenId, { focus: false })
