import { test } from "node:test"
import assert from "node:assert/strict"
import { parseHypridle, writeHypridle } from "./hypridle.ts"

const SAMPLE = `general {
    lock_cmd = hyprlock
}

listener {
    timeout = 600
    on-timeout = hyprctl dispatch dpms off
    on-resume = hyprctl dispatch dpms on
}

listener {
    timeout = 630
    on-timeout = hyprlock
}

listener {
    timeout =  660
    on-timeout = systemctl suspend
}
`

test("parseHypridle extrae los tres timeouts en segundos", () => {
  const p = parseHypridle(SAMPLE)
  assert.equal(p.dpms.timeout, 600)
  assert.equal(p.dpms.enabled, true)
  assert.equal(p.lock.timeout, 630)
  assert.equal(p.suspend.timeout, 660)
})

test("writeHypridle cambia solo el valor y preserva el resto", () => {
  const out = writeHypridle(SAMPLE, { dpms: { timeout: 300, enabled: true } })
  assert.match(out, /timeout = 300\n\s+on-timeout = hyprctl dispatch dpms off/)
  assert.match(out, /timeout = 630/)   // lock intacto
  assert.match(out, /on-resume = hyprctl dispatch dpms on/) // comentarios/estructura intactos
})

test("writeHypridle desactiva comentando la línea timeout con sentinel", () => {
  const out = writeHypridle(SAMPLE, { suspend: { timeout: 660, enabled: false } })
  assert.match(out, /#\s*timeout =\s*660\s+# GIGIOS-OFF/)
  const p = parseHypridle(out)
  assert.equal(p.suspend.enabled, false)
  assert.equal(p.suspend.timeout, 660) // sigue leyéndose el valor
})

test("writeHypridle reactiva quitando el sentinel", () => {
  const off = writeHypridle(SAMPLE, { suspend: { timeout: 660, enabled: false } })
  const on = writeHypridle(off, { suspend: { timeout: 660, enabled: true } })
  const p = parseHypridle(on)
  assert.equal(p.suspend.enabled, true)
})
