/**
 * notifications/NotificationItem.tsx
 * Item individual de notificación para el panel principal.
 * Muestra icono, nombre de app, título, cuerpo (2 líneas), timestamp relativo.
 * Hover revela acciones: descartar, silenciar app, marcar leída.
 * Soporta acciones inline (reply para mensajería, acciones D-Bus generales).
 */

import { Gtk, Gdk } from "ags/gtk4"
import { createState } from "ags"
import { execAsync } from "ags/process"
import GLib from "gi://GLib"
import GdkPixbuf from "gi://GdkPixbuf"
import AstalNotifd from "gi://AstalNotifd"
import {
  StoredNotification,
  resolveNotifColor,
  getRelativeTime,
  markRead,
  removeNotification,
  updateAppSettings,
  appSettings,
  selectionMode,
  selectedIds,
  setSelectedIds,
  timeTick,
} from "./store"

// ── Helpers para tipo de notificación ─────────────────────────────────────────

function isMessagingApp(appName: string): boolean {
  const n = appName.toLowerCase()
  return n.includes("whatsapp") || n.includes("telegram") || n.includes("signal") ||
    n.includes("discord") || n.includes("slack") || n.includes("messages") ||
    n.includes("chat") || n.includes("sms") || n.includes("matrix")
}

// ── Componente principal ──────────────────────────────────────────────────────

