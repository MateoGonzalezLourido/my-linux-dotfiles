import { test } from "node:test"
import assert from "node:assert/strict"
import {
  parseMinutes, normalizeMinutesText, formatRemaining, chipText, tooltipText, MAX_MINUTES,
} from "./wakeupTime.ts"

test("el campo vacío significa SIN LÍMITE, no cero", () => {
  assert.equal(parseMinutes(""), null)
  assert.equal(parseMinutes("   "), null)
})

test("parseMinutes lee un número de minutos", () => {
  assert.equal(parseMinutes("30"), 30)
  assert.equal(parseMinutes("1"), 1)
  assert.equal(parseMinutes(" 45 "), 45)
  assert.equal(parseMinutes("007"), 7)
})

test("parseMinutes topa el plazo en 24 h", () => {
  assert.equal(parseMinutes(String(MAX_MINUTES + 1)), MAX_MINUTES)
  assert.equal(parseMinutes("999999"), MAX_MINUTES)
  assert.equal(parseMinutes("9".repeat(400)), MAX_MINUTES)
})

test("'0' es sin límite, no un Wake up que se apaga al instante", () => {
  assert.equal(parseMinutes("0"), null)
  assert.equal(parseMinutes("00"), null)
})

test("la basura degrada a sin límite en vez de reventar", () => {
  // El campo es Gtk.InputPurpose.DIGITS, así que esto son solo casos límite.
  assert.equal(parseMinutes("abc"), null)
  assert.equal(parseMinutes("3o"), null)
  assert.equal(parseMinutes("-5"), null)
  assert.equal(parseMinutes("1.5"), null)
})

test("normalizeMinutesText deja el campo en su forma canónica", () => {
  assert.equal(normalizeMinutesText("007"), "7")
  assert.equal(normalizeMinutesText("abc"), "")
  assert.equal(normalizeMinutesText("0"), "")
  assert.equal(normalizeMinutesText("30"), "30")
  assert.equal(normalizeMinutesText("99999"), String(MAX_MINUTES))
})

test("formatRemaining: M:SS por debajo de una hora", () => {
  assert.equal(formatRemaining(1800), "30:00")
  assert.equal(formatRemaining(59), "0:59")
  assert.equal(formatRemaining(60), "1:00")
  assert.equal(formatRemaining(605), "10:05")
})

test("formatRemaining: H:MM:SS a partir de una hora", () => {
  assert.equal(formatRemaining(3600), "1:00:00")
  assert.equal(formatRemaining(3905), "1:05:05")
  assert.equal(formatRemaining(86400), "24:00:00")
})

test("formatRemaining redondea hacia arriba y no baja de cero", () => {
  // Al armar un plazo de 30 min el primer tick llega un pelo después: sin el ceil
  // el chip estrenaría "29:59", que parece que ya ha perdido un segundo.
  assert.equal(formatRemaining(1799.4), "30:00")
  assert.equal(formatRemaining(0), "0:00")
  assert.equal(formatRemaining(-5), "0:00")
  assert.equal(formatRemaining(Number.NaN), "0:00")
  assert.equal(formatRemaining(Number.POSITIVE_INFINITY), "0:00")
})

test("chipText refleja los tres estados de la fila", () => {
  assert.equal(chipText(false, null), "OFF")
  assert.equal(chipText(false, 300), "OFF")   // apagado manda sobre cualquier resto
  assert.equal(chipText(true, null), "∞")
  assert.equal(chipText(true, 1800), "30:00")
})

test("tooltipText distingue si la pantalla está protegida", () => {
  assert.match(tooltipText(null, false), /sin límite/)
  assert.match(tooltipText(1800, false), /30:00 restantes/)
  assert.match(tooltipText(1800, true), /pantalla tampoco se apaga/)
  assert.match(tooltipText(1800, false), /se apaga y bloquea con normalidad/)
})
