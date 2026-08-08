// modulos/ajustes/disco/SeccionAlmacenamiento.tsx — Ajustes > Almacenamiento.
//
// Dos destinos de la navegación, un solo componente (mismo patrón que `SeccionSistema` y
// `SeccionSeguridad`): «Almacenamiento» enseña qué ocupa el disco y «Liberar espacio» decide qué
// se borra y cuándo.
//
// ── Se pinta LLENO en el primer frame ────────────────────────────────────────
// El análisis obliga a recorrer el sistema de ficheros y tarda segundos. Se construye con el
// análisis anterior leído de `~/.cache/gigios/almacenamiento.json` (síncrono, ~1 ms) y el nuevo
// entra por detrás cuando llega, igual que Ajustes > Sistema. Sin caché previa —primera vez en un
// equipo— sí se ve el spinner, que es cuando de verdad no hay nada que enseñar.
//
// ── El directorio se llama `disco/` y el servicio `servicios/disco/` ─────────
// NO `almacenamiento/`: ese nombre ya está cogido por `servicios/almacenamiento/`, que es la
// lectura y escritura de los JSON del shell — nada que ver con el espacio en disco. Dos cosas con
// el mismo nombre a dos niveles distintos del árbol es una trampa para el siguiente que grepee.
import { Gtk } from "ags/gtk4"
import { For, With, createComputed, createState, onCleanup, type Accessor } from "ags"
import {
  AjusteInterruptor, BotonAjustes, FilaAjuste, TarjetaAjustes,
  TextoInformativo, TituloSeccion,
} from "../componentes"
import {
  ACCIONES, ACCIONES_AUTOMATIZABLES, agrupar, accion as buscarAccion,
  analisisCaducado, estimarLiberable, type FilaCategoria, type IdAccion,
} from "../../../servicios/disco/catalogo"
import {
  ANALISIS_VACIO, analizar, leerCache, type Analisis, type App, type Disco,
} from "../../../servicios/disco/analisis"
import { ejecutarLimpieza, type ResultadoLimpieza } from "../../../servicios/disco/limpieza"
import { formatearBytes, formatearFecha, fraccionUso, severidadUso } from "../../../servicios/disco/formato"
import {
  accionAutomatica, autoLimpieza, diasDescargas, diasPapelera, intervaloHoras,
  limpiarAhora, notificarLimpieza, retenerJournal, setAccionAutomatica, setAutoLimpieza,
  setDiasDescargas, setDiasPapelera, setIntervaloHoras, setNotificarLimpieza,
  setRetenerJournal, setUmbralUso, umbralUso,
} from "../../../servicios/disco/preferencias"
import CampoNumerico from "../pantalla/CampoNumerico"
import textos from "../../../textos/ajustes/almacenamiento.json" with { type: "json" }
import { formatearTexto } from "../../../textos/formatear"

type VistaAlmacenamiento = "uso" | "limpieza"

/** Cuántas aplicaciones se enseñan antes de "Ver más". */
const APPS_VISIBLES = 12

// ── Análisis compartido por las dos vistas ───────────────────────────────────
//
// Cada visita a la sección lanza su propio análisis y lo tira al salir: no hay estado a nivel de
// módulo. Es lo que hace que cerrar Ajustes no deje nada corriendo, y el coste de reanalizar ya
// está cubierto por la caché de disco.
function usarAnalisis(): [Accessor<Analisis>, Accessor<boolean>, () => void] {
  const cacheado = leerCache()
  const [analisis, setAnalisis] = createState<Analisis>(cacheado ?? ANALISIS_VACIO)
  const [analizando, setAnalizando] = createState(false)

  // El análisis de fondo puede terminar con la sección ya desmontada: sin la guarda, el `set`
  // reconstruiría widgets que ya no existen. Mismo apaño que `SeccionSistema`.
  let vivo = true
  onCleanup(() => { vivo = false })

  const refrescar = () => {
    setAnalizando(true)
    analizar()
      .then(nuevo => { if (vivo) setAnalisis(nuevo) })
      .catch(() => { /* el análisis anterior sigue siendo lo mejor que tenemos */ })
      .finally(() => { if (vivo) setAnalizando(false) })
  }

  // Al montar NO se reanaliza si la medida es reciente. Antes se lanzaba siempre, así que abrir
  // Ajustes y pasar de «Almacenamiento» a «Liberar espacio» costaba dos análisis completos
  // (~0,6 s de reloj y ~0,7 s de CPU cada uno) para volver a medir lo mismo. `refrescar` sigue
  // disponible sin condiciones para el botón y para el «después de limpiar».
  if (analisisCaducado(analisis.get().epoch, Math.floor(Date.now() / 1000))) refrescar()

  return [analisis, analizando, refrescar]
}

