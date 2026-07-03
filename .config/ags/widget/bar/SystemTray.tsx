import app from "ags/gtk4/app"
import AstalTray from "gi://AstalTray"
import Gio from "gi://Gio"
import GLib from "gi://GLib"
import { Astal, Gtk, Gdk } from "ags/gtk4"
import { createBinding, createState, For, With } from "ags"
import {
  closeAllPanels,
  panelAutoClose,
  setTrayMenuVisible,
  trayMenuVisible,
} from "../state"

const ACTION_GROUP_NAMES = ["dbusmenu", "tray", "indicator", "item", "app", "unity"]

const [activeTrayItem, setActiveTrayItem] = createState<AstalTray.TrayItem | null>(null)

function closeTrayMenu() {
  setTrayMenuVisible(false)
  setActiveTrayItem(null)
}

function toggleTrayMenu(item: AstalTray.TrayItem) {
  const sameItemOpen = trayMenuVisible.get() && activeTrayItem.get()?.itemId === item.itemId

  if (sameItemOpen) {
    closeTrayMenu()
    return
  }

  closeAllPanels()
  try { item.about_to_show() } catch (_) {}
  setActiveTrayItem(item)
  setTrayMenuVisible(true)
}

function insertTrayActions(widget: Gtk.Widget, actionGroup: Gio.ActionGroup | null) {
  for (const name of ACTION_GROUP_NAMES) {
    widget.insert_action_group(name, actionGroup)
  }
}

function variantToString(value: GLib.Variant | null): string | null {
  if (!value) return null

  try {
    const unpacked = value.deep_unpack()
    return typeof unpacked === "string" ? unpacked : String(unpacked)
  } catch (_) {
    return null
  }
}

function menuLabel(model: Gio.MenuModel, index: number): string | null {
  const label = variantToString(model.get_item_attribute_value(index, "label", null))
  return label?.replace(/_/g, "").trim() || null
}

function menuAction(model: Gio.MenuModel, index: number): string | null {
  return variantToString(model.get_item_attribute_value(index, "action", null))
}

function localActionName(action: string): string {
  for (const prefix of ACTION_GROUP_NAMES) {
    const fullPrefix = `${prefix}.`
    if (action.startsWith(fullPrefix)) return action.slice(fullPrefix.length)
  }

  return action
}

function activateTrayAction(action: string, target: GLib.Variant | null) {
  const actionGroup = activeTrayItem.get()?.actionGroup
  if (!actionGroup) return

  const localName = localActionName(action)
  const candidates = localName === action ? [action] : [localName, action]

  try {
    const name = candidates.find((candidate) => {
      try { return actionGroup.has_action(candidate) } catch (_) { return false }
    }) ?? candidates[0]

    actionGroup.activate_action(name, target)
  } catch (error) {
    console.error(`[tray] failed to activate action ${action}:`, error)
  }
}

function TrayMenuHeader({ label, depth }: { label: string; depth: number }) {
  return (
    <label
      cssClasses={depth > 0 ? ["tray-menu-header", "nested"] : ["tray-menu-header"]}
      label={label}
      xalign={0}
    />
  )
}

function TrayMenuSeparator() {
  return <Gtk.Separator orientation={Gtk.Orientation.HORIZONTAL} cssClasses={["tray-menu-separator"]} />
}

function TrayMenuButton({
  label,
  action,
  target,
  depth,
  fallback,
}: {
  label: string
  action: string | null
  target: GLib.Variant | null
  depth: number
  fallback?: () => void
}) {
  return (
    <button
      cssClasses={depth > 0 ? ["fn-menu-button", "tray-menu-button", "nested"] : ["fn-menu-button", "tray-menu-button"]}
      focusable={false}
      sensitive={Boolean(action || fallback)}
      $={(self) => {
        self.connect("clicked", () => {
          if (action) activateTrayAction(action, target)
          else if (fallback) fallback()
          closeTrayMenu()
        })
      }}
    >
      <box cssClasses={["fn-menu-row", "tray-menu-row"]} spacing={8}>
        <label
          cssClasses={["fn-menu-label", "tray-menu-label"]}
          label={label}
          xalign={0}
          hexpand
          ellipsize={3}
        />
      </box>
    </button>
  )
}

