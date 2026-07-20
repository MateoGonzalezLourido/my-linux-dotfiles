import { Gtk } from "ags/gtk4"
import { With, createState } from "ags"
import Gio from "gi://Gio"
import GLib from "gi://GLib"
import ProfileAvatar from "./ProfileAvatar"
import { AVATAR_PATH, refreshAvatar } from "./avatar"
import { BotonAjustes, EntradaTextoAjustes, FilaAjuste, TarjetaAjustes, TextoInformativo, TituloSeccion } from "./componentes"
import textos from "../../textos/ajustes/cuenta.json" with { type: "json" }
import { formatearTexto } from "../../textos/formatear"

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
          else reject(new Error((stderr ?? textos.avisos.operacionFallida).trim()))
        } catch (error) { reject(error) }
      })
    } catch (error) { reject(error) }
  })
}

function cleanAdminError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/incorrect password|authentication failure|try again/i.test(message)) return textos.avisos.contrasenaAdministradorIncorrecta
  return message.replace(/^sudo:\s*/i, "") || textos.avisos.operacionFallida
}

export default function AccountSection() {
  const currentUser = GLib.get_user_name() || textos.seccion.usuarioPredeterminado
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
    if (!raw) return setNotice({ kind: "error", text: textos.avisos.rutaVacia })
    const path = raw === "~" ? GLib.get_home_dir()
      : raw.startsWith("~/") ? `${GLib.get_home_dir()}/${raw.slice(2)}`
      : raw
    try {
      if (!GLib.path_is_absolute(path)) throw new Error(textos.avisos.rutaInvalida)
      if (!GLib.file_test(path, GLib.FileTest.IS_REGULAR)) throw new Error(textos.avisos.imagenAusente)
      GLib.mkdir_with_parents(GLib.path_get_dirname(AVATAR_PATH), 0o700)
      Gio.File.new_for_path(path).copy(Gio.File.new_for_path(AVATAR_PATH), Gio.FileCopyFlags.OVERWRITE, null, null)
      refreshAvatar()
      setAvatarInput("")
      setNotice({ kind: "ok", text: textos.avisos.fotoActualizada })
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : String(error) })
    }
  }

  const applyChanges = async () => {
    const nextLogin = loginName.get().trim()
    const realName = fullName.get().trim()
    const password = newPassword.get()
    const admin = adminPassword.get()
    if (!admin) return setNotice({ kind: "error", text: textos.avisos.autorizacionRequerida })
    if (!/^[a-z_][a-z0-9_-]{0,31}$/.test(nextLogin)) return setNotice({ kind: "error", text: textos.avisos.usuarioInvalido })
    if (password && password !== confirmPassword.get()) return setNotice({ kind: "error", text: textos.avisos.contrasenasNoCoinciden })
    if (password && password.length < 8) return setNotice({ kind: "error", text: textos.avisos.contrasenaCorta })
    if (nextLogin === currentUser && !realName && !password) return setNotice({ kind: "error", text: textos.avisos.sinCambios })

    setNotice({ kind: "working", text: textos.avisos.aplicando })
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
      setNotice({ kind: "ok", text: nextLogin !== currentUser ? textos.avisos.cuentaActualizadaReinicio : textos.avisos.cuentaActualizada })
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
      <TituloSeccion titulo={textos.seccion.titulo} />

      <TarjetaAjustes titulo={textos.perfil.titulo} icono="󰀄" cssClasses={["account-card"]}>
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
            <TextoInformativo label={formatearTexto(textos.perfil.equipo, { nombre: GLib.get_host_name() })} halign={Gtk.Align.START} />
          </box>
        </box>
        <FilaAjuste titulo={textos.perfil.foto.titulo} informacion={textos.perfil.foto.descripcion}
          cssClasses={["account-row"]} maxCaracteresInformacion={38}>
          <box cssClasses={["account-controls"]} spacing={8} valign={Gtk.Align.CENTER}>
            <EntradaTextoAjustes placeholderText={textos.perfil.foto.placeholder}
              onChanged={(entry) => setAvatarInput(entry.get_text())}
              onActivate={applyAvatar} hexpand />
            <BotonAjustes label={textos.perfil.foto.boton} onClicked={applyAvatar} />
          </box>
        </FilaAjuste>
      </TarjetaAjustes>

      <TarjetaAjustes titulo={textos.datosPersonales.titulo} icono="󰓝" cssClasses={["account-card"]}>
        <FilaAjuste titulo={textos.datosPersonales.usuario.titulo} informacion={textos.datosPersonales.usuario.descripcion}
          cssClasses={["account-row"]} maxCaracteresInformacion={38}>
          <box cssClasses={["account-controls"]}>
            <EntradaTextoAjustes text={currentUser}
              onChanged={(entry) => setLoginName(entry.get_text())} hexpand />
          </box>
        </FilaAjuste>
        <FilaAjuste titulo={textos.datosPersonales.nombreCompleto.titulo} informacion={textos.datosPersonales.nombreCompleto.descripcion}
          cssClasses={["account-row"]} maxCaracteresInformacion={38}>
          <box cssClasses={["account-controls"]}>
            <EntradaTextoAjustes placeholderText={textos.datosPersonales.nombreCompleto.placeholder}
              onChanged={(entry) => setFullName(entry.get_text())} hexpand />
          </box>
        </FilaAjuste>
      </TarjetaAjustes>

      <TarjetaAjustes titulo={textos.seguridad.titulo} icono="󰌾" cssClasses={["account-card"]}>
        <FilaAjuste titulo={textos.seguridad.contrasena.titulo} informacion={textos.seguridad.contrasena.descripcion}
          cssClasses={["account-row"]} maxCaracteresInformacion={38}>
          <BotonAjustes
            activo={passwordExpanded}
            onClicked={() => {
              const open = !passwordExpanded.get()
              setPasswordExpanded(open)
              if (!open) { setNewPassword(""); setConfirmPassword("") }
            }}
            label={passwordExpanded((open: boolean) => open ? textos.seguridad.contrasena.ocultar : textos.seguridad.contrasena.mostrar)}
          />
        </FilaAjuste>
        <box visible={passwordExpanded} cssClasses={["account-password-fields"]} orientation={Gtk.Orientation.VERTICAL}>
          <FilaAjuste titulo={textos.seguridad.nuevaContrasena.titulo} informacion={textos.seguridad.nuevaContrasena.descripcion}
            cssClasses={["account-row"]} maxCaracteresInformacion={38}>
            <box cssClasses={["account-controls"]}>{passwordEntry(textos.seguridad.nuevaContrasena.placeholder, setNewPassword)}</box>
          </FilaAjuste>
          <FilaAjuste titulo={textos.seguridad.confirmarContrasena.titulo} cssClasses={["account-row"]}>
            <box cssClasses={["account-controls"]}>{passwordEntry(textos.seguridad.confirmarContrasena.placeholder, setConfirmPassword)}</box>
          </FilaAjuste>
        </box>
        <FilaAjuste titulo={textos.seguridad.autorizacion.titulo} informacion={textos.seguridad.autorizacion.descripcion}
          cssClasses={["account-row"]} maxCaracteresInformacion={38}>
          <box cssClasses={["account-controls"]}>{passwordEntry(textos.seguridad.autorizacion.placeholder, setAdminPassword)}</box>
        </FilaAjuste>
      </TarjetaAjustes>

      <box cssClasses={["account-actions"]} spacing={12} valign={Gtk.Align.CENTER}>
        <With value={notice}>{(state: Notice) => state.text
          ? <label cssClasses={["account-notice", state.kind]} label={formatearTexto(textos.avisos.formato, { mensaje: state.text })} halign={Gtk.Align.START} wrap xalign={0} hexpand />
          : <box hexpand />}</With>
        <BotonAjustes variante="principal" label={textos.acciones.guardar} onClicked={applyChanges} />
      </box>
    </box>
  )
}
