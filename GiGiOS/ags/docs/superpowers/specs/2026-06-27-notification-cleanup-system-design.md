# Sistema de limpieza de notificaciones — Diseño

Fecha: 2026-06-27
Estado: Aprobado (pendiente de plan de implementación)

## Objetivo

Sistema escalable de gestión y limpieza de notificaciones para la config AGS. Todo se basa
en **filtros (reglas)**: cada notificación es idéntica salvo por el conjunto de reglas que se
le aplican (built-in que trae el código + reglas que añade el usuario). Las "categorías"
(flash, temporal, clear-on-boot, persistente) no son tipos rígidos sino **consecuencia** de
qué reglas aplican.

Principios:
- La metadata se **calcula una sola vez** al recibir la notificación (motor de reglas) y se
  guarda con ella. La limpieza **solo lee** metadata, nunca re-clasifica → "no repetir trabajo".
- Las reglas se editan **cómodamente sin ver código**, vía UI de formularios. El JSON es solo
  formato de persistencia.
- Eficiencia primero: matchers precompilados, índice por app, barrido periódico en vez de
  muchos timers, watchers solo para las pocas notifs que llevan condiciones dinámicas.

## Enfoque elegido

**A — Reglas declarativas (datos) + registro de condiciones/efectos con nombre.** Built-ins y
reglas de usuario comparten el mismo esquema. La lógica compleja (condiciones dinámicas tipo
"flash") se expresa como *providers con nombre* en un registro extensible; la regla solo los
referencia. Rechazadas: B (reglas como código → la UI no puede generar código) y C (híbrido,
converge con A porque el registro de condiciones ya es la vía de escape).

## Modelo de datos

### Metadata calculada (se guarda con la notificación)

```ts
type Lifetime = "flash" | "timed" | "clear-on-boot" | "persistent"

interface NotifMeta {
  lifetime: Lifetime
  expiresAt?: number      // ms epoch (solo timed)
  clearOnBoot: boolean
  noHistory: boolean      // no entra al historial (ej: captura)
  muteAudio: boolean
  dontShow: boolean       // no muestra popup, pero sí almacena
  dedupKey: string        // clave de dedup ya computada
  conditions: string[]    // providers dinámicos a vigilar (flash)
  matchedRules: string[]  // ids de reglas que aplicaron (debug/UI/historial)
}
```

`StoredNotification` gana el campo `meta: NotifMeta`.

`suppress` no se persiste como campo: si una regla lo activa, la notificación se descarta antes
de almacenarse (ni popup, ni lista activa, ni historial).

### Esquema de regla (mismo para built-in y usuario)

```ts
interface NotifRule {
  id: string
  name: string
  enabled: boolean
  priority: number          // mayor gana en conflicto; built-ins bajo, usuario alto
  source: "builtin" | "user"
  match: MatchSpec          // todos los campos presentes deben cumplir (AND)
  effects: EffectSpec       // se fusionan por prioridad, campo a campo
  stopOnMatch?: boolean     // corta la evaluación
}

type StringMatch =
  | { op: "contains" | "equals" | "regex"; value: string; ci?: boolean }

interface MatchSpec {
  app?: StringMatch; summary?: StringMatch; body?: StringMatch
  urgency?: number[]        // any-of
}

interface EffectSpec {
  lifetime?: Lifetime; ttlMs?: number
  clearOnBoot?: boolean; noHistory?: boolean; suppress?: boolean
  muteAudio?: boolean; dontShow?: boolean
  dedupKey?: "app" | "app+summary" | "app+summary+body" | { template: string } // "{app}|{summary}"
  conditions?: string[]
}
```

Defaults cuando ninguna regla matchea: `lifetime:"persistent"`, `dedupKey:"app+summary"`,
todo lo demás `false`.

## Motor de reglas (`rules/engine.ts`, puro/testeable)

- **Compilación al cargar**: cada regla → closure `{ test(n): boolean, effects, priority }`.
  Regex compiladas, constantes en minúsculas. Recompila solo al cambiar reglas, no por notif.
- **Índice por app**: `Map<appLower, Rule[]>` + `appAgnosticRules[]`. Conjunto candidato por
  notif = `byApp(app) ∪ appAgnostic`. No se escanea todo el set.
- **Evaluación**: candidatas en orden de prioridad; `effects` se fusionan campo a campo (mayor
  prioridad pisa); `stopOnMatch` corta. Resultado → `NotifMeta`.
