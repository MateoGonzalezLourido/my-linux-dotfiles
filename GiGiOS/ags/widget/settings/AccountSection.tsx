import { Gtk } from "ags/gtk4"
import { With, createState } from "ags"
import Gio from "gi://Gio"
import GLib from "gi://GLib"
import ProfileAvatar from "./ProfileAvatar"
import { AVATAR_PATH, refreshAvatar } from "./avatar"
import { BotonAjustes, EntradaTextoAjustes, FilaAjuste, TarjetaAjustes, TextoInformativo, TituloSeccion } from "./componentes"

type Notice = { kind: "idle" | "working" | "ok" | "error"; text: string }

function adminCommand(argv: string[], input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      const flags = Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
      // -k obliga a que sudo consuma exactamente la primera línea de este stdin.
      // Así, si el comando es chpasswd, sólo recibe las líneas posteriores.
      const process = Gio.Subprocess.new(["sudo", "-k", "-S", "-p", "", ...argv], flags)
      process.communicate_utf8_async(input, null, (proc, result) => {
        try {
          const [, stdout, stderr] = proc.communicate_utf8_finish(result)
          if (proc.get_successful()) resolve((stdout ?? "").trim())
          else reject(new Error((stderr ?? "No se pudo completar la operación").trim()))
        } catch (error) { reject(error) }
      })
    } catch (error) { reject(error) }
  })
}

function cleanAdminError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/incorrect password|authentication failure|try again/i.test(message)) return "La contraseña de administrador no es correcta."
  return message.replace(/^sudo:\s*/i, "") || "No se pudo completar la operación."
}

