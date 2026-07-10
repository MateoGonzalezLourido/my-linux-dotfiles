import { Gtk } from "ags/gtk4"
import {
  COLOR_MAP,
  events,
  selectedDate,
  setSelectedDate,
  getAgendaEvents,
  formatTimeRange,
  formatDisplayDate,
  isToday,
  isPast,
  deleteEvent,
} from "./store"
import { openCreateDialog, openEditDialog } from "./EventDialog"
import EmptyState from "../components/EmptyState.tsx"

// ── Group events by date ──────────────────────────────────────────────────────

function groupByDate(evList: ReturnType<typeof getAgendaEvents>) {
  const map = new Map<string, typeof evList>()
  for (const ev of evList) {
    const arr = map.get(ev.date) ?? []
    arr.push(ev)
    map.set(ev.date, arr)
  }
  return map
}

// ── Single event row ──────────────────────────────────────────────────────────

function EventRow(ev: ReturnType<typeof getAgendaEvents>[number]): Gtk.Widget {
  const color   = COLOR_MAP[ev.color] ?? "#7F77DD"
  const timeStr = formatTimeRange(ev)

  const infoChildren: Gtk.Widget[] = [
    (
      <label
        cssClasses={["cal-event-title"]}
        label={ev.title}
        halign={Gtk.Align.START}
        ellipsize={3}
      />
    ) as unknown as Gtk.Widget,
  ]

  if (timeStr) {
    infoChildren.push(
      (
        <label
          cssClasses={["cal-event-time"]}
          label={timeStr}
          halign={Gtk.Align.START}
        />
      ) as unknown as Gtk.Widget
    )
  }

  if (ev.description) {
    infoChildren.push(
      (
        <label
          cssClasses={["cal-event-desc"]}
          label={ev.description}
          halign={Gtk.Align.START}
          ellipsize={3}
        />
      ) as unknown as Gtk.Widget
    )
  }

  const infoBox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL })
  infoBox.set_hexpand(true)
  for (const child of infoChildren) {
    infoBox.append(child)
  }

  return (
    <box cssClasses={["cal-agenda-event-row"]} spacing={10}>
      <box
        cssClasses={["cal-event-color-stripe"]}
        css={`background-color: ${color};`}
        widthRequest={3}
      />
      {infoBox}
      <box cssClasses={["cal-event-actions"]} spacing={4}>
        <button
          cssClasses={["cal-icon-btn", "small"]}
          tooltipText="Editar"
          onClicked={() => openEditDialog(ev)}
        >
          <label label="✎" />
        </button>
        <button
          cssClasses={["cal-icon-btn", "small", "danger"]}
          tooltipText="Eliminar"
          onClicked={() => deleteEvent(ev.id)}
        >
          <label label="✕" />
        </button>
      </box>
    </box>
  ) as unknown as Gtk.Widget
}

// ── Date section header ───────────────────────────────────────────────────────

function DateHeader(dateStr: string): Gtk.Widget {
  const today   = isToday(dateStr)
  const past    = isPast(dateStr)
  const display = formatDisplayDate(dateStr)
  const cls: string[] = ["cal-agenda-date-header"]
  if (today) cls.push("today")
  if (past)  cls.push("past")

  return (
    <box cssClasses={cls} spacing={8}>
      <label
        cssClasses={["cal-agenda-date-label"]}
        label={today ? `${display} · Hoy` : display}
        halign={Gtk.Align.START}
      />
    </box>
  ) as unknown as Gtk.Widget
}

// ── Agenda header ─────────────────────────────────────────────────────────────

function AgendaHeader(): Gtk.Widget {
  return (
    <box cssClasses={["cal-agenda-header"]} spacing={8}>
      <label
        cssClasses={["cal-agenda-title"]}
        label="Agenda"
        hexpand
        halign={Gtk.Align.START}
      />
      <button
        cssClasses={["cal-btn", "cal-btn-primary", "small"]}
        tooltipText="Nuevo evento en la fecha seleccionada"
        onClicked={() => openCreateDialog(selectedDate.get())}
      >
        <label label="+ Nuevo" />
      </button>
    </box>
  ) as unknown as Gtk.Widget
}

// ── Main AgendaView ───────────────────────────────────────────────────────────

export function AgendaView(): Gtk.Widget {
  const scrollContent = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 0 })
  scrollContent.set_css_classes(["cal-agenda-list"])

  function rebuild() {
    const fromDate = selectedDate.get()
    const evList   = getAgendaEvents(fromDate, 90)
    const grouped  = groupByDate(evList)

    // Clear
    let child = scrollContent.get_first_child()
    while (child) {
      const next = child.get_next_sibling()
      scrollContent.remove(child)
      child = next
    }

    if (grouped.size === 0) {
      scrollContent.append(EmptyState({
        icon: "📅",
        title: "Sin eventos próximos",
        subtitle: "Haz click en un día del calendario para añadir uno",
        wrapClass: "cal-agenda-empty",
        iconClass: "cal-empty-icon",
        titleClass: "cal-empty-title",
        subClass: "cal-empty-sub",
      }))
      return
    }

    const sortedDates = [...grouped.keys()].sort()

    for (const date of sortedDates) {
      const dayEvs = grouped.get(date)!

      scrollContent.append(DateHeader(date))

      const evBox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 4 })
      evBox.set_css_classes(["cal-agenda-day-events"])
      for (const ev of dayEvs) {
        evBox.append(EventRow(ev))
      }
      scrollContent.append(evBox)

      // Separator
      const sep = new Gtk.Box()
      sep.set_css_classes(["cal-agenda-separator"])
      sep.set_size_request(-1, 1)
      scrollContent.append(sep)
    }
  }

  events.subscribe(rebuild)
  selectedDate.subscribe(rebuild)
  rebuild()

  const scroll = new Gtk.ScrolledWindow()
  scroll.set_vexpand(true)
  scroll.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.AUTOMATIC)
  scroll.set_child(scrollContent)

  return (
    <box cssClasses={["cal-agenda-view"]} orientation={Gtk.Orientation.VERTICAL} spacing={0}>
      {AgendaHeader()}
      {scroll}
    </box>
  ) as unknown as Gtk.Widget
}
