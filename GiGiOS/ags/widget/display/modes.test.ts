import { test } from "node:test"
import assert from "node:assert/strict"
import { parseAvailableModes } from "./modes.ts"

test("parseAvailableModes groups by resolution and sorts", () => {
  const parsed = parseAvailableModes(["1920x1200@144.00Hz", "1920x1200@60.00Hz"])
  assert.equal(parsed.resolutions.length, 1)
  const res = parsed.resolutions[0]
  assert.equal(res.w, 1920)
  assert.equal(res.h, 1200)
  assert.equal(res.key, "1920x1200")
  assert.equal(res.label, "1920×1200") // U+00D7 ×
  assert.deepEqual(res.refreshRates.map(r => r.hz), [144, 60]) // hz desc
  assert.equal(res.refreshRates[0].raw, "144.00")
  assert.equal(res.refreshRates[0].modeString, "1920x1200@144.00Hz")
})

test("parseAvailableModes sorts resolutions by area desc", () => {
  const parsed = parseAvailableModes(["1280x720@60.00Hz", "1920x1080@60.00Hz"])
  assert.deepEqual(parsed.resolutions.map(r => r.key), ["1920x1080", "1280x720"])
})

test("parseAvailableModes dedups refresh rates by rounded hz", () => {
  const parsed = parseAvailableModes(["1920x1080@60.00Hz", "1920x1080@59.94Hz"])
  assert.deepEqual(parsed.resolutions[0].refreshRates.map(r => r.hz), [60])
})

test("parseAvailableModes ignores malformed entries", () => {
  const parsed = parseAvailableModes(["garbage", "1920x1080@60.00Hz"])
  assert.equal(parsed.resolutions.length, 1)
})

test("parseAvailableModes handles empty input", () => {
  assert.deepEqual(parseAvailableModes([]).resolutions, [])
})

import {
  modeToHyprctl,
  buildMonitorRule,
  matchScalePreset,
  monitorNeedsUpdate,
  SCALE_PRESETS,
} from "./modes.ts"

test("modeToHyprctl strips the Hz suffix", () => {
  assert.equal(modeToHyprctl("1920x1200@144.00Hz"), "1920x1200@144.00")
})

test("buildMonitorRule assembles a full rule", () => {
  const rule = buildMonitorRule({
    name: "eDP-1",
    position: "0x0",
    pref: { mode: "1920x1200@144.00Hz", scale: 1.33, vrr: true, mirrorOf: "none" },
  })
  assert.equal(rule, "eDP-1,1920x1200@144.00,0x0,1.33,vrr,1")
})

test("buildMonitorRule appends mirror and omits none", () => {
  const rule = buildMonitorRule({
    name: "HDMI-A-1",
    position: "auto",
    pref: { mode: "1920x1080@60.00Hz", scale: 1, vrr: false, mirrorOf: "eDP-1" },
  })
  assert.equal(rule, "HDMI-A-1,1920x1080@60.00,auto,1,vrr,0,mirror,eDP-1")
})

test("buildMonitorRule returns disable rule when enabled is false", () => {
  const rule = buildMonitorRule({ name: "eDP-1", position: "0x0", pref: { enabled: false } })
  assert.equal(rule, "eDP-1,disable")
})

test("buildMonitorRule falls back to preferred/auto when fields missing", () => {
  const rule = buildMonitorRule({ name: "eDP-1", position: "auto", pref: {} })
  assert.equal(rule, "eDP-1,preferred,auto,auto")
})

test("matchScalePreset returns the nearest preset", () => {
  assert.equal(matchScalePreset(1.3), 1.33)
  assert.equal(matchScalePreset(1.0), 1.0)
  assert.equal(matchScalePreset(1.9), 2.0)
  assert.ok(SCALE_PRESETS.includes(matchScalePreset(1.4)))
})

test("monitorNeedsUpdate detects a mode mismatch", () => {
  const mon = { width: 1920, height: 1200, refreshRate: 60.001, scale: 1.33, vrr: false, disabled: false, mirrorOf: "none" }
  assert.equal(monitorNeedsUpdate(mon, { mode: "1920x1200@60.00Hz" }), false)
  assert.equal(monitorNeedsUpdate(mon, { mode: "1920x1200@144.00Hz" }), true)
})

