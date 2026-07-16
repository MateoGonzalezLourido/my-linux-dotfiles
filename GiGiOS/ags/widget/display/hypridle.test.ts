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

// ── La puerta del Wake up (hypr/scripts/idle-action.sh) ──────────────────────
// Los listeners reales ya no llaman a la acción directamente: pasan por el script
// que consulta el Wake up. Si kindOf() no supiera reconocerlos, Ajustes > Pantalla
// dejaría de ver los tres listeners y sus tiempos se volverían ineditables — en
// silencio, porque parseHypridle degrada a "no encontrado", no a un error.
const GATED = `listener {
    timeout = 600
    on-timeout = ~/.config/hypr/scripts/idle-action.sh dpms-off
    on-resume = hyprctl dispatch dpms on
}

listener {
    timeout = 660
    on-timeout = ~/.config/hypr/scripts/idle-action.sh lock
}

listener {
    timeout = 900
    on-timeout = ~/.config/hypr/scripts/idle-action.sh suspend
}
`

test("parseHypridle reconoce los listeners que pasan por idle-action.sh", () => {
  const p = parseHypridle(GATED)
  assert.equal(p.dpms.timeout, 600)
  assert.equal(p.dpms.enabled, true)
  assert.equal(p.lock.timeout, 660)
  assert.equal(p.lock.enabled, true)
  assert.equal(p.suspend.timeout, 900)
  assert.equal(p.suspend.enabled, true)
})

test("writeHypridle edita los listeners con puerta sin tocar el comando", () => {
  const out = writeHypridle(GATED, { dpms: { timeout: 300, enabled: true } })
  assert.match(out, /timeout = 300\n\s+on-timeout = ~\/\.config\/hypr\/scripts\/idle-action\.sh dpms-off/)
  assert.equal(parseHypridle(out).dpms.timeout, 300)
  assert.equal(parseHypridle(out).lock.timeout, 660) // los demás intactos
})

test("parseHypridle sigue leyendo el formato directo (config sin Wake up)", () => {
  // Un hypridle.conf traído de otra máquina, o una copia anterior a esta función.
  const p = parseHypridle(SAMPLE)
  assert.equal(p.dpms.timeout, 600)
  assert.equal(p.lock.timeout, 630)
  assert.equal(p.suspend.timeout, 660)
})

test("la puerta gana al patrón directo: 'lock' no se confunde con la ruta", () => {
  // La ruta del script contiene "hypr"; si algún día colgara de un directorio
  // llamado p.ej. .../hyprlock/, el patrón directo /hyprlock/ casaría antes y
  // marcaría el listener equivocado. El argumento es la única señal fiable.
  const tricky = `listener {
    timeout = 660
    on-timeout = ~/.config/hyprlock-tools/idle-action.sh suspend
}
`
  assert.equal(parseHypridle(tricky).suspend.timeout, 660)
  assert.equal(parseHypridle(tricky).lock.enabled, false) // no lo ha tomado por lock
})

test("una acción desconocida en la puerta no se asigna a ningún listener", () => {
  const unknown = `listener {
    timeout = 500
    on-timeout = ~/.config/hypr/scripts/idle-action.sh algo-nuevo
}
`
  const p = parseHypridle(unknown)
  assert.equal(p.dpms.enabled, false)
  assert.equal(p.lock.enabled, false)
  assert.equal(p.suspend.enabled, false)
})
