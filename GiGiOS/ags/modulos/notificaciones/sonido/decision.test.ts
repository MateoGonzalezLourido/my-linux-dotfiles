import { test } from "node:test"
import assert from "node:assert/strict"
import { SONIDO_ALARMA, comandoReproduccion, decidirSonido } from "./decision.ts"
import type { EntradaSonido } from "./decision.ts"

const base = (p: Partial<EntradaSonido> = {}): EntradaSonido => ({
  noMolestar: false,
  muteAudio: false,
  ...p,
})

test("sin sonido pedido no suena nada: no hay sonido por defecto", () => {
  // Es la guarda que evita que activar el audio convierta en sonora toda notificación del sistema.
  assert.deepEqual(decidirSonido(base()), { reproducir: false, motivo: "sin-sonido" })
  assert.deepEqual(decidirSonido(base({ soundName: "   " })), { reproducir: false, motivo: "sin-sonido" })
})

test("un sound-name pedido suena como tema", () => {
  assert.deepEqual(decidirSonido(base({ soundName: SONIDO_ALARMA })), {
    reproducir: true,
    tipo: "tema",
    recurso: "alarm-clock-elapsed",
  })
})

test("el sound-file gana al sound-name: es más específico", () => {
  assert.deepEqual(decidirSonido(base({ soundName: "bell", soundFile: "/tmp/a.oga" })), {
    reproducir: true,
    tipo: "archivo",
    recurso: "/tmp/a.oga",
  })
})

test("suppress-sound gana a todo", () => {
  const d = decidirSonido(base({ soundName: SONIDO_ALARMA, suppressSound: true }))
  assert.deepEqual(d, { reproducir: false, motivo: "suppress-sound" })
})

test("No molestar silencia", () => {
  assert.deepEqual(decidirSonido(base({ soundName: SONIDO_ALARMA, noMolestar: true })), {
    reproducir: false,
    motivo: "no-molestar",
  })
})

test("una regla con muteAudio silencia", () => {
  assert.deepEqual(decidirSonido(base({ soundName: SONIDO_ALARMA, muteAudio: true })), {
    reproducir: false,
    motivo: "regla",
  })
})

test("una notificación CRÍTICA tampoco se salta el No molestar", () => {
  // Tentador, pero quien activa No molestar está pidiendo silencio; la notificación sigue viéndose.
  const d = decidirSonido(base({ soundName: SONIDO_ALARMA, urgencia: 2, noMolestar: true }))
  assert.equal(d.reproducir, false)
})

test("una alarma con todo permitido sí suena", () => {
  const d = decidirSonido(base({ soundName: SONIDO_ALARMA, urgencia: 2 }))
  assert.equal(d.reproducir, true)
})

// ── Comando ──────────────────────────────────────────────────────────────────

const todo = () => true
const nada = () => false
const solo = (...ok: string[]) => (p: string) => ok.includes(p)

test("un nombre de tema exige canberra", () => {
  const d = decidirSonido(base({ soundName: "bell" }))
  assert.deepEqual(comandoReproduccion(d, todo), ["canberra-gtk-play", "-i", "bell"])
  // Sin canberra no se puede resolver un nombre de tema, y adivinar la ruta del `.oga` sería
  // inventarse el tema instalado.
  assert.equal(comandoReproduccion(d, solo("paplay", "pw-play")), null)
})

test("un fichero cae a otros reproductores por orden", () => {
  const d = decidirSonido(base({ soundFile: "/tmp/a.oga" }))
  assert.deepEqual(comandoReproduccion(d, todo), ["canberra-gtk-play", "-f", "/tmp/a.oga"])
  assert.deepEqual(comandoReproduccion(d, solo("pw-play", "paplay")), ["pw-play", "/tmp/a.oga"])
  assert.deepEqual(comandoReproduccion(d, solo("paplay")), ["paplay", "/tmp/a.oga"])
  assert.equal(comandoReproduccion(d, nada), null)
})

test("el comando es siempre un array de argumentos, nunca una cadena de shell", () => {
  // Un `sound-file` llega por D-Bus desde cualquier proceso de la sesión: con `sh -c` esto sería
  // ejecución de comandos.
  const d = decidirSonido(base({ soundFile: "/tmp/a.oga; rm -rf ~" }))
  const cmd = comandoReproduccion(d, todo)!
  assert.equal(Array.isArray(cmd), true)
  assert.equal(cmd[cmd.length - 1], "/tmp/a.oga; rm -rf ~", "va como un único argumento literal")
  assert.equal(cmd.some((a) => a === "sh" || a === "-c"), false)
})

test("una decisión de silencio no produce comando", () => {
  assert.equal(comandoReproduccion({ reproducir: false, motivo: "no-molestar" }, todo), null)
})
