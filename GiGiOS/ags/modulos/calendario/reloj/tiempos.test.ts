import { test } from "node:test"
import assert from "node:assert/strict"
import {
  cancelarTemporizador,
  continuarTemporizador,
  fijarDuracion,
  formatearCronometro,
  formatearRestante,
  haVencido,
  iniciarCronometro,
  iniciarTemporizador,
  msHastaSiguienteTick,
  pausarCronometro,
  pausarTemporizador,
  reiniciarCronometro,
  restanteTemporizador,
  transcurrido,
} from "./tiempos.ts"
import { cronometroInicial, temporizadorInicial } from "./tipos.ts"

const T0 = 1_000_000

test("el temporizador cuenta contra el reloj, no acumulando ticks", () => {
  let t = iniciarTemporizador(temporizadorInicial(60_000), T0)
  assert.equal(t.estado, "corriendo")
  assert.equal(restanteTemporizador(t, T0), 60_000)
  assert.equal(restanteTemporizador(t, T0 + 15_000), 45_000)
  // Aunque no se haya pintado ni un frame en 59 s, el restante es exacto.
  assert.equal(restanteTemporizador(t, T0 + 59_000), 1_000)
  assert.equal(restanteTemporizador(t, T0 + 90_000), 0, "vencido nunca es negativo")
})

test("pausar y continuar conservan el restante exacto", () => {
  let t = iniciarTemporizador(temporizadorInicial(60_000), T0)
  t = pausarTemporizador(t, T0 + 20_000)
  assert.equal(t.estado, "pausado")
  assert.equal(t.venceEn, null)
  assert.equal(restanteTemporizador(t, T0 + 20_000), 40_000)
  // En pausa el tiempo real no corre: pasan cinco minutos y sigue en 40 s.
  assert.equal(restanteTemporizador(t, T0 + 320_000), 40_000)

  t = continuarTemporizador(t, T0 + 320_000)
  assert.equal(t.estado, "corriendo")
  assert.equal(restanteTemporizador(t, T0 + 320_000), 40_000)
  assert.equal(restanteTemporizador(t, T0 + 340_000), 20_000)
})

test("una suspensión larga no descuadra el temporizador", () => {
  // Los timeouts de GLib no corren dormidos. Con un contador de ticks, volver de suspender dejaría
  // el temporizador atrasado justo lo que durase la suspensión; contra el reloj de pared, vence.
  const t = iniciarTemporizador(temporizadorInicial(10 * 60_000), T0)
  assert.equal(haVencido(t, T0 + 3 * 3600_000), true)
  assert.equal(restanteTemporizador(t, T0 + 3 * 3600_000), 0)
})

test("haVencido solo es cierto mientras corre", () => {
  const parado = temporizadorInicial(1_000)
  assert.equal(haVencido(parado, T0 + 999_999), false)
  const pausado = pausarTemporizador(iniciarTemporizador(parado, T0), T0 + 500)
  assert.equal(haVencido(pausado, T0 + 999_999), false)
})

test("cancelar devuelve el temporizador a su duración configurada", () => {
  let t = iniciarTemporizador(temporizadorInicial(60_000), T0)
  t = pausarTemporizador(t, T0 + 20_000)
  t = cancelarTemporizador(t)
  assert.equal(t.estado, "parado")
  assert.equal(restanteTemporizador(t, T0 + 99_999), 60_000)
})

test("continuar o pausar en el estado equivocado no hace nada", () => {
  const parado = temporizadorInicial(60_000)
  assert.equal(continuarTemporizador(parado, T0), parado)
  assert.equal(pausarTemporizador(parado, T0), parado)
})

test("una duración de cero no arranca", () => {
  const t = temporizadorInicial(0)
  assert.equal(iniciarTemporizador(t, T0).estado, "parado")
})

test("fijarDuracion mueve lo mostrado solo si está parado", () => {
  const parado = fijarDuracion(temporizadorInicial(60_000), 90_000)
  assert.equal(restanteTemporizador(parado, T0), 90_000)

  const corriendo = fijarDuracion(iniciarTemporizador(temporizadorInicial(60_000), T0), 90_000)
  assert.equal(restanteTemporizador(corriendo, T0), 60_000, "no se altera una cuenta en marcha")
  assert.equal(corriendo.duracionMs, 90_000, "pero la próxima vez durará lo nuevo")
})

test("el cronómetro mide por marcas y sobrevive a los ticks perdidos", () => {
  let c = iniciarCronometro(cronometroInicial(), T0)
  assert.equal(transcurrido(c, T0), 0)
  assert.equal(transcurrido(c, T0 + 3_600_000), 3_600_000)
})

test("el cronómetro suma tramos al pausar y continuar", () => {
  let c = iniciarCronometro(cronometroInicial(), T0)
  c = pausarCronometro(c, T0 + 5_000)
  assert.equal(c.acumuladoMs, 5_000)
  assert.equal(transcurrido(c, T0 + 60_000), 5_000, "en pausa no avanza")

  c = iniciarCronometro(c, T0 + 60_000)
  assert.equal(transcurrido(c, T0 + 62_500), 7_500)

  c = pausarCronometro(c, T0 + 62_500)
  assert.equal(c.acumuladoMs, 7_500)
})

test("reiniciar el cronómetro lo deja a cero", () => {
  let c = iniciarCronometro(cronometroInicial(), T0)
  c = pausarCronometro(c, T0 + 5_000)
  c = reiniciarCronometro()
  assert.equal(transcurrido(c, T0 + 99_999), 0)
  assert.equal(c.estado, "parado")
})

test("iniciar dos veces no reinicia la marca", () => {
  const c = iniciarCronometro(cronometroInicial(), T0)
  assert.equal(iniciarCronometro(c, T0 + 5_000), c)
})

test("formatearRestante redondea hacia ARRIBA", () => {
  // 500 ms restantes siguen siendo «queda algo»: enseñar 00:00 con el temporizador vivo sería mentir.
  assert.equal(formatearRestante(500), "00:01")
  assert.equal(formatearRestante(0), "00:00")
  assert.equal(formatearRestante(59_000), "00:59")
  assert.equal(formatearRestante(60_000), "01:00")
  assert.equal(formatearRestante(3_600_000), "1:00:00")
  assert.equal(formatearRestante(-5), "00:00")
})

test("formatearCronometro redondea hacia abajo y enseña décimas", () => {
  assert.equal(formatearCronometro(0), "00:00.0")
  assert.equal(formatearCronometro(1_250), "00:01.2")
  assert.equal(formatearCronometro(61_900), "01:01.9")
  assert.equal(formatearCronometro(3_723_400), "1:02:03.4")
})

test("msHastaSiguienteTick alinea con el reloj en vez de con el arranque", () => {
  assert.equal(msHastaSiguienteTick(60_000), 1000)
  assert.equal(msHastaSiguienteTick(59_400), 400)
  assert.equal(msHastaSiguienteTick(1), 1)
  assert.equal(msHastaSiguienteTick(12_345, 100), 45)
})
