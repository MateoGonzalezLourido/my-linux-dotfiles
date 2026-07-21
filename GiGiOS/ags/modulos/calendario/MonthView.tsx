import { Gtk } from "ags/gtk4"
import {
  MONTHS,
  WDAYS_SHORT,
  COLOR_MAP,
  getDaysInMonth,
  getFirstDOW,
  getEventsForMonth,
  dateKey,
  isToday,
  calViewDate,
  setCalViewDate,
  selectedDate,
  setSelectedDate,
  events,
} from "./store"
import { openCreateDialog } from "./EventDialog"

// ── Day cell ─────────────────────────────────────────────────────────────────

function DayCell({
  day,
  dateStr,
  otherMonth,
  isCurrentDay,
  isSelected,
  eventColors,
}: {
  day: number
  dateStr: string
  otherMonth: boolean
  isCurrentDay: boolean
  isSelected: boolean
  eventColors: string[]
}) {
  const cls: string[] = ["cal-day-cell"]
  if (otherMonth)   cls.push("other-month")
  if (isCurrentDay) cls.push("today")
  if (isSelected)   cls.push("selected")

  const dotsBox = eventColors.length > 0
    ? (
        <box cssClasses={["cal-event-dots"]} halign={Gtk.Align.CENTER} spacing={2}>
          {eventColors.slice(0, 4).map((color) => (
            <box
              cssClasses={["cal-event-dot"]}
              css={`background-color: ${color};`}
              widthRequest={5}
              heightRequest={5}
            />
          ))}
        </box>
      )
    : null

  return (
    <button
      cssClasses={cls}
      onClicked={() => {
        setSelectedDate(dateStr)
        if (!otherMonth) openCreateDialog(dateStr)
      }}
      tooltipText={isCurrentDay ? "Hoy" : ""}
    >
      <box orientation={Gtk.Orientation.VERTICAL} spacing={2}>
        <label
          cssClasses={["cal-day-num"]}
          label={String(day)}
          halign={Gtk.Align.CENTER}
        />
        {dotsBox}
      </box>
    </button>
  )
}

// ── Month grid (rebuilt on state change) ─────────────────────────────────────

function buildGrid(
  year: number,
  month: number,
  selDate: string,
  evMap: Map<string, any[]>
): Gtk.Widget[] {
  const firstDOW  = getFirstDOW(year, month)
  const daysInMon = getDaysInMonth(year, month)
  const prevDays  = getDaysInMonth(year, month - 1 < 0 ? 11 : month - 1)
  const cells: Gtk.Widget[] = []

  // Padding from prev month
  for (let i = firstDOW - 1; i >= 0; i--) {
    const d   = prevDays - i
    const py  = month === 0 ? year - 1 : year
    const pm  = month === 0 ? 11 : month - 1
    const key = dateKey(py, pm, d)
    cells.push(
      DayCell({
        day: d,
        dateStr: key,
        otherMonth: true,
        isCurrentDay: isToday(key),
        isSelected: key === selDate,
        eventColors: [],
      }) as unknown as Gtk.Widget
    )
  }

  // Current month
  for (let d = 1; d <= daysInMon; d++) {
    const key    = dateKey(year, month, d)
    const evs    = evMap.get(key) ?? []
    const colors = evs.map((e) => COLOR_MAP[e.color as keyof typeof COLOR_MAP])
    cells.push(
      DayCell({
        day: d,
        dateStr: key,
        otherMonth: false,
        isCurrentDay: isToday(key),
        isSelected: key === selDate,
        eventColors: colors,
      }) as unknown as Gtk.Widget
    )
  }

  // Next month padding
  const total   = firstDOW + daysInMon
  const padding = (7 - (total % 7)) % 7
  for (let d = 1; d <= padding; d++) {
    const ny  = month === 11 ? year + 1 : year
    const nm  = month === 11 ? 0 : month + 1
    const key = dateKey(ny, nm, d)
    cells.push(
      DayCell({
        day: d,
        dateStr: key,
        otherMonth: true,
        isCurrentDay: isToday(key),
        isSelected: key === selDate,
        eventColors: [],
      }) as unknown as Gtk.Widget
    )
  }

  return cells
}

