"""
Pruebas del motor de selección de fondos.

    python3 -m unittest discover -s hypr/scripts/lib -p '*_test.py'

Todo lo que aquí se comprueba es determinista: el módulo es puro, así que la hora
y el generador aleatorio entran por parámetro. `random.Random(semilla)` fija el
sorteo, y donde importa el reparto y no una elección concreta se cuenta sobre
muchas tiradas.
"""

import random
import unittest

import seleccion_fondos as sf


D = "/w/dia.png"
T = "/w/tarde.png"
N = "/w/noche.png"
G1, G2 = "/w/g_dia.png", "/w/g_noche.png"
G3 = "/w/g_noche_b.png"

TODOS = {D, T, N, G1, G2, G3}

FRANJAS = [
    {"id": "dia",   "start": "07:00"},
    {"id": "tarde", "start": "18:30"},
    {"id": "noche", "start": "21:30"},
]

CFG = {
    "version": 1,
    "franjas": FRANJAS,
    "grupos": [{
        "id": "g1",
        "nombre": "Lofi",
        "tramos": [
            {"start": "07:00", "paths": [G1]},
            {"start": "21:30", "paths": [G2, G3]},
        ],
    }],
    "fondos": {
        D: {"franjas": ["dia"]},
        T: {"franjas": ["tarde", "noche"]},
        N: {"franjas": ["noche"]},
    },
}


def h(hhmm):
    return sf.a_minutos(hhmm)


class Horas(unittest.TestCase):
    def test_parseo(self):
        self.assertEqual(sf.a_minutos("00:00"), 0)
        self.assertEqual(sf.a_minutos("07:30"), 450)
        self.assertEqual(sf.a_minutos("23:59"), 1439)

    def test_basura_no_lanza(self):
        for malo in [None, "", "7", "25:00", "07:60", "aa:bb", 7, "07:00:00"]:
            self.assertIsNone(sf.a_minutos(malo))


class FranjaVigente(unittest.TestCase):
    def test_dentro_del_dia(self):
        self.assertEqual(sf.franja_actual(CFG, h("07:00")), "dia")
        self.assertEqual(sf.franja_actual(CFG, h("12:00")), "dia")
        self.assertEqual(sf.franja_actual(CFG, h("18:30")), "tarde")
        self.assertEqual(sf.franja_actual(CFG, h("21:29")), "tarde")
        self.assertEqual(sf.franja_actual(CFG, h("23:00")), "noche")

    def test_antes_del_primer_inicio_manda_la_de_ayer(self):
        # 00:30 con la primera franja a las 07:00: rige "noche", que viene de
        # ayer. Es el caso que se olvida al escribir esta lógica a mano.
        self.assertEqual(sf.franja_actual(CFG, h("00:30")), "noche")
        self.assertEqual(sf.franja_actual(CFG, h("06:59")), "noche")

    def test_sin_franjas(self):
        self.assertIsNone(sf.franja_actual({}, 600))


class Aptitud(unittest.TestCase):
    def test_respeta_la_declaracion(self):
        self.assertTrue(sf.es_apto(CFG, D, h("12:00")))
        self.assertFalse(sf.es_apto(CFG, D, h("23:00")))
        self.assertTrue(sf.es_apto(CFG, T, h("23:00")))

    def test_sin_declaracion_es_apto_siempre(self):
        # Un fondo recién copiado a la carpeta no puede quedar invisible sin que
        # nadie lo haya pedido.
        for hora in ["03:00", "12:00", "23:00"]:
            self.assertTrue(sf.es_apto(CFG, "/w/nuevo.png", h(hora)))

    def test_lista_vacia_es_apto_siempre(self):
        cfg = {**CFG, "fondos": {D: {"franjas": []}}}
        self.assertTrue(sf.es_apto(cfg, D, h("23:00")))

    def test_sin_franjas_globales_todo_es_apto(self):
        cfg = {"fondos": {D: {"franjas": ["dia"]}}}
        self.assertTrue(sf.es_apto(cfg, D, h("23:00")))


