"""beta.28 : adresses de chantier portées par le tour (texte + GPS), pré-remplissage
étendu (chargement = livraison précédente ; livraison = dernier chantier si la
livraison précédente était un site permanent), RPC adresses_chantier, down."""

from pathlib import Path

from conftest import as_postgres

ROOT = Path(__file__).resolve().parents[2]
DOWN = ROOT / "supabase" / "down"


def test_colonnes_adresse_chantier(conn):
    as_postgres(conn)
    with conn.cursor() as cur:
        cur.execute(
            "SELECT count(*) FROM information_schema.columns "
            "WHERE table_schema='bon' AND table_name='tours' AND column_name IN "
            "('chargement_adresse','chargement_lat','chargement_lon',"
            "'dechargement_adresse','dechargement_lat','dechargement_lon')"
        )
        assert cur.fetchone()[0] == 6
        # exposées par la vue api.tours
        cur.execute(
            "SELECT count(*) FROM information_schema.columns "
            "WHERE table_schema='api' AND table_name='tours' "
            "AND column_name IN ('chargement_adresse','dechargement_adresse')"
        )
        assert cur.fetchone()[0] == 2


def _new_lv(cur, actors):
    cur.execute("INSERT INTO bon.projets (client_id, nom) VALUES (%s,'P28') RETURNING id", (actors["client_id"],))
    projet = cur.fetchone()[0]
    cur.execute(
        "INSERT INTO bon.lettres_voiture (projet_id, client_id, owner_email) VALUES (%s,%s,%s) RETURNING id",
        (projet, actors["client_id"], actors["chauffeur"]),
    )
    return cur.fetchone()[0]


def test_prefill_adresse_de_chantier(conn, actors):
    as_postgres(conn)
    with conn.cursor() as cur:
        lv = _new_lv(cur, actors)
        # Tour 1 : livraison = adresse de chantier libre.
        cur.execute(
            "INSERT INTO bon.tours (lv_id, dechargement_adresse, dechargement_lat, dechargement_lon) "
            "VALUES (%s,'Chantier X, Lagny',48.1,2.2) RETURNING ordre",
            (lv,),
        )
        assert cur.fetchone()[0] == 1
        # Tour 2 : rien fourni -> chargement reprend l'adresse de chantier précédente.
        cur.execute(
            "INSERT INTO bon.tours (lv_id) VALUES (%s) "
            "RETURNING chargement_adresse, chargement_lat, site_chargement_id",
            (lv,),
        )
        charg_adr, charg_lat, charg_site = cur.fetchone()
        assert charg_adr == "Chantier X, Lagny"
        assert float(charg_lat) == 48.1
        assert charg_site is None


def test_prefill_livraison_depuis_site_permanent(conn, actors):
    as_postgres(conn)
    with conn.cursor() as cur:
        lv = _new_lv(cur, actors)
        cur.execute("INSERT INTO bon.sites (nom, portee) VALUES ('Centrale28','commun') RETURNING id")
        centrale = cur.fetchone()[0]
        # Tour 1 : livraison = adresse de chantier.
        cur.execute("INSERT INTO bon.tours (lv_id, dechargement_adresse) VALUES (%s,'Chantier Lot 3')", (lv,))
        # Tour 2 : livraison = site permanent.
        cur.execute("INSERT INTO bon.tours (lv_id, site_dechargement_id) VALUES (%s,%s)", (lv, centrale))
        # Tour 3 : rien -> chargement = centrale ; livraison = dernier chantier (Lot 3).
        cur.execute(
            "INSERT INTO bon.tours (lv_id) VALUES (%s) "
            "RETURNING site_chargement_id, dechargement_adresse",
            (lv,),
        )
        charg_site, dech_adr = cur.fetchone()
        assert charg_site == centrale
        assert dech_adr == "Chantier Lot 3"


def test_rpc_adresses_chantier(conn, actors):
    as_postgres(conn)
    with conn.cursor() as cur:
        lv = _new_lv(cur, actors)
        cur.execute(
            "INSERT INTO bon.tours (lv_id, chargement_adresse, dechargement_adresse) "
            "VALUES (%s,'Depart A','Chantier Y')",
            (lv,),
        )
        cur.execute("SELECT adresse, client_id, nb FROM bon.adresses_chantier(%s) ORDER BY adresse", (actors["client_id"],))
        rows = cur.fetchall()
        adresses = {r[0] for r in rows}
        assert "Chantier Y" in adresses and "Depart A" in adresses
        # même client en tête
        assert all(r[1] == actors["client_id"] for r in rows)


def test_down_executable(conn):
    as_postgres(conn)
    sql = (DOWN / "0026_down.sql").read_text(encoding="utf-8")
    with conn.cursor() as cur:
        cur.execute(sql)
        # colonnes retirées
        cur.execute(
            "SELECT count(*) FROM information_schema.columns "
            "WHERE table_schema='bon' AND table_name='tours' AND column_name='chargement_adresse'"
        )
        assert cur.fetchone()[0] == 0
        # RPC retirée
        cur.execute("SELECT count(*) FROM pg_proc WHERE proname='adresses_chantier'")
        assert cur.fetchone()[0] == 0
    conn.rollback()  # ne pas laisser le schéma dégradé pour les autres tests