// ── Header (nav) ─────────────────────────────────────────────────────────────

function NavHeader(): Gtk.Widget {
  const monthLabel = new Gtk.Label()
  monthLabel.set_css_classes(["cal-month-title"])
  monthLabel.set_hexpand(true)
  monthLabel.set_halign(Gtk.Align.START)

  const { year, month } = calViewDate.get()
  monthLabel.set_label(`${MONTHS[month]} ${year}`)

  calViewDate.subscribe(({ year, month }) => {
    monthLabel.set_label(`${MONTHS[month]} ${year}`)
  })

  return (
    <box cssClasses={["cal-month-nav"]} spacing={8}>
      {monthLabel}
      <button
        cssClasses={["cal-icon-btn"]}
        tooltipText="Hoy"
        onClicked={() => {
          const now = new Date()
          setCalViewDate({ year: now.getFullYear(), month: now.getMonth() })
          setSelectedDate(dateKey(now.getFullYear(), now.getMonth(), now.getDate()))
        }}
      >
        <label label="Hoy" cssClasses={["cal-today-label"]} />
      </button>
      <button
        cssClasses={["cal-icon-btn"]}
        tooltipText="Mes anterior"
        onClicked={() => {
          const { year, month } = calViewDate.get()
          setCalViewDate(
            month === 0
              ? { year: year - 1, month: 11 }
              : { year, month: month - 1 }
          )
        }}
      >
        <label label="‹" />
      </button>
      <button
        cssClasses={["cal-icon-btn"]}
        tooltipText="Mes siguiente"
        onClicked={() => {
          const { year, month } = calViewDate.get()
          setCalViewDate(
            month === 11
              ? { year: year + 1, month: 0 }
              : { year, month: month + 1 }
          )
        }}
      >
        <label label="›" />
      </button>
    </box>
  ) as unknown as Gtk.Widget
}

// ── Weekday headers ───────────────────────────────────────────────────────────

function WeekdayHeaders(): Gtk.Widget {
  const grid = new Gtk.Grid()
  grid.set_css_classes(["cal-weekday-headers"])

  WDAYS_SHORT.forEach((w, i) => {
    const lbl = new Gtk.Label({ label: w })
    lbl.set_css_classes(["cal-wd-label"])
    grid.attach(lbl, i, 0, 1, 1)
  })

  return grid
}

// ── Main MonthView ────────────────────────────────────────────────────────────

export function MonthView(): Gtk.Widget {
  const gridBox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL })
  gridBox.set_css_classes(["cal-month-grid"])

  function rebuild() {
    const { year, month } = calViewDate.get()
    const selDate = selectedDate.get()
    const evMap   = getEventsForMonth(year, month)

    // Remove existing children
    let child = gridBox.get_first_child()
    while (child) {
      const next = child.get_next_sibling()
      gridBox.remove(child)
      child = next
    }

    const cells = buildGrid(year, month, selDate, evMap)
    const grid  = new Gtk.Grid()
    grid.set_css_classes(["cal-days-grid"])

    cells.forEach((cell, idx) => {
      const col = idx % 7
      const row = Math.floor(idx / 7)
      grid.attach(cell, col, row, 1, 1)
    })

    gridBox.append(grid)
  }

  calViewDate.subscribe(rebuild)
  selectedDate.subscribe(rebuild)
  events.subscribe(rebuild)
  rebuild()

  return (
    <box cssClasses={["cal-month-view"]} orientation={Gtk.Orientation.VERTICAL} spacing={0}>
      {NavHeader()}
      {WeekdayHeaders()}
      {gridBox}
    </box>
  ) as unknown as Gtk.Widget
}
