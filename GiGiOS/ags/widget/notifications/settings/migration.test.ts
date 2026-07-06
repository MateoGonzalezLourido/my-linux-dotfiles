// widget/notifications/settings/migration.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { migrateAppSettingsToRules } from "./migration.ts"

test("creates a suppress rule per muted app, ignores unmuted", () => {
  const rules = migrateAppSettingsToRules({
    Discord: { muted: true },
    WhatsApp: { muted: false },
    Slack: { muted: true },
  })
  const ids = rules.map(r => r.id).sort()
  assert.deepEqual(ids, ["user.mute.Discord", "user.mute.Slack"])
  for (const r of rules) {
    assert.equal(r.effects.suppress, true)
    assert.equal(r.match.app?.op, "equals")
    assert.equal(r.source, "user")
  }
})

test("empty settings → no rules", () => {
  assert.deepEqual(migrateAppSettingsToRules({}), [])
})