- `matchedRules` registra qué ids aplicaron (lo usa el historial para excluir las que tienen
  regla, y la UI para debug).

### Built-ins y overrides (`rules/defaults.ts` + `rules/rulesStore.ts`)

- Built-ins definidas en código (semilla). Cubren sistema: captura (`suppress`/`noHistory`),
  crash y reboot (`clear-on-boot`), batería baja (`flash` + condición `battery-resolved`),
  WhatsApp/mensajería (`timed`, ttl 2 días, dedupKey `app+summary`), alarmas (`timed`).
- Editar/desactivar una built-in guarda un **override por id** en `config/notif-rules.json`.
  El motor compone *defaults en código + overrides encima*. Las built-in siguen siendo
  recuperables y editables desde la UI.
- Reglas de usuario también en `config/notif-rules.json`. Store reactivo; recompila el motor al
  cambiar.

## Condiciones dinámicas (`rules/conditions.ts`)

```ts
interface ConditionProvider {
  name: string
  watch(notif: StoredNotification, resolve: () => void): () => void  // devuelve disposer
}
```

- Solo se crean watchers para notifs que llevan `conditions` (la mayoría no) → coste casi nulo.
- `Map<notifId, disposers[]>`; al eliminar la notif se disparan los disposers (sin fugas).
- Providers viables iniciales:
  - `battery-resolved`: suscribe AstalBattery; si el % sube, resuelve → borra el aviso de batería baja.
  - `superseded`: cuando llega otra con misma dedupKey de la misma app, borra la vieja.
- Providers inviables/teóricos (ej. `update-applied`, "acción de terminal superada") quedan como
  **gancho registrado-pero-vacío**: la arquitectura los soporta, se implementan cuando sean factibles.

## Embudo único de entrada (`ingest.ts`)

Hoy el `StoredNotification` se construye dos veces (en `store.addNotification` y en el handler
`notified` del popup). Se unifica: el handler `notified` llama a un solo `ingest(n)`:

```
ingest(n):
  meta = engine.evaluate(n)            // reglas → NotifMeta
  if meta.suppress: return             // descartado: ni popup, ni lista, ni historial
  stored = build(n, meta)
  dedupActive(stored)                  // colapsa duplicado en lista activa (misma dedupKey)
  store en lista activa
  if !meta.noHistory: history.upsert(stored)
  if !meta.dontShow && !dnd && !muted: showPopup(stored)
  scheduleConditions(stored)           // engancha providers dinámicos
```

## Motor de limpieza (`cleanup/`)

Disparadores:

1. **Deep-clean en boot real** (`bootDetect.ts` + `cleanupEngine.ts`): se detecta boot leyendo
   `btime` de `/proc/stat` y comparándolo con un marcador en `config/notif-cleanup-state.json`.
   Si cambió → nuevo boot → borra todas las `clear-on-boot`, barrido de 7 días, colapso dedup,
   elimina `timed` ya expiradas. Recargar AGS **no** dispara esto (btime no cambia entre recargas).
2. **On-receive** (en `ingest`): `suppress`, dedup en lista activa, alta en historial.
3. **Barrido periódico**: reusa el `timeTick` de 60s ya existente. Elimina `timed` expiradas
   (`expiresAt < now`) y aplica el barrido de 7 días. Un barrido periódico en vez de un timer por
   notificación → mucho más barato a escala (no se acumulan cientos de timeouts GLib).

## Historial (`history/historyStore.ts`) — almacén separado

- Distinto de la lista activa del panel. Archivo `config/notif-history.json`.
- Entradas **únicas por dedupKey**: `{ app, summary, sampleBody, dedupKey, appIcon, count, firstSeen, lastSeen }`
  — lo mínimo para construir reglas.