class TramosDeGrupo(unittest.TestCase):
    def setUp(self):
        self.grupo = CFG["grupos"][0]

    def test_tramo_vigente(self):
        self.assertEqual(sf.tramo_actual(self.grupo, h("12:00"), TODOS), [G1])
        self.assertEqual(sf.tramo_actual(self.grupo, h("22:00"), TODOS), [G2, G3])

    def test_envuelve_medianoche(self):
        self.assertEqual(sf.tramo_actual(self.grupo, h("03:00"), TODOS), [G2, G3])

    def test_tramo_vacio_deja_al_grupo_fuera(self):
        grupo = {"id": "g", "tramos": [
            {"start": "07:00", "paths": [G1]},
            {"start": "21:30", "paths": []},
        ]}
        self.assertEqual(sf.tramo_actual(grupo, h("23:00"), TODOS), [])

    def test_imagenes_desaparecidas_dejan_al_grupo_fuera(self):
        # Mismo efecto que un tramo vacío, sin que nadie haya editado la config.
        self.assertEqual(sf.tramo_actual(self.grupo, h("22:00"), {D, T, N}), [])

    def test_tramo_a_medias_conserva_lo_que_queda(self):
        self.assertEqual(sf.tramo_actual(self.grupo, h("22:00"), TODOS - {G3}), [G2])


class Candidatos(unittest.TestCase):
    def test_el_grupo_cuenta_como_UNA_entidad(self):
        # Dos variantes de noche, pero el grupo aporta una sola entrada: si
        # aportara una por variante, agrupar multiplicaría sus posibilidades de
        # salir frente a un fondo suelto.
        ops = sf.candidatos(CFG, h("22:00"), TODOS)
        grupos = [o for o in ops if o[0] == "g1"]
        self.assertEqual(len(grupos), 1)
        self.assertEqual(grupos[0][1], [G2, G3])

    def test_las_imagenes_de_un_grupo_no_compiten_sueltas(self):
        ops = sf.candidatos(CFG, h("12:00"), TODOS)
        sueltas = {o[1][0] for o in ops if o[0] is None}
        self.assertNotIn(G1, sueltas)
        self.assertNotIn(G2, sueltas)

    def test_filtra_por_franja(self):
        ops = sf.candidatos(CFG, h("23:00"), TODOS)
        sueltas = {o[1][0] for o in ops if o[0] is None}
        self.assertEqual(sueltas, {T, N})   # D es solo de día

    def test_grupo_sin_tramo_vigente_no_es_candidato(self):
        cfg = {**CFG, "grupos": [{"id": "g1", "tramos": [
            {"start": "07:00", "paths": [G1]},
            {"start": "21:30", "paths": []},
        ]}]}
        ops = sf.candidatos(cfg, h("23:00"), TODOS)
        self.assertEqual([o for o in ops if o[0] == "g1"], [])


class Sorteo(unittest.TestCase):
    def test_solo_devuelve_candidatos_validos(self):
        rng = random.Random(1)
        for _ in range(200):
            gid, ruta = sf.elegir(CFG, h("23:00"), TODOS, rng)
            if gid == "g1":
                self.assertIn(ruta, (G2, G3))
            else:
                self.assertIn(ruta, (T, N))

    def test_dentro_del_grupo_se_sortea_entre_las_del_tramo(self):
        rng = random.Random(7)
        vistas = {sf.elegir(CFG, h("23:00"), TODOS, rng)[1] for _ in range(200)}
        self.assertIn(G2, vistas)
        self.assertIn(G3, vistas)

    def test_evitar_no_repite_el_actual(self):
        rng = random.Random(3)
        for _ in range(100):
            self.assertNotEqual(
                sf.elegir(CFG, h("23:00"), TODOS, rng, evitar=(None, N))[1], N)

    def test_evitar_descarta_el_grupo_entero(self):
        rng = random.Random(3)
        for _ in range(100):
            self.assertNotEqual(
                sf.elegir(CFG, h("23:00"), TODOS, rng, evitar=("g1", G2))[0], "g1")

    def test_evitar_cede_si_es_el_unico_candidato(self):
        cfg = {"franjas": FRANJAS, "fondos": {D: {"franjas": ["dia"]}}}
        self.assertEqual(sf.elegir(cfg, h("12:00"), {D}, evitar=(None, D)), (None, D))

    def test_franja_sin_candidatos_ignora_los_filtros(self):
        # Fail-open: es preferible un fondo "equivocado" —visible y corregible—
        # a un escritorio sin fondo.
        cfg = {"franjas": FRANJAS, "fondos": {
            D: {"franjas": ["dia"]}, T: {"franjas": ["dia"]}}}
        gid, ruta = sf.elegir(cfg, h("23:00"), {D, T}, random.Random(0))
        self.assertIsNone(gid)
        self.assertIn(ruta, (D, T))

    def test_sin_ficheros_no_hay_nada_que_aplicar(self):
        self.assertIsNone(sf.elegir(CFG, h("12:00"), set()))


