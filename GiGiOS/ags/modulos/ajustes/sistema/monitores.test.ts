import { test } from "node:test"
import assert from "node:assert/strict"
import {
  bitsPorCanal,
  diagonalPulgadas,
  identidadMonitor,
  parsearMonitores,
} from "./monitores.ts"

const salidaCompleta = JSON.stringify([{
  name: "DP-1",
  description: "ASUSTek COMPUTER INC XG27AQDMES SERIAL",
  make: "ASUSTek COMPUTER INC",
  model: "XG27AQDMES",
  serial: "SERIAL",
  width: 2560,
  height: 1440,
  physicalWidth: 590,
  physicalHeight: 330,
  refreshRate: 239.97,
  scale: 1.25,
  currentFormat: "XRGB8888",
}])

test("parsearMonitores conserva las especificaciones y no expone el número de serie", () => {
  const [monitor] = parsearMonitores(salidaCompleta)
  assert.deepEqual(monitor, {
    conector: "DP-1",
    fabricante: "ASUSTek COMPUTER INC",
    modelo: "XG27AQDMES",
    ancho: 2560,
    alto: 1440,
    anchoFisico: 590,
    altoFisico: 330,
    frecuencia: 239.97,
    escala: 1.25,
    formatoColor: "XRGB8888",
  })
  assert.equal("serial" in monitor, false)
  assert.equal(identidadMonitor(monitor), "ASUSTek COMPUTER INC XG27AQDMES")
})

test("parsearMonitores admite varios monitores y campos ausentes", () => {
  const monitores = parsearMonitores(JSON.stringify([
    { name: "eDP-1", model: "Pantalla integrada", width: 1920, height: 1200 },
    { name: "HDMI-A-1", description: "Monitor externo" },
    null,
  ]))

  assert.equal(monitores.length, 2)
  assert.equal(identidadMonitor(monitores[0]), "Pantalla integrada")
  assert.equal(identidadMonitor(monitores[1]), "HDMI-A-1")
  assert.equal(monitores[1].frecuencia, 0)
  assert.equal(monitores[1].formatoColor, "")
})

test("parsearMonitores degrada a una lista vacía ante JSON inválido", () => {
  assert.deepEqual(parsearMonitores("no es JSON"), [])
  assert.deepEqual(parsearMonitores("{}"), [])
})

test("diagonalPulgadas calcula el tamaño físico declarado por el EDID", () => {
  const [monitor] = parsearMonitores(salidaCompleta)
  assert.equal(diagonalPulgadas(monitor)?.toFixed(1), "26.6")
})

test("bitsPorCanal reconoce formatos DRM habituales", () => {
  assert.equal(bitsPorCanal("XRGB8888"), 8)
  assert.equal(bitsPorCanal("ARGB2101010"), 10)
  assert.equal(bitsPorCanal("XBGR16161616F"), 16)
  assert.equal(bitsPorCanal("desconocido"), null)
})
