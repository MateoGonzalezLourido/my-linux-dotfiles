// Información de hardware y software del equipo. Todos los comandos son
// opcionales: la sección sigue siendo útil en instalaciones mínimas.
import { Gtk } from "ags/gtk4"
import { With, createState } from "ags"
import { execAsync } from "ags/process"
import GLib from "gi://GLib"
import { TituloSeccion, TituloSubseccion } from "./componentes"
import SupervisionSistema from "./SupervisionSistema"
import textos from "../../textos/ajustes/sistema.json" with { type: "json" }
import { formatearTexto } from "../../textos/formatear"

interface InfoItem { label: string; value: string }
interface InfoGroup { title: string; icon: string; items: InfoItem[] }
interface SystemSnapshot { groups: InfoGroup[] }

const EMPTY: SystemSnapshot = { groups: [] }

async function command(script: string): Promise<string> {
  return execAsync(["bash", "-c", script])
    .then(out => out.trim())
    .catch(() => "")
}

function readFile(path: string): string {
  try {
    const [ok, bytes] = GLib.file_get_contents(path)
    return ok ? new TextDecoder().decode(bytes).trim() : ""
  } catch (_) { return "" }
}

function osRelease(): Record<string, string> {
  const result: Record<string, string> = {}
  for (const line of readFile("/etc/os-release").split("\n")) {
    const pos = line.indexOf("=")
    if (pos < 1) continue
    result[line.slice(0, pos)] = line.slice(pos + 1).replace(/^['\"]|['\"]$/g, "")
  }
  return result
}

function firstLine(value: string): string {
  return value.split("\n").find(Boolean)?.trim() ?? ""
}

function add(items: InfoItem[], label: string, value: string) {
  const clean = value.trim()
  if (clean && clean !== "N/A" && clean !== "unknown") items.push({ label, value: clean })
}

interface PciDevice { name: string; driver: string; modules: string }

function parsePciDevices(raw: string): PciDevice[] {
  return raw.split("\n\n").map(block => {
    const lines = block.split("\n").map(line => line.trim()).filter(Boolean)
    const name = (lines[0] ?? "")
      .replace(/^[0-9a-f:.]+\s+/i, "")
      .replace(/^(VGA compatible controller|3D controller|Display controller):\s*/i, "")
    const driver = lines.find(line => line.startsWith("Kernel driver in use:"))?.split(":").slice(1).join(":").trim() ?? ""
    const modules = lines.find(line => line.startsWith("Kernel modules:"))?.split(":").slice(1).join(":").trim() ?? ""
    return { name, driver, modules }
  }).filter(device => device.name)
}

function addDevices(items: InfoItem[], label: string, raw: string) {
  raw.split("\n").map(line => line.trim()).filter(Boolean).forEach((device, index, all) => {
    const clean = device.replace(/^(Ethernet controller|Network controller|Audio device):\s*/i, "")
    add(items, all.length > 1
      ? formatearTexto(textos.etiquetas.elementoNumerado, { etiqueta: label, numero: index + 1 })
      : label, clean)
  })
}

async function collectSystemInfo(): Promise<SystemSnapshot> {
  const os = osRelease()
  const cpuModel = readFile("/proc/cpuinfo").match(/^model name\s*:\s*(.+)$/m)?.[1] ?? ""
  const memKb = Number(readFile("/proc/meminfo").match(/^MemTotal:\s+(\d+)/m)?.[1] ?? 0)
  const memory = memKb ? `${(memKb / 1024 / 1024).toFixed(1)} GiB` : ""

  const [kernel, arch, virt, memorySpeed, gpuRaw, renderer,
    board, bios, disks, network, audio, hyprRaw, agsVersion] = await Promise.all([
    command("uname -r"), command("uname -m"),
    command("systemd-detect-virt 2>/dev/null || true"),
    command("v=$({ for f in /sys/devices/system/edac/mc/mc*/dimm*/dimm_speed; do [ -r \"$f\" ] && cat \"$f\"; done; } 2>/dev/null | awk '$1>0{v[$1]=1} END{for(x in v) printf \"%s%s MT/s\",sep,x; sep=\" · \"}'); if [ -n \"$v\" ]; then printf '%s' \"$v\"; else lshw -class memory 2>/dev/null | sed -n 's/.*clock: \\([^ ]*\\).*/\\1/p' | sort -u | paste -sd ' · ' -; fi"),
    command("lspci -Dk 2>/dev/null | awk '/VGA compatible controller|3D controller|Display controller/{if(found) print \"\"; found=1; print; next} found && /Kernel driver in use:|Kernel modules:/{print; next} found && /^[^ \\t]/{found=0}'"),
    command("(glxinfo -B 2>/dev/null || eglinfo -B 2>/dev/null) | sed -n 's/^[ \\t]*OpenGL renderer string:[ \\t]*//p' | head -n1"),
    command("printf '%s %s' \"$(cat /sys/devices/virtual/dmi/id/board_vendor 2>/dev/null)\" \"$(cat /sys/devices/virtual/dmi/id/board_name 2>/dev/null)\""),
    command("printf '%s %s' \"$(cat /sys/devices/virtual/dmi/id/bios_vendor 2>/dev/null)\" \"$(cat /sys/devices/virtual/dmi/id/bios_version 2>/dev/null)\""),
    command("lsblk -dn -o MODEL,SIZE,TYPE 2>/dev/null | awk '$3==\"disk\"{$3=\"\"; sub(/^ +/,\"\"); sub(/ +$/,\"\"); print}'"),
    command("lspci 2>/dev/null | sed -nE '/Ethernet|Network controller/{s/^[^ ]+ //;p}'"),
    command("lspci 2>/dev/null | sed -nE '/Audio device/{s/^[^ ]+ //;p}'"),
    command("hyprctl version -j 2>/dev/null"), command("ags --version 2>/dev/null"),
  ])
  const gpus = parsePciDevices(gpuRaw)

  let hyprland = ""
  try {
    const h = JSON.parse(hyprRaw)
    hyprland = [h.tag || h.version, h.commit ? `(${String(h.commit).slice(0, 8)})` : ""].filter(Boolean).join(" ")
  } catch (_) { hyprland = firstLine(hyprRaw) }

  const system: InfoItem[] = []
  add(system, textos.etiquetas.sistemaOperativo, os.PRETTY_NAME || os.NAME || "")
  add(system, textos.etiquetas.kernelArquitectura, [kernel, arch].filter(Boolean).join(" · "))
  add(system, textos.etiquetas.nombreEquipo, GLib.get_host_name())
  if (virt && virt !== "none") add(system, textos.etiquetas.virtualizacion, virt)

  const hardware: InfoItem[] = []
  add(hardware, textos.etiquetas.procesador, cpuModel)
  add(hardware, textos.etiquetas.memoria, [memory, memorySpeed].filter(Boolean).join(" · "))
  add(hardware, textos.etiquetas.placaBase, board)
  add(hardware, textos.etiquetas.firmware, bios)
  add(hardware, textos.etiquetas.almacenamiento, disks)

  const graphics: InfoItem[] = []
  gpus.forEach((gpu, index) => {
    const numero = { numero: index + 1 }
    const etiquetaGpu = gpus.length > 1
      ? formatearTexto(textos.etiquetas.gpuNumerada, numero)
      : textos.etiquetas.gpu
    const etiquetaControlador = gpus.length > 1
      ? formatearTexto(textos.etiquetas.controladorNumerado, numero)
      : textos.etiquetas.controlador
    const modulos = gpu.modules && gpu.modules !== gpu.driver
      ? formatearTexto(textos.etiquetas.modulos, { modulos: gpu.modules })
      : ""
    add(graphics, etiquetaGpu, gpu.name)
    add(graphics, etiquetaControlador, [gpu.driver, modulos].filter(Boolean).join(" · "))
  })
  add(graphics, textos.etiquetas.renderizadorOpenGl, renderer)

  const environment: InfoItem[] = []
  add(environment, textos.etiquetas.compositor, hyprland ? `Hyprland ${hyprland}` : "Hyprland")
  add(environment, textos.etiquetas.sesion, [GLib.getenv("XDG_SESSION_TYPE") || "Wayland", GLib.getenv("XDG_CURRENT_DESKTOP") || "Hyprland"].join(" · "))
  add(environment, textos.etiquetas.ags, firstLine(agsVersion))
  add(environment, textos.etiquetas.gtk, `${Gtk.get_major_version()}.${Gtk.get_minor_version()}.${Gtk.get_micro_version()}`)

  const devices: InfoItem[] = []
  addDevices(devices, textos.etiquetas.redPci, network)
  addDevices(devices, textos.etiquetas.audioPci, audio)

  return {
    groups: [
      { title: textos.grupos.sistema, icon: "󰍹", items: system },
      { title: textos.grupos.componentes, icon: "󰌢", items: hardware },
      { title: textos.grupos.graficos, icon: "󰢮", items: graphics },
      { title: textos.grupos.entorno, icon: "󰖯", items: environment },
      { title: textos.grupos.controladoresPci, icon: "󰓢", items: devices },
    ].filter(group => group.items.length),
  }
}

function InfoGroupView({ group }: { group: InfoGroup }) {
  return (
    <box orientation={Gtk.Orientation.VERTICAL} spacing={0} cssClasses={["sys-card"]}>
      <box spacing={8} cssClasses={["sys-card-header"]}>
        <label cssClasses={["sys-card-icon"]} label={group.icon} />
        <TituloSubseccion cssClasses={["sys-card-title"]} label={group.title} hexpand halign={Gtk.Align.START} />
      </box>
      {group.items.map((item, i) => (
        <box cssClasses={i ? ["sys-row", "bordered"] : ["sys-row"]} spacing={20}>
          <label cssClasses={["sys-label"]} label={item.label} halign={Gtk.Align.START} valign={Gtk.Align.START} />
          <label cssClasses={["sys-value"]} label={item.value} hexpand halign={Gtk.Align.START}
            xalign={0} wrap={true} selectable={true} maxWidthChars={48} />
        </box>
      ))}
    </box>
  )
}

type VistaSistema = "informacion" | "supervision"

export default function SystemSection({ vista }: { vista: VistaSistema }) {
  if (vista === "supervision") {
    return (
      <box orientation={Gtk.Orientation.VERTICAL} spacing={14} cssClasses={["sp-section", "dev-section"]} hexpand>
        <TituloSeccion titulo={textos.vistas.supervision} />
        <SupervisionSistema />
      </box>
    )
  }
  const [snapshot, setSnapshot] = createState<SystemSnapshot>(EMPTY)
  collectSystemInfo().then(setSnapshot)

  return (
    <box orientation={Gtk.Orientation.VERTICAL} spacing={14} cssClasses={["sp-section", "sys-section"]} hexpand>
      <TituloSeccion titulo={textos.vistas.informacion} />
      <With value={snapshot}>
        {(data: SystemSnapshot) => data.groups.length
          ? <box orientation={Gtk.Orientation.VERTICAL} spacing={12}>
              {data.groups.map(group => <InfoGroupView group={group} />)}
            </box>
          : <box cssClasses={["sys-loading"]} halign={Gtk.Align.CENTER} valign={Gtk.Align.CENTER}>
              <Gtk.Spinner spinning={true} />
              <label label={textos.seccion.cargando} />
            </box>}
      </With>
    </box>
  )
}