// ── Piezas ───────────────────────────────────────────────────────────────────

function BarraDisco({ disco }: { disco: Disco }) {
  const severidad = severidadUso(disco.porcentaje)
  return (
    <box orientation={Gtk.Orientation.VERTICAL} spacing={5} cssClasses={["dev-row", "alm-disco"]}>
      <box spacing={10}>
        <label cssClasses={["alm-disco-punto"]} label={disco.punto} halign={Gtk.Align.START} />
        <label cssClasses={["alm-disco-fs"]} label={disco.fs} halign={Gtk.Align.START} hexpand />
        <label
          cssClasses={["alm-disco-uso", severidad]}
          label={formatearTexto(textos.seccion.usadoPorcentaje, { porcentaje: disco.porcentaje })}
          halign={Gtk.Align.END}
        />
      </box>
      <Gtk.ProgressBar
        cssClasses={["alm-barra", severidad]}
        fraction={fraccionUso(disco.usado, disco.total)}
        hexpand
      />
      <label
        cssClasses={["alm-disco-libre"]}
        label={formatearTexto(textos.seccion.libreDe, {
          libre: formatearBytes(disco.libre),
          total: formatearBytes(disco.total),
        })}
        halign={Gtk.Align.START}
      />
    </box>
  )
}

/**
 * Fila de una categoría, con su botón de limpieza si la tiene.
 *
 * El resultado se pinta EN LA PROPIA FILA y no en un aviso global: con doce botones, un mensaje
 * arriba del todo no dice cuál de ellos acaba de terminar. Y el botón se deshabilita mientras
 * corre porque varias limpiezas tardan segundos sin dar señal de vida.
 */
function FilaCategoriaVista({ fila, tras }: { fila: FilaCategoria; tras: () => void }) {
  const meta = fila.categoria.accion ? buscarAccion(fila.categoria.accion) : undefined
  const [ocupado, setOcupado] = createState(false)
  const [resultado, setResultado] = createState<ResultadoLimpieza | null>(null)

  let vivo = true
  onCleanup(() => { vivo = false })

  const limpiar = () => {
    if (!fila.categoria.accion || ocupado.get()) return
    setOcupado(true)
    setResultado(null)
    ejecutarLimpieza(fila.categoria.accion).then(r => {
      if (!vivo) return
      setOcupado(false)
      setResultado(r)
      // Un reanálisis tras cada limpieza, y no una resta local sobre la cifra que había: el
      // espacio liberado que devuelve el script es el de ESA categoría, pero varias se solapan
      // (miniaturas y desarrollo viven dentro de ~/.cache), así que restar dejaría al desglose
      // contradiciéndose consigo mismo.
      if (r.estado === "ok") tras()
    })
  }

  return (
    <box orientation={Gtk.Orientation.VERTICAL} cssClasses={["dev-row", "alm-fila"]} spacing={4}>
      <box spacing={12} valign={Gtk.Align.CENTER}>
        <label cssClasses={["alm-icono"]} label={fila.categoria.icono} valign={Gtk.Align.START} />
        <box orientation={Gtk.Orientation.VERTICAL} spacing={2} hexpand>
          <label cssClasses={["sp-field-label"]} label={fila.categoria.nombre} halign={Gtk.Align.START} />
          <TextoInformativo label={fila.categoria.descripcion} wrap xalign={0} maxWidthChars={56} />
        </box>
        <label cssClasses={["alm-tamano"]} label={formatearBytes(fila.bytes)} valign={Gtk.Align.START} />
        {meta ? (
          <BotonAjustes
            onClicked={limpiar}
            sensitive={ocupado((esta: boolean) => !esta)}
            tooltipText={meta.descripcion}
          >
            <label label={ocupado((esta: boolean) => esta ? textos.estados.limpiando : meta.etiqueta)} />
          </BotonAjustes>
        ) : (
          <box widthRequest={4} />
        )}
      </box>
      <With value={resultado}>
        {(r: ResultadoLimpieza | null) =>
          r ? <TextoInformativo cssClasses={["alm-resultado", r.estado]} label={textoResultado(r)} wrap xalign={0} maxWidthChars={60} />
            : <box />}
      </With>
    </box>
  )
}