test("monitorNeedsUpdate detects enable/disable, scale, vrr, mirror", () => {
  const mon = { width: 1920, height: 1200, refreshRate: 60, scale: 1.33, vrr: false, disabled: false, mirrorOf: "none" }
  assert.equal(monitorNeedsUpdate(mon, { enabled: false }), true)
  assert.equal(monitorNeedsUpdate({ ...mon, disabled: true }, { enabled: false }), false)
  assert.equal(monitorNeedsUpdate({ ...mon, disabled: true }, { enabled: true }), true)
  assert.equal(monitorNeedsUpdate(mon, { scale: 1.5 }), true)
  assert.equal(monitorNeedsUpdate(mon, { scale: 1.33 }), false)
  assert.equal(monitorNeedsUpdate(mon, { vrr: true }), true)
  assert.equal(monitorNeedsUpdate(mon, { mirrorOf: "eDP-1" }), true)
  assert.equal(monitorNeedsUpdate(mon, {}), false)
})

import { TRANSFORMS, computeRelativePosition } from "./modes.ts"

test("TRANSFORMS cubre los 8 valores de Hyprland", () => {
  assert.deepEqual(TRANSFORMS.map(t => t.value), [0, 1, 2, 3, 4, 5, 6, 7])
  assert.equal(TRANSFORMS[0].label, "Normal")
  assert.equal(TRANSFORMS[1].label, "90°")
})

test("computeRelativePosition coloca a la derecha usando ancho lógico del ref", () => {
  const ref = { x: 0, y: 0, width: 1920, height: 1080, scale: 1 }
  const self = { width: 1920, height: 1080, scale: 1 }
  assert.equal(computeRelativePosition(ref, self, "right"), "1920x0")
  assert.equal(computeRelativePosition(ref, self, "down"), "0x1080")
})

test("computeRelativePosition a la izquierda/arriba usa dims del propio monitor", () => {
  const ref = { x: 1920, y: 0, width: 1920, height: 1080, scale: 1 }
  const self = { width: 1280, height: 720, scale: 1 }
  assert.equal(computeRelativePosition(ref, self, "left"), "640x0")
  assert.equal(computeRelativePosition(ref, self, "up"), "1920x-720")
})

test("computeRelativePosition respeta la escala (ancho lógico redondeado)", () => {
  const ref = { x: 0, y: 0, width: 2560, height: 1440, scale: 2 }
  const self = { width: 1920, height: 1080, scale: 1.5 }
  assert.equal(computeRelativePosition(ref, self, "right"), "1280x0")
})

test("buildMonitorRule anexa transform, bitdepth, cm y sdr", () => {
  const rule = buildMonitorRule({
    name: "eDP-1", position: "0x0",
    pref: { mode: "1920x1200@144.00Hz", scale: 1, vrr: false, mirrorOf: "none",
            transform: 1, bitdepth: 10, cm: "hdr", sdrBrightness: 1.2, sdrSaturation: 1.1 },
  })
  assert.equal(rule, "eDP-1,1920x1200@144.00,0x0,1,vrr,0,transform,1,bitdepth,10,cm,hdr,sdrbrightness,1.2,sdrsaturation,1.1")
})

test("monitorNeedsUpdate detecta transform, bitdepth y cm", () => {
  const mon = { width: 1920, height: 1200, refreshRate: 60, scale: 1, vrr: false, disabled: false, mirrorOf: "none", transform: 0, bitdepth: 8, cm: "auto" }
  assert.equal(monitorNeedsUpdate(mon, { transform: 1 }), true)
  assert.equal(monitorNeedsUpdate(mon, { transform: 0 }), false)
  assert.equal(monitorNeedsUpdate(mon, { bitdepth: 10 }), true)
  assert.equal(monitorNeedsUpdate(mon, { cm: "hdr" }), true)
  assert.equal(monitorNeedsUpdate(mon, { cm: "auto" }), false)
})

import { nativeResolution, resolutionOptions, refreshOptions, bestRefreshFor } from "./modes.ts"

// Los modos reales de este panel (DP-1), recortados: sirven para los casos que
// motivaron el filtro por resolución.
const PANEL = [
  "2560x1440@59.95Hz", "2560x1440@239.97Hz", "2560x1440@164.96Hz",
  "2560x1440@144.00Hz", "2560x1440@120.00Hz",
  "1920x1080@240.00Hz", "1920x1080@119.88Hz", "1920x1080@100.00Hz",
  "1920x1080@60.00Hz", "1920x1080@23.98Hz",
  "1600x1200@60.00Hz",
]

