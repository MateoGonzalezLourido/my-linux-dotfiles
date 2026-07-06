# Games Indicator — Design

**Fecha:** 2026-07-05
**Estado:** aprobado, listo para implementar

## Objetivo

Un contenedor **morado** a la derecha de los workspaces en el bar que muestra
**un icono por cada videojuego en ejecución**. Detección **automática** (sin
config manual), **event-driven** y con **coste ~nulo en reposo** (cuando no hay
juegos, cero timers y widget oculto). Reemplaza al `GameIndicator` central
actual, que dependía de listas gigantes de clases/keywords y solo mostraba un
juego.

## Requisitos

- Detección automática por heurística (no hay `gamemode` ni Steam en la máquina).
- Varios juegos a la vez → un icono por juego, en fila.
- Click en un icono → salta al workspace del juego, lo enfoca y lo pone
  fullscreen si no lo estaba (misma UX que el indicador actual).
- **Secundario:** sin polling, sin timers vivos mientras no haya juegos.

## Arquitectura

Dos piezas, separando lógica pura de GTK (como el subsistema de notificaciones).

### 1. `widget/bar/games/detect.ts` — lógica pura (testeable con `node --test`)

Sin imports de GTK/GLib. Exporta:

```ts
interface GameClientLike {
  class?: string
  initialClass?: string
  initial_class?: string
  title?: string
  fullscreen?: number   // Hyprland: 0 = no fullscreen
}
export function isGame(c: GameClientLike | null | undefined): boolean
```

Heurística (elegida por el usuario):

- **Señales de clase (fuertes):** `class` o `initialClass` (lowercased) incluye
  `steam_app_`, `gamescope`, `wine`, `proton`, `lutris`, `heroic`, o termina en
  `.exe`.
- **Señal de fullscreen (débil):** `fullscreen` truthy (≠ 0) **y** la clase no
  está en una blocklist pequeña de apps fullscreen no-juego:
  navegadores (`firefox`, `chrome`, `chromium`, `brave`, `zen`, ...),
  reproductores (`mpv`, `vlc`), terminales (`kitty`, `foot`, `alacritty`, ...),
  visores (`imv`, `feh`, ...) y apps obvias no-juego.

`detect.test.ts` cubre: `steam_app_1234` (sí), clase `.exe` wine (sí),
`chrome` fullscreen (no), `mpv` fullscreen (no), `factorio` fullscreen (sí),
ventana normal no-fullscreen sin señal de clase (no), `null`/vacío (no).

### 2. `widget/bar/games/GamesIndicator.tsx` — widget

- Estado **local** (no global): `Map<address, GameEntry>` →
  `createState<GameEntry[]>`. `GameEntry = { class, title, address, workspaceId, fullscreen }`.
- **Ciclo de vida event-driven, cero polling:**
  - Arranque: **un** escaneo `hypr.get_clients()`; añade los que sean juego.
  - `client-added`: `isGame(client)` inmediato. Programa **un** re-check tardío
    (~600ms) **solo si** la clase aún no está resuelta al añadirse (evita
    arrancar timers al abrir ventanas normales como una terminal).
  - `client-removed`: si el address está en el Map, lo quita.
  - Evento de fullscreen de Hyprland: re-evalúa la ventana afectada (una que se
    vuelve fullscreen puede pasar a contar como juego, o dejar de serlo). Se
    actualiza el Map en consecuencia.
- **Render:** contenedor `.game-tray` (morado). `visible` ligado a
  `list.length > 0` → oculto y sin coste visual cuando no hay juegos. Dentro, un
  `<For>` (o mapeo) de botones `.game-tray-icon`, cada uno con `getIcon(class)`
  o glyph fallback `󰊴`. Tooltip con el nombre formateado.
- **Click:** `hyprctl dispatch workspace <id>` → `focuswindow address:<addr>` →
  `fullscreen 0` si `entry.fullscreen === 0`. (Reutiliza la lógica del actual.)

### 3. Integración

- `widget/Bar.tsx`: quitar `import GameIndicator` y su `<GameIndicator/>` del
  box `center`; añadir `<GamesIndicator/>` justo después de `<Workspaces/>` en el
  box `start`.
- `widget/state.tsx`: eliminar `gameActive`/`setGameActive`/`gameInfo`/
  `setGameInfo` (solo los usaba el indicador viejo).
- Borrar `widget/bar/GameIndicator.tsx`.

### 4. Estilos

- `style.scss`: clases `.game-tray` (fondo/borde violeta `#cba6f7`) y
  `.game-tray-icon`. **Compilar** con `sass style.scss out.css` tras editar (la
  app carga `out.css`, no el scss).

## Presupuesto de recursos (en reposo)

Sin juegos: lista vacía, widget oculto, **ningún timer vivo**. El único trabajo
es reaccionar a eventos de Hyprland que ocurren igualmente; `isGame` son unas
pocas comparaciones de strings. El coste solo aparece al lanzar/cerrar un juego.

## Testing

- `node --test widget/bar/games/detect.test.ts` para la heurística pura.
- Verificación de UI: `ags run ~/.config/ags/app.ts`, lanzar algo que dispare la
  heurística (o forzar una ventana fullscreen) y comprobar icono, click y ocultado.
