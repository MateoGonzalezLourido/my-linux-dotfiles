// notifications/autoDnd/watcher.ts
//
// "No molestar automático". Cuando la preferencia autoDnd está activa, este
// watcher enciende notifd.dontDisturb mientras haya un juego corriendo o una app
// configurada en pantalla completa (ver ./detect + widget/settings/preferences).
//
// Silencia SOLO el popup para el usuario: NotificationPopup ejecuta ingest()
// antes de comprobar dontDisturb, así que el procesamiento, el historial y las
// reglas siguen funcionando igual.
//
// Un único watcher para todo el shell (no por monitor). Se arranca una vez desde
// app.ts vía initAutoDnd(); llamarlo más de una vez es no-op.
//
// Respeto por la elección manual (botón de la barra):
//   - autoOwned: sólo apagamos el DND al terminar si lo encendimos nosotros.
//   - userOptedOut: si el usuario apaga el DND a mano DURANTE un juego/app, no lo
//     volvemos a encender hasta que la condición se limpie y vuelva a dispararse.

import AstalHyprland from "gi://AstalHyprland"
import AstalNotifd from "gi://AstalNotifd"
import GLib from "gi://GLib"
import { shouldSilence } from "./detect.ts"
import { isGameClient } from "../../bar/games/evidence.ts"
import { autoDndEnabled, autoDndFullscreenApps } from "../../settings/preferences.ts"

let started = false

// ¿encendimos nosotros el DND actual? Sólo entonces lo apagamos al terminar.
let autoOwned = false
// ¿el usuario lo apagó a mano mientras la condición seguía activa?
let userOptedOut = false
// guarda para distinguir nuestras escrituras de las manuales en notify::dont-disturb.
let selfWrite = false

function setDnd(notifd: AstalNotifd.Notifd, value: boolean): void {
  selfWrite = true
  notifd.dontDisturb = value
  selfWrite = false
}

function conditionActive(hypr: AstalHyprland.Hyprland): boolean {
  // Sólo cuenta lo que hay en el workspace que estás mirando: un juego en
  // fullscreen en otro workspace no debe silenciar hasta que te muevas a él.
  // isGameClient (no isGame) para que una ventana MAXIMIZADA que no es un juego
  // — Discord era el caso — no silencie las notificaciones.
  const activeWs = hypr.focusedWorkspace?.id ?? null
  return shouldSilence(
    hypr.get_clients?.() ?? [],
    autoDndFullscreenApps.get(),
    activeWs,
    isGameClient,
  )
}

function evaluate(): void {
  const notifd = AstalNotifd.get_default()
  const hypr = AstalHyprland.get_default()

  if (!autoDndEnabled.get()) return

  const silence = conditionActive(hypr)
  const dnd = notifd.dontDisturb

  if (!silence) {
    // La condición se limpió: soltamos nuestro control y reseteamos el opt-out.
    if (dnd && autoOwned) setDnd(notifd, false)
    autoOwned = false
    userOptedOut = false
    return
  }

  // silence == true
  if (!dnd && !userOptedOut) {
    setDnd(notifd, true)
    autoOwned = true
  }
}

export function initAutoDnd(): void {
  if (started) return
  started = true

  const notifd = AstalNotifd.get_default()
  const hypr = AstalHyprland.get_default()

  // Adopción al arranque: si ya estamos en condición y el DND ya está encendido,
  // asumimos su propiedad para poder apagarlo cuando el juego/app termine (p. ej.
  // tras reiniciar el shell a mitad de partida).
  if (autoDndEnabled.get() && conditionActive(hypr) && notifd.dontDisturb) {
    autoOwned = true
  }

  // Cambios manuales del DND (botón de la barra u otra fuente).
  notifd.connect("notify::dont-disturb", () => {
    if (selfWrite) return
    if (notifd.dontDisturb) {
      // Encendido a mano: no es nuestro.
      autoOwned = false
    } else {
      // Apagado a mano: no lo re-encendemos hasta que la condición se limpie.
      autoOwned = false
      userOptedOut = true
    }
  })

  // Eventos de ventanas de Hyprland que pueden cambiar la condición.
  hypr.connect("client-added", (_s: unknown, client: AstalHyprland.Client) => {
    evaluate()
    // class / fullscreen pueden resolverse un instante después del mapeo; un único
    // re-chequeo tardío, sólo si la clase aún no está lista (no cuesta nada abrir
    // ventanas normales que sí traen clase).
    if (!client || !client.class) {
      GLib.timeout_add(GLib.PRIORITY_DEFAULT, 700, () => {
        evaluate()
        return GLib.SOURCE_REMOVE
      })
    }
  })
  hypr.connect("client-removed", () => evaluate())
  hypr.connect("event", (_s: unknown, name: string) => {
    // fullscreen: cambia la condición en el workspace actual.
    // workspace(v2)/focusedmon: cambia CUÁL es el workspace activo, así que un
    // juego que estaba "fuera de vista" puede pasar a estarlo (o al revés).
    if (
      name === "fullscreen" ||
      name === "workspace" ||
      name === "workspacev2" ||
      name === "focusedmon"
    ) {
      evaluate()
    }
  })
  // Señal directa por si el backend no emite el "event" anterior en algún caso.
  hypr.connect("notify::focused-workspace", () => evaluate())

  // Cambios de la preferencia.
  autoDndEnabled.subscribe(() => {
    if (!autoDndEnabled.get()) {
      // Al desactivar la función soltamos cualquier DND que hayamos puesto.
      if (autoOwned && notifd.dontDisturb) setDnd(notifd, false)
      autoOwned = false
      userOptedOut = false
    } else {
      evaluate()
    }
  })
  autoDndFullscreenApps.subscribe(() => evaluate())

  evaluate()
}
