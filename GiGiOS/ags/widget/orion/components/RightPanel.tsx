import { Gtk } from "ags/gtk4"
import { execAsync } from "ags/process"
import GLib from "gi://GLib"
import {
  rightPanelApp, rightPanelVisible, hidePanel,
  addTask, removeTask, type AppContextItem,
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

  function action(icon: string, label: string, cb: () => void, disabled = false): Gtk.Button {
    const btn = new Gtk.Button({ cssClasses: ["rp-action"], sensitive: !disabled })
    const row = new Gtk.Box({ spacing: 10 })
    row.append(new Gtk.Image({ iconName: icon, pixelSize: 14, cssClasses: ["rp-action-ico"] }))
    row.append(new Gtk.Label({ label, halign: Gtk.Align.START, hexpand: true, cssClasses: ["rp-action-label"] }))
    btn.set_child(row)
    if (!disabled) btn.connect("clicked", cb)
    return btn
  }

  function rebuild() {
    const app = rightPanelApp.get()
    let child = inner.get_first_child()
    while (child) { const next = child.get_next_sibling(); inner.remove(child); child = next }
    if (!app) return

    // ── Header ───────────────────────────────────────────────────────────────
    const header = new Gtk.Box({ cssClasses: ["rp-header"], spacing: 8 })
    const headerIcon = app.gicon
      ? (() => { const i = Gtk.Image.new_from_gicon(app.gicon); i.pixel_size = 22; return i })()
      : new Gtk.Image({ iconName: app.iconName, pixelSize: 22 })
    header.append(headerIcon)
    header.append(new Gtk.Label({
      label: app.name, halign: Gtk.Align.START, hexpand: true,
      cssClasses: ["rp-app-name"], ellipsize: 3, maxWidthChars: 13,
    }))
    inner.append(header)
    inner.append(new Gtk.Box({ cssClasses: ["j-hdiv"] }))

    // ── Actions ───────────────────────────────────────────────────────────────
    const acts = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, cssClasses: ["rp-actions"] })

    acts.append(action("media-playback-start-symbolic", "Abrir", () => {
      const id = addTask(`Abriendo ${app.name}`, app.iconName)
      GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2500, () => { removeTask(id); return false })
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

    acts.append(action("input-keyboard-symbolic", "Añadir atajo", () => {}, true))

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
