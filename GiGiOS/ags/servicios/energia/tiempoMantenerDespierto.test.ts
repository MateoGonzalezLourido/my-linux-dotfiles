import { test } from "node:test"
import assert from "node:assert/strict"
import {
  formatearTiempoRestante,
  interpretarMinutos,
  MAXIMO_MINUTOS,
  normalizarTextoMinutos,
  textoChipMantenerDespierto,
  textoTooltipMantenerDespierto,
} from "./tiempoMantenerDespierto.ts"

test("el campo vacío significa sin límite, no cero", () => {
  assert.equal(interpretarMinutos(""), null)
  assert.equal(interpretarMinutos("   "), null)
})

test("interpreta un número de minutos", () => {
  assert.equal(interpretarMinutos("30"), 30)
  assert.equal(interpretarMinutos("1"), 1)
  assert.equal(interpretarMinutos(" 45 "), 45)
  assert.equal(interpretarMinutos("007"), 7)
})

test("limita el plazo a 24 horas", () => {
  assert.equal(interpretarMinutos(String(MAXIMO_MINUTOS + 1)), MAXIMO_MINUTOS)
  assert.equal(interpretarMinutos("999999"), MAXIMO_MINUTOS)
  assert.equal(interpretarMinutos("9".repeat(400)), MAXIMO_MINUTOS)
})

test("cero significa sin límite", () => {
  assert.equal(interpretarMinutos("0"), null)
  assert.equal(interpretarMinutos("00"), null)
})

test("los valores no válidos degradan a sin límite", () => {
  assert.equal(interpretarMinutos("abc"), null)
  assert.equal(interpretarMinutos("3o"), null)
  assert.equal(interpretarMinutos("-5"), null)
  assert.equal(interpretarMinutos("1.5"), null)
})

test("normaliza el texto de minutos", () => {
  assert.equal(normalizarTextoMinutos("007"), "7")
  assert.equal(normalizarTextoMinutos("abc"), "")
  assert.equal(normalizarTextoMinutos("0"), "")
  assert.equal(normalizarTextoMinutos("30"), "30")
  assert.equal(normalizarTextoMinutos("99999"), String(MAXIMO_MINUTOS))
})

test("formatea M:SS por debajo de una hora", () => {
  assert.equal(formatearTiempoRestante(1800), "30:00")
  assert.equal(formatearTiempoRestante(59), "0:59")
  assert.equal(formatearTiempoRestante(60), "1:00")
  assert.equal(formatearTiempoRestante(605), "10:05")
})

test("formatea H:MM:SS a partir de una hora", () => {
  assert.equal(formatearTiempoRestante(3600), "1:00:00")
  assert.equal(formatearTiempoRestante(3905), "1:05:05")
  assert.equal(formatearTiempoRestante(86400), "24:00:00")
})

test("redondea hacia arriba y no baja de cero", () => {
  assert.equal(formatearTiempoRestante(1799.4), "30:00")
  assert.equal(formatearTiempoRestante(0), "0:00")
  assert.equal(formatearTiempoRestante(-5), "0:00")
  assert.equal(formatearTiempoRestante(Number.NaN), "0:00")
  assert.equal(formatearTiempoRestante(Number.POSITIVE_INFINITY), "0:00")
})

test("el chip refleja los tres estados", () => {
  assert.equal(textoChipMantenerDespierto(false, null), "OFF")
  assert.equal(textoChipMantenerDespierto(false, 300), "OFF")
  assert.equal(textoChipMantenerDespierto(true, null), "∞")
  assert.equal(textoChipMantenerDespierto(true, 1800), "30:00")
})

test("el tooltip distingue si la pantalla está protegida", () => {
  assert.match(textoTooltipMantenerDespierto(null, false), /sin límite/)
  assert.match(textoTooltipMantenerDespierto(1800, false), /30:00 restantes/)
  assert.match(textoTooltipMantenerDespierto(1800, true), /pantalla tampoco se apaga/)
  assert.match(textoTooltipMantenerDespierto(1800, false), /se apaga y bloquea con normalidad/)
})