class Decidir(unittest.TestCase):
    def test_el_grupo_conserva_identidad_y_muda_de_variante(self):
        estado = {"current": G1, "currentGroup": "g1"}
        self.assertEqual(
            sf.decidir(CFG, estado, h("22:00"), TODOS, random.Random(0))[0], "g1")
        self.assertIn(
            sf.decidir(CFG, estado, h("22:00"), TODOS, random.Random(0))[1], (G2, G3))

    def test_dentro_del_mismo_tramo_no_se_mueve(self):
        estado = {"current": G1, "currentGroup": "g1"}
        self.assertEqual(sf.decidir(CFG, estado, h("15:00"), TODOS), ("g1", G1))

    def test_un_tramo_con_varias_no_se_re_sortea_en_cada_pasada(self):
        # El planificador puede despertar más veces de las previstas (una
        # suspensión larga, un arranque dentro del tramo); sin `preferir`, el
        # fondo cambiaría sin haber cruzado ningún límite.
        estado = {"current": G3, "currentGroup": "g1"}
        for semilla in range(20):
            self.assertEqual(
                sf.decidir(CFG, estado, h("23:00"), TODOS, random.Random(semilla)),
                ("g1", G3))

    def test_grupo_sin_tramo_vigente_cede_al_sorteo(self):
        cfg = {**CFG, "grupos": [{"id": "g1", "tramos": [
            {"start": "07:00", "paths": [G1]},
            {"start": "21:30", "paths": []},
        ]}]}
        gid, ruta = sf.decidir(cfg, {"current": G1, "currentGroup": "g1"},
                               h("23:00"), TODOS, random.Random(0))
        self.assertNotEqual(gid, "g1")
        self.assertIn(ruta, (T, N))

    def test_grupo_borrado_de_la_config_cede_al_sorteo(self):
        cfg = {**CFG, "grupos": []}
        gid, _ = sf.decidir(cfg, {"current": G1, "currentGroup": "g1"},
                            h("12:00"), TODOS, random.Random(0))
        self.assertIsNone(gid)

    def test_fondo_suelto_apto_no_se_toca(self):
        self.assertEqual(
            sf.decidir(CFG, {"current": T}, h("19:00"), TODOS), (None, T))

    def test_fondo_suelto_no_apto_se_sustituye(self):
        # El motivo original de todo esto: nada claro de noche.
        for semilla in range(20):
            gid, ruta = sf.decidir(CFG, {"current": D}, h("23:00"), TODOS,
                                   random.Random(semilla))
            self.assertNotEqual(ruta, D)
            if gid is None:
                self.assertIn(ruta, (T, N))

    def test_fondo_desaparecido_del_disco_se_sustituye(self):
        gid, ruta = sf.decidir(CFG, {"current": "/w/borrado.png"}, h("12:00"),
                               TODOS, random.Random(0))
        self.assertNotEqual(ruta, "/w/borrado.png")

    def test_sin_estado_previo_elige(self):
        self.assertIsNotNone(sf.decidir(CFG, {}, h("12:00"), TODOS, random.Random(0)))

    def test_estado_corrupto_no_lanza(self):
        for estado in [{}, {"current": None}, {"currentGroup": 5},
                       {"current": 7, "currentGroup": ""}]:
            self.assertIsNotNone(
                sf.decidir(CFG, estado, h("12:00"), TODOS, random.Random(0)))


class ProximoCambio(unittest.TestCase):
    """Sin `estado` se miran TODOS los límites (modo conservador)."""

    def test_dentro_del_dia(self):
        self.assertEqual(sf.proximo_cambio(CFG, h("12:00")), h("18:30") - h("12:00"))

    def test_incluye_los_tramos_de_los_grupos(self):
        cfg = {"franjas": FRANJAS, "grupos": [
            {"id": "g", "tramos": [{"start": "05:00", "paths": [G1]}]}]}
        self.assertEqual(sf.proximo_cambio(cfg, h("03:00")), 120)

    def test_envuelve_a_manana(self):
        # 23:00 con el primer límite a las 07:00 -> 8 h, no un número negativo.
        self.assertEqual(sf.proximo_cambio(CFG, h("23:00")), 8 * 60)

    def test_justo_encima_de_un_limite_apunta_al_siguiente(self):
        # Nunca 0: un delta de 0 dejaría al planificador en un bucle cerrado.
        self.assertEqual(sf.proximo_cambio(CFG, h("18:30")), h("21:30") - h("18:30"))

    def test_sin_limites(self):
        self.assertIsNone(sf.proximo_cambio({}, 600))