export default function NotificationItem({ notif }: { notif: StoredNotification }) {
  // Reactive: rule color (meta) > per-app color > system default. Updates live when the
  // user edits an app's global color in settings.
  const color = appSettings((s) => resolveNotifColor(notif, s))
  const iconInfo = resolveIcon(notif.appIcon)
  const appIconWidget = (() => {
    if (!iconInfo) return null
    try {
      let img: Gtk.Image
      if (iconInfo.type === "file") {
        const pb = loadFileIcon(iconInfo.path)
        if (!pb) return null
        img = Gtk.Image.new_from_pixbuf(pb)
      } else {
        img = Gtk.Image.new_from_icon_name(iconInfo.name)
        img.pixel_size = 18
      }
      img.valign = Gtk.Align.CENTER
      img.css_classes = ["notif-app-img"]
      return img
    } catch (_) {
      return null
    }
  })()
  const [actionsOpen, setActionsOpen] = createState(false)
  const [replyOpen, setReplyOpen] = createState(false)
  const [replyText, setReplyText] = createState("")
  const [dismissed, setDismissed] = createState(false)

  const isMessaging = isMessagingApp(notif.appName)
  const isSelected = selectedIds((s) => s?.has(notif.id) ?? false)
  const isMuted = appSettings((s) => s?.[notif.appName]?.muted ?? false)

  // Función para enviar respuesta
  // NOTA: WhatsApp/Telegram no exponen D-Bus reply nativo en Linux.
  // Usamos la acción "reply" del D-Bus si existe, o abrimos la app como fallback.
  function sendReply() {
    const text = replyText.get().trim()
    if (!text) return

    const notifd = AstalNotifd.get_default()
    const liveNotif = notifd.get_notification(notif.id)

    // Intentar con acción D-Bus si existe
    const replyAction = notif.actions.find(a =>
      a.id === "inline-reply" || a.id === "reply" || a.label.toLowerCase().includes("resp")
    )

    if (replyAction && liveNotif) {
      // La notificación D-Bus acepta una acción de reply
      try {
        liveNotif.invoke(replyAction.id)
      } catch (e) {
        // Fallback: abrir la app
        execAsync(["bash", "-c", `xdg-open ${notif.appName.toLowerCase()} || true`]).catch(() => {})
      }
    } else {
      // FALLBACK: No hay API pública de WhatsApp/Telegram para reply sin app nativa.
      // Abrimos la app con la notificación como contexto.
      execAsync(["bash", "-c", `
        app="${notif.appName.toLowerCase()}"
        if command -v "$app" &>/dev/null; then
          "$app" &
        else
          xdg-open . 2>/dev/null || true
        fi
      `]).catch(() => {})
    }

    setReplyText("")
    setReplyOpen(false)
  }

  // Toggle selección en modo múltiple
  function toggleSelect() {
    const sel = new Set(selectedIds.get())
    if (sel.has(notif.id)) {
      sel.delete(notif.id)
    } else {
      sel.add(notif.id)
    }
    setSelectedIds(sel)
  }

  // Al hacer click (no en modo selección), marcar como leída y abrir la notificación
  function handleClick() {
    setActionsOpen(false)
    if (selectionMode.get()) {
      toggleSelect()
      return
    }
    markRead(notif.id)
    // Invocar la acción default si existe
    try {
      const notifd = AstalNotifd.get_default()
      const live = notifd.get_notification(notif.id)
      if (live) live.invoke("default")
    } catch (_) {}
  }

  // La acción "default" es la activación implícita al hacer click (la maneja handleClick),
  // no un botón visible. La excluimos para no renderizar una fila vacía.
  const visibleActions = notif.actions.filter(a => a.id !== "default" && a.label.trim() !== "")

  const unreadIndicator = color((c) => notif.read ? "background: transparent;" : `background: ${c};`)
  const bgTint = color((c) => notif.read ? "" : `background: rgba(${hexToRgb(c)}, 0.06);`)

  return (
    <box
      cssClasses={["notif-item-wrapper"]}
      orientation={Gtk.Orientation.VERTICAL}
      visible={dismissed((d) => !d)}
    >
      <Gtk.GestureClick
        button={3}
        onPressed={() => setActionsOpen(!actionsOpen.get())}
      />

      <box
        cssClasses={notif.read ? ["notif-item"] : ["notif-item", "unread"]}
        css={bgTint}
        spacing={0}
      >
        {/* Barra de no leída (izquierda) */}
        <box
          cssClasses={["notif-unread-bar"]}
          css={unreadIndicator}
        />

        {/* Checkbox de selección (modo selección múltiple) */}
        <box visible={selectionMode((v) => v)} css="margin: 0 6px;">
          <button
            cssClasses={isSelected((s) => s ? ["notif-checkbox", "checked"] : ["notif-checkbox"])}
            onClicked={toggleSelect}
          >
            <label
              cssClasses={["notif-checkbox-icon"]}
              label={isSelected((s) => s ? "󰄵" : "󰄱")}
              css={isSelected((s) => s ? `color: ${color.get()};` : "")}
            />
          </button>
        </box>

        {/* Contenido principal */}
        <button
          cssClasses={["notif-item-btn"]}
          onClicked={handleClick}
          hexpand
        >
          <box orientation={Gtk.Orientation.VERTICAL} spacing={2} hexpand>
            {/* App · Título + timestamp en una fila */}
            <box spacing={4} valign={Gtk.Align.CENTER}>
              {appIconWidget}
              <label
                cssClasses={["notif-app-name"]}
                label={notif.appName}
                halign={Gtk.Align.START}
                ellipsize={3}
                visible={!!notif.appName}
              />
              <label
                cssClasses={["notif-dot"]}
                label="·"
                visible={!!notif.appName && !!(notif.summary)}
              />
              <label
                cssClasses={["notif-summary"]}
                label={stripMarkup(notif.summary)}
                hexpand
                halign={Gtk.Align.START}
                ellipsize={3}
                visible={!!(notif.summary)}
              />
              {!notif.summary && <box hexpand />}
              <label
                cssClasses={["notif-timestamp"]}
                label={timeTick((_) => getRelativeTime(notif.timestamp))}
                halign={Gtk.Align.END}
                valign={Gtk.Align.CENTER}
              />
            </box>
            {/* Body */}
            <label
              cssClasses={["notif-body"]}
              label={stripMarkup(notif.body)}
              halign={Gtk.Align.START}
              wrap={true}
              lines={2}
              ellipsize={3}
              visible={!!(notif.body)}
            />
          </box>
        </button>

        {/* Acciones — visibles con click derecho, animadas con Revealer */}
        <Gtk.Revealer
          revealChild={actionsOpen((v) => v)}
          transitionType={Gtk.RevealerTransitionType.SLIDE_LEFT}
          transitionDuration={150}
          valign={Gtk.Align.CENTER}
        >
          <box cssClasses={["notif-hover-actions"]} spacing={2}>
            {/* Responder (solo apps de mensajería) */}
            {isMessaging && (
              <button
                cssClasses={["notif-action-btn", "reply"]}
                tooltipText="Responder"
                onClicked={() => {
                  setReplyOpen(!replyOpen.get())
                  markRead(notif.id)
                }}
              >
                <label label="󰔈" />
              </button>
            )}

            {/* Silenciar/activar app */}
            <button
              cssClasses={isMuted((m) => m ? ["notif-action-btn", "active"] : ["notif-action-btn"])}
              tooltipText={isMuted((m) => m ? "Activar app" : "Silenciar app")}
              onClicked={() => updateAppSettings(notif.appName, { muted: !appSettings.get()?.[notif.appName]?.muted })}
            >
              <label label={isMuted((m) => m ? "󰂛" : "󰂚")} />
            </button>

            {/* Marcar leída */}
            {!notif.read && (
              <button
                cssClasses={["notif-action-btn"]}
                tooltipText="Marcar leída"
                onClicked={() => markRead(notif.id)}
              >
                <label label="󰄵" />
              </button>
            )}

            {/* Descartar */}
            <button
              cssClasses={["notif-action-btn", "dismiss"]}
              tooltipText="Descartar"
              onClicked={() => {
                setDismissed(true)
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
                  removeNotification(notif.id)
                  return GLib.SOURCE_REMOVE
                })
              }}
            >
              <label label="󰅖" />
            </button>
          </box>
        </Gtk.Revealer>
      </box>

      {/* Acciones D-Bus inline — siempre visibles si existen */}
      {visibleActions.length > 0 && (
        <box
          cssClasses={["notif-dbus-actions"]}
          spacing={4}
          css="padding: 4px 8px 4px 16px;"
        >
          {visibleActions.slice(0, 3).map(action => (
            <button
              cssClasses={["notif-dbus-btn"]}
              onClicked={() => {
                try {
                  const notifd = AstalNotifd.get_default()
                  const live = notifd.get_notification(notif.id)
                  if (live) live.invoke(action.id)
                } catch (_) {}
                markRead(notif.id)
              }}
            >
              <label label={action.label} />
            </button>
          ))}
        </box>
      )}

      {/* Campo de respuesta inline (mensajería) */}
      <box
        cssClasses={["notif-reply-box"]}
        spacing={6}
        visible={replyOpen((v) => v)}
        css="padding: 6px 8px;"
      >
        <Gtk.Entry
          cssClasses={["notif-reply-entry"]}
          placeholderText={`Responder a ${notif.appName}…`}
          hexpand
          onChanged={(self) => setReplyText(self.text)}
          onActivate={sendReply}
        />
        <button
          cssClasses={["notif-reply-send"]}
          onClicked={sendReply}
        >
          <label label="󰕒" css={color((c) => `color: ${c};`)} />
        </button>
        <button
          cssClasses={["notif-reply-cancel"]}
          onClicked={() => setReplyOpen(false)}
        >
          <label label="󰅖" />
        </button>
      </box>
    </box>
  )
}

