// modulos/notificaciones/history/historyLogic.upsert.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { upsertEntry, trimByRecency, type HistoryEntry, type HistoryInput } from "./historyLogic.ts"

function input(over: Partial<HistoryInput> = {}): HistoryInput {
  return { dedupKey: "whatsapp usuario1", app: "WhatsApp", summary: "usuario1", body: "hola", appIcon: "ic", matchedRulesCount: 0, ...over }
}

test("adds a new entry with count 1", () => {
  const out = upsertEntry([], input(), 1000, 500)
  assert.equal(out.length, 1)
  assert.equal(out[0].count, 1)
  assert.equal(out[0].firstSeen, 1000)
  assert.equal(out[0].lastSeen, 1000)
  assert.equal(out[0].dedupKey, "whatsapp usuario1")
})

test("increments count and updates lastSeen/body for same dedupKey", () => {
  const first = upsertEntry([], input({ body: "hola" }), 1000, 500)
  const second = upsertEntry(first, input({ body: "adios" }), 2000, 500)
  assert.equal(second.length, 1)
  assert.equal(second[0].count, 2)
  assert.equal(second[0].firstSeen, 1000)
  assert.equal(second[0].lastSeen, 2000)
  assert.equal(second[0].sampleBody, "adios")
})

test("matched-rule input removes existing entry and never adds", () => {
  const first = upsertEntry([], input(), 1000, 500)
  const ruled = upsertEntry(first, input({ matchedRulesCount: 1 }), 2000, 500)
  assert.equal(ruled.length, 0)
})

test("matched-rule input on absent dedupKey returns the SAME array reference (no-op)", () => {
  const entries: HistoryEntry[] = []
  const out = upsertEntry(entries, input({ dedupKey: "other", matchedRulesCount: 2 }), 1000, 500)
  assert.equal(out, entries)
})

test("trims to cap keeping most recent by lastSeen", () => {
  const entries: HistoryEntry[] = []
  const e = (k: string, t: number): HistoryEntry => ({ dedupKey: k, app: "a", summary: k, sampleBody: "", appIcon: "", count: 1, firstSeen: t, lastSeen: t })
  const list = [e("a", 1), e("b", 2), e("c", 3)]
  const out = trimByRecency(list, 2)
  assert.deepEqual(out.map(x => x.dedupKey), ["c", "b"])
})

test("trimByRecency returns input unchanged when under cap", () => {
  const list: HistoryEntry[] = [{ dedupKey: "a", app: "a", summary: "", sampleBody: "", appIcon: "", count: 1, firstSeen: 1, lastSeen: 1 }]
  assert.equal(trimByRecency(list, 500), list)
})
