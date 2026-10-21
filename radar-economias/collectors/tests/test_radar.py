"""Pruebas de los parsers y de las reglas de vínculo con Chile.

    cd radar-economias/collectors && python -m unittest -v

Los nombres de víctimas son ficticios: las pruebas no deben fijar ni repetir
reivindicaciones reales.
"""

import unittest

from radar.brands import match_brand
from radar.core import cl_domains, mentions_chile
from radar.sources import deepdarkcti, hibp, ofac, phishing, ransomware

AT = "2026-10-21T00:00:00+00:00"


class ChileLink(unittest.TestCase):
    def test_cl_domains_exige_tld_completo(self):
        self.assertEqual(cl_domains("www.ejemplo.cl"), ["ejemplo.cl"])
        self.assertEqual(cl_domains("Colegio X (colegiox.cl)"), ["colegiox.cl"])
        for falso in ("www.cloudeurope.it/", "https://www.clatronic.com/", "www.mivideo.club", "www.tta.cls"):
            self.assertEqual(cl_domains(falso), [], falso)

    def test_mentions_chile(self):
        self.assertTrue(mentions_chile("Empresa Chilena de Ejemplo"))
        self.assertFalse(mentions_chile("Chilecito Foods"))


class Brands(unittest.TestCase):
    def test_marca_especifica(self):
        self.assertEqual(match_brand("login-personas-bancoestado-ingreso.cf").code, "BANCOESTADO")
        self.assertEqual(match_brand("bancoestadochile.club").code, "BANCOESTADO")

    def test_marca_regional_exige_senal_de_chile(self):
        self.assertIsNone(match_brand("santander-uk-secure.com"))
        self.assertEqual(match_brand("santander-cl-acceso.top").code, "SANTANDER_CL")
        self.assertEqual(match_brand("itau.cl.verifica-cuenta.xyz").code, "ITAU_CL")

    def test_tokens_cortos_solo_como_etiqueta(self):
        self.assertIsNone(match_brand("budapest-hotel.cl"))
        self.assertIsNone(match_brand("abci-news.cl"))
        self.assertEqual(match_brand("bci.cl-seguro.com").code, "BCI")

    def test_dominio_oficial_no_cuenta(self):
        self.assertIsNone(match_brand("bancoestado.cl"))
        self.assertIsNone(match_brand("www.bancoestado.cl"))
        self.assertIsNone(match_brand("personas.bancoestado.cl"))


class Phishing(unittest.TestCase):
    def test_parse_deduplica_y_acepta_urls(self):
        lines = ["bancoestado-portal-personas-cl.ml", "https://bancoestado-portal-personas-cl.ml/login",
                 "# comentario", "", "google.com"]
        evs = phishing.parse_lines(lines, "OPENPHISH", AT, "u")
        self.assertEqual(len(evs), 1)
        self.assertEqual(evs[0].evidence["indicator"], "bancoestado-portal-personas-cl[.]ml")


