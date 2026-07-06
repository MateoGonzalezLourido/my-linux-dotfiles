import { Gtk } from "ags/gtk4"
import { createState } from "ags"
import {
  CalendarEvent,
  EventColor,
  EVENT_COLORS,
  COLOR_MAP,
  addEvent,
  updateEvent,
  formatDisplayDate,
} from "./store"

// ── Dialog state ─────────────────────────────────────────────────────────────

interface DialogState {
  open: boolean
  mode: "create" | "edit"
  date: string
  event?: CalendarEvent
}

export const [dialogState, setDialogState] = createState<DialogState>({
  open: false,
  mode: "create",
  date: "",
})

export function openCreateDialog(date: string) {
  setDialogState({ open: true, mode: "create", date })
}

export function openEditDialog(event: CalendarEvent) {
  setDialogState({ open: true, mode: "edit", date: event.date, event })
}

export function closeDialog() {
  setDialogState({ open: false, mode: "create", date: "" })
}

// ── Form fields ───────────────────────────────────────────────────────────────

const [fTitle, setFTitle]             = createState("")
const [fDate, setFDate]               = createState("")
const [fStartTime, setFStartTime]     = createState("")
const [fEndTime, setFEndTime]         = createState("")
const [fColor, setFColor]             = createState<EventColor>("purple")
const [fAllDay, setFAllDay]           = createState(true)
const [fDescription, setFDescription] = createState("")

function resetForm(state: DialogState) {
  if (state.mode === "edit" && state.event) {
    const e = state.event
    setFTitle(e.title)
    setFDate(e.date)
    setFStartTime(e.startTime ?? "")
    setFEndTime(e.endTime ?? "")
    setFColor(e.color)
    setFAllDay(e.allDay)
    setFDescription(e.description ?? "")
  } else {
    setFTitle("")
    setFDate(state.date)
    setFStartTime("")
    setFEndTime("")
    setFColor("purple")
    setFAllDay(true)
    setFDescription("")
  }
}

function submit(mode: "create" | "edit", eventId?: string) {
  const title = fTitle.get().trim()
  if (!title) return

  const data = {
    title,
    date: fDate.get(),
    startTime: fAllDay.get() ? undefined : (fStartTime.get() || undefined),
    endTime:   fAllDay.get() ? undefined : (fEndTime.get() || undefined),
    color: fColor.get(),
    allDay: fAllDay.get(),
    description: fDescription.get().trim() || undefined,
  }

  if (mode === "create") {
    addEvent(data)
  } else if (eventId) {
    updateEvent(eventId, data)
  }
  closeDialog()
}

// ── Color swatch ──────────────────────────────────────────────────────────────

function ColorSwatch(color: EventColor): Gtk.Widget {
  const btn = new Gtk.Button()
  const initialCls = ["cal-color-swatch", `cal-color-${color}`]
  if (fColor.get() === color) initialCls.push("active")
  btn.set_css_classes(initialCls)
  btn.connect("clicked", () => setFColor(color))

  fColor.subscribe((c) => {
    const cls = ["cal-color-swatch", `cal-color-${color}`]
    if (c === color) cls.push("active")
    btn.set_css_classes(cls)
  })

  return btn
}

// ── Time row ──────────────────────────────────────────────────────────────────

function TimeRow(): Gtk.Widget {
  const startEntry = new Gtk.Entry()
  startEntry.set_placeholder_text("HH:MM")
  startEntry.set_css_classes(["cal-form-entry", "cal-time-entry"])
  startEntry.set_text(fStartTime.get())
  startEntry.set_sensitive(!fAllDay.get())
  startEntry.connect("changed", () => setFStartTime(startEntry.get_text()))

  const endEntry = new Gtk.Entry()
  endEntry.set_placeholder_text("HH:MM")
  endEntry.set_css_classes(["cal-form-entry", "cal-time-entry"])
  endEntry.set_text(fEndTime.get())
  endEntry.set_sensitive(!fAllDay.get())
  endEntry.connect("changed", () => setFEndTime(endEntry.get_text()))

  fAllDay.subscribe((v) => {
    startEntry.set_sensitive(!v)
    endEntry.set_sensitive(!v)
  })

  dialogState.subscribe((s) => {
    if (s.open) {
      startEntry.set_text(fStartTime.get())
      endEntry.set_text(fEndTime.get())
    }
  })

  return (
    <box cssClasses={["cal-time-row"]} spacing={8}>
      {startEntry}
      <label label="–" cssClasses={["cal-time-sep"]} />
      {endEntry}
    </box>
  ) as unknown as Gtk.Widget
}

// ── Main EventDialog ──────────────────────────────────────────────────────────