- `upsert`: si existe la dedupKey → `count++`, `lastSeen=now`; si no → nueva entrada.
- **Exclusión por regla**: si la notificación entrante coincide con **cualquier** regla
  (built-in o de usuario, vía `meta.matchedRules.length > 0`), no se añade; si ya había entrada
  con esa dedupKey, se elimina. Así el historial solo muestra **tipos sin regla** ("lo que aún no
  has configurado"). Las que tienen regla ya se ven en las pestañas Apps/Reglas.
- También se excluye lo marcado `noHistory`.
- **Depuración**: al llegar a 500 se recorta (drop más antiguas por `lastSeen`); al **abrir los
  ajustes** se re-colapsa dedup + recorta + re-aplica la exclusión por regla.
- No se ve afectado por filtros de ciclo de vida (solo por `noHistory` y por exclusión-por-regla).

## UI de ajustes — 3 pestañas (`settings/`)

Expande el `NotificationSettings` actual a un panel con pestañas.

- **Apps** (`AppsTab.tsx`): filas por app (las actuales), expandibles a sub-filas **por tipo**
  (cada tipo = grupo dedup visto de esa app). Por app/tipo: *no mostrar*, *silenciar audio*,
  *override de ciclo de vida*. Cada control escribe una **regla de usuario** por debajo (un único
  modelo, sin sistema paralelo).
- **Historial** (`HistoryTab.tsx`): lista de las únicas **sin regla**. Cada entrada → botón
  **"crear regla"** que abre el editor prerrellenado (match `app`+`summary`).
- **Reglas / Filtros** (`RulesTab.tsx`): lista de **todas** las reglas (built-in + usuario).
  Añadir / editar / activar-desactivar / borrar (usuario). Editar built-in escribe override por id.
  `RuleEditor.tsx`: formularios — campos de match (app/summary/body/urgency con selector de
  operador) + efectos (desplegable de ciclo de vida, ttl, toggles, dedupKey). **Cero JSON a la vista.**

### Migración

El `appSettings` actual (muted/importance/showOnLockscreen) se convierte **una vez** a reglas
equivalentes. El chequeo de `muted` en el ingest pasa a ser el motor (`suppress`/`muteAudio`/
`dontShow`). Un solo modelo de verdad.

## Layout de archivos

```
widget/notifications/
  store.ts            (lista activa + estado panel; adelgazado)
  ingest.ts           (embudo único: notified → engine → cleanup → store/history/popup)
  rules/
    types.ts          (NotifRule, MatchSpec, EffectSpec, NotifMeta, Lifetime)
    engine.ts         (compilar + indexar + evaluar → NotifMeta) — puro, testeable
    defaults.ts       (built-ins)
    conditions.ts     (registro ConditionProvider + providers viables)
    rulesStore.ts     (carga/guarda config/notif-rules.json, defaults+overrides, reactivo)
  cleanup/
    bootDetect.ts     (btime /proc/stat + marcador config/notif-cleanup-state.json)
    cleanupEngine.ts  (deep-clean boot, on-receive, barrido periódico, dedup)
  history/
    historyStore.ts   (500 únicas, dedup, exclusión por regla, persistencia)
  settings/
    SettingsTabs.tsx  AppsTab.tsx  HistoryTab.tsx  RulesTab.tsx  RuleEditor.tsx
  NotificationItem.tsx / NotificationPanel.tsx / NotificationPopup.tsx  (existentes; Popup usa ingest.ts)
```

## Archivos de configuración (runtime)

- `config/notifications.json` — lista activa (ya existe).
- `config/notif-rules.json` — reglas de usuario + overrides de built-ins (nuevo).
- `config/notif-history.json` — historial de 500 únicas (nuevo).
- `config/notif-cleanup-state.json` — marcador de boot (`btime`) y última limpieza (nuevo).

## Fases de implementación

1. **Núcleo (sin UI)**: `types` + `engine` + `defaults` + `rulesStore` + `cleanup`
   (boot/dedup/expiry/7d) + `conditions` (batería + superseded) + `ingest.ts`. Reglas editables
   vía JSON. Sistema funcionando de fondo. Migración de `appSettings`.
2. **Historial**: `historyStore.ts` + exclusión de las que tienen regla.
3. **UI**: 3 pestañas + `RuleEditor`.

## Notas de verificación

- No hay suite de tests ni build en el repo; `engine.ts` se diseña puro para poder testearse de
  forma aislada si se añade un runner. Verificación práctica: `ags run ~/.config/ags/app.ts` y
  observar el comportamiento (popups, panel, limpieza tras reboot real).
- `git` no está inicializado en este repo, así que el spec no se commitea automáticamente.

## Decisiones tomadas durante el brainstorming

- "Inicio del OS" = **boot real de la máquina** (btime), no recarga de AGS.
- Clave de dedup por defecto = **app + summary**, definible por regla (WhatsApp: app+summary).
- Lifetime = consecuencia de los filtros, no tipo rígido. Condiciones flash difíciles quedan como
  ganchos.
- Lista activa e historial son **dos almacenes separados**.
- Historial oculta lo que tiene **cualquier** regla (built-in o usuario); las built-in se ven en
  la pestaña Reglas.
```