function textoResultado(r: ResultadoLimpieza): string {
  switch (r.estado) {
    case "ok":
      return r.liberado > 0
        ? formatearTexto(textos.estados.liberado, { tamano: formatearBytes(r.liberado) })
        : textos.estados.nada
    case "cancelado":    return textos.estados.cancelado
    case "omitida":      return formatearTexto(textos.estados.omitida, { mensaje: r.mensaje })
    case "sin-permisos": return textos.estados.sinPermisos
    default:             return formatearTexto(textos.estados.error, { mensaje: r.mensaje })
  }
}

// ── Catálogo de aplicaciones ─────────────────────────────────────────────────

type FiltroApps = "todas" | "explicitas" | "dependencias" | "aur"

const FILTROS: { id: FiltroApps; etiqueta: string }[] = [
  { id: "todas",        etiqueta: textos.apps.filtros.todas },
  { id: "explicitas",   etiqueta: textos.apps.filtros.explicitas },
  { id: "dependencias", etiqueta: textos.apps.filtros.dependencias },
  { id: "aur",          etiqueta: textos.apps.filtros.aur },
]

function aplicaFiltro(app: App, filtro: FiltroApps): boolean {
  if (filtro === "explicitas") return app.explicito
  if (filtro === "dependencias") return !app.explicito
  if (filtro === "aur") return app.origen === "aur"
  return true
}

function CatalogoApps({ apps }: { apps: Accessor<App[]> }) {
  const [busqueda, setBusqueda] = createState("")
  const [filtro, setFiltro] = createState<FiltroApps>("todas")
  const [expandido, setExpandido] = createState(false)

  // El script ya devuelve la lista ordenada por tamaño, así que aquí solo se filtra: reordenar
  // ~1600 elementos en cada pulsación del buscador es trabajo que ya está hecho.
  const filtradas = createComputed([apps, busqueda, filtro], (lista, texto, f) =>
    lista.filter(app => aplicaFiltro(app, f) && (!texto || app.nombre.toLowerCase().includes(texto))))
  // El recorte a `APPS_VISIBLES` es lo que hace utilizable esta tarjeta: con ~1600 paquetes,
  // pintarlos todos construye 1600 filas de tres widgets cada una dentro de un ScrolledWindow que
  // no virtualiza nada. Se enseñan doce y el resto entra bajo demanda.
  const visibles = createComputed([filtradas, expandido], (lista, abierto) =>
    abierto ? lista : lista.slice(0, APPS_VISIBLES))

  return (
    <TarjetaAjustes titulo={textos.grupos.apps} icono="󰏖">
      <box orientation={Gtk.Orientation.VERTICAL} spacing={8} cssClasses={["dev-row"]}>
        <TextoInformativo label={textos.apps.descripcion} wrap xalign={0} maxWidthChars={62} />
        <label
          cssClasses={["alm-totales"]}
          halign={Gtk.Align.START}
          label={filtradas((lista: App[]) => formatearTexto(textos.apps.totales, {
            numero: lista.length,
            tamano: formatearBytes(lista.reduce((suma, app) => suma + app.bytes, 0)),
          }))}
        />
        <entry
          cssClasses={["account-entry", "alm-buscador"]}
          placeholderText={textos.apps.buscar}
          hexpand
          onChanged={(self: Gtk.Entry) => setBusqueda(self.text.trim().toLowerCase())}
        />
        <box spacing={6}>
          {FILTROS.map(f => (
            <BotonAjustes
              activo={filtro((actual: FiltroApps) => actual === f.id)}
              onClicked={() => { setFiltro(f.id); setExpandido(false) }}
            >
              <label label={f.etiqueta} />
            </BotonAjustes>
          ))}
        </box>
      </box>

      <box orientation={Gtk.Orientation.VERTICAL}>
        {/* `id` por NOMBRE de paquete: sin él, `<For>` indexa por identidad de objeto y cada
            pulsación en el buscador reconstruiría las doce filas enteras — el mismo fallo que
            documenta la barra en el CLAUDE.md de ags. El nombre es único por definición. */}
        <For each={visibles} id={(app: App) => app.nombre}>
          {(app: App) => (
            <box spacing={10} cssClasses={["dev-row", "alm-app"]} valign={Gtk.Align.CENTER}>
              <box orientation={Gtk.Orientation.VERTICAL} spacing={2} hexpand>
                <box spacing={6}>
                  <label cssClasses={["sp-field-label"]} label={app.nombre} halign={Gtk.Align.START} />
                  <label
                    cssClasses={["alm-etiqueta", app.origen]}
                    label={app.origen === "aur" ? textos.apps.origenAur : textos.apps.origenRepo}
                  />
                  <label
                    cssClasses={["alm-etiqueta", app.explicito ? "explicita" : "dependencia"]}
                    label={app.explicito ? textos.apps.explicita : textos.apps.dependencia}
                  />
                </box>
                <TextoInformativo label={app.descripcion} wrap xalign={0} maxWidthChars={58} />
              </box>
              <label cssClasses={["alm-tamano"]} label={formatearBytes(app.bytes)} valign={Gtk.Align.START} />
            </box>
          )}
        </For>
      </box>

      <box cssClasses={["dev-row"]} visible={filtradas((lista: App[]) => lista.length === 0)}>
        <TextoInformativo label={textos.apps.sinResultados} />
      </box>
      <box
        cssClasses={["dev-row"]}
        visible={filtradas((lista: App[]) => lista.length > APPS_VISIBLES)}
      >
        <BotonAjustes onClicked={() => setExpandido(!expandido.get())} halign={Gtk.Align.START}>
          <label label={expandido((abierto: boolean) => abierto ? textos.apps.verMenos : textos.apps.verMas)} />
        </BotonAjustes>
      </box>
    </TarjetaAjustes>
  )
}