class Ransomware(unittest.TestCase):
    def test_ransomwatch_filtra_chile(self):
        posts = [
            {"post_title": "www.empresaficticia.cl", "group_name": "grupoa", "discovered": "2025-02-26 18:34:51"},
            {"post_title": "www.cloudeurope.it/", "group_name": "grupob", "discovered": "2024-07-16 20:36:31"},
            {"post_title": "Corporación Chilena Ficticia", "group_name": "grupoc", "discovered": "2024-01-01 00:00:00"},
        ]
        evs = {e.actor: e for e in ransomware.parse_ransomwatch(posts, AT, "u")}
        self.assertEqual(sorted(evs), ["grupoa", "grupoc"])
        self.assertEqual(evs["grupoa"].chile_link["confidence"], "alta")
        self.assertEqual(evs["grupoa"].event_date, "2025-02-26")
        self.assertEqual(evs["grupoc"].chile_link["confidence"], "media")

    def test_ransomwatch_republicacion_es_un_evento(self):
        posts = [
            {"post_title": "ficticia.cl\\$25.1M\\Chile\\460GB\\100%DISCLOSED", "group_name": "g", "discovered": "2024-05-20"},
            {"post_title": "ficticia.cl\\$25.1M\\Chile\\460GB\\1%DISCLOSED", "group_name": "g", "discovered": "2024-05-13"},
        ]
        evs = ransomware.parse_ransomwatch(posts, AT, "u")
        self.assertEqual(len(evs), 1)
        self.assertEqual((evs[0].title, evs[0].event_date), ("ficticia.cl", "2024-05-13"))
        self.assertEqual(evs[0].attributes["republications"], 1)

    def test_ransomware_live_tolera_campos(self):
        items = [
            {"victim": "Ficticia SpA", "group": "grupoa", "country": "CL", "discovered": "2026-09-01 10:00:00",
             "attackdate": "2026-08-30", "activity": "Financial Services", "domain": "www.ficticia.cl"},
            {"post_title": "Otra Ficticia", "group_name": "grupob", "country": "AR", "published": "2026-09-02"},
        ]
        evs = ransomware.parse_ransomware_live(items, AT, "u")
        self.assertEqual(evs[0].scope, "CL")
        self.assertEqual(evs[0].chile_link["confidence"], "alta")
        self.assertEqual(evs[0].event_date, "2026-08-30")
        self.assertEqual(evs[0].target["domain"], "ficticia.cl")
        self.assertEqual(evs[1].scope, "GLOBAL")


    def test_pais_del_agregador_sin_senal_es_confianza_baja(self):
        items = [{"victim": "Ficticia Chilis Restaurants", "group": "g", "country": "CL",
                  "discovered": "2026-10-12", "domain": "ficticiachilis.com", "activity": "Not Found"}]
        ev = ransomware.parse_ransomware_live(items, AT, "u")[0]
        self.assertEqual(ev.chile_link["confidence"], "baja")
        self.assertIsNone(ev.target["sector"])


class Hibp(unittest.TestCase):
    def test_solo_servicios_chilenos_y_sin_spam(self):
        breaches = [
            {"Name": "Ficticia", "Title": "Ficticia", "Domain": "ficticia.cl", "BreachDate": "2024-05-01", "PwnCount": 10},
            {"Name": "Lista", "Title": "Lista", "Domain": "lista.cl", "IsSpamList": True},
            {"Name": "Otra", "Title": "Otra", "Domain": "otra.com", "Description": "A Spanish retailer"},
        ]
        evs = hibp.parse(breaches, AT)
        self.assertEqual([e.title for e in evs], ["Ficticia"])


class Ofac(unittest.TestCase):
    def test_primer_corte_es_linea_base(self):
        self.assertEqual(ofac.diff_events({"TRX": ["T1"]}, None, AT, "b/"), [])

    def test_nuevas_designaciones(self):
        evs = ofac.diff_events({"TRX": ["T1", "T2"], "ETH": ["0x1"]}, {"TRX": ["T1"]}, AT, "b/")
        self.assertEqual([e.target["address"] for e in evs], ["T2"])


class DeepDarkCti(unittest.TestCase):
    MD = (
        "|Name|Status|Description|\n| ------ | ------ | ------ |\n"
        "|[Mercado Uno](http://abcdefabcdefabcdef.onion)| ONLINE | |\n"
        "|[CVV Shop](https://cvv.example)| OFFLINE | |\n"
    )
    TG = (
        "|Telegram|Status|Threat Actor Name|Type of attacks|\n|------|------|------|------|\n"
        "|https://t.me/canal|ONLINE|Grupo LATAM chat|DDoS|\n"
    )

    def test_parse_descarta_urls(self):
        rows = deepdarkcti.parse_table(self.MD)
        self.assertEqual([r["name"] for r in rows], ["Mercado Uno", "CVV Shop"])
        self.assertNotIn("onion", str(rows))

    def test_resumen_y_region(self):
        rows = deepdarkcti.parse_table(self.TG)
        self.assertEqual(rows[0]["name"], "Grupo LATAM chat")
        self.assertNotIn("t.me", str(rows))
        evs = deepdarkcti.regional_events("Canales", rows, AT, "u")
        self.assertEqual(evs[0].scope, "LATAM")
        s = deepdarkcti.summarize("Mercados", deepdarkcti.parse_table(self.MD))
        self.assertEqual((s["active"], s["inactive"]), (1, 1))
        self.assertEqual(s["active_by_kind"], {"general": 1})


if __name__ == "__main__":
    unittest.main()
