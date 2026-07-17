const cards = [
  {
    speaker: "治疗师 · 林岚", role: "你的咨询师", portrait: "林", tone: "therapist",
    prompt: "“今天坐下来的这一刻，你最想让谁听见你？”", whisper: "房间很安静。你听见自己的呼吸。",
    left: { label: "先不说", delta: { calm: 7, awareness: -2 }, result: "沉默也可以是一种边界。" },
    right: { label: "试着说说", delta: { awareness: 8, calm: -3 }, result: "你说出了那个一直绕开的词。" }
  },
  {
    speaker: "焦虑", role: "总比你早一步醒来", portrait: "雾", tone: "anxiety",
    prompt: "“明天的汇报一定会出错。我们现在再检查一遍，好吗？”", whisper: "凌晨 01:14，屏幕还亮着。",
    left: { label: "继续检查", delta: { calm: -8, energy: -8, awareness: 2 }, result: "你换来一点确定，也透支了一点明天。" },
    right: { label: "合上电脑", delta: { calm: 5, energy: 7, awareness: 4 }, result: "不确定仍在，但身体先被你接住。" }
  },
  {
    speaker: "阿澄", role: "很久没见的朋友", portrait: "澄", tone: "friend",
    prompt: "“你最近是不是不太好？如果愿意，我可以听。”", whisper: "消息输入框里的光标，闪了很久。",
    left: { label: "说没事", delta: { connection: -7, calm: 3 }, result: "你保护了自己，也把距离留在原处。" },
    right: { label: "说一点点", delta: { connection: 9, awareness: 4, energy: -2 }, result: "一句真话，让关系重新有了入口。" }
  },
  {
    speaker: "身体", role: "一直在替你记得", portrait: "息", tone: "body",
    prompt: "“你的肩膀已经很累了。今天，能不能先不证明自己？”", whisper: "疼痛不是命令，它是一封迟到的信。",
    left: { label: "再撑一下", delta: { energy: -10, calm: -4 }, result: "你完成了任务，却没能听完身体的话。" },
    right: { label: "停五分钟", delta: { energy: 8, calm: 7, awareness: 3 }, result: "五分钟没有解决生活，但让你回到了身体。" }
  },
  {
    speaker: "小时候的你", role: "藏在旧照片背面", portrait: "小", tone: "child",
    prompt: "“如果我没有做到最好，你还会站在我这边吗？”", whisper: "你突然想起，那时没人回答这个问题。",
    left: { label: "要更努力", delta: { energy: -7, calm: -5, awareness: 2 }, result: "熟悉的答案很安全，也很沉重。" },
    right: { label: "我会陪你", delta: { calm: 8, connection: 7, awareness: 5 }, result: "这一次，你成为了那个留下来的人。" }
  },
  {
    speaker: "治疗师 · 林岚", role: "会谈还有两分钟", portrait: "林", tone: "therapist",
    prompt: "“结束前，你想把哪个问题留在这里，而不是带回家？”", whisper: "不是所有问题，都需要今天得到答案。",
    left: { label: "全部带走", delta: { energy: -5, awareness: 4 }, result: "你仍习惯独自负责一切。你也看见了这个习惯。" },
    right: { label: "留下一件", delta: { calm: 9, energy: 5, connection: 4 }, result: "门外的生活没有变，但肩上轻了一点。" }
  }
]

const statMeta = {
  awareness: { label: "觉察", symbol: "◐" },
  calm: { label: "安定", symbol: "⌁" },
  connection: { label: "联结", symbol: "∞" },
  energy: { label: "精力", symbol: "✦" }
}

const initialStats = { awareness: 48, calm: 52, connection: 46, energy: 50 }
let stats = { ...initialStats }
let currentIndex = 0
let locked = false
let dragStartX = 0
let dragX = 0
let dragging = false

const byId = (id) => document.getElementById(id)
const introScreen = byId("intro-screen")
const gameScreen = byId("game-screen")
const summaryScreen = byId("summary-screen")
const storyCard = byId("story-card")
const safetyModal = byId("safety-modal")
const leftPreview = byId("left-preview")
const rightPreview = byId("right-preview")

function showScreen(screen) {
  ;[introScreen, gameScreen, summaryScreen].forEach((item) => item.classList.toggle("is-hidden", item !== screen))
}

function clamp(value) { return Math.max(8, Math.min(92, value)) }

function renderMeters() {
  Object.entries(stats).forEach(([key, value]) => {
    const fill = document.querySelector(`[data-stat="${key}"] .meter-track span`)
    fill.style.width = `${value}%`
    fill.style.background = value < 28 ? "#d9907a" : value > 72 ? "#a9c899" : "#d9c28c"
  })
}

