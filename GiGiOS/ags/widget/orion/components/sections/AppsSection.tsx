import { Gtk } from "ags/gtk4"
import { createState } from "ags"
import Gio from "gi://Gio"
import { execAsync } from "ags/process"
import { showAppContext } from "../../state"

interface AppEntry {
  name: string
  iconName: string
  gicon: Gio.Icon | null
  exec: string
  execName: string
  appId: string
  categories: string[]
}

interface Category {
  id: string
  label: string
  gioKey: string
}

const CATEGORIES: Category[] = [
  { id: "all",        label: "Todas",      gioKey: "" },
  { id: "games",      label: "Juegos",     gioKey: "Game" },
  { id: "multimedia", label: "Multimedia", gioKey: "AudioVideo" },
  { id: "internet",   label: "Internet",   gioKey: "Network" },
  { id: "office",     label: "Oficina",    gioKey: "Office" },
  { id: "dev",        label: "Dev",        gioKey: "Development" },
  { id: "system",     label: "Sistema",    gioKey: "System" },
  { id: "graphics",   label: "Gráficos",   gioKey: "Graphics" },
]

let _appCache: AppEntry[] | null = null

function getAllApps(): AppEntry[] {
  if (_appCache) return _appCache
  _appCache = (Gio.AppInfo.get_all() as Gio.AppInfo[])
    .filter(a => a.should_show())
    .map(a => {
      const cmdline = (a.get_commandline() ?? "").replace(/%[fFuUdDnNickvmb]/g, "").trim()
      const cats = (a as any).get_categories?.()?.split(";").filter(Boolean) ?? []
      return {
        name: a.get_name() ?? "",
        iconName: a.get_icon()?.to_string() ?? "application-x-executable",
        gicon: a.get_icon(),
        exec: cmdline,
        execName: a.get_executable() ?? "",
        appId: a.get_id() ?? a.get_name() ?? "",
        categories: cats,
      }
    })
    .filter(a => a.name && a.exec)
    .sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" }))
  return _appCache
}

function buildAppRow(app: AppEntry): Gtk.Widget {
  const btn = new Gtk.Button({ cssClasses: ["apps-row"], hexpand: true })
  const inner = new Gtk.Box({ spacing: 10 })

  const iconBox = new Gtk.Box({ cssClasses: ["apps-row-icon"], valign: Gtk.Align.CENTER })
  if (app.gicon) {
    const img = Gtk.Image.new_from_gicon(app.gicon)
    img.pixel_size = 24
    iconBox.append(img)
  } else {
    iconBox.append(new Gtk.Image({ iconName: app.iconName, pixelSize: 24 }))
  }
  inner.append(iconBox)
  inner.append(new Gtk.Label({
    label: app.name,
    cssClasses: ["apps-row-label"],
    halign: Gtk.Align.START,
    hexpand: true,
    ellipsize: 3,
  }))
  btn.set_child(inner)

  btn.connect("clicked", () => {
    showAppContext({
      id: app.appId,
      name: app.name,
      iconName: app.iconName,
      gicon: app.gicon,
      execRaw: app.exec,
      execName: app.execName,
      appId: app.appId,
      launch: () => execAsync(["sh", "-c", app.exec]).catch(() => {}),
    })
  })

  return btn
}

export function AppsSection() {
  const [activeCat, setActiveCat] = createState("all")

  // ── Category pills ────────────────────────────────────────────
  const catsBox = new Gtk.Box({ cssClasses: ["apps-cats"], spacing: 4 })

  const catBtns: Map<string, Gtk.Button> = new Map()

  function refreshCatBtns(cat: string) {
    for (const [id, btn] of catBtns) {
      btn.set_css_classes(id === cat ? ["apps-cat-btn", "active"] : ["apps-cat-btn"])
    }
  }

  for (const cat of CATEGORIES) {
    const btn = new Gtk.Button({
      cssClasses: cat.id === "all" ? ["apps-cat-btn", "active"] : ["apps-cat-btn"],
      label: cat.label,
    })
    btn.connect("clicked", () => {
      setActiveCat(cat.id)
      refreshCatBtns(cat.id)
      rebuild(cat.id)
    })
    catBtns.set(cat.id, btn)
    catsBox.append(btn)
  }

  // ── App list ──────────────────────────────────────────────────
  const listBox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, cssClasses: ["apps-list"] })

  function rebuild(catId: string) {
    let child = listBox.get_first_child()
    while (child) { const next = child.get_next_sibling(); listBox.remove(child); child = next }

    const gioKey = CATEGORIES.find(c => c.id === catId)?.gioKey ?? ""
    const apps = getAllApps().filter(a =>
      !gioKey || a.categories.some(c => c === gioKey)
    )

    for (const app of apps) {
      listBox.append(buildAppRow(app))
    }
  }

  rebuild("all")

  const catsScroll = new Gtk.ScrolledWindow()
  catsScroll.set_css_classes(["apps-cats-scroll"])
  catsScroll.set_policy(Gtk.PolicyType.AUTOMATIC, Gtk.PolicyType.NEVER)
  catsScroll.set_child(catsBox)

  const listScroll = new Gtk.ScrolledWindow()
  listScroll.set_css_classes(["apps-list-scroll"])
  listScroll.vexpand = true
  listScroll.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.AUTOMATIC)
  listScroll.set_child(listBox)

  const root = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, cssClasses: ["apps-section"] })
  root.append(catsScroll)
  root.append(listScroll)
  return root
}