class LimitesRelevantes(unittest.TestCase):
    """
    Lo que decide cuánto puede dormir el planificador. Vigilar de más significa
    despertar a horas en las que no hay absolutamente nada que hacer.
    """

    CFG2 = {
        "franjas": FRANJAS,
        "grupos": [
            {"id": "g1", "tramos": [{"start": "06:00", "paths": [G1]},
                                    {"start": "20:00", "paths": [G2]}]},
            {"id": "g2", "tramos": [{"start": "01:00", "paths": [G3]}]},
        ],
    }

    def test_con_un_grupo_puesto_solo_cuentan_SUS_tramos(self):
        # Ni las franjas globales (sus variantes no las miran) ni los tramos del
        # otro grupo (nada depende de ellos mientras no salga elegido).
        self.assertEqual(
            sf.limites_relevantes(self.CFG2, {"currentGroup": "g1"}),
            [h("06:00"), h("20:00")])

    def test_con_un_fondo_suelto_solo_cuentan_las_franjas_globales(self):
        self.assertEqual(
            sf.limites_relevantes(self.CFG2, {"current": D}),
            [h("07:00"), h("18:30"), h("21:30")])

    def test_sin_estado_es_como_un_fondo_suelto(self):
        self.assertEqual(sf.limites_relevantes(self.CFG2, {}),
                         [h("07:00"), h("18:30"), h("21:30")])

    def test_un_grupo_que_ya_no_existe_vigila_de_mas(self):
        # Estado incoherente: mejor vigilar de más que quedarse sin despertador.
        self.assertEqual(sf.limites_relevantes(self.CFG2, {"currentGroup": "fantasma"}),
                         sf.limites(self.CFG2))

    def test_un_grupo_sin_tramos_utilizables_vigila_de_mas(self):
        cfg = {"franjas": FRANJAS, "grupos": [{"id": "g1", "tramos": [{"start": "mal"}]}]}
        self.assertEqual(sf.limites_relevantes(cfg, {"currentGroup": "g1"}),
                         sf.limites(cfg))

    def test_el_delta_sale_de_los_relevantes(self):
        # Con g1 puesto a las 12:00 el siguiente suyo son las 20:00 (8 h), no las
        # 18:30 de la franja global — que es lo que devolvía el cálculo viejo.
        self.assertEqual(
            sf.proximo_cambio(self.CFG2, h("12:00"), {"currentGroup": "g1"}), 8 * 60)
        self.assertEqual(
            sf.proximo_cambio(self.CFG2, h("12:00"), {"current": D}),
            h("18:30") - h("12:00"))

    def test_sin_franjas_ni_grupo_no_hay_nada_que_programar(self):
        # Y entonces el planificador no arma NINGÚN temporizador.
        self.assertIsNone(sf.proximo_cambio({"grupos": self.CFG2["grupos"]}, 600, {}))

    def test_estado_corrupto_no_lanza(self):
        for estado in [{}, {"currentGroup": None}, {"currentGroup": 5}, {"currentGroup": ""}]:
            sf.limites_relevantes(self.CFG2, estado)


class ConfigCorrupta(unittest.TestCase):
    """Puede editarla el usuario a mano o venir de otra máquina."""

    def test_tipos_inesperados_no_lanzan(self):
        basura = [
            {}, {"franjas": "no"}, {"grupos": {}}, {"fondos": []},
            {"franjas": [None, 5, {"id": "x"}, {"start": "07:00"}]},
            {"grupos": [{"id": "g"}, {"tramos": [None]}, 3]},
            {"grupos": [{"id": "g", "tramos": [{"start": "mal", "paths": None}]}]},
        ]
        for cfg in basura:
            sf.franja_actual(cfg, 600)
            sf.candidatos(cfg, 600, TODOS)
            sf.limites(cfg)
            self.assertIsNotNone(sf.decidir(cfg, {}, 600, TODOS, random.Random(0)))


if __name__ == "__main__":
    unittest.main()
