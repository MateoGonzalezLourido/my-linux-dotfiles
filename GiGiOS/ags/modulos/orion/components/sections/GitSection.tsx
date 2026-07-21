// Sección "Git" de Orion: dos pestañas sobre el mismo estado compartido.
//   - `git/estado.ts`         — estado reactivo, refresco e init (única fuente
//     de verdad; ni la vista de repos ni la de gestión dependen la una de la otra)
//   - `git/vistaRepos.tsx`    — pestaña "repos": chips, commits, archivos, diff
//   - `git/vistaGestionar.tsx` — pestaña "gestionar": añadir, guardados, descubrimiento
import { Gtk } from "ags/gtk4"
import { init, gitView, setGitView } from "./git/estado"
import { buildReposView } from "./git/vistaRepos"
import { buildManageView } from "./git/vistaGestionar"

function buildTabBar(): Gtk.Box {
  const bar = new Gtk.Box({ cssClasses: ["git-tab-bar"], spacing: 4 })

  const reposTab  = new Gtk.ToggleButton({ cssClasses: ["git-tab"], active: true })
  const manageTab = new Gtk.ToggleButton({ cssClasses: ["git-tab"] })

  const ri = new Gtk.Box({ spacing: 6 })
  ri.append(new Gtk.Image({ iconName: "vcs-repository-symbolic" }))
  ri.append(new Gtk.Label({ label: "repos" }))
  reposTab.set_child(ri)

  const mi = new Gtk.Box({ spacing: 6 })
  mi.append(new Gtk.Image({ iconName: "list-add-symbolic" }))
  mi.append(new Gtk.Label({ label: "gestionar" }))
  manageTab.set_child(mi)

  bar.append(reposTab)
  bar.append(manageTab)

  reposTab.connect("toggled", () => {
    if (reposTab.active) { setGitView("repos"); if (manageTab.active) manageTab.active = false }
    else if (!manageTab.active) reposTab.active = true
  })
  manageTab.connect("toggled", () => {
    if (manageTab.active) { setGitView("manage"); if (reposTab.active) reposTab.active = false }
    else if (!reposTab.active) manageTab.active = true
  })

  gitView.subscribe(v => {
    const wantRepos = v === "repos"
    if (reposTab.active  !== wantRepos)  reposTab.active  = wantRepos
    if (manageTab.active !== !wantRepos) manageTab.active = !wantRepos
  })

  return bar
}

export function GitSection(): Gtk.Box {
  init().catch(console.error)

  const container = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 8, cssClasses: ["git-section"] })

  container.append(buildTabBar())
  container.append(new Gtk.Box({ cssClasses: ["j-hdiv"] }))

  const reposView  = buildReposView()
  const manageView = buildManageView()
  manageView.visible = false

  gitView.subscribe(v => {
    reposView.visible  = v === "repos"
    manageView.visible = v === "manage"
  })

  container.append(reposView)
  container.append(manageView)

  return container
}
