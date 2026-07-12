import { Gtk } from "ags/gtk4"
import { execAsync } from "ags/process"
import GLib from "gi://GLib"
import {
  rightPanelApp, rightPanelVisible, hidePanel,
  type AppContextItem,
} from "../state"
import { addFavorite, removeFavorite, isFavorite, favorites } from "../data/favorites"

function guessConfigPath(execName: string, appId: string): string | null {
  const home = GLib.get_home_dir()
  for (const p of [
    `${home}/.config/${execName}`,
    `${home}/.config/${appId.replace(/\.desktop$/, "").split(".").pop() ?? ""}`,
    `${home}/.${execName}`,
  ]) {
    if (GLib.file_test(p, GLib.FileTest.EXISTS)) return p
  }
  return null
}

export default function RightPanel() {
  const inner = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, cssClasses: ["rp-inner"] })

  function action(icon: string, label: string, cb: () => void): Gtk.Button {
    const btn = new Gtk.Button({ cssClasses: ["rp-action"] })
    const row = new Gtk.Box({ spacing: 9, cssClasses: ["rp-action-row"] })
    row.append(new Gtk.Image({ iconName: icon, pixelSize: 14, cssClasses: ["rp-action-ico"] }))
    row.append(new Gtk.Label({ label, halign: Gtk.Align.START, hexpand: true, cssClasses: ["rp-action-label"] }))
    btn.set_child(row)
    btn.connect("clicked", cb)
    return btn
  }

  function rebuild() {
    const app = rightPanelApp.get()
    let child = inner.get_first_child()
    while (child) { const next = child.get_next_sibling(); inner.remove(child); child = next }
    if (!app) return

    // ── Header ───────────────────────────────────────────────────────────────
    const header = new Gtk.Box({ cssClasses: ["rp-header"], spacing: 10 })
    const eyebrow = new Gtk.Label({ label: "APLICACIÓN", cssClasses: ["rp-eyebrow"], halign: Gtk.Align.START })
    inner.append(eyebrow)
    const headerIcon = app.gicon
      ? (() => { const i = Gtk.Image.new_from_gicon(app.gicon); i.pixel_size = 22; return i })()
      : new Gtk.Image({ iconName: app.iconName, pixelSize: 22 })
    headerIcon.set_css_classes(["rp-app-icon"])
    const iconWrap = new Gtk.Box({ cssClasses: ["rp-app-icon-wrap"], halign: Gtk.Align.CENTER, valign: Gtk.Align.CENTER })
    iconWrap.append(headerIcon)
    header.append(iconWrap)
    header.append(new Gtk.Label({
      label: app.name, halign: Gtk.Align.START, hexpand: true,
      cssClasses: ["rp-app-name"], ellipsize: 3, maxWidthChars: 13,
    }))
    inner.append(header)
    inner.append(new Gtk.Box({ cssClasses: ["j-hdiv"] }))

    // ── Actions ───────────────────────────────────────────────────────────────
    const acts = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, cssClasses: ["rp-actions"] })

    acts.append(action("media-playback-start-symbolic", "Abrir", () => {
      app.launch()
      hidePanel()
    }))

    acts.append(action("document-edit-symbolic", "Editar config", () => {
      const p = guessConfigPath(app.execName, app.appId)
      execAsync(p
        ? ["xdg-open", p]
        : ["kitty", "--", "bash", "-c", `echo 'No config para ${app.execName}'; sleep 3`]
      ).catch(() => {})
      hidePanel()
    }))

    const pinned = isFavorite(app.appId)
    acts.append(action(
      pinned ? "starred-symbolic" : "non-starred-symbolic",
      pinned ? "Desfijar" : "Fijar en inicio",
      () => {
        if (isFavorite(app.appId)) removeFavorite(app.appId)
        else addFavorite({ id: app.appId, name: app.name, exec: app.execName, iconName: app.iconName })
        rebuild()
      }
    ))

    inner.append(acts)
  }

  rightPanelApp.subscribe(rebuild)
  favorites.subscribe(rebuild)
  rebuild()

  return (
    <box
      cssClasses={["right-panel"]}
      orientation={Gtk.Orientation.VERTICAL}
      visible={rightPanelVisible(v => v)}
    >
      {inner as unknown as any}
    </box>
  )
}