// ── Vistas ───────────────────────────────────────────────────────────────────

function VistaUso() {
  const [analisis, analizando, refrescar] = usarAnalisis()

  return (
    <box orientation={Gtk.Orientation.VERTICAL} spacing={14} cssClasses={["sp-section", "dev-section", "alm-section"]} hexpand>
      <TituloSeccion titulo={textos.vistas.uso} />

      <box spacing={10} valign={Gtk.Align.CENTER}>
        <label
          cssClasses={["sp-field-hint"]}
          hexpand
          halign={Gtk.Align.START}
          label={analisis((a: Analisis) => a.epoch
            ? formatearTexto(textos.seccion.ultimoAnalisis, { fecha: formatearFecha(a.epoch) })
            : textos.seccion.sinAnalisis)}
        />
        <Gtk.Spinner spinning={analizando} visible={analizando} />
        <BotonAjustes onClicked={refrescar} sensitive={analizando((esta: boolean) => !esta)}>
          <label label={textos.seccion.reanalizar} />
        </BotonAjustes>
      </box>

      <With value={analisis}>
        {(a: Analisis) => {
          if (!a.epoch) {
            return (
              <box cssClasses={["alm-cargando"]} spacing={10} halign={Gtk.Align.CENTER} valign={Gtk.Align.CENTER}>
                <Gtk.Spinner spinning={true} />
                <label label={textos.seccion.analizando} />
              </box>
            )
          }
          const grupos = agrupar(a.categorias)
          return (
            <box orientation={Gtk.Orientation.VERTICAL} spacing={12}>
              <TarjetaAjustes titulo={textos.grupos.discos} icono="󰋊">
                {a.discos.map(disco => <BarraDisco disco={disco} />)}
              </TarjetaAjustes>
              <TarjetaAjustes titulo={textos.grupos.sistema} icono="󰒓">
                {grupos.sistema.map(fila => <FilaCategoriaVista fila={fila} tras={refrescar} />)}
              </TarjetaAjustes>
              <TarjetaAjustes titulo={textos.grupos.personal} icono="󰋜">
                {grupos.personal.map(fila => <FilaCategoriaVista fila={fila} tras={refrescar} />)}
              </TarjetaAjustes>
              <CatalogoApps apps={analisis((x: Analisis) => x.apps)} />
            </box>
          )
        }}
      </With>
    </box>
  )
}

