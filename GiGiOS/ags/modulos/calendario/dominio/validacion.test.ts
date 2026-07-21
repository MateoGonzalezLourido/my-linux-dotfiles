import { test } from "node:test"
import assert from "node:assert/strict"
import { errorDeCampo, esBorradorValido, validarEvento } from "./validacion.ts"
import type { BorradorEvento } from "./tipos.ts"

function borrador(p: Partial<BorradorEvento> = {}): BorradorEvento {
  return {
    titulo: "Reunión",
    inicio: { fecha: "2026-07-21", hora: "09:00" },
    fin: { fecha: "2026-07-21", hora: "10:00" },
    todoElDia: false,
    color: "purple",
    calendarioId: "local",
    ...p,
  }
}

test("un borrador correcto no da errores", () => {
  assert.deepEqual(validarEvento(borrador()), [])
  assert.equal(esBorradorValido(borrador()), true)
})

test("el título no puede estar vacío ni ser solo espacios", () => {
  assert.equal(errorDeCampo(validarEvento(borrador({ titulo: "" })), "titulo"), "El título no puede estar vacío")
  assert.equal(errorDeCampo(validarEvento(borrador({ titulo: "   " })), "titulo"), "El título no puede estar vacío")
})

test("fechas inexistentes", () => {
  const errores = validarEvento(borrador({ inicio: { fecha: "2026-02-30", hora: "09:00" } }))
  assert.equal(errorDeCampo(errores, "inicio"), "Fecha de inicio no válida")
})

test("el fin no puede ser anterior al inicio", () => {
  const errores = validarEvento(
    borrador({ inicio: { fecha: "2026-07-21", hora: "09:00" }, fin: { fecha: "2026-07-20", hora: "10:00" } }),
  )
  assert.equal(errorDeCampo(errores, "fin"), "La fecha de fin no puede ser anterior a la de inicio")
})

test("en un evento con hora, el fin debe ser POSTERIOR al inicio", () => {
  const igual = validarEvento(borrador({ fin: { fecha: "2026-07-21", hora: "09:00" } }))
  assert.equal(errorDeCampo(igual, "fin"), "La hora de fin debe ser posterior a la de inicio")

  const antes = validarEvento(borrador({ fin: { fecha: "2026-07-21", hora: "08:00" } }))
  assert.equal(errorDeCampo(antes, "fin"), "La hora de fin debe ser posterior a la de inicio")
})

test("en un evento de día completo, fin == inicio es lo NORMAL", () => {
  // Es la asimetría que justifica no usar una comparación única para los dos tipos.
  const diaCompleto = borrador({
    todoElDia: true,
    inicio: { fecha: "2026-07-21" },
    fin: { fecha: "2026-07-21" },
  })
  assert.deepEqual(validarEvento(diaCompleto), [])
})

test("un evento con hora que abarca varios días no exige que la hora de fin sea mayor", () => {
  // 21 a las 18:00 → 23 a las 09:00 es perfectamente válido aunque 09:00 < 18:00.
  const largo = borrador({
    inicio: { fecha: "2026-07-21", hora: "18:00" },
    fin: { fecha: "2026-07-23", hora: "09:00" },
  })
  assert.deepEqual(validarEvento(largo), [])
})

test("horas mal formadas", () => {
  const errores = validarEvento(borrador({ inicio: { fecha: "2026-07-21", hora: "25:00" } }))
  assert.equal(errorDeCampo(errores, "inicio"), "Hora de inicio no válida")
  const sinHora = validarEvento(borrador({ fin: { fecha: "2026-07-21" } }))
  assert.equal(errorDeCampo(sinHora, "fin"), "Hora de fin no válida")
})

test("una hora inválida no se valida como día completo", () => {
  const diaCompleto = borrador({
    todoElDia: true,
    inicio: { fecha: "2026-07-21", hora: "99:99" },
    fin: { fecha: "2026-07-22", hora: "99:99" },
  })
  assert.deepEqual(validarEvento(diaCompleto), [], "la hora se ignora si es de día completo")
})

test("los errores se acumulan", () => {
  const errores = validarEvento(borrador({ titulo: "", fin: { fecha: "2026-07-20", hora: "10:00" } }))
  assert.equal(errores.length, 2)
  assert.equal(esBorradorValido(borrador({ titulo: "" })), false)
})