export default function AccountSection() {
  const currentUser = GLib.get_user_name() || "user"
  const [loginName, setLoginName] = createState(currentUser)
  const [fullName, setFullName] = createState("")
  const [newPassword, setNewPassword] = createState("")
  const [confirmPassword, setConfirmPassword] = createState("")
  const [adminPassword, setAdminPassword] = createState("")
  const [avatarInput, setAvatarInput] = createState("")
  const [passwordExpanded, setPasswordExpanded] = createState(false)
  const [notice, setNotice] = createState<Notice>({ kind: "idle", text: "" })

  const applyAvatar = () => {
    const raw = avatarInput.get().trim()
    if (!raw) return setNotice({ kind: "error", text: "Escribe la ruta de una imagen." })
    const path = raw === "~" ? GLib.get_home_dir()
      : raw.startsWith("~/") ? `${GLib.get_home_dir()}/${raw.slice(2)}`
      : raw
    try {
      if (!GLib.path_is_absolute(path)) throw new Error("La ruta debe ser absoluta o empezar por ~/.")
      if (!GLib.file_test(path, GLib.FileTest.IS_REGULAR)) throw new Error("No existe una imagen en esa ruta.")
      GLib.mkdir_with_parents(GLib.path_get_dirname(AVATAR_PATH), 0o700)
      Gio.File.new_for_path(path).copy(Gio.File.new_for_path(AVATAR_PATH), Gio.FileCopyFlags.OVERWRITE, null, null)
      refreshAvatar()
      setAvatarInput("")
      setNotice({ kind: "ok", text: "Foto de perfil actualizada." })
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : String(error) })
    }
  }

  const applyChanges = async () => {
    const nextLogin = loginName.get().trim()
    const realName = fullName.get().trim()
    const password = newPassword.get()
    const admin = adminPassword.get()
    if (!admin) return setNotice({ kind: "error", text: "Introduce la contraseña de administrador." })
    if (!/^[a-z_][a-z0-9_-]{0,31}$/.test(nextLogin)) return setNotice({ kind: "error", text: "El usuario debe usar minúsculas, números, _ o - y empezar por una letra." })
    if (password && password !== confirmPassword.get()) return setNotice({ kind: "error", text: "Las contraseñas nuevas no coinciden." })
    if (password && password.length < 8) return setNotice({ kind: "error", text: "La contraseña nueva debe tener al menos 8 caracteres." })
    if (nextLogin === currentUser && !realName && !password) return setNotice({ kind: "error", text: "No hay cambios que guardar." })

    setNotice({ kind: "working", text: "Aplicando cambios…" })
    try {
      // Validación explícita; cada orden vuelve a autenticar para mantener separado
      // el stdin de sudo del stdin destinado a chpasswd.
      await adminCommand(["-v"], `${admin}\n`)
      if (realName) await adminCommand(["usermod", "-c", realName, currentUser], `${admin}\n`)
      if (password) await adminCommand(["chpasswd"], `${admin}\n${currentUser}:${password}\n`)
      if (nextLogin !== currentUser) await adminCommand(["usermod", "-l", nextLogin, currentUser], `${admin}\n`)
      setAdminPassword("")
      setNewPassword("")
      setConfirmPassword("")
      setNotice({ kind: "ok", text: nextLogin !== currentUser ? "Cuenta actualizada. Cierra sesión para usar el nuevo nombre." : "Cuenta actualizada correctamente." })
    } catch (error) {
      setAdminPassword("")
      setNotice({ kind: "error", text: cleanAdminError(error) })
    }
  }

  const passwordEntry = (placeholder: string, setter: (v: string) => void) => (
    <EntradaTextoAjustes placeholderText={placeholder} visibility={false}
      onChanged={(entry) => setter(entry.get_text())} hexpand />
  )

  return (
    <box orientation={Gtk.Orientation.VERTICAL} spacing={10} cssClasses={["sp-section", "account-section"]} hexpand>
      <TituloSeccion titulo="Cuenta" />

      <TarjetaAjustes titulo="Perfil" icono="󰀄" cssClasses={["account-card"]}>
        <box cssClasses={["dev-row", "account-profile-summary"]} spacing={14} valign={Gtk.Align.CENTER}>
          <ProfileAvatar
            size={46}
            fallbackLabel={currentUser.slice(0, 2).toUpperCase()}
            fallbackCssClasses={["account-avatar", "fallback"]}
            borderWidth={2}
            borderRgba={[203 / 255, 166 / 255, 247 / 255, 0.45]}
          />
          <box orientation={Gtk.Orientation.VERTICAL} spacing={3} hexpand valign={Gtk.Align.CENTER}>
            <label cssClasses={["account-current-user"]} label={currentUser} halign={Gtk.Align.START} />
            <TextoInformativo label={`@${GLib.get_host_name()}`} halign={Gtk.Align.START} />
          </box>
        </box>
        <FilaAjuste titulo="Foto de perfil" informacion="Elige una imagen mediante su ruta local."
          cssClasses={["account-row"]} maxCaracteresInformacion={38}>
          <box cssClasses={["account-controls"]} spacing={8} valign={Gtk.Align.CENTER}>
            <EntradaTextoAjustes placeholderText="~/Imágenes/perfil.png"
              onChanged={(entry) => setAvatarInput(entry.get_text())}
              onActivate={applyAvatar} hexpand />
            <BotonAjustes label="Cambiar foto" onClicked={applyAvatar} />
          </box>
        </FilaAjuste>
      </TarjetaAjustes>

      <TarjetaAjustes titulo="Datos personales" icono="󰓝" cssClasses={["account-card"]}>
        <FilaAjuste titulo="Nombre de usuario" informacion="Identificador usado para iniciar sesión."
          cssClasses={["account-row"]} maxCaracteresInformacion={38}>
          <box cssClasses={["account-controls"]}>
            <EntradaTextoAjustes text={currentUser}
              onChanged={(entry) => setLoginName(entry.get_text())} hexpand />
          </box>
        </FilaAjuste>
        <FilaAjuste titulo="Nombre completo" informacion="Nombre visible asociado a la cuenta."
          cssClasses={["account-row"]} maxCaracteresInformacion={38}>
          <box cssClasses={["account-controls"]}>
            <EntradaTextoAjustes placeholderText="Opcional"
              onChanged={(entry) => setFullName(entry.get_text())} hexpand />
          </box>
        </FilaAjuste>
      </TarjetaAjustes>

      <TarjetaAjustes titulo="Seguridad" icono="󰌾" cssClasses={["account-card"]}>
        <FilaAjuste titulo="Contraseña" informacion="Cambia la contraseña de inicio de sesión."
          cssClasses={["account-row"]} maxCaracteresInformacion={38}>
          <BotonAjustes
            activo={passwordExpanded}
            onClicked={() => {
              const open = !passwordExpanded.get()
              setPasswordExpanded(open)
              if (!open) { setNewPassword(""); setConfirmPassword("") }
            }}
            label={passwordExpanded((open: boolean) => open ? "Ocultar" : "Cambiar")}
          />
        </FilaAjuste>
        <box visible={passwordExpanded} cssClasses={["account-password-fields"]} orientation={Gtk.Orientation.VERTICAL}>
          <FilaAjuste titulo="Nueva contraseña" informacion="Debe tener al menos 8 caracteres."
            cssClasses={["account-row"]} maxCaracteresInformacion={38}>
            <box cssClasses={["account-controls"]}>{passwordEntry("Nueva contraseña", setNewPassword)}</box>
          </FilaAjuste>
          <FilaAjuste titulo="Confirmar contraseña" informacion="Vuelve a escribir la nueva contraseña."
            cssClasses={["account-row"]} maxCaracteresInformacion={38}>
            <box cssClasses={["account-controls"]}>{passwordEntry("Repetir nueva contraseña", setConfirmPassword)}</box>
          </FilaAjuste>
        </box>
        <FilaAjuste titulo="Autorización administrativa" informacion="Se envía directamente a sudo y no se guarda."
          cssClasses={["account-row"]} maxCaracteresInformacion={38}>
          <box cssClasses={["account-controls"]}>{passwordEntry("Contraseña de administrador", setAdminPassword)}</box>
        </FilaAjuste>
      </TarjetaAjustes>

      <box cssClasses={["account-actions"]} spacing={12} valign={Gtk.Align.CENTER}>
        <With value={notice}>{(state: Notice) => state.text
          ? <label cssClasses={["account-notice", state.kind]} label={`~ ${state.text}`} halign={Gtk.Align.START} wrap xalign={0} hexpand />
          : <box hexpand />}</With>
        <BotonAjustes variante="principal" label="Guardar cambios" onClicked={applyChanges} />
      </box>
    </box>
  )
}
