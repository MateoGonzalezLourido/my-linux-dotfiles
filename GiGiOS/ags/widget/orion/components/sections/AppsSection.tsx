import { Gtk } from "ags/gtk4"
import Gio from "gi://Gio"
import GLib from "gi://GLib"
import Pango from "gi://Pango"
import {
  activeSection,
  hidePanel,
  rightPanelVisible,
  showAppContext,
} from "../../state"
import { launchApp } from "../../data/launch"
import type {
  ElementoNavegacionBusqueda,
  NavegacionBusqueda,
} from "../NavegacionBusqueda"

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

interface AppRenderizada {
  widget: Gtk.Widget
  navegable: ElementoNavegacionBusqueda
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

function appIcon(app: AppEntry, size: number): Gtk.Image {
  if (app.gicon) {
    const image = Gtk.Image.new_from_gicon(app.gicon)
    image.pixel_size = size
    return image
  }
  return new Gtk.Image({ iconName: app.iconName, pixelSize: size })
}

function openAppContext(app: AppEntry) {
  showAppContext({
    id: app.appId,
    name: app.name,
    iconName: app.iconName,
    gicon: app.gicon,
    execRaw: app.exec,
    execName: app.execName,
    appId: app.appId,
    launch: () => launchApp(app.exec),
  })
}

function launchAppDirect(app: AppEntry) {
  launchApp(app.exec)
  hidePanel()
}

function bindAppActivation(
  boton: Gtk.Button,
  app: AppEntry,
  navegacion: NavegacionBusqueda,
  navegable: ElementoNavegacionBusqueda,
) {
  let suppressClick = false
  const gesture = new Gtk.GestureClick()
  gesture.set_button(1)
  gesture.propagation_phase = Gtk.PropagationPhase.CAPTURE
  gesture.connect("pressed", (_gesture, presses) => {
    if (presses === 2) {
      suppressClick = true
      // Orion can hide before GTK emits this press' final "clicked" signal.
      // Always release the guard so it cannot consume a click on the next open.
      GLib.timeout_add(GLib.PRIORITY_DEFAULT, 350, () => {
        suppressClick = false
        return GLib.SOURCE_REMOVE
      })
      navegacion.seleccionarResultado(navegable, false)
      launchAppDirect(app)
    }
  })
  boton.add_controller(gesture)
  boton.connect("notify::has-focus", () => {
    if (boton.has_focus) navegacion.seleccionarResultado(navegable, false)
  })
  boton.connect("clicked", () => {
    navegacion.seleccionarResultado(navegable, false)
    if (suppressClick) { suppressClick = false; return }
    openAppContext(app)
  })
}

function buildAppRow(app: AppEntry, navegacion: NavegacionBusqueda): AppRenderizada {
  const boton = new Gtk.Button({ cssClasses: ["apps-row"], hexpand: true })
  const inner = new Gtk.Box({ spacing: 10 })

  const iconBox = new Gtk.Box({ cssClasses: ["apps-row-icon"], valign: Gtk.Align.CENTER })
  iconBox.append(appIcon(app, 32))
  inner.append(iconBox)
  inner.append(new Gtk.Label({
    label: app.name,
    cssClasses: ["apps-row-label"],
    halign: Gtk.Align.START,
    hexpand: true,
    ellipsize: 3,
  }))
  boton.set_child(inner)

  const navegable: ElementoNavegacionBusqueda = {
    marcarSeleccionado: (seleccionado) => {
      if (seleccionado) boton.add_css_class("seleccionado")
      else boton.remove_css_class("seleccionado")
    },
    previsualizar: () => {
      if (rightPanelVisible.get()) openAppContext(app)
    },
    enfocar: () => boton.grab_focus(),
    activar: () => openAppContext(app),
  }
  bindAppActivation(boton, app, navegacion, navegable)

  return { widget: boton, navegable }
}

function buildAppTile(app: AppEntry, navegacion: NavegacionBusqueda): AppRenderizada {
  const boton = new Gtk.Button({ cssClasses: ["apps-tile"] })
  const inner = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    cssClasses: ["apps-tile-inner"],
    spacing: 6,
    halign: Gtk.Align.CENTER,
  })
  const iconBox = new Gtk.Box({
    cssClasses: ["apps-tile-icon"],
    halign: Gtk.Align.CENTER,
    valign: Gtk.Align.CENTER,
  })
  iconBox.append(appIcon(app, 38))
  inner.append(iconBox)
  inner.append(new Gtk.Label({
    label: app.name,
    cssClasses: ["apps-tile-label"],
    wrap: true,
    wrapMode: Pango.WrapMode.WORD_CHAR,
    lines: 2,
    ellipsize: Pango.EllipsizeMode.END,
    maxWidthChars: 12,
    halign: Gtk.Align.CENTER,
    justify: Gtk.Justification.CENTER,
    xalign: 0.5,
  }))
  boton.set_child(inner)
  const navegable: ElementoNavegacionBusqueda = {
    marcarSeleccionado: (seleccionado) => {
      if (seleccionado) boton.add_css_class("seleccionado")
      else boton.remove_css_class("seleccionado")
    },
    previsualizar: () => {
      if (rightPanelVisible.get()) openAppContext(app)
    },
    enfocar: () => boton.grab_focus(),
    activar: () => openAppContext(app),
  }
  bindAppActivation(boton, app, navegacion, navegable)
  return { widget: boton, navegable }
}

