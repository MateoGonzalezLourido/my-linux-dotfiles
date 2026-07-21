import { test } from "node:test"
import assert from "node:assert/strict"
import { getAppColor, getAppIcon, resolveAppColor, resolveNotifColor } from "./presentacion.ts"

test("mantiene los colores e iconos semánticos de aplicaciones conocidas", () => {
  assert.equal(getAppColor("WhatsApp Desktop"), "#a6e3a1")
  assert.equal(getAppColor("Thunderbird"), "#89b4fa")
  assert.equal(getAppIcon("Firefox"), "󰈹")
  assert.equal(getAppIcon("aplicación desconocida"), "󰂚")
})

test("prioriza el color de regla sobre el de aplicación y el predeterminado", () => {
  const ajustes = {
    Discord: { muted: false, importance: "normal" as const, showOnLockscreen: true, color: "#112233" },
  }
  assert.equal(resolveAppColor("Discord", ajustes), "#112233")
  assert.equal(resolveNotifColor({ appName: "Discord" }, ajustes), "#112233")
  assert.equal(resolveNotifColor({ appName: "Discord", meta: { color: "#abcdef" } }, ajustes), "#abcdef")
})
