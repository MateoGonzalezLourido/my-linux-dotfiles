// widget/notifications/rules/defaults.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { BUILTIN_RULES } from "./defaults.ts"
import { compileRules, evaluate } from "./engine.ts"

const idx = compileRules(BUILTIN_RULES)
const NOW = 0

test("all builtin rules are source=builtin, enabled, low priority", () => {
  for (const r of BUILTIN_RULES) {
    assert.equal(r.source, "builtin")
    assert.equal(r.enabled, true)
    assert.ok(r.priority < 100, `${r.id} priority should be <100`)
  }
})

test("builtin ids are unique", () => {
  const ids = BUILTIN_RULES.map(r => r.id)
  assert.equal(new Set(ids).size, ids.length)
})

test("screenshot → suppress + noHistory", () => {
  const r = evaluate({ appName: "notify-send", summary: "Captura de pantalla", body: "", urgency: 1 }, idx, NOW)
  assert.equal(r.suppress, true)
})

test("app crash → clear-on-boot", () => {
  const r = evaluate({ appName: "notify-send", summary: "App crasheada", body: "Proceso: python3 (coredump)", urgency: 2 }, idx, NOW)
  assert.equal(r.meta.clearOnBoot, true)
  assert.equal(r.meta.lifetime, "persistent") // clear-on-boot is now an independent flag, not a lifetime
})

test("reboot recommended → clear-on-boot", () => {
  const r = evaluate({ appName: "CachyOS Update", summary: "Reboot recommended!", body: "Reboot is recommended", urgency: 2 }, idx, NOW)
  assert.equal(r.meta.clearOnBoot, true)
})

test("low battery → flash + battery-resolved condition", () => {
  const r = evaluate({ appName: "notify-send", summary: "Batería baja", body: "5% restante", urgency: 2 }, idx, NOW)
  assert.equal(r.meta.lifetime, "flash")
  assert.ok(r.meta.conditions.includes("battery-resolved"))
})

test("battery app → clearOnBoot (case-insensitive on app name)", () => {
  const r = evaluate({ appName: "batería", summary: "Cargando", body: "", urgency: 1 }, idx, NOW)
  assert.equal(r.meta.clearOnBoot, true)
})

test("low battery from Batería app → flash AND clearOnBoot combine", () => {
  const r = evaluate({ appName: "Batería", summary: "Batería baja", body: "5%", urgency: 2 }, idx, NOW)
  assert.equal(r.meta.lifetime, "flash")
  assert.equal(r.meta.clearOnBoot, true)
  assert.ok(r.meta.conditions.includes("battery-resolved"))
})

test("whatsapp → timed 2 days, dedup app+summary", () => {
  const r = evaluate({ appName: "WhatsApp", summary: "usuario1", body: "hola", urgency: 1 }, idx, NOW)
  assert.equal(r.meta.lifetime, "timed")
  assert.equal(r.meta.expiresAt, 2 * 24 * 60 * 60 * 1000)
  assert.equal(r.meta.dedupKey, "whatsapp usuario1")
})
