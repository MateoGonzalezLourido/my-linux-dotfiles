// modulos/barra/UpdatesButton.tsx
// Iconos de la barra (a la izquierda de NotificationButton) que avisan de
// actualizaciones IMPORTANTES: uno para el kernel y otro, separado, para los drivers
// de la GPU. Cada uno aparece solo si su categoría tiene algo pendiente. Las
// actualizaciones normales de paquetes/dependencias NO hacen aparecer ningún icono
// (son ruido); se listan como contexto al abrir el popover.
//
// No hay polling aquí: hypr/scripts/updates-monitor.sh escribe
// ~/.config/gigios/updates.json y esto lo observa con un Gio.FileMonitor, igual que
// el bar-toggle de state.tsx.
import { onCleanup } from "ags"
import { Gtk } from "ags/gtk4"
import { execAsync } from "ags/process"
import { panelAutoClose } from "../../estado/shell"
import { datosActualizaciones } from "../../servicios/sistema/actualizaciones"
import { crearControlPopoverAnclado } from "./componentes/PopoverAnclado"
import type { ControlVisibilidadBarra } from "./visibilidad"

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

export default function UpdatesButton({ visibilidad }: { visibilidad: ControlVisibilidadBarra }) {
  const data = datosActualizaciones

  // Construye uno de los dos iconos. Cada uno tiene su propio popover, anclado a sí
  // mismo, y se muestra solo si su categoría tiene paquetes pendientes.
  const mkIcon = (kind: Kind) => {
    const meta = KIND_META[kind]
    const list = data((d) => d[kind])

    let activePopover: Gtk.Popover | null = null
    let btnRef: Gtk.Widget | null = null
    const controlMenu = crearControlPopoverAnclado(visibilidad)
    const autoClose = panelAutoClose(() => { if (activePopover) activePopover.popdown() }, 250)

    const finalizarPopover = (popover: Gtk.Popover) => {
      if (activePopover === popover) {
        activePopover = null
        controlMenu.cerrar()
      }
      try { popover.unparent() } catch (_) {}
    }

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
      controlMenu.abrir()
      pop.connect("closed", () => finalizarPopover(pop))
      pop.popup()
    }

    onCleanup(() => {
      autoClose.dispose()
      const popover = activePopover
      if (popover) {
        try { popover.popdown() } catch (_) {}
        finalizarPopover(popover)
      }
      controlMenu.cerrar()
      btnRef = null
    })

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

  return (
    <box spacing={0}>
      {mkIcon("kernel")}
      {mkIcon("gpu")}
    </box>
  )
}
