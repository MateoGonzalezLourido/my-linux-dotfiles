// modulos/notificaciones/rules/rulesStore.ts
// Loads built-in rules + user rules/overrides from config/notif-rules.json, exposes a
// reactive compiled index. Editing/disabling a builtin = an override entry keyed by builtin id.
import { createState } from "ags"
import GLib from "gi://GLib"
import type { NotifRule } from "./types.ts"
import { BUILTIN_RULES } from "./defaults.ts"
import { compileRules, type RuleIndex } from "./engine.ts"

const RULES_PATH = `${GLib.get_user_config_dir()}/gigios/notif-rules.json`

interface RulesFile {
  userRules: NotifRule[]
  builtinOverrides: Record<string, Partial<NotifRule>> // keyed by builtin id
}

function loadFile(): RulesFile {
  try {
    if (!GLib.file_test(RULES_PATH, GLib.FileTest.EXISTS)) {
      return { userRules: [], builtinOverrides: {} }
    }
    const [ok, content] = GLib.file_get_contents(RULES_PATH)
    if (ok) {
      const data = JSON.parse(new TextDecoder().decode(content))
      return { userRules: data.userRules ?? [], builtinOverrides: data.builtinOverrides ?? {} }
    }
  } catch (e) { console.error("[notif] loadFile failed:", e) }
  return { userRules: [], builtinOverrides: {} }
}

let saveTimer: number | null = null
function scheduleSave(file: RulesFile): void {
  if (saveTimer !== null) GLib.source_remove(saveTimer)
  saveTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 800, () => {
    try {
      const dir = GLib.path_get_dirname(RULES_PATH)
      if (!GLib.file_test(dir, GLib.FileTest.EXISTS)) GLib.mkdir_with_parents(dir, 0o755)
      GLib.file_set_contents(RULES_PATH, JSON.stringify(file, null, 2))
    } catch (e) { console.error("[notif] save rules failed:", e) }
    saveTimer = null
    return GLib.SOURCE_REMOVE
  })
}

/** Compose builtin seeds (with overrides applied) + user rules into one list. */
function composeRules(file: RulesFile): NotifRule[] {
  const builtins = BUILTIN_RULES.map(b => {
    const ov = file.builtinOverrides[b.id]
    return ov ? { ...b, ...ov, effects: { ...b.effects, ...(ov.effects ?? {}) }, match: { ...b.match, ...(ov.match ?? {}) } } : b
  })
  return [...builtins, ...file.userRules]
}

const initialFile = loadFile()

// Reactive: the full rule list and the compiled index.
export const [rulesFile, setRulesFile] = createState<RulesFile>(initialFile)
export const [ruleIndex, setRuleIndex] = createState<RuleIndex>(compileRules(composeRules(initialFile)))

function recompile(file: RulesFile): void {
  setRulesFile(file)
  setRuleIndex(compileRules(composeRules(file)))
  scheduleSave(file)
}

export function allRules(): NotifRule[] { return composeRules(rulesFile.get()) }

export function upsertUserRule(rule: NotifRule): void {
  const f = rulesFile.get()
  const idx = f.userRules.findIndex(r => r.id === rule.id)
  const userRules = idx >= 0
    ? [...f.userRules.slice(0, idx), rule, ...f.userRules.slice(idx + 1)]
    : [...f.userRules, rule]
  recompile({ ...f, userRules })
}

export function removeUserRule(id: string): void {
  const f = rulesFile.get()
  recompile({ ...f, userRules: f.userRules.filter(r => r.id !== id) })
}

export function setBuiltinOverride(id: string, patch: Partial<NotifRule>): void {
  const f = rulesFile.get()
  recompile({ ...f, builtinOverrides: { ...f.builtinOverrides, [id]: patch } })
}

export function clearBuiltinOverride(id: string): void {
  const f = rulesFile.get()
  const { [id]: _, ...rest } = f.builtinOverrides
  recompile({ ...f, builtinOverrides: rest })
}
