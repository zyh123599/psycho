"use strict"

const STORAGE_KEY = "xinchao.future-echoes.v1"
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

const byId = (id) => document.getElementById(id)
const screens = Array.from(document.querySelectorAll(".screen"))
const bottomNav = byId("bottom-nav")
const storyCard = byId("story-card")
const leftPreview = byId("left-preview")
const rightPreview = byId("right-preview")
const safetyModal = byId("safety-modal")
const topLevelScreens = new Set(["today-screen", "echoes-screen", "settings-screen"])

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
    responseIndex: 0,
    responseAnswers: [],
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

  screens.forEach((screen) => {
    screen.hidden = screen !== target
  })
  activeScreenId = target.id
  updateBottomNavigation(target.id)
  target.scrollTop = 0

  if (target.id === "today-screen") updateDueEchoCard()
  if (target.id === "echoes-screen") renderEchoLibrary()
  if (target.id === "settings-screen") updateSettingsStorageState()
  if (options.focus !== false) focusScreenHeading(target)
}

function startNewFlow() {
  flow = createFreshFlow()
  locked = false
  dragging = false
  byId("notes-personalize").checked = true
  byId("custom-theme").value = ""
  byId("custom-echo").value = ""
  byId("save-echo").checked = false
  renderNotes()
  showScreen("notes-screen")
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
  flow.responseIndex = 0
  flow.responseAnswers = []
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
    beginResponses()
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
  storyCard.classList.add("enter")
  schedule(() => storyCard.classList.remove("enter"), 500)
}

function beginGame() {
  if (flow.choices.every(Boolean)) {
    beginResponses()
    return
  }
  const nextUnanswered = flow.choices.findIndex((choice) => !choice)
  flow.currentCard = nextUnanswered < 0 ? 0 : nextUnanswered
  showScreen("game-screen")
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
  flow.choices[flow.currentCard] = {
    direction,
    label: option ? option.label : "两个都不像",
    result
  }
  recomputeSignals()

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
  schedule(() => {
    flow.currentCard += 1
    if (flow.currentCard >= cards.length) {
      beginResponses()
    } else {
      renderCard()
      storyCard.focus({ preventScroll: true })
    }
  }, 760)
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

function buildResponseRounds() {
  const pauses = countChoiceLabels(["先交出够用版", "先离开两分钟", "给今天一个停点", "先走一小步"])
  const lastChoice = flow.choices.filter(Boolean).at(-1)
  const firstAnswer = flow.responseAnswers[0] && !flow.responseAnswers[0].skipped
    ? flow.responseAnswers[0].text
    : "它也许同时保护着不止一件事"
  const secondAnswer = flow.responseAnswers[1] && !flow.responseAnswers[1].skipped
    ? flow.responseAnswers[1].text
    : "你还不必马上替它命名"

  return [
    {
      reference: pauses > 0
        ? `刚才有 ${pauses} 次，你为“先停一下或先走一小步”留出了位置。`
        : `最后一张卡里，你选择了“${lastChoice ? lastChoice.label : "两个都不像"}”。`,
      question: "这样的选择，此刻更像是在保护什么？",
      options: ["避免事情失控", "避免让别人失望", "给自己留一点余地"]
    },
    {
      reference: `你刚才把它说成：“${firstAnswer}”。`,
      question: "如果不急着改变它，你最希望先被理解的是哪一部分？",
      options: ["我其实已经很努力了", "我需要一点确定感", "我想有人陪我分担一点"]
    },
    {
      reference: `到这里，你留下了一句话：“${secondAnswer}”。`,
      question: "今天结束前，哪一种态度更值得被带走？",
      options: ["够用也可以是完成", "我可以先照顾身体", "真实不需要一次说完"]
    }
  ]
}

function renderResponseRound() {
  const rounds = buildResponseRounds()
  const round = rounds[flow.responseIndex]
  if (!round) {
    showActionScreen()
    return
  }

  byId("response-step").textContent = String(flow.responseIndex + 1).padStart(2, "0")
  byId("response-progress").style.setProperty("--progress", `${((flow.responseIndex + 1) / rounds.length) * 100}%`)
  byId("response-reference").textContent = round.reference
  byId("response-question").textContent = round.question

  const options = byId("response-options")
  options.replaceChildren()
  round.options.forEach((optionText) => {
    const button = document.createElement("button")
    button.type = "button"
    button.textContent = optionText
    button.addEventListener("click", () => advanceResponse({ text: optionText, skipped: false }))
    options.append(button)
  })

  byId("correction-panel").hidden = true
  byId("response-correction").value = ""
  byId("use-correction").disabled = true
}

function beginResponses() {
  flow.responseIndex = 0
  flow.responseAnswers = []
  showScreen("response-screen")
  renderResponseRound()
}

function advanceResponse(answer) {
  flow.responseAnswers[flow.responseIndex] = answer
  flow.responseIndex += 1
  if (flow.responseIndex >= 3) {
    showActionScreen()
  } else {
    renderResponseRound()
    focusScreenHeading(byId("response-screen"))
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
  return [
    "今天的我已经停下来，认真听了一会儿自己。",
    action ? `提醒自己：${action.label}。` : "不行动也可以是今天诚实的选择。",
    "答案可以慢一点，我不必现在把一切想清楚。"
  ]
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

  showScreen("complete-screen")
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
  const button = byId("settings-clear-echoes")
  const count = readEchoes().length
  button.disabled = count === 0
  button.textContent = count === 0 ? "没有已保存的回响" : `删除全部已保存回响（${count}）`
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
  if (event.key !== "Tab" || safetyModal.hidden) return
  const focusable = Array.from(safetyModal.querySelectorAll("button:not([disabled])"))
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
    showScreen(control.dataset.navTarget)
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

byId("response-back").addEventListener("click", () => {
  if (flow.responseIndex > 0) {
    flow.responseIndex -= 1
    renderResponseRound()
    return
  }
  flow.currentCard = cards.length - 1
  showScreen("game-screen")
  renderCard()
})
byId("response-correct").addEventListener("click", () => {
  const panel = byId("correction-panel")
  panel.hidden = !panel.hidden
  if (!panel.hidden) byId("response-correction").focus()
})
byId("response-correction").addEventListener("input", (event) => {
  byId("use-correction").disabled = event.currentTarget.value.trim().length === 0
})
byId("use-correction").addEventListener("click", () => {
  const correction = byId("response-correction").value.trim()
  if (!correction) return
  advanceResponse({ text: correction, skipped: false, corrected: true })
})
byId("skip-response").addEventListener("click", () => {
  advanceResponse({ text: "", skipped: true })
})
byId("stop-responses").addEventListener("click", showActionScreen)

document.querySelectorAll("[data-action-id]").forEach((button) => {
  button.addEventListener("click", () => {
    flow.selectedAction = button.dataset.actionId
    renderActionRecommendation()
  })
})
byId("action-back").addEventListener("click", () => {
  flow.responseIndex = 2
  showScreen("response-screen")
  renderResponseRound()
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
byId("settings-clear-echoes").addEventListener("click", clearAllEchoes)

byId("close-safety").addEventListener("click", closeSafety)
byId("acknowledge-safety").addEventListener("click", closeSafety)
safetyModal.addEventListener("click", (event) => {
  if (event.target === safetyModal) closeSafety()
})
document.addEventListener("keydown", (event) => {
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
