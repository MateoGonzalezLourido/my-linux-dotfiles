// widget/bar/UpdatesButton.tsx
// Iconos de la barra (a la izquierda de NotificationButton) que avisan de
// actualizaciones IMPORTANTES: uno para el kernel y otro, separado, para los drivers
// de la GPU. Cada uno aparece solo si su categoría tiene algo pendiente. Las
// actualizaciones normales de paquetes/dependencias NO hacen aparecer ningún icono
// (son ruido); se listan como contexto al abrir el popover.
//
// No hay polling aquí: hypr/scripts/updates-monitor.sh escribe
// ~/.config/gigios/updates.json y esto lo observa con un Gio.FileMonitor, igual que
// el bar-toggle de state.tsx.
import GLib from "gi://GLib"
import Gio from "gi://Gio"
import { createState, onCleanup } from "ags"
import { Gtk } from "ags/gtk4"
import { execAsync } from "ags/process"
import { openBarMenu, closeBarMenu, panelAutoClose } from "../state"

const UPDATES_PATH = `${GLib.get_user_config_dir()}/gigios/updates.json`

type PkgUpd = { name: string; from: string; to: string }
type UpdatesData = { system: number; kernel: PkgUpd[]; gpu: PkgUpd[]; updateCmd: string; systemSample: string[] }

const EMPTY: UpdatesData = { system: 0, kernel: [], gpu: [], updateCmd: "", systemSample: [] }

// Lee updates.json de forma defensiva: ausente/corrupto → sin actualizaciones.
function readUpdates(): UpdatesData {
  const pkgs = (v: any): PkgUpd[] =>
    Array.isArray(v) ? v.filter((p: any) => p && typeof p.name === "string") : []
  try {
    const [ok, content] = GLib.file_get_contents(UPDATES_PATH)
    if (!ok) return EMPTY
    const j = JSON.parse(new TextDecoder().decode(content))
    return {
      system: typeof j.system === "number" ? j.system : 0,
      kernel: pkgs(j.kernel),
      gpu: pkgs(j.gpu),
      updateCmd: typeof j.updateCmd === "string" ? j.updateCmd : "",
      systemSample: Array.isArray(j.systemSample) ? j.systemSample.filter((s: any) => typeof s === "string") : [],
    }
  } catch (_) {
    return EMPTY
  }
}

// Abre la actualización en la primera terminal disponible (kitty = $terminal del
// sistema; fallback foot/alacritty/wezterm/xterm). --hold/read mantienen la ventana
// abierta al terminar para poder leer la salida.
function launchUpdate(cmd: string) {
  if (!cmd) return
  const picker = `
    hold_cmd="$1"
    for t in kitty foot alacritty wezterm xterm; do
      command -v "$t" >/dev/null 2>&1 || continue
      case "$t" in
        kitty) exec kitty --hold sh -lc "$hold_cmd";;
        foot)  exec foot sh -lc "$hold_cmd; printf '\\nPulsa Enter para cerrar…'; read _";;
        *)     exec "$t" -e sh -lc "$hold_cmd; printf '\\nPulsa Enter para cerrar…'; read _";;
      esac
    done
    exit 127`
  execAsync(["bash", "-c", picker, "bash", cmd]).catch((e) => console.error("[updates] launch:", e))
}

type Kind = "kernel" | "gpu"

const KIND_META: Record<Kind, { icon: string; title: string; noun: string }> = {
  kernel: { icon: "", title: "Actualización de kernel", noun: "kernel" },
  gpu: { icon: "󰢮", title: "Actualización de drivers de GPU", noun: "drivers de GPU" },
}