test("nativeResolution returns the largest reported mode by area", () => {
  assert.deepEqual(nativeResolution(["1920x1200@144.00Hz", "1920x1200@60.00Hz"]), { w: 1920, h: 1200 })
  assert.deepEqual(nativeResolution(["1280x720@60.00Hz", "1920x1080@60.00Hz"]), { w: 1920, h: 1080 })
  assert.equal(nativeResolution([]), null)
})

test("resolutionOptions marks native and filters common ones above it", () => {
  const opts = resolutionOptions(["1920x1200@144.00Hz", "1920x1200@60.00Hz"])
  assert.equal(opts[0].key, "1920x1200")
  assert.equal(opts[0].native, true)
  assert.equal(opts[0].label, "1920×1200 (nativa)")
  // no debe ofrecer resoluciones mayores que la nativa (área)
  assert.ok(!opts.some(o => o.w * o.h > 1920 * 1200))
  // sí ofrece comunes menores, sin duplicar la nativa
  assert.ok(opts.some(o => o.key === "1280x720" && !o.native))
  assert.equal(opts.filter(o => o.key === "1920x1200").length, 1)
  // ordenadas por área descendente
  for (let i = 1; i < opts.length; i++) {
    assert.ok(opts[i - 1].w * opts[i - 1].h >= opts[i].w * opts[i].h)
  }
})

test("resolutionOptions without modes returns the full common list", () => {
  const opts = resolutionOptions([])
  assert.equal(opts.length, 12)
  assert.ok(opts.every(o => !o.native))
  assert.equal(opts[0].key, "3840x2160")
})

test("refreshOptions returns distinct rounded hz sorted desc", () => {
  const opts = refreshOptions(["1920x1200@144.00Hz", "1920x1200@60.00Hz", "1600x900@60.00Hz"])
  assert.deepEqual(opts.map(o => o.hz), [144, 60])
  assert.equal(opts[0].raw, "144.00")
})

test("refreshOptions only offers rates the given resolution actually has", () => {
  assert.deepEqual(refreshOptions(PANEL, { w: 2560, h: 1440 }).map(o => o.hz), [240, 165, 144, 120, 60])
  assert.deepEqual(refreshOptions(PANEL, { w: 1920, h: 1080 }).map(o => o.hz), [240, 120, 100, 60, 24])
  assert.deepEqual(refreshOptions(PANEL, { w: 1600, h: 1200 }).map(o => o.hz), [60])
})

test("refreshOptions takes the raw value from the given resolution's own mode", () => {
  // 240 Hz es 239.97 a 1440p pero 240.00 a 1080p: agrupados, elegir 240 a 1080p
  // mandaba un modo inexistente.
  assert.equal(refreshOptions(PANEL, { w: 2560, h: 1440 })[0].raw, "239.97")
  assert.equal(refreshOptions(PANEL, { w: 1920, h: 1080 })[0].raw, "240.00")
})

test("refreshOptions falls back to every rate for an unreported resolution", () => {
  // 1366x768 no lo reporta el panel (resolución fabricada, escalada por GPU):
  // mejor ofrecer de más que dejar el desplegable vacío.
  const opts = refreshOptions(PANEL, { w: 1366, h: 768 })
  assert.deepEqual(opts.map(o => o.hz), refreshOptions(PANEL).map(o => o.hz))
})

test("bestRefreshFor keeps the rate when the new resolution has it", () => {
  assert.equal(bestRefreshFor(PANEL, { w: 1920, h: 1080 }, 120), "119.88")
  assert.equal(bestRefreshFor(PANEL, { w: 2560, h: 1440 }, 144), "144.00")
})

test("bestRefreshFor steps DOWN, never up, when the rate is unavailable", () => {
  // 1080p@240 → 1600x1200, cuyo único modo es 60: pedir 240 dejaría la pantalla negra.
  assert.equal(bestRefreshFor(PANEL, { w: 1600, h: 1200 }, 240), "60.00")
  // 1440p@165 → 1080p: no hay 165, el mayor que cabe es 120.
  assert.equal(bestRefreshFor(PANEL, { w: 1920, h: 1080 }, 165), "119.88")
})

test("bestRefreshFor falls back to the lowest rate when nothing is below", () => {
  assert.equal(bestRefreshFor(PANEL, { w: 2560, h: 1440 }, 30), "59.95")
})

test("bestRefreshFor returns null for an unreported resolution", () => {
  assert.equal(bestRefreshFor(PANEL, { w: 1366, h: 768 }, 144), null)
})