function AccionManual({ id, tras }: { id: IdAccion; tras: () => void }) {
  const meta = buscarAccion(id)!
  const [ocupado, setOcupado] = createState(false)
  const [resultado, setResultado] = createState<ResultadoLimpieza | null>(null)

  let vivo = true
  onCleanup(() => { vivo = false })

  const ejecutar = () => {
    if (ocupado.get()) return
    setOcupado(true)
    setResultado(null)
    ejecutarLimpieza(id).then(r => {
      if (!vivo) return
      setOcupado(false)
      setResultado(r)
      if (r.estado === "ok") tras()
    })
  }

  return (
    <box orientation={Gtk.Orientation.VERTICAL} spacing={4} cssClasses={["dev-row"]}>
      <box spacing={12} valign={Gtk.Align.CENTER}>
        <box orientation={Gtk.Orientation.VERTICAL} spacing={2} hexpand>
          <label cssClasses={["sp-field-label"]} label={meta.etiqueta} halign={Gtk.Align.START} />
          <TextoInformativo label={meta.descripcion} wrap xalign={0} maxWidthChars={58} />
        </box>
        <BotonAjustes
          variante={meta.peligrosa ? "secundario" : "principal"}
          onClicked={ejecutar}
          sensitive={ocupado((esta: boolean) => !esta)}
        >
          <label label={ocupado((esta: boolean) => esta ? textos.estados.limpiando : meta.etiqueta)} />
        </BotonAjustes>
      </box>
      <With value={resultado}>
        {(r: ResultadoLimpieza | null) =>
          r ? <TextoInformativo cssClasses={["alm-resultado", r.estado]} label={textoResultado(r)} wrap xalign={0} maxWidthChars={60} />
            : <box />}
      </With>
    </box>
  )
}

