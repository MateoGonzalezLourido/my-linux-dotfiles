import GLib from "gi://GLib"
import Gio from "gi://Gio"
import { createState } from "ags"

// ── Types ────────────────────────────────────────────────────────────────────

export type EventColor =
  | "purple"
  | "teal"
  | "red"
  | "amber"
  | "blue"
  | "pink"

export interface CalendarEvent {
  id: string
  title: string
  date: string       // "YYYY-MM-DD"
  startTime?: string // "HH:MM" optional
  endTime?: string   // "HH:MM" optional
  color: EventColor
  description?: string
  allDay: boolean
}

export type CalendarView = "month" | "agenda"

// ── Persistence ──────────────────────────────────────────────────────────────

const DATA_PATH = `${GLib.get_home_dir()}/.config/ags/calendar-events.json`

function ensureDir() {
  const dir = Gio.File.new_for_path(`${GLib.get_home_dir()}/.config/ags`)
  if (!dir.query_exists(null)) {
    dir.make_directory_with_parents(null)
  }
}

export function loadEvents(): CalendarEvent[] {
  try {
    ensureDir()
    const file = Gio.File.new_for_path(DATA_PATH)
    if (!file.query_exists(null)) return []
    const [, contents] = file.load_contents(null)
    const text = new TextDecoder().decode(contents)
    return JSON.parse(text) as CalendarEvent[]
  } catch (e) {
    console.error("[Calendar] Error loading events:", e)
    return []
  }
}

export function saveEvents(evs: CalendarEvent[]) {
  try {
    ensureDir()
    const file = Gio.File.new_for_path(DATA_PATH)
    const text = JSON.stringify(evs, null, 2)
    const bytes = new TextEncoder().encode(text)
    file.replace_contents(
      bytes,
      null,
      false,
      Gio.FileCreateFlags.REPLACE_DESTINATION,
      null
    )
  } catch (e) {
    console.error("[Calendar] Error saving events:", e)
  }
}

// ── State ────────────────────────────────────────────────────────────────────

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

export const [events, setEvents] = createState<CalendarEvent[]>(loadEvents())
export const [currentView, setCurrentView] = createState<CalendarView>("month")
export const [selectedDate, setSelectedDate] = createState<string>(todayStr())
export const [calViewDate, setCalViewDate] = createState<{ year: number; month: number }>({
  year: new Date().getFullYear(),
  month: new Date().getMonth(),
})

// Persist on every change
events.subscribe((evs) => saveEvents(evs))

// ── Actions ──────────────────────────────────────────────────────────────────

export function addEvent(ev: Omit<CalendarEvent, "id">) {
  setEvents([...events.get(), { ...ev, id: uid() }])
}

export function updateEvent(id: string, patch: Partial<Omit<CalendarEvent, "id">>) {
  setEvents(events.get().map((e) => (e.id === id ? { ...e, ...patch } : e)))
}

export function deleteEvent(id: string) {
  setEvents(events.get().filter((e) => e.id !== id))
}

export function getEventsForDate(date: string): CalendarEvent[] {
  return events
    .get()
    .filter((e) => e.date === date)
    .sort((a, b) => {
      if (a.allDay && !b.allDay) return -1
      if (!a.allDay && b.allDay) return 1
      return (a.startTime ?? "").localeCompare(b.startTime ?? "")
    })
}

export function getEventsForMonth(year: number, month: number): Map<string, CalendarEvent[]> {
  const map = new Map<string, CalendarEvent[]>()
  const prefix = `${year}-${String(month + 1).padStart(2, "0")}`
  for (const ev of events.get()) {
    if (ev.date.startsWith(prefix)) {
      const arr = map.get(ev.date) ?? []
      arr.push(ev)
      map.set(ev.date, arr)
    }
  }
  return map
}

export function getAgendaEvents(fromDate: string, days = 60): CalendarEvent[] {
  const sorted = [...events.get()].sort((a, b) => a.date.localeCompare(b.date))
  const from = new Date(fromDate)
  const to = new Date(fromDate)
  to.setDate(to.getDate() + days)
  return sorted.filter((e) => {
    const d = new Date(e.date)
    return d >= from && d <= to
  })
}

// ── Calendar helpers ─────────────────────────────────────────────────────────

export const MONTHS = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
]

export const WDAYS_SHORT = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"]

export const COLOR_MAP: Record<EventColor, string> = {
  purple: "#7F77DD",
  teal:   "#1D9E75",
  red:    "#E24B4A",
  amber:  "#BA7517",
  blue:   "#378ADD",
  pink:   "#D4537E",
}

export const EVENT_COLORS: EventColor[] = ["purple", "teal", "red", "amber", "blue", "pink"]

export function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate()
}

// Returns 0=Mon ... 6=Sun
export function getFirstDOW(year: number, month: number): number {
  return (new Date(year, month, 1).getDay() + 6) % 7
}

export function dateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

export function formatDisplayDate(date: string): string {
  const [y, m, d] = date.split("-")
  return `${parseInt(d)} ${MONTHS[parseInt(m) - 1]} ${y}`
}

export function formatTimeRange(ev: CalendarEvent): string {
  if (ev.allDay) return "Todo el día"
  if (ev.startTime && ev.endTime) return `${ev.startTime} – ${ev.endTime}`
  if (ev.startTime) return ev.startTime
  return ""
}

export function isToday(dateStr: string): boolean {
  return dateStr === todayStr()
}

export function isPast(dateStr: string): boolean {
  return dateStr < todayStr()
}