export function AppsSection(navegacion: NavegacionBusqueda) {
  // ── Category pills ────────────────────────────────────────────
  const catsBox = new Gtk.Box({ cssClasses: ["apps-cats"], spacing: 2 })

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
      valign: Gtk.Align.CENTER,
    })
    btn.connect("clicked", () => {
      refreshCatBtns(cat.id)
      rebuild(cat.id)
    })
    catBtns.set(cat.id, btn)
    catsBox.append(btn)
  }

  // "Todas" uses a visual catalogue; filtered categories stay compact.
  const grid = new Gtk.FlowBox({ cssClasses: ["apps-all-grid"] })
  grid.selection_mode = Gtk.SelectionMode.NONE
  grid.homogeneous = true
  grid.column_spacing = 6
  grid.row_spacing = 6
  grid.min_children_per_line = 6
  grid.max_children_per_line = 6

  const listBox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, cssClasses: ["apps-list"] })
  const modeIcon = new Gtk.Image({ iconName: "view-app-grid-symbolic", pixelSize: 13 })
  const modeLabel = new Gtk.Label({ label: "Mosaico", cssClasses: ["apps-mode-label"] })
  const modeButton = new Gtk.Button({ cssClasses: ["apps-mode-toggle"] })
  const modeButtonInner = new Gtk.Box({ spacing: 6 })
  modeButtonInner.append(modeIcon)
  modeButtonInner.append(modeLabel)
  modeButton.set_child(modeButtonInner)
  const countLabel = new Gtk.Label({ cssClasses: ["apps-count"] })
  let currentApps: AppEntry[] = []
  let gridMode = true
  let navegablesActuales: ElementoNavegacionBusqueda[] = []

  function clearViews() {
    let child = listBox.get_first_child()
    while (child) { const next = child.get_next_sibling(); listBox.remove(child); child = next }
    let gridChild: Gtk.FlowBoxChild | null
    while ((gridChild = grid.get_child_at_index(0)) !== null) grid.remove(gridChild)
  }

  function renderMode() {
    clearViews()
    navegablesActuales = []
    grid.visible = gridMode
    listBox.visible = !gridMode
    modeIcon.icon_name = gridMode ? "view-app-grid-symbolic" : "view-list-symbolic"
    modeLabel.label = gridMode ? "Mosaico" : "Lista"
    for (const app of currentApps) {
      const renderizada = gridMode
        ? buildAppTile(app, navegacion)
        : buildAppRow(app, navegacion)
      navegablesActuales.push(renderizada.navegable)
      if (gridMode) grid.append(renderizada.widget)
      else listBox.append(renderizada.widget)
    }
    sincronizarNavegacion()
  }

  function sincronizarNavegacion(): void {
    if (activeSection.get() !== "apps") return
    // Al entrar no hay selección. La primera flecha o Tab seleccionan la
    // primera app; a partir de ahí el modelo aplica el movimiento solicitado.
    navegacion.establecerResultados(navegablesActuales, false, gridMode ? 6 : 1)
  }

  modeButton.connect("clicked", () => {
    gridMode = !gridMode
    renderMode()
  })

  function rebuild(catId: string) {
    const gioKey = CATEGORIES.find(c => c.id === catId)?.gioKey ?? ""
    currentApps = getAllApps().filter(a =>
      !gioKey || a.categories.some(c => c === gioKey)
    )

    // Every category change is a fresh render: "Todas" defaults to mosaic,
    // while filtered categories keep their compact list default.
    gridMode = catId === "all"
    countLabel.label = `${currentApps.length} ${currentApps.length === 1 ? "aplicación" : "aplicaciones"}`
    renderMode()
  }

  rebuild("all")
  activeSection.subscribe(sincronizarNavegacion)

  const catsScroll = new Gtk.ScrolledWindow()
  catsScroll.set_css_classes(["apps-cats-scroll"])
  catsScroll.set_policy(Gtk.PolicyType.AUTOMATIC, Gtk.PolicyType.NEVER)
  catsScroll.set_child(catsBox)

  const root = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, cssClasses: ["apps-section"] })
  root.append(catsScroll)
  const meta = new Gtk.Box({ cssClasses: ["apps-meta"], spacing: 6 })
  meta.append(countLabel)
  const spacer = new Gtk.Box({ hexpand: true })
  meta.append(spacer)
  meta.append(modeButton)
  root.append(meta)
  root.append(grid)
  root.append(listBox)
  return root
}
