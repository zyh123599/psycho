import test from "node:test"
import assert from "node:assert/strict"

import { analyzeProfile, sendCompanionMessage } from "../api-client.js"

test("前端使用正确端点且不会发送模型密钥", async (t) => {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json", "X-Request-ID": "server-1" }
    })
  }
  t.after(() => { globalThis.fetch = originalFetch })

  await sendCompanionMessage({
    consent: { ai_processing: true },
    mode: "standalone",
    messages: [{ role: "user", content: "我有点累" }]
  }, { baseUrl: "https://app.example.test" })

  await analyzeProfile({
    payload: {
      consent: {
        profile_generation: true,
        ai_processing: true,
        subject_is_requester: true,
        media_rights_confirmed: false
      },
      texts: [{ source_id: "note:1", source: "note", content: "我有点累" }]
    },
    baseUrl: "https://app.example.test"
  })

  assert.equal(calls[0].url, "https://app.example.test/api/v1/companion/respond")
  assert.equal(calls[1].url, "https://app.example.test/api/v1/profiles/analyze")
  assert.equal(calls[0].options.headers["X-API-Key"], undefined)
  assert.equal(calls[0].options.headers.Authorization, undefined)
  assert.equal(calls[1].options.body instanceof FormData, true)
  assert.equal("Content-Type" in calls[1].options.headers, false)
})
