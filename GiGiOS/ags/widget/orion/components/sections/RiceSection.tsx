// widget/orion/components/sections/RiceSection.tsx
//
// Sección "Temas" de Orion (la acción rápida "temas" navega a la sección `rice`).
// Selector de wallpapers de ~/GiGiOS/Wallpapers:
//   - rejilla de miniaturas; clic => fija ese fondo ahora
//   - botón "Aleatorio" => aplica uno al azar ahora
//   - toggle "Fondo aleatorio al iniciar Hyprland" (independiente de lo anterior)
//
// Las miniaturas se cargan de forma perezosa (primer `map`) y a través de
// `wallpaperThumbs`, que las cachea en disco y decodifica los originales fuera
// del hilo principal — ver ese módulo para el porqué.
//
// La carpeta de fondos se vigila con un Gio.FileMonitor: añadir o borrar un
// wallpaper reconstruye la rejilla sin reiniciar el shell.

import { Gtk } from "ags/gtk4"
import GLib from "gi://GLib"
import Gio from "gi://Gio"
import {
  listWallpapers, applyWallpaper, applyRandom,
  randomOnStart, setRandomOnStart, currentWallpaper, WALLPAPER_DIR,
} from "../../wallpaperConfig"
import { loadThumbnails, THUMB_W, THUMB_H } from "../../wallpaperThumbs"

