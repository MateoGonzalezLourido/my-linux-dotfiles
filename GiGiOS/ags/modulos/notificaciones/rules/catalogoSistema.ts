// modulos/notificaciones/rules/catalogoSistema.ts
// CATÁLOGO de las notificaciones del sistema: una entrada por aviso que puede emitir
// `hypr/scripts/` (y los pocos que manda AGS por `notify-send`). Módulo puro, sin GTK.
//
// POR QUÉ EXISTE. El hint `x-gigios-event` (ver `hypr/scripts/lib/notif.sh`) da identidad a
// cada aviso, pero eso solo sirve para CASAR: sin una lista, Ajustes no podría enseñar un
// aviso que todavía no se ha disparado nunca — y ese es justo el que interesa configurar
// (nadie quiere esperar a que le falle un disco para poder decidir cómo avisa). El catálogo
// es esa lista: los ~100 avisos con su nombre legible, su categoría y sus efectos por
// defecto, y es lo que pinta la pestaña Sistema.
//
// NO es la configuración del usuario. Aquí van los DEFAULTS que vienen con GiGiOS; lo que el
// usuario cambia vive fuera del repo, en `~/.config/gigios/notif-sistema.json`, y se
// superpone a esto (`sistemaStore.ts`). Un aviso sin entrada en ese fichero usa lo de aquí.
//
// AL AÑADIR UN AVISO NUEVO a un script, da de alta su id aquí. Si no, el aviso funciona
// igual (nada depende de estar catalogado: `match.event` casa contra el hint, no contra esta
// lista) pero no sale en Ajustes, que es lo único que se pierde — y todo lo que este trabajo
// pretendía ganar. `catalogo.test.ts` comprueba que no haya ids repetidos ni categorías
// huérfanas, no que la lista esté completa: eso no lo puede saber TypeScript.
import type { EffectSpec } from "./types.ts"
import textos from "../../../textos/ajustes/notificaciones-sistema.json" with { type: "json" }

/** Agrupación de la pestaña Sistema. El orden del array ES el orden en pantalla, de lo que
 *  más importa vigilar a lo más accesorio. */
export const CATEGORIAS_SISTEMA = [
  "energia",
  "hardware",
  "almacenamiento",
  "red",
  "seguridad",
  "antivirus",
  "apps",
  "arranque",
  "escritorio",
] as const

export type CategoriaSistema = (typeof CATEGORIAS_SISTEMA)[number]

export interface EventoSistema {
  /** El hint `x-gigios-event` que manda el emisor. Clave primaria. */
  id: string
  nombre: string
  categoria: CategoriaSistema
  /** Fichero que lo emite, para poder ir a la fuente sin grepear. Se enseña en la UI. */
  origen: string
  /** Efectos por defecto. Vacío = comportamiento normal (popup + panel). Lo que se ponga aquí
   *  es exactamente lo que el usuario ve prerrellenado al abrir el aviso en Ajustes. */
  efectos?: EffectSpec
}

const t = textos.eventos as Record<string, string>

/** Azúcar para no repetir `nombre: textos.eventos["…"]` cien veces; si falta la traducción se
 *  cae al id, que es feo pero legible — nunca a una cadena vacía. */
const ev = (
  id: string,
  categoria: CategoriaSistema,
  origen: string,
  efectos?: EffectSpec,
): EventoSistema => ({ id, nombre: t[id] ?? id, categoria, origen, ...(efectos ? { efectos } : {}) })

