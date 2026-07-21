import assert from "node:assert/strict"
import test from "node:test"
import type { StoredNotification } from "../store"
import {
  calcularDuracionPopup,
  crearResumenRafaga,
  obtenerAccionesVisibles,
} from "./logica.ts"

function crearNotificacion(
  parcial: Partial<StoredNotification> = {},
): StoredNotification {
  return {
    id: 1,
    appName: "Prueba",
    appIcon: "",
    summary: "Resumen",
    body: "Cuerpo",
    timestamp: 0,
    read: false,
    urgency: 1,
    actions: [],
    meta: {
      lifetime: "timed",
      clearOnBoot: false,
      noHistory: false,
      muteAudio: false,
      dontShow: false,
      conditions: [],
      matchedRules: [],
    },
    ...parcial,
  }
}

test("filtra la activación implícita y las acciones sin etiqueta", () => {
  const notificacion = crearNotificacion({
    actions: [
      { id: "default", label: "Abrir" },
      { id: "vacia", label: "  " },
      { id: "reparar", label: "Reparar" },
    ],
  })

  assert.deepEqual(obtenerAccionesVisibles(notificacion), [
    { id: "reparar", label: "Reparar" },
  ])
})

test("mantiene la duración normal cuando no hay acciones visibles", () => {
  const notificacion = crearNotificacion({
    expireTimeout: 45000,
    actions: [{ id: "default", label: "Abrir" }],
  })

  assert.equal(calcularDuracionPopup(notificacion), 5500)
})

test("acota la duración de los popups con acciones", () => {
  const accion = [{ id: "reparar", label: "Reparar" }]

  assert.equal(calcularDuracionPopup(crearNotificacion({ actions: accion })), 20000)
  assert.equal(calcularDuracionPopup(crearNotificacion({ actions: accion, expireTimeout: 5000 })), 20000)
  assert.equal(calcularDuracionPopup(crearNotificacion({ actions: accion, expireTimeout: 35000 })), 35000)
  assert.equal(calcularDuracionPopup(crearNotificacion({ actions: accion, expireTimeout: 90000 })), 60000)
})

test("crea un resumen sintético que no se guarda en el historial", () => {
  const resumen = crearResumenRafaga(-4, 23)

  assert.equal(resumen.id, -4)
  assert.equal(resumen.body, "Han llegado 23 notificaciones. Revísalas en el panel de notificaciones.")
  assert.equal(resumen.meta.noHistory, true)
  assert.equal(resumen.meta.muteAudio, true)
  assert.equal(resumen.meta.dedupKey, "gigios-popup-burst-summary")
})
