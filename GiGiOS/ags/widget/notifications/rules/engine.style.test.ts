// widget/notifications/rules/engine.style.test.ts
// El efecto `style` (skin del popup) se pliega igual que `color`: set-once, gana la regla de
// mayor prioridad, y cae a la siguiente si la de arriba no opina.
import { test } from "node:test"
import assert from "node:assert/strict"
import { compileRules, evaluate } from "./engine.ts"
import { validateRule } from "./validate.ts"
import { BUILTIN_RULES } from "./defaults.ts"
import type { NotifRule, NotifInput } from "./types.ts"

const NOW = 0
const input: NotifInput = { appName: "Discord", summary: "mensaje", body: "hola", urgency: 1 }
function rule(p: Partial<NotifRule>): NotifRule {
  return { id: "r", name: "r", enabled: true, priority: 0, source: "user", match: {}, effects: {}, ...p }
}

test("sin regla de estilo → meta.style undefined (decide el hint x-gigios-source)", () => {
  const r = evaluate(input, compileRules([]), NOW)
  assert.equal(r.meta.style, undefined)
})

test("el efecto style aflora en meta.style", () => {
  const r = evaluate(input, compileRules([rule({ effects: { style: "dunst" } })]), NOW)
  assert.equal(r.meta.style, "dunst")
})

test("gana la regla de mayor prioridad", () => {
  const rules = [
    rule({ id: "low", priority: 0, effects: { style: "dunst" } }),
    rule({ id: "high", priority: 10, effects: { style: "default" } }),
  ]
  assert.equal(evaluate(input, compileRules(rules), NOW).meta.style, "default")
})

test("cae a la siguiente si la de arriba no fija estilo", () => {
  const rules = [
    rule({ id: "low", priority: 0, effects: { style: "dunst" } }),
    rule({ id: "high", priority: 10, effects: { muteAudio: true } }),
  ]
  assert.equal(evaluate(input, compileRules(rules), NOW).meta.style, "dunst")
})

// "default" tiene que ser distinguible de "ninguna regla opina": es lo que permite SACAR del
// skin a una notificación del sistema (que lleva el hint). Si el motor colapsara "default" a
// undefined, el hint volvería a mandar y la regla no serviría para nada.
test("style:default se hornea, no se colapsa a undefined", () => {
  const r = evaluate(input, compileRules([rule({ effects: { style: "default" } })]), NOW)
  assert.equal(r.meta.style, "default")
  assert.notEqual(r.meta.style, undefined)
})

// ── La builtin que da el skin a los scripts (builtin.system-dunst) ───────────────────────────

const builtins = () => compileRules(BUILTIN_RULES)
const sys: NotifInput = { appName: "notify-send", summary: "USB conectado", body: "SanDisk", urgency: 1, source: "system" }

test("builtin: una notificación con source=system sale con skin dunst, sin ninguna regla de usuario", () => {
  const r = evaluate(sys, builtins(), NOW)
  assert.equal(r.meta.style, "dunst")
  assert.ok(r.meta.matchedRules.includes("builtin.system-dunst"))
})

test("builtin: una app normal (sin hint) NO se lleva el skin", () => {
  const r = evaluate({ appName: "Discord", summary: "hola", body: "", urgency: 1 }, builtins(), NOW)
  assert.equal(r.meta.style, undefined)
})

// Sin stopOnMatch y con prioridad baja: es cosmética, no debe tapar a las demás builtin, que
// también casan con notificaciones que salen de los scripts.
test("builtin: no tapa a las otras builtin que casan con la misma notificación", () => {
  const bateria: NotifInput = { appName: "Batería", summary: "Batería baja", body: "5%", urgency: 2, source: "system" }
  const r = evaluate(bateria, builtins(), NOW)
  assert.equal(r.meta.style, "dunst")               // la cosmética se aplica…
  assert.equal(r.meta.lifetime, "flash")            // …y builtin.low-battery sigue actuando
  assert.ok(r.meta.conditions.includes("battery-resolved"))
})

// Es lo que hace que el interruptor de la UI signifique algo: el popup ya no mira el hint por
// detrás, así que desactivar la regla tiene que quitar el skin de verdad.
test("builtin: desactivarla deja la notificación del sistema SIN estilo", () => {
  const off = BUILTIN_RULES.map(r => r.id === "builtin.system-dunst" ? { ...r, enabled: false } : r)
  const r = evaluate(sys, compileRules(off), NOW)
  assert.equal(r.meta.style, undefined)
})

test("builtin: una regla de usuario de más prioridad la pisa (opt-out)", () => {
  const userOptOut = rule({ id: "u", priority: 100, match: { summary: { op: "contains", value: "USB" } }, effects: { style: "default" } })
  const r = evaluate(sys, compileRules([...BUILTIN_RULES, userOptOut]), NOW)
  assert.equal(r.meta.style, "default")
})

test("validate acepta los estilos conocidos y rechaza los inventados", () => {
  assert.deepEqual(validateRule(rule({ effects: { style: "dunst" } })), [])
  assert.deepEqual(validateRule(rule({ effects: { style: "default" } })), [])
  const errs = validateRule(rule({ effects: { style: "neon" as any } }))
  assert.equal(errs.length, 1)
  assert.match(errs[0], /Estilo de popup desconocido/)
})
