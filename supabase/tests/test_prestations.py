"""Prestations : référentiels matériels/prestations (seed + RLS bureau/membre),
lignes lv_prestations rattachées à la LV (écriture par le propriétaire, figées si
LV signée), report de la dernière prestation du chauffeur."""

import psycopg
import pytest
from conftest import as_postgres, as_user

MATERIELS_ATTENDUS = {
    "15 t 6×4 bi-benne grue",
    "20 t 8×4 bi-benne",
    "20 t 8×4 bi-benne grue",
    "20 t 8×4 ampliroll grue",
    "Mini-pelle sur chenilles 2–2,8 t",
}

PRESTATIONS_ATTENDUES = {
    "Jour de régie avec chauffeur": "jour",
    "Heure supplémentaire jour": "heure",
    "Heure supplémentaire nuit": "heure",
    "Heure supplémentaire week-end": "heure",
    "Astreinte": "unite",
}


# --- Seed --------------------------------------------------------------------

def test_seed_materiels(conn):
    as_postgres(conn)
    with conn.cursor() as cur:
        cur.execute("SELECT libelle FROM bon.materiels WHERE created_by='seed'")
        libelles = {r[0] for r in cur.fetchall()}
    assert MATERIELS_ATTENDUS.issubset(libelles)
    assert len(MATERIELS_ATTENDUS & libelles) == 5


def test_seed_prestations(conn):
    as_postgres(conn)
    with conn.cursor() as cur:
        cur.execute(
            "SELECT libelle, unite_defaut, commentaire_interne, actif "
            "FROM bon.prestations WHERE created_by='seed'"
        )
        rows = cur.fetchall()
    found = {libelle: (unite, com, actif) for libelle, unite, com, actif in rows}
    for libelle, unite in PRESTATIONS_ATTENDUES.items():
        assert libelle in found, f"prestation manquante: {libelle}"
        got_unite, com, actif = found[libelle]
        assert got_unite == unite
        assert com is None            # commentaire_interne jamais imprimé, laissé NULL
        assert actif is True


# --- RLS référentiels --------------------------------------------------------

def test_chauffeur_voit_referentiels(conn, actors):
    as_user(conn, actors["chauffeur"])
    with conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM bon.materiels")
        assert cur.fetchone()[0] >= 5
        cur.execute("SELECT count(*) FROM bon.prestations")
        assert cur.fetchone()[0] >= 5


def test_chauffeur_ne_peut_pas_ecrire_materiels(conn, actors):
    as_user(conn, actors["chauffeur"])
    # INSERT matériel (écriture réservée au bureau) : refusé.
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute("INSERT INTO bon.materiels (libelle) VALUES ('Tombereau')")


def test_chauffeur_ne_peut_pas_modifier_prestations(conn, actors):
    # Écriture structurante (UPDATE/DELETE) d'une prestation réservée au bureau.
    as_user(conn, actors["chauffeur"])
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute("UPDATE bon.prestations SET actif=false WHERE created_by='seed'")


def test_chauffeur_peut_creer_prestation(conn, actors):
    # Comme pour bon.articles : un membre peut créer une prestation.
    as_user(conn, actors["chauffeur"])
    with conn.cursor() as cur:
        cur.execute("INSERT INTO bon.prestations (libelle) VALUES ('Prestation ad hoc')")
        cur.execute("SELECT count(*) FROM bon.prestations WHERE libelle='Prestation ad hoc'")
        assert cur.fetchone()[0] == 1


def test_bureau_peut_ecrire_referentiels(conn, actors):
    as_user(conn, actors["bureau"])
    with conn.cursor() as cur:
        cur.execute("INSERT INTO bon.materiels (libelle) VALUES ('Benne TP')")
        cur.execute("UPDATE bon.prestations SET actif=false WHERE created_by='seed'")
        cur.execute("SELECT count(*) FROM bon.materiels WHERE libelle='Benne TP'")
        assert cur.fetchone()[0] == 1


# --- lv_prestations ----------------------------------------------------------

def _lv_pour(conn, actors, owner, statut="en_cours"):
    """Crée (superuser) une LV appartenant à `owner` et renvoie son id."""
    as_postgres(conn)
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO bon.projets (client_id, nom) VALUES (%s,'Prest') RETURNING id",
            (actors["client_id"],),
        )
        projet = cur.fetchone()[0]
        cur.execute(
            "INSERT INTO bon.lettres_voiture (projet_id, chauffeur_id, owner_email, statut) "
            "VALUES (%s,%s,%s,%s) RETURNING id",
            (projet, actors["chauffeur_id"], owner, statut),
        )
        return cur.fetchone()[0]