export default function UpdatesButton() {
  const [data, setData] = createState(readUpdates())

  // ── Observación de updates.json (un solo monitor para ambos iconos) ─────────
  let monitor: Gio.FileMonitor | null = null
  try {
    const file = Gio.file_new_for_path(UPDATES_PATH)
    monitor = file.monitor(Gio.FileMonitorFlags.NONE, null)
    monitor.connect("changed", () => setData(readUpdates()))
  } catch (e) {
    console.error("[updates] monitor:", e)
  }

  const popovers: Gtk.Popover[] = []

  // Construye uno de los dos iconos. Cada uno tiene su propio popover, anclado a sí
  // mismo, y se muestra solo si su categoría tiene paquetes pendientes.
  const mkIcon = (kind: Kind) => {
    const meta = KIND_META[kind]
    const list = data((d) => d[kind])

    let activePopover: Gtk.Popover | null = null
    let btnRef: Gtk.Widget | null = null
    const autoClose = panelAutoClose(() => { if (activePopover) activePopover.popdown() }, 250)

    const buildCard = () => {
      const d = data.get()
      const card = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 4 })
      card.add_css_class("upd-popover")

      const cardMotion = new Gtk.EventControllerMotion()
      cardMotion.connect("enter", () => autoClose.onEnter())
      cardMotion.connect("leave", () => autoClose.onLeave())
      card.add_controller(cardMotion)

      const header = new Gtk.Label({ label: meta.title, xalign: 0 })
      header.add_css_class("upd-popover-header")
      card.append(header)

      for (const p of d[kind]) {
        const ver = p.from && p.to ? `${p.from} → ${p.to}` : (p.to || "")
        const row = new Gtk.Label({ label: `${meta.icon}  ${p.name}${ver ? "  " + ver : ""}`, xalign: 0, wrap: true, maxWidthChars: 42 })
        row.add_css_class("upd-row")
        row.add_css_class(kind)
        card.append(row)
      }

      // Resto de paquetes/dependencias: contexto, no motivo de aviso. Se actualizan
      // igualmente con el botón de abajo (el comando actualiza el sistema entero).
      if (d.system > 0) {
        const sysTitle = new Gtk.Label({ label: `󰆼  Otros: ${d.system} ${d.system === 1 ? "paquete" : "paquetes"}`, xalign: 0 })
        sysTitle.add_css_class("upd-row")
        sysTitle.add_css_class("system")
        card.append(sysTitle)

        if (d.systemSample.length > 0) {
          const more = d.system > d.systemSample.length ? ", …" : ""
          const names = new Gtk.Label({ label: d.systemSample.join(", ") + more, xalign: 0, wrap: true, maxWidthChars: 42 })
          names.add_css_class("upd-sample")
          card.append(names)
        }
      }

      const btn = new Gtk.Button({ label: "Actualizar", halign: Gtk.Align.START })
      btn.add_css_class("upd-update-btn")
      btn.connect("clicked", () => {
        launchUpdate(data.get().updateCmd)
        if (activePopover) activePopover.popdown()
      })
      card.append(btn)

      return card
    }

    const openPopover = () => {
      if (activePopover) { activePopover.popdown(); return }
      if (!btnRef) return
      const pop = new Gtk.Popover()
      pop.add_css_class("upd-popover-container")
      pop.set_has_arrow(true)
      pop.set_position(Gtk.PositionType.BOTTOM)
      pop.set_child(buildCard())
      pop.set_parent(btnRef)
      activePopover = pop
      popovers.push(pop)
      openBarMenu()
      pop.connect("closed", () => {
        activePopover = null
        const i = popovers.indexOf(pop)
        if (i >= 0) popovers.splice(i, 1)
        try { pop.unparent() } catch (_) {}
        closeBarMenu()
      })
      pop.popup()
    }

    return (
      <button
        // El popover se ancla al propio botón. Usamos onClicked (no un GestureClick
        // de botón primario): Gtk.Button reclama esa secuencia de clic para sí, así
        // que un gesture primario encima no llegaría a dispararse.
        $={(self: Gtk.Widget) => { btnRef = self }}
        visible={list((l) => l.length > 0)}
        cssClasses={["bar-pill-btn"]}
        onClicked={openPopover}
        tooltipText={data((d) => {
          const names = d[kind].map((p) => p.name).join(", ")
          if (!names) return `Sin actualizaciones de ${meta.noun}`
          const tail = d.system > 0 ? ` — y ${d.system} paquete${d.system === 1 ? "" : "s"} más` : ""
          return `${meta.title}: ${names}${tail}`
        })}
      >
        <Gtk.EventControllerMotion onEnter={autoClose.onEnter} onLeave={autoClose.onLeave} />
        {/* Solo el icono: el número sobraba. El detalle (qué paquetes, de qué
            versión a cuál) está en el tooltip y en el popover. */}
        <box cssClasses={["bar-pill", "upd-pill", kind]} halign={Gtk.Align.CENTER} valign={Gtk.Align.CENTER}>
          <label cssClasses={["upd-icon"]} label={meta.icon} />
        </box>
      </button>
    )
  }

  onCleanup(() => {
    if (monitor) { try { monitor.cancel() } catch (_) {} monitor = null }
    for (const p of [...popovers]) { try { p.popdown() } catch (_) {} }
  })

  return (
    <box spacing={0}>
      {mkIcon("kernel")}
      {mkIcon("gpu")}
    </box>
  )
}
