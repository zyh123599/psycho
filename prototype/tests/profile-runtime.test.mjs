import test from "node:test"
import assert from "node:assert/strict"

import {
  companionProfileContext,
  deriveProfileActions,
  deriveProfileEchoes,
  deriveProfileReport,
  deriveThemeCandidates
} from "../profile-runtime.js"

const envelope = {
  profile_id: "18db117e-25ca-4b26-88dc-8fbd8f3a846b",
  generated_at: "2026-07-18T08:30:00Z",
  profile: {
    headline: "在检查与休息之间寻找停点",
    summary: "这是可被新材料修正的暂时性总结。",
    current_state: [{ title: "已经很累", description: "", confidence: "medium", uncertainty: "" }],
    recurring_patterns: [],
    strengths_and_resources: [{ title: "能够觉察疲惫" }],
    needs_and_preferences: [{ title: "一个清楚的结束边界" }],
    communication_preferences: ["先被理解"],
    gentle_actions: [
      { title: "设定停点", action: "写下最后一次检查的时间", rationale: "让够用变得可见" }
    ],
    reflection_questions: ["什么样的停点对今天已经够用？"],
    uncertainties: ["只来自一次短会话"],
    safety_notice: { level: "not_indicated", evidence: ["不应发送"] }
  }
}

test("画像派生内容保持有限且可解释", () => {
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
  assert.equal(report.suggestions[0][1], "写下最后一次检查的时间")
  assert.match(deriveProfileEchoes(envelope)[0], /停点/)
})

test("对话画像上下文不包含证据或安全事件", () => {
  const context = companionProfileContext(envelope)
  assert.equal(context.profile_id, envelope.profile_id)
  assert.deepEqual(context.needs_and_preferences, ["一个清楚的结束边界"])
  assert.equal("safety_notice" in context, false)
  assert.equal("evidence" in context, false)
  assert.equal(JSON.stringify(context).includes("不应发送"), false)
})