export function EventDialog(): Gtk.Widget {
  // Title entry
  const titleEntry = new Gtk.Entry()
  titleEntry.set_placeholder_text("Título del evento")
  titleEntry.set_css_classes(["cal-form-entry", "cal-title-entry"])
  titleEntry.connect("changed", () => setFTitle(titleEntry.get_text()))
  titleEntry.connect("activate", () => {
    const s = dialogState.get()
    submit(s.mode, s.event?.id)
  })

  // Date entry
  const dateEntry = new Gtk.Entry()
  dateEntry.set_placeholder_text("YYYY-MM-DD")
  dateEntry.set_css_classes(["cal-form-entry"])
  dateEntry.set_hexpand(true)
  dateEntry.connect("changed", () => setFDate(dateEntry.get_text()))

  // All day switch
  const allDaySwitch = new Gtk.Switch()
  allDaySwitch.set_active(fAllDay.get())
  allDaySwitch.connect("notify::active", () => setFAllDay(allDaySwitch.get_active()))

  // Description entry
  const descEntry = new Gtk.Entry()
  descEntry.set_placeholder_text("Descripción (opcional)")
  descEntry.set_css_classes(["cal-form-entry"])
  descEntry.connect("changed", () => setFDescription(descEntry.get_text()))

  // Dialog title label
  const dialogTitleLabel = new Gtk.Label()
  dialogTitleLabel.set_css_classes(["cal-dialog-title"])
  dialogTitleLabel.set_halign(Gtk.Align.START)
  dialogTitleLabel.set_hexpand(true)
  dialogTitleLabel.set_label("Nuevo evento")

  // Submit label
  const submitLabel = new Gtk.Label({ label: "Guardar" })

  // Subscribe to dialog state to sync form
  dialogState.subscribe((s) => {
    if (s.open) {
      resetForm(s)
      // Sync entry widgets from form state (after resetForm has set state)
      titleEntry.set_text(fTitle.get())
      dateEntry.set_text(fDate.get())
      descEntry.set_text(fDescription.get())
      allDaySwitch.set_active(fAllDay.get())
      dialogTitleLabel.set_label(
        s.mode === "create"
          ? `Nuevo evento · ${formatDisplayDate(s.date)}`
          : "Editar evento"
      )
      submitLabel.set_label(s.mode === "create" ? "Guardar" : "Actualizar")
    }
  })

  // Color swatches
  const colorSwatches = EVENT_COLORS.map(ColorSwatch)
  const colorRow = new Gtk.Box({ spacing: 6 })
  colorRow.set_css_classes(["cal-color-row"])
  for (const sw of colorSwatches) {
    colorRow.append(sw)
  }

  // Backdrop box (shown/hidden)
  const backdropBox = new Gtk.Box()
  backdropBox.set_css_classes(["cal-dialog-backdrop"])
  backdropBox.set_visible(false)
  backdropBox.set_halign(Gtk.Align.CENTER)
  backdropBox.set_valign(Gtk.Align.CENTER)
  backdropBox.set_hexpand(true)
  backdropBox.set_vexpand(true)

  dialogState.subscribe((s) => {
    backdropBox.set_visible(s.open)
  })

  const cardBox = (
    <box cssClasses={["cal-dialog-card"]} orientation={Gtk.Orientation.VERTICAL} spacing={12}>
      {/* Header */}
      <box cssClasses={["cal-dialog-header"]}>
        {dialogTitleLabel}
        <button cssClasses={["cal-icon-btn"]} onClicked={closeDialog}>
          <label label="✕" />
        </button>
      </box>

      {/* Title entry */}
      {titleEntry}

      {/* Date row */}
      <box cssClasses={["cal-form-row"]} spacing={8}>
        <label label="Fecha" cssClasses={["cal-form-label"]} halign={Gtk.Align.START} />
        {dateEntry}
      </box>

      {/* All day toggle */}
      <box cssClasses={["cal-form-row"]} spacing={8}>
        <label label="Todo el día" cssClasses={["cal-form-label"]} halign={Gtk.Align.START} hexpand />
        {allDaySwitch}
      </box>

      {/* Time range */}
      {TimeRow()}

      {/* Description */}
      {descEntry}

      {/* Color picker */}
      {colorRow}

      {/* Actions */}
      <box cssClasses={["cal-dialog-actions"]} spacing={8}>
        <button
          cssClasses={["cal-btn", "cal-btn-secondary"]}
          hexpand
          onClicked={closeDialog}
        >
          <label label="Cancelar" />
        </button>
        <button
          cssClasses={["cal-btn", "cal-btn-primary"]}
          hexpand
          onClicked={() => {
            const s = dialogState.get()
            submit(s.mode, s.event?.id)
          }}
        >
          {submitLabel}
        </button>
      </box>
    </box>
  ) as unknown as Gtk.Widget

  backdropBox.append(cardBox)

  return backdropBox
}
