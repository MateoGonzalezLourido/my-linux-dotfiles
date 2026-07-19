// Información de hardware y software del equipo. Todos los comandos son
// opcionales: la sección sigue siendo útil en instalaciones mínimas.
import { Gtk } from "ags/gtk4"
import { With, createState } from "ags"
import { execAsync } from "ags/process"
import GLib from "gi://GLib"
import { TituloSeccion, TituloSubseccion } from "./componentes"

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
    add(items, all.length > 1 ? `${label} ${index + 1}` : label, clean)
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
  add(system, "Sistema operativo", os.PRETTY_NAME || os.NAME || "")
  add(system, "Kernel", [kernel, arch].filter(Boolean).join(" · "))
  add(system, "Nombre del equipo", GLib.get_host_name())
  if (virt && virt !== "none") add(system, "Virtualización", virt)

  const hardware: InfoItem[] = []
  add(hardware, "Procesador", cpuModel)
  add(hardware, "Memoria instalada", [memory, memorySpeed].filter(Boolean).join(" · "))
  add(hardware, "Placa base", board)
  add(hardware, "BIOS / UEFI", bios)
  add(hardware, "Almacenamiento", disks)

  const graphics: InfoItem[] = []
  gpus.forEach((gpu, index) => {
    const integrated = /Intel/i.test(gpu.name) || (/AMD|Radeon/i.test(gpu.name) && !/\bRX\b|Radeon Pro/i.test(gpu.name))
    const kind = gpus.length > 1 ? (integrated ? " integrada" : " dedicada") : ""
    const fallback = gpus.length > 1 && gpus.filter(g => (/Intel/i.test(g.name) || (/AMD|Radeon/i.test(g.name) && !/\bRX\b|Radeon Pro/i.test(g.name))) === integrated).length > 1
      ? ` ${index + 1}` : ""
    add(graphics, `GPU${kind}${fallback}`, gpu.name)
    add(graphics, `Driver${kind}${fallback}`, [gpu.driver, gpu.modules && gpu.modules !== gpu.driver ? `módulos: ${gpu.modules}` : ""].filter(Boolean).join(" · "))
  })
  add(graphics, "Renderizador OpenGL", renderer)

  const environment: InfoItem[] = []
  add(environment, "Compositor", hyprland ? `Hyprland ${hyprland}` : "Hyprland")
  add(environment, "Sesión", [GLib.getenv("XDG_SESSION_TYPE") || "Wayland", GLib.getenv("XDG_CURRENT_DESKTOP") || "Hyprland"].join(" · "))
  add(environment, "AGS", firstLine(agsVersion))
  add(environment, "GTK", `${Gtk.get_major_version()}.${Gtk.get_minor_version()}.${Gtk.get_micro_version()}`)

  const devices: InfoItem[] = []
  addDevices(devices, "Red", network)
  addDevices(devices, "Audio", audio)

  return {
    groups: [
      { title: "Sistema", icon: "󰍹", items: system },
      { title: "Componentes", icon: "󰌢", items: hardware },
      { title: "Gráficos y drivers", icon: "󰢮", items: graphics },
      { title: "Entorno gráfico", icon: "󰖯", items: environment },
      { title: "Dispositivos", icon: "󰓢", items: devices },
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

export default function SystemSection() {
  const [snapshot, setSnapshot] = createState<SystemSnapshot>(EMPTY)
  collectSystemInfo().then(setSnapshot)

  return (
    <box orientation={Gtk.Orientation.VERTICAL} spacing={14} cssClasses={["sp-section", "sys-section"]} hexpand>
      <TituloSeccion titulo="Sistema" />
      <With value={snapshot}>
        {(data: SystemSnapshot) => data.groups.length
          ? <box orientation={Gtk.Orientation.VERTICAL} spacing={12}>
              {data.groups.map(group => <InfoGroupView group={group} />)}
            </box>
          : <box cssClasses={["sys-loading"]} halign={Gtk.Align.CENTER} valign={Gtk.Align.CENTER}>
              <Gtk.Spinner spinning={true} />
              <label label="Detectando componentes del sistema…" />
            </box>}
      </With>
    </box>
  )
}