export function RiceSection() {
  const root = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, cssClasses: ["rice-content"] })

  // ── Cabecera: título + botón aleatorio ─────────────────────────────────────
  const header = new Gtk.Box({ cssClasses: ["rice-header"], spacing: 8 })
  header.append(new Gtk.Label({
    label: "Fondos de pantalla", cssClasses: ["rice-section-title"],
    halign: Gtk.Align.START, hexpand: true,
  }))

  const randomBtn = new Gtk.Button({
    cssClasses: ["rice-random-btn"],
    widthRequest: 27,
    heightRequest: 27,
  })
  randomBtn.set_child(new Gtk.Image({
    iconName: "media-playlist-shuffle-symbolic",
    cssClasses: ["rice-random-icon"],
  }))
  randomBtn.connect("clicked", () => applyRandom())
  header.append(randomBtn)
  root.append(header)

  // ── Fila del toggle "aleatorio al iniciar" ─────────────────────────────────
  const toggleRow = new Gtk.Box({ cssClasses: ["rice-toggle-row"], spacing: 8 })
  const tText = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, hexpand: true, halign: Gtk.Align.START })
  tText.append(new Gtk.Label({
    label: "Fondo aleatorio al iniciar Hyprland",
    cssClasses: ["sp-field-label"], halign: Gtk.Align.START,
  }))
  tText.append(new Gtk.Label({
    label: "Si lo apagas, al arrancar se mantiene el último fondo elegido.",
    cssClasses: ["sp-field-hint"], halign: Gtk.Align.START,
    wrap: true, maxWidthChars: 54, xalign: 0,
  }))
  toggleRow.append(tText)

  const toggleBtn = new Gtk.Button({ valign: Gtk.Align.CENTER })
  const track = new Gtk.Box({ cssClasses: ["qs-toggle-track"] })
  const dot   = new Gtk.Box()
  track.append(dot)
  toggleBtn.set_child(track)
  const syncToggle = (on: boolean) => {
    toggleBtn.set_css_classes(on ? ["qs-toggle", "on"] : ["qs-toggle"])
    dot.set_css_classes(on ? ["qs-toggle-dot", "on"] : ["qs-toggle-dot"])
  }
  syncToggle(randomOnStart.get())
  randomOnStart.subscribe(() => syncToggle(randomOnStart.get()))
  toggleBtn.connect("clicked", () => setRandomOnStart(!randomOnStart.get()))
  toggleRow.append(toggleBtn)
  root.append(toggleRow)

  // ── Rejilla de miniaturas ──────────────────────────────────────────────────
  const flow = new Gtk.FlowBox({ cssClasses: ["rice-grid"] })
  flow.selection_mode      = Gtk.SelectionMode.NONE
  flow.column_spacing      = 8
  flow.row_spacing         = 8
  flow.min_children_per_line = 3
  flow.max_children_per_line = 3
  flow.homogeneous         = true

  root.append(flow)

  // path -> botón, para resaltar el fondo actual reactivamente
  const btnByPath = new Map<string, Gtk.Button>()
  const viewportByPath = new Map<string, Gtk.Box>()
  const syncHighlight = () => {
    const cur = currentWallpaper.get()
    for (const [path, btn] of btnByPath) {
      btn.set_css_classes(path === cur ? ["rice-thumb", "wp-current"] : ["rice-thumb"])
    }
  }
  currentWallpaper.subscribe(syncHighlight)

  // Cada reconstrucción de la rejilla invalida a la anterior: las miniaturas de
  // una pasada en vuelo pueden llegar después de que la rejilla se haya rehecho
  // (un fondo añadido mientras se generaban), y deben descartarse.
  let generation = 0

  const rebuild = () => {
    const mine = ++generation
    btnByPath.clear()
    viewportByPath.clear()
    flow.remove_all()

    const paths = listWallpapers()

    // Reservamos toda la rejilla antes de pedir las imágenes. Si los botones se
    // añaden a la vez que las miniaturas, FlowBox recalcula sus columnas en cada
    // una y los fondos parecen encogerse durante la carga.
    for (const path of paths) {
      const placeholder = new Gtk.Box({ cssClasses: ["rice-thumb-placeholder"], hexpand: true })
      placeholder.set_size_request(THUMB_W, THUMB_H)

      // El viewport conserva el tamaño de la tarjeta y recorta la imagen cuando
      // el hover la amplía; así la rejilla y el borde nunca se desplazan.
      const viewport = new Gtk.Box({ cssClasses: ["rice-thumb-viewport"], hexpand: true })
      viewport.set_overflow(Gtk.Overflow.HIDDEN)
      viewport.set_size_request(THUMB_W, THUMB_H)
      viewport.append(placeholder)

      const btn = new Gtk.Button({ cssClasses: ["rice-thumb"], hexpand: true })
      btn.set_child(viewport)
      btn.connect("clicked", () => applyWallpaper(path))
      btnByPath.set(path, btn)
      viewportByPath.set(path, viewport)
      flow.append(btn)
    }
    syncHighlight()

    loadThumbnails(paths, (path, tex) => {
      if (mine !== generation) return // rejilla ya obsoleta
      const pic = new Gtk.Picture({ cssClasses: ["rice-thumb-img"], hexpand: true })
      pic.set_paintable(tex)
      pic.content_fit = Gtk.ContentFit.COVER
      pic.set_size_request(THUMB_W, THUMB_H)
      const viewport = viewportByPath.get(path)
      const anterior = viewport?.get_first_child()
      if (!viewport || !anterior) return
      viewport.remove(anterior)
      viewport.append(pic)
    })
  }

  // Carga perezosa: solo al abrir la sección por primera vez.
  let loaded = false
  root.connect("map", () => {
    if (loaded) return
    loaded = true
    rebuild()
  })

  // La carpeta de fondos se vigila para no tener que reiniciar AGS al meter o
  // quitar wallpapers. Copiar un fondo grande dispara muchos eventos (created,
  // changed…, uno por bloque escrito), así que se rebota: se reconstruye tras
  // 800 ms sin novedades. Solo si la sección ya se abrió — si no, ya se cargará
  // al abrirla. La caché es por fichero, así que rehacer la rejilla solo genera
  // las miniaturas nuevas; las demás se releen del disco (~30 ms).
  let debounce = 0
  const dir = Gio.File.new_for_path(WALLPAPER_DIR)
  const dirMonitor = dir.monitor_directory(Gio.FileMonitorFlags.NONE, null)
  dirMonitor.connect("changed", () => {
    if (!loaded) return
    if (debounce) GLib.source_remove(debounce)
    debounce = GLib.timeout_add(GLib.PRIORITY_DEFAULT_IDLE, 800, () => {
      debounce = 0
      rebuild()
      return GLib.SOURCE_REMOVE
    })
  })
  // Sin esta referencia el monitor sería recolectado por el GC y dejaría de avisar.
  ;(root as any)._wallpaperDirMonitor = dirMonitor

  return root
}
