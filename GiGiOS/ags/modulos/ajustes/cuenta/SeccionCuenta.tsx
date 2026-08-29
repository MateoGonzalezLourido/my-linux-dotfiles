import { Gtk } from "ags/gtk4"
import { With, createState } from "ags"
import Gio from "gi://Gio"
import GLib from "gi://GLib"
import ProfileAvatar from "../ProfileAvatar"
import { withPrivilegedPrompt } from "../../../estado/shell"
import { importarFotoPerfil, refreshAvatar } from "./avatar"
import { BotonAjustes, EntradaTextoAjustes, FilaAjuste, TarjetaAjustes, TextoInformativo, TituloSeccion } from "../componentes"
import textos from "../../../textos/ajustes/cuenta.json" with { type: "json" }
import { formatearTexto } from "../../../textos/formatear"

type Notice = { kind: "idle" | "working" | "ok" | "error"; text: string }

// Los tres cambios de cuenta (nombre completo, contraseña, login) van en UNA sola
// escalada de privilegios. Antes había un campo "Autorización administrativa" en la
// propia sección y cada orden salía por `sudo -S` con esa contraseña por stdin: un
// segundo sitio donde teclear la contraseña de root, cuando polkit ya abre su propio
// diálogo. Ahora es `pkexec`, como el resto de Ajustes (fechaHora.ts, printers.ts,
// disco/limpieza.ts).
//
// Dos detalles que no son opcionales:
//   - Los valores viajan como ARGUMENTOS ("$1", "$2"…), nunca interpolados en el
//     script: un nombre completo con comillas o `$(...)` sería inyección de shell
//     ejecutada como root. pkexec además limpia el entorno, así que por variables
//     tampoco valdría.
//   - La contraseña nueva viaja por STDIN y no por argv, donde cualquiera la vería
//     en `ps`. `chpasswd` la lee de la misma línea.
const GUION_CUENTA = `
set -e
usuario="$1"; nombre="$2"; nuevo_login="$3"; cambiar_pass="$4"
if [ -n "$nombre" ]; then usermod -c "$nombre" "$usuario"; fi
if [ "$cambiar_pass" = "1" ]; then
  IFS= read -r pass
  printf '%s:%s\\n' "$usuario" "$pass" | chpasswd
fi
if [ "$nuevo_login" != "$usuario" ]; then usermod -l "$nuevo_login" "$usuario"; fi
exit 0
`

function ejecutarComoAdministrador(argumentos: string[], entrada: string): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      const flags = Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
      // El "bash" repetido es $0: pkexec lo pasa tal cual y sin él el primer valor
      // real se perdería como nombre del programa en vez de llegar como "$1".
      const proceso = Gio.Subprocess.new(["pkexec", "bash", "-c", GUION_CUENTA, "bash", ...argumentos], flags)
      proceso.communicate_utf8_async(entrada, null, (proc, result) => {
        try {
          const [, stdout, stderr] = proc.communicate_utf8_finish(result)
          if (proc.get_successful()) return resolve((stdout ?? "").trim())
          // 126 = el usuario cerró el diálogo o falló la autenticación;
          // 127 = polkit no le autoriza. Ninguno de los dos deja stderr útil.
          const codigo = proc.get_exit_status()
          if (codigo === 126 || codigo === 127) return reject(new Error(textos.avisos.autorizacionCancelada))
          reject(new Error((stderr ?? "").trim() || textos.avisos.operacionFallida))
        } catch (error) { reject(error) }
      })
    } catch (error) { reject(error) }
  })
}

function limpiarErrorAdministrador(error: unknown): string {
  const mensaje = error instanceof Error ? error.message : String(error)
  return mensaje.replace(/^(usermod|chpasswd|pkexec):\s*/i, "").trim() || textos.avisos.operacionFallida
}

export default function SeccionCuenta() {
  const currentUser = GLib.get_user_name() || textos.seccion.usuarioPredeterminado
  const [loginName, setLoginName] = createState(currentUser)
  const [fullName, setFullName] = createState("")
  const [newPassword, setNewPassword] = createState("")
  const [confirmPassword, setConfirmPassword] = createState("")
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
      // No es una copia del original: se recorta cuadrado y se reduce (ver avatar.ts).
      importarFotoPerfil(path)
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
    if (!/^[a-z_][a-z0-9_-]{0,31}$/.test(nextLogin)) return setNotice({ kind: "error", text: textos.avisos.usuarioInvalido })
    if (password && password !== confirmPassword.get()) return setNotice({ kind: "error", text: textos.avisos.contrasenasNoCoinciden })
    if (password && password.length < 8) return setNotice({ kind: "error", text: textos.avisos.contrasenaCorta })
    if (nextLogin === currentUser && !realName && !password) return setNotice({ kind: "error", text: textos.avisos.sinCambios })

    setNotice({ kind: "working", text: textos.avisos.aplicando })
    try {
      // withPrivilegedPrompt aparta la ventana de Ajustes mientras polkit pide la
      // contraseña: es una capa OVERLAY y taparía el diálogo, que es un toplevel
      // normal. Mismo envoltorio que fechaHora.ts y printers.ts.
      await withPrivilegedPrompt(() => ejecutarComoAdministrador(
        [currentUser, realName, nextLogin, password ? "1" : "0"],
        password ? `${password}\n` : "",
      ))
      setNewPassword("")
      setConfirmPassword("")
      setNotice({ kind: "ok", text: nextLogin !== currentUser ? textos.avisos.cuentaActualizadaReinicio : textos.avisos.cuentaActualizada })
    } catch (error) {
      setNotice({ kind: "error", text: limpiarErrorAdministrador(error) })
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