function TrayMenuModel({ model, depth = 0 }: { model: Gio.MenuModel; depth?: number }) {
  const rows = []
  const total = model.get_n_items()

  for (let index = 0; index < total; index++) {
    const label = menuLabel(model, index)
    const section = model.get_item_link(index, "section")
    const submenu = model.get_item_link(index, "submenu")

    if (section) {
      if (index > 0) rows.push(<TrayMenuSeparator />)
      if (label) rows.push(<TrayMenuHeader label={label} depth={depth} />)
      rows.push(<TrayMenuModel model={section} depth={depth} />)
      continue
    }

    if (submenu) {
      if (index > 0) rows.push(<TrayMenuSeparator />)
      if (label) rows.push(<TrayMenuHeader label={label} depth={depth} />)
      rows.push(<TrayMenuModel model={submenu} depth={depth + 1} />)
      continue
    }

    const action = menuAction(model, index)
    if (!label && !action) continue

    rows.push(
      <TrayMenuButton
        label={label ?? action ?? ""}
        action={action}
        target={model.get_item_attribute_value(index, "target", null)}
        depth={depth}
      />
    )
  }

  return <box orientation={Gtk.Orientation.VERTICAL}>{rows}</box>
}

function TrayMenuContent({ item }: { item: AstalTray.TrayItem }) {
  const model = item.menuModel

  return (
    <box cssClasses={["fn-menu", "tray-menu"]} orientation={Gtk.Orientation.VERTICAL}>
      <label
        cssClasses={["fn-menu-header", "tray-menu-title"]}
        label={item.title || item.id || "Aplicación"}
        xalign={0}
      />
      {model && model.get_n_items() > 0 ? (
        <TrayMenuModel model={model} />
      ) : (
        <TrayMenuButton
          label="Abrir"
          action={null}
          target={null}
          depth={0}
          fallback={() => item.activate(0, 0)}
        />
      )}
    </box>
  )
}

export function SystemTrayMenu(gdkmonitor: Gdk.Monitor) {
  const { TOP, RIGHT } = Astal.WindowAnchor
  const autoClose = panelAutoClose(closeTrayMenu, 300, trayMenuVisible)

  return (
    <window
      name="system-tray-menu"
      visible={trayMenuVisible}
      gdkmonitor={gdkmonitor}
      layer={Astal.Layer.TOP}
      exclusivity={Astal.Exclusivity.NORMAL}
      keymode={Astal.Keymode.ON_DEMAND}
      anchor={TOP | RIGHT}
      application={app}
      widthRequest={230}
      marginTop={37}
      marginRight={126}
      decorated={false}
      cssClasses={["fn-menu-window", "tray-menu-window"]}
      $={(self) => {
        insertTrayActions(self, activeTrayItem.get()?.actionGroup ?? null)
        activeTrayItem.subscribe((item) => {
          insertTrayActions(self, item?.actionGroup ?? null)
        })
      }}
    >
      <Gtk.EventControllerKey
        onKeyPressed={(_self, keyval) => {
          if (keyval === Gdk.KEY_Escape) {
            closeTrayMenu()
            return true
          }
          return false
        }}
      />
      <box orientation={Gtk.Orientation.VERTICAL}>
        <Gtk.EventControllerMotion onEnter={autoClose.onEnter} onLeave={autoClose.onLeave} />
        <With value={activeTrayItem}>
          {(item) => item ? <TrayMenuContent item={item} /> : <box />}
        </With>
      </box>
    </window>
  )
}

export default function SystemTray() {
  const tray  = AstalTray.get_default()
  const items = createBinding(tray, "items")

  return (
    <box spacing={2}>
      <For each={items}>
        {(item) => (
          <button
            cssName="icon-bare"
            cssClasses={["tray-item"]}
            focusable={false}
            tooltipMarkup={createBinding(item, "tooltipMarkup")}
            onClicked={() => toggleTrayMenu(item)}
          >
            <image
              gicon={createBinding(item, "gicon")}
              pixelSize={17}
            />
          </button>
        )}
      </For>
    </box>
  )
}