function VistaLimpieza() {
  const [analisis, , refrescar] = usarAnalisis()
  const [marcadas, setMarcadas] = createState(ACCIONES_AUTOMATIZABLES.filter(id => accionAutomatica(id).get()))
  const [ejecutando, setEjecutando] = createState(false)

  let vivo = true
  onCleanup(() => { vivo = false })

  const alternar = (id: IdAccion) => {
    const nuevo = !accionAutomatica(id).get()
    setAccionAutomatica(id, nuevo)
    // La estimación se recalcula desde la lista de marcadas, no suscribiéndose a los doce
    // accessors: un solo state que se reemite una vez por clic en vez de doce recomputaciones.
    setMarcadas(ACCIONES_AUTOMATIZABLES.filter(otro => accionAutomatica(otro).get()))
  }

  const ejecutarAhora = () => {
    if (ejecutando.get()) return
    setEjecutando(true)
    limpiarAhora()
      .catch(() => {})
      .finally(() => {
        if (!vivo) return
        setEjecutando(false)
        refrescar()
      })
  }

  return (
    <box orientation={Gtk.Orientation.VERTICAL} spacing={14} cssClasses={["sp-section", "dev-section", "alm-section"]} hexpand>
      <TituloSeccion titulo={textos.vistas.limpieza} />

      <TarjetaAjustes titulo={textos.auto.titulo} icono="󰃢">
        <AjusteInterruptor
          titulo={textos.auto.activar.titulo}
          informacion={textos.auto.activar.descripcion}
          activo={autoLimpieza}
          alAlternar={() => setAutoLimpieza(!autoLimpieza.get())}
        />
        <FilaAjuste titulo={textos.auto.intervalo.titulo} informacion={textos.auto.intervalo.descripcion}>
          <CampoNumerico valor={intervaloHoras} minimo={1} maximo={720} caracteres={3} relleno={1} alConfirmar={setIntervaloHoras} />
        </FilaAjuste>
        <FilaAjuste titulo={textos.auto.umbral.titulo} informacion={textos.auto.umbral.descripcion}>
          <CampoNumerico valor={umbralUso} minimo={0} maximo={100} caracteres={3} relleno={1} alConfirmar={setUmbralUso} />
        </FilaAjuste>
        <FilaAjuste titulo={textos.auto.retencion.titulo} informacion={textos.auto.retencion.descripcion}>
          <entry
            cssClasses={["sp-num-input"]}
            widthChars={6}
            xalign={0.5}
            $={(self: Gtk.Entry) => {
              self.set_text(retenerJournal.get())
              onCleanup(retenerJournal.subscribe(() => {
                if (!self.has_focus) self.set_text(retenerJournal.get())
              }))
            }}
            onActivate={(self: Gtk.Entry) => {
              setRetenerJournal(self.get_text())
              // Se reescribe SIEMPRE desde el estado, no desde lo tecleado: `setRetenerJournal`
              // rechaza los formatos inválidos en silencio, y sin esto el campo se quedaría
              // enseñando un valor que no se ha guardado.
              self.set_text(retenerJournal.get())
            }}
          />
        </FilaAjuste>
        <FilaAjuste titulo={textos.auto.diasPapelera.titulo} informacion={textos.auto.diasPapelera.descripcion}>
          <CampoNumerico valor={diasPapelera} minimo={0} maximo={3650} caracteres={4} relleno={1} alConfirmar={setDiasPapelera} />
        </FilaAjuste>
        <FilaAjuste titulo={textos.auto.diasDescargas.titulo} informacion={textos.auto.diasDescargas.descripcion}>
          <CampoNumerico valor={diasDescargas} minimo={0} maximo={3650} caracteres={4} relleno={1} alConfirmar={setDiasDescargas} />
        </FilaAjuste>
        <AjusteInterruptor
          titulo={textos.auto.notificar.titulo}
          informacion={textos.auto.notificar.descripcion}
          activo={notificarLimpieza}
          alAlternar={() => setNotificarLimpieza(!notificarLimpieza.get())}
        />
      </TarjetaAjustes>

      <TarjetaAjustes titulo={textos.auto.queLimpiar} icono="󰄬">
        {/* El `.map` va DENTRO de una caja y no suelto junto a la fila de abajo. Un array como
            hijo directo se aplana; DOS hijos donde uno es un array llegan a `Fragment.append` sin
            aplanar y revientan con «Object … is not a subclass of GObject_Object, it's a Array»,
            que además tumba la construcción de la sección entera. Medido: con el array suelto,
            abrir «Liberar espacio» dejaba el panel vacío y el shell escupiendo esa traza. */}
        <box orientation={Gtk.Orientation.VERTICAL}>
          {ACCIONES_AUTOMATIZABLES.map(id => {
            const meta = buscarAccion(id)!
            return (
              <AjusteInterruptor
                titulo={meta.etiqueta}
                informacion={meta.descripcion}
                activo={accionAutomatica(id)}
                alAlternar={() => alternar(id)}
              />
            )
          })}
        </box>
        <box orientation={Gtk.Orientation.VERTICAL} spacing={8} cssClasses={["dev-row"]}>
          {/* Depende de las DOS fuentes. Con `marcadas` sola —leyendo el análisis con `.get()`—
              la cifra se quedaba congelada en la del análisis cacheado: el nuevo llega segundos
              después de abrir la sección y no reemitía nada, así que la estimación contradecía
              al desglose de la vista de al lado hasta que tocaras una casilla. */}
          <TextoInformativo
            label={createComputed([analisis, marcadas], (a: Analisis, activas: IdAccion[]) =>
              formatearTexto(textos.auto.estimacion, {
                tamano: formatearBytes(estimarLiberable(a.categorias, activas)),
              }))}
            wrap
            xalign={0}
            maxWidthChars={62}
          />
          <BotonAjustes
            variante="principal"
            onClicked={ejecutarAhora}
            sensitive={ejecutando((esta: boolean) => !esta)}
            halign={Gtk.Align.START}
          >
            <label label={ejecutando((esta: boolean) => esta ? textos.estados.limpiando : textos.auto.ejecutar)} />
          </BotonAjustes>
        </box>
      </TarjetaAjustes>

      {/* Manual: TODAS las acciones, también las que piden contraseña y por eso no salen arriba. */}
      <TarjetaAjustes titulo={textos.vistas.limpieza} icono="󰩹">
        {ACCIONES.map(meta => <AccionManual id={meta.id} tras={refrescar} />)}
      </TarjetaAjustes>
    </box>
  )
}

export default function SeccionAlmacenamiento({ vista }: { vista: VistaAlmacenamiento }) {
  return vista === "limpieza" ? <VistaLimpieza /> : <VistaUso />
}