export const CATALOGO_SISTEMA: EventoSistema[] = [
  // ── Energía ────────────────────────────────────────────────────────────────────────────
  // `bateria.baja` llega con `lifetime: flash` + condición: es el mismo trato que le daba la
  // builtin `builtin.low-battery` casando por el título "batería", que además pillaba de
  // rebote cualquier notificación de otra app que dijera esa palabra.
  ev("bateria.baja", "energia", "battery-monitor.sh", { lifetime: "flash", conditions: ["battery-resolved"] }),
  ev("bateria.cargando", "energia", "battery-monitor.sh", { clearOnBoot: true }),
  ev("bateria.descargando", "energia", "battery-monitor.sh", { clearOnBoot: true }),
  ev("bateria.completa", "energia", "battery-monitor.sh", { clearOnBoot: true }),
  ev("bateria.modo-ahorro", "energia", "battery-monitor.sh", { clearOnBoot: true }),
  ev("energia.perfil-tlp", "energia", "servicios/energia/tlp.ts", { clearOnBoot: true }),
  ev("juegos.modo-juego", "energia", "servicios/energia/gamemode.ts", { clearOnBoot: true }),

  // ── Hardware ───────────────────────────────────────────────────────────────────────────
  ev("temperatura.cpu-alta", "hardware", "temp-monitor.sh"),
  ev("temperatura.cpu-normal", "hardware", "temp-monitor.sh", { clearOnBoot: true }),
  ev("temperatura.gpu-alta", "hardware", "temp-monitor.sh"),
  ev("temperatura.gpu-normal", "hardware", "temp-monitor.sh", { clearOnBoot: true }),
  ev("ram.baja", "hardware", "ram-monitor.sh"),
  ev("ram.normalizada", "hardware", "ram-monitor.sh", { clearOnBoot: true }),
  ev("cpu.throttling", "hardware", "oom-monitor.sh"),
  ev("gpu.error", "hardware", "oom-monitor.sh"),
  ev("hardware.error", "hardware", "oom-monitor.sh"),
  ev("kernel.oom", "hardware", "oom-monitor.sh"),
  ev("kernel.panic", "hardware", "oom-monitor.sh"),
  ev("kernel.tarea-colgada", "hardware", "oom-monitor.sh"),
  ev("kernel.modulo-sin-firmar", "hardware", "oom-monitor.sh"),

  // ── Almacenamiento ─────────────────────────────────────────────────────────────────────
  ev("disco.casi-lleno", "almacenamiento", "disk-monitor.sh"),
  // `clearOnBoot`: informa de algo que ya pasó y no requiere ninguna acción; arrastrarlo al
  // siguiente arranque solo ensucia el panel.
  ev("limpieza.completada", "almacenamiento", "limpiar-almacenamiento.sh", { clearOnBoot: true }),
  ev("disco.error-es", "almacenamiento", "oom-monitor.sh"),
  ev("disco.smart-fallo", "almacenamiento", "oom-monitor.sh"),
  ev("disco.smart-sin-permisos", "almacenamiento", "oom-monitor.sh"),
  ev("usb.conectado", "almacenamiento", "usb-monitor.sh", { clearOnBoot: true }),
  ev("usb.desconectado", "almacenamiento", "usb-monitor.sh", { clearOnBoot: true }),
  ev("usb.almacenamiento", "almacenamiento", "usb-monitor.sh", { clearOnBoot: true }),
  ev("usb.volumen-con-errores", "almacenamiento", "usb-monitor.sh"),
  ev("usb.extraccion-insegura", "almacenamiento", "oom-monitor.sh"),
  ev("usb.expulsado", "almacenamiento", "usb-eject.sh", { clearOnBoot: true }),
  ev("usb.desmontado", "almacenamiento", "usb-eject.sh", { clearOnBoot: true }),
  ev("usb.expulsar-fallo", "almacenamiento", "usb-eject.sh"),
  ev("usb.expulsar-falta-udisks", "almacenamiento", "usb-eject.sh"),
  ev("usb.expulsar-sin-dispositivo", "almacenamiento", "usb-eject.sh"),
  ev("usb.reparando", "almacenamiento", "usb-repair.sh", { clearOnBoot: true }),
  ev("usb.reparado", "almacenamiento", "usb-repair.sh", { clearOnBoot: true }),
  ev("usb.reparacion-incompleta", "almacenamiento", "usb-repair.sh"),
  ev("usb.reparar-en-uso", "almacenamiento", "usb-repair.sh"),
  ev("usb.reparar-fallo", "almacenamiento", "usb-repair.sh"),
  ev("usb.reparar-sin-dispositivo", "almacenamiento", "usb-repair.sh"),

  // ── Red ────────────────────────────────────────────────────────────────────────────────
  ev("wifi.desconectado", "red", "wifi-monitor.sh", { clearOnBoot: true }),
  ev("wifi.reconectado", "red", "wifi-monitor.sh", { clearOnBoot: true }),
  ev("wifi.portal-cautivo", "red", "wifi-monitor.sh", { clearOnBoot: true }),
  ev("wifi.sin-interfaz", "red", "wifi-monitor.sh", { clearOnBoot: true }),
  ev("bluetooth.conectado", "red", "bt-monitor.sh", { clearOnBoot: true }),
  ev("bluetooth.perdido", "red", "bt-monitor.sh", { clearOnBoot: true }),

  // ── Seguridad ──────────────────────────────────────────────────────────────────────────
  ev("seguridad.escalada-privilegios", "seguridad", "oom-monitor.sh"),
  ev("sudo.fallo-autenticacion", "seguridad", "oom-monitor.sh"),
  ev("ssh.evento", "seguridad", "oom-monitor.sh"),
  ev("archivos.critico-modificado", "seguridad", "oom-monitor.sh"),
  ev("archivos.persistencia", "seguridad", "oom-monitor.sh"),
  ev("archivos.clave-ssh", "seguridad", "oom-monitor.sh"),
  ev("archivos.boot", "seguridad", "oom-monitor.sh"),
  ev("archivos.actualizacion", "seguridad", "oom-monitor.sh", { clearOnBoot: true }),
  ev("sistema.reinicio-pendiente", "seguridad", "oom-monitor.sh", { clearOnBoot: true }),
  ev("monitor.sin-inotify", "seguridad", "oom-monitor.sh", { clearOnBoot: true }),

  // ── Antivirus y descargas ──────────────────────────────────────────────────────────────
  ev("descargas.malware", "antivirus", "oom-monitor.sh"),
  ev("descargas.ejecutable-nuevo", "antivirus", "oom-monitor.sh"),
  ev("descargas.archivo-grande", "antivirus", "oom-monitor.sh"),
  ev("antivirus.sin-firmas", "antivirus", "oom-monitor.sh"),
  ev("antivirus.actualizando", "antivirus", "actualizar-firmas.sh", { clearOnBoot: true }),
  ev("antivirus.actualizacion-en-curso", "antivirus", "actualizar-firmas.sh", { clearOnBoot: true }),
  ev("antivirus.firmas-actualizadas", "antivirus", "actualizar-firmas.sh", { clearOnBoot: true }),
  ev("antivirus.fallo-actualizacion", "antivirus", "actualizar-firmas.sh"),
  ev("antivirus.falta-ayudante", "antivirus", "actualizar-firmas.sh"),
  ev("antivirus.estado", "antivirus", "servicios/seguridad/clamav.ts", { clearOnBoot: true }),
  ev("analisis.analizando", "antivirus", "scan-file.sh", { clearOnBoot: true }),
  ev("analisis.limpio", "antivirus", "scan-file.sh", { clearOnBoot: true }),
  ev("analisis.malware", "antivirus", "scan-file.sh"),
  ev("analisis.sin-firmas", "antivirus", "scan-file.sh"),
  ev("analisis.sin-clamav", "antivirus", "scan-file.sh"),
  ev("analisis.sin-archivo", "antivirus", "scan-file.sh", { clearOnBoot: true }),
  ev("analisis.sin-carpeta", "antivirus", "scan-downloads.sh", { clearOnBoot: true }),
  ev("aislado.lanzando", "antivirus", "run-untrusted.sh", { clearOnBoot: true }),
  ev("aislado.malware", "antivirus", "run-untrusted.sh"),
  ev("aislado.no-analizado", "antivirus", "run-untrusted.sh"),
  ev("aislado.sin-antivirus", "antivirus", "run-untrusted.sh"),
  ev("aislado.sin-archivo", "antivirus", "run-untrusted.sh", { clearOnBoot: true }),
  ev("aislado.falta-firejail", "antivirus", "run-untrusted.sh"),
  ev("aislado.falta-wine", "antivirus", "run-untrusted.sh"),

  // ── Apps y servicios ───────────────────────────────────────────────────────────────────
  // Los tres heredan el `clearOnBoot` que les daban las builtin `app-crash` / `coredump`,
  // que casaban por las palabras "crash" y "coredump" en cualquier notificación.
  ev("app.crash", "apps", "oom-monitor.sh", { clearOnBoot: true }),
  ev("app.tormenta-crashes", "apps", "oom-monitor.sh", { clearOnBoot: true }),
  ev("servicio.fallo-arranque", "apps", "oom-monitor.sh", { clearOnBoot: true }),
  ev("servicio.en-fallo", "apps", "oom-monitor.sh", { clearOnBoot: true }),

  // ── Arranque ───────────────────────────────────────────────────────────────────────────
  // Todo el healthcheck se limpia al reiniciar por definición: describe ESE arranque, y
  // conservarlo hasta el siguiente solo sirve para confundirlo con el nuevo.
  // `arranque.resumen` es el aviso único que sale cuando hay VARIOS problemas a la vez; es una
  // entrada propia y no un recuento de las de abajo, así que se cataloga aparte.
  ev("arranque.resumen", "arranque", "boot-healthcheck.sh", { clearOnBoot: true }),
  ev("arranque.servicios-fallidos", "arranque", "boot-healthcheck.sh", { clearOnBoot: true }),
  ev("arranque.errores-journal", "arranque", "boot-healthcheck.sh", { clearOnBoot: true }),
  ev("arranque.suspension-fallida", "arranque", "boot-healthcheck.sh", { clearOnBoot: true }),
  ev("arranque.disco-lleno", "arranque", "boot-healthcheck.sh", { clearOnBoot: true }),
  ev("arranque.lento", "arranque", "boot-healthcheck.sh", { clearOnBoot: true }),
  ev("arranque.red-inactiva", "arranque", "boot-healthcheck.sh", { clearOnBoot: true }),
  ev("arranque.sin-conectividad", "arranque", "boot-healthcheck.sh", { clearOnBoot: true }),
  ev("arranque.sin-interfaces", "arranque", "boot-healthcheck.sh", { clearOnBoot: true }),
  ev("arranque.nvidia-sin-driver", "arranque", "boot-healthcheck.sh", { clearOnBoot: true }),
  ev("arranque.nvidia-error", "arranque", "boot-healthcheck.sh", { clearOnBoot: true }),
  ev("arranque.nvme-smart", "arranque", "boot-healthcheck.sh", { clearOnBoot: true }),
  ev("arranque.sata-smart", "arranque", "boot-healthcheck.sh", { clearOnBoot: true }),
  ev("arranque.bateria-degradada", "arranque", "boot-healthcheck.sh", { clearOnBoot: true }),
  ev("arranque.ventilador-parado", "arranque", "boot-healthcheck.sh", { clearOnBoot: true }),
  ev("arranque.pipewire-inactivo", "arranque", "boot-healthcheck.sh", { clearOnBoot: true }),
  ev("arranque.bluetooth-inactivo", "arranque", "boot-healthcheck.sh", { clearOnBoot: true }),
  ev("arranque.bluetooth-bloqueado", "arranque", "boot-healthcheck.sh", { clearOnBoot: true }),
  ev("arranque.errores-usb", "arranque", "boot-healthcheck.sh", { clearOnBoot: true }),

  // ── Escritorio ─────────────────────────────────────────────────────────────────────────
  ev("desinstalar.ok", "escritorio", "desinstalar-app.sh", { clearOnBoot: true }),
  ev("desinstalar.fallo", "escritorio", "desinstalar-app.sh", { clearOnBoot: true }),
  ev("desinstalar.steam", "escritorio", "desinstalar-app.sh", { clearOnBoot: true }),
  ev("desinstalar.no-soportado", "escritorio", "desinstalar-app.sh", { clearOnBoot: true }),
  ev("desinstalar.falta-script", "escritorio", "modulos/orion/data/uninstall.ts", { clearOnBoot: true }),
  ev("grabacion.guardada", "escritorio", "grabar-pantalla.sh", { clearOnBoot: true }),
  ev("grabacion.error", "escritorio", "grabar-pantalla.sh", { clearOnBoot: true }),
  ev("emojis.no-disponible", "escritorio", "emoji-picker.sh", { clearOnBoot: true }),
]

const PORID = new Map(CATALOGO_SISTEMA.map(e => [e.id, e]))

export function eventoSistema(id: string): EventoSistema | undefined { return PORID.get(id) }

/** Catálogo agrupado y en el orden de `CATEGORIAS_SISTEMA`. Las categorías vacías no salen. */
export function catalogoPorCategoria(): { categoria: CategoriaSistema; nombre: string; eventos: EventoSistema[] }[] {
  const nombres = textos.categorias as Record<string, string>
  return CATEGORIAS_SISTEMA
    .map(categoria => ({
      categoria,
      nombre: nombres[categoria] ?? categoria,
      eventos: CATALOGO_SISTEMA.filter(e => e.categoria === categoria),
    }))
    .filter(g => g.eventos.length > 0)
}