function renderCard() {
  const card = cards[currentIndex]
  byId("day-label").textContent = `会谈 ${String(currentIndex + 1).padStart(2, "0")}`
  byId("speaker").textContent = card.speaker
  byId("speaker-role").textContent = card.role
  byId("portrait").textContent = card.portrait
  byId("scene").dataset.tone = card.tone
  byId("prompt").textContent = card.prompt
  byId("card-whisper").textContent = card.whisper
  byId("card-count").textContent = `${currentIndex + 1} / ${cards.length}`
  leftPreview.textContent = card.left.label
  rightPreview.textContent = card.right.label
  byId("left-button-label").textContent = card.left.label
  byId("right-button-label").textContent = card.right.label
  storyCard.className = "story-card enter"
  storyCard.style.transform = ""
  leftPreview.style.opacity = 0
  rightPreview.style.opacity = 0
  window.setTimeout(() => storyCard.classList.remove("enter"), 500)
  locked = false
}

function applyChoice(choice) {
  Object.entries(choice.delta).forEach(([key, delta]) => { stats[key] = clamp(stats[key] + delta) })
  renderMeters()
  const toast = byId("result-toast")
  toast.textContent = choice.result
  toast.classList.add("show")
  window.setTimeout(() => toast.classList.remove("show"), 850)
}

function choose(direction) {
  if (locked) return
  locked = true
  const card = cards[currentIndex]
  const choice = direction === "left" ? card.left : card.right
  storyCard.classList.add(direction === "left" ? "exit-left" : "exit-right")
  applyChoice(choice)
  window.setTimeout(() => {
    currentIndex += 1
    if (currentIndex >= cards.length) {
      renderSummary()
      showScreen(summaryScreen)
      return
    }
    renderCard()
  }, 900)
}

function renderSummary() {
  const strongest = Object.entries(stats).sort((a, b) => b[1] - a[1])[0][0]
  const reflections = {
    awareness: ["你开始辨认，那些自动出现的声音并不等于全部的你。", "“看见正在发生什么，本身就是一种改变。”"],
    calm: ["你为自己腾出了一点缓冲，让感受不必立刻变成行动。", "“允许自己慢一点，也是一种前进。”"],
    connection: ["你尝试让另一个人靠近，也开始练习不独自承担。", "“被看见不等于变得脆弱。”"],
    energy: ["你听见了身体的界限，并把休息当作继续生活的一部分。", "“照顾能量，不需要先证明自己值得。”"]
  }
  byId("summary-copy").textContent = reflections[strongest][0]
  byId("takeaway").textContent = reflections[strongest][1]
  byId("summary-stats").innerHTML = Object.entries(statMeta).map(([key, meta]) => `
    <div class="summary-stat"><strong>${stats[key]}</strong><span>${meta.symbol} ${meta.label}</span></div>
  `).join("")
}

function resetExperience() {
  stats = { ...initialStats }
  currentIndex = 0
  locked = false
  renderMeters()
  renderCard()
  showScreen(gameScreen)
  storyCard.focus()
}

function openSafety() { safetyModal.classList.remove("is-hidden"); byId("close-safety").focus() }
function closeSafety() { safetyModal.classList.add("is-hidden") }

storyCard.addEventListener("pointerdown", (event) => {
  if (locked) return
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
  leftPreview.style.opacity = Math.max(0, Math.min(1, -dragX / 90))
  rightPreview.style.opacity = Math.max(0, Math.min(1, dragX / 90))
})

storyCard.addEventListener("pointerup", () => {
  if (!dragging || locked) return
  dragging = false
  storyCard.classList.remove("is-dragging")
  if (Math.abs(dragX) > 86) choose(dragX < 0 ? "left" : "right")
  else { storyCard.style.transform = ""; leftPreview.style.opacity = 0; rightPreview.style.opacity = 0 }
})

storyCard.addEventListener("pointercancel", () => {
  dragging = false
  storyCard.classList.remove("is-dragging")
  storyCard.style.transform = ""
})

storyCard.addEventListener("keydown", (event) => {
  if (event.key === "ArrowLeft") choose("left")
  if (event.key === "ArrowRight") choose("right")
})

byId("start-button").addEventListener("click", resetExperience)
byId("restart-button").addEventListener("click", resetExperience)
byId("left-button").addEventListener("click", () => choose("left"))
byId("right-button").addEventListener("click", () => choose("right"))
byId("open-safety").addEventListener("click", openSafety)
byId("game-info").addEventListener("click", openSafety)
byId("close-safety").addEventListener("click", closeSafety)
byId("acknowledge-safety").addEventListener("click", closeSafety)
safetyModal.addEventListener("click", (event) => { if (event.target === safetyModal) closeSafety() })
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !safetyModal.classList.contains("is-hidden")) closeSafety()
})

renderMeters()
renderCard()