// ── Utilidades ────────────────────────────────────────────────────────────────

type IconInfo = { type: "name"; name: string } | { type: "file"; path: string }

// App icons repeat across notifications (and across the flat/grouped views), and both
// theme lookups and on-disk decode are comparatively expensive. Memoize both by their
// key so each distinct icon is resolved/decoded at most once for the whole session.
const iconInfoCache = new Map<string, IconInfo | null>()
const pixbufCache = new Map<string, GdkPixbuf.Pixbuf | null>()

/** Decode a file icon at 18px, cached by path (shared Pixbuf, reused across items). */
function loadFileIcon(path: string): GdkPixbuf.Pixbuf | null {
  const cached = pixbufCache.get(path)
  if (cached !== undefined) return cached
  let pb: GdkPixbuf.Pixbuf | null = null
  try { pb = GdkPixbuf.Pixbuf.new_from_file_at_scale(path, 18, 18, true) } catch (_) { pb = null }
  pixbufCache.set(path, pb)
  return pb
}

function resolveIcon(appIcon: string): IconInfo | null {
  const cached = iconInfoCache.get(appIcon)
  if (cached !== undefined) return cached
  const info = resolveIconUncached(appIcon)
  iconInfoCache.set(appIcon, info)
  return info
}

function resolveIconUncached(appIcon: string): IconInfo | null {
  if (!appIcon) return null
  // Ruta de archivo
  if (appIcon.startsWith("/")) {
    return GLib.file_test(appIcon, GLib.FileTest.EXISTS)
      ? { type: "file", path: appIcon }
      : null
  }
  // Nombre en el tema de iconos
  try {
    const display = Gdk.Display.get_default()
    if (!display) return null
    const theme = Gtk.IconTheme.get_for_display(display)
    const candidates = [appIcon, appIcon.toLowerCase(), appIcon.toLowerCase().replace(/[_\s]/g, "-")]
    const found = candidates.find(n => theme.has_icon(n))
    return found ? { type: "name", name: found } : null
  } catch (_) {
    return null
  }
}

function stripMarkup(text: string): string {
  return text
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

function hexToRgb(hex: string): string {
  const h = hex.replace("#", "")
  if (h.length !== 6) return "255,255,255"
  const r = parseInt(h.substring(0, 2), 16)
  const g = parseInt(h.substring(2, 4), 16)
  const b = parseInt(h.substring(4, 6), 16)
  return `${r},${g},${b}`
}