def test_proprietaire_gere_ses_prestations(conn, actors):
    lv = _lv_pour(conn, actors, actors["chauffeur"])
    as_postgres(conn)
    with conn.cursor() as cur:
        cur.execute("SELECT id FROM bon.prestations LIMIT 1")
        prestation_id = cur.fetchone()[0]

    as_user(conn, actors["chauffeur"])
    with conn.cursor() as cur:
        # INSERT
        cur.execute(
            "INSERT INTO bon.lv_prestations (lv_id, prestation_id, quantite, unite, ordre) "
            "VALUES (%s,%s,1,'jour',1) RETURNING id",
            (lv, prestation_id),
        )
        ligne = cur.fetchone()[0]
        # SELECT
        cur.execute("SELECT count(*) FROM bon.lv_prestations WHERE lv_id=%s", (lv,))
        assert cur.fetchone()[0] == 1
        # UPDATE
        cur.execute("UPDATE bon.lv_prestations SET quantite=2 WHERE id=%s", (ligne,))
        # DELETE
        cur.execute("DELETE FROM bon.lv_prestations WHERE id=%s", (ligne,))
        cur.execute("SELECT count(*) FROM bon.lv_prestations WHERE lv_id=%s", (lv,))
        assert cur.fetchone()[0] == 0


def test_autre_chauffeur_ne_voit_pas(conn, actors):
    lv = _lv_pour(conn, actors, actors["chauffeur"])
    as_postgres(conn)
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO bon.lv_prestations (lv_id, ordre) VALUES (%s,1)", (lv,)
        )
    as_user(conn, actors["chauffeur2"])
    with conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM bon.lv_prestations WHERE lv_id=%s", (lv,))
        assert cur.fetchone()[0] == 0


def test_lv_signee_figee(conn, actors):
    lv = _lv_pour(conn, actors, actors["chauffeur"], statut="signee")
    as_user(conn, actors["chauffeur"])
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO bon.lv_prestations (lv_id, ordre) VALUES (%s,1)", (lv,)
                )


# --- derniere_prestation -----------------------------------------------------

def test_derniere_prestation(conn, actors):
    as_postgres(conn)
    with conn.cursor() as cur:
        cur.execute("SELECT id FROM bon.prestations ORDER BY id LIMIT 2")
        p1, p2 = (r[0] for r in cur.fetchall())
        cur.execute("SELECT id FROM bon.materiels ORDER BY id LIMIT 1")
        materiel = cur.fetchone()[0]
        cur.execute(
            "INSERT INTO bon.projets (client_id, nom) VALUES (%s,'DP1'),(%s,'DP2') RETURNING id",
            (actors["client_id"], actors["client_id"]),
        )
        pr = [r[0] for r in cur.fetchall()]
        # Ancienne LV (date antérieure) — ne doit PAS gagner.
        cur.execute(
            "INSERT INTO bon.lettres_voiture (projet_id, chauffeur_id, owner_email, "
            "date_etablissement) VALUES (%s,%s,%s,CURRENT_DATE - 2) RETURNING id",
            (pr[0], actors["chauffeur_id"], actors["chauffeur"]),
        )
        lv_vieille = cur.fetchone()[0]
        cur.execute(
            "INSERT INTO bon.lv_prestations (lv_id, prestation_id, ordre) VALUES (%s,%s,1)",
            (lv_vieille, p2),
        )
        # Dernière LV (date récente) avec deux lignes — la 1re (ordre asc) gagne.
        cur.execute(
            "INSERT INTO bon.lettres_voiture (projet_id, chauffeur_id, owner_email, "
            "date_etablissement) VALUES (%s,%s,%s,CURRENT_DATE) RETURNING id",
            (pr[1], actors["chauffeur_id"], actors["chauffeur"]),
        )
        lv_recente = cur.fetchone()[0]
        cur.execute(
            "INSERT INTO bon.lv_prestations (lv_id, prestation_id, quantite, unite, materiel_id, ordre) "
            "VALUES (%s,%s,3,'heure',%s,2)",
            (lv_recente, p2, materiel),
        )
        cur.execute(
            "INSERT INTO bon.lv_prestations (lv_id, prestation_id, quantite, unite, materiel_id, ordre) "
            "VALUES (%s,%s,1,'jour',%s,1)",
            (lv_recente, p1, materiel),
        )
        cur.execute("SELECT bon.derniere_prestation(%s)", (actors["chauffeur_id"],))
        r = cur.fetchone()[0]
    assert r is not None
    assert r["prestation_id"] == p1       # 1re prestation (ordre 1) de la dernière LV
    assert r["unite"] == "jour"
    assert float(r["quantite"]) == 1.0
    assert r["materiel_id"] == materiel


def test_derniere_prestation_vide(conn, actors):
    # Chauffeur sans aucune ligne de prestation => NULL.
    as_postgres(conn)
    with conn.cursor() as cur:
        cur.execute("SELECT bon.derniere_prestation(%s)", (actors["chauffeur_id"],))
        assert cur.fetchone()[0] is None
