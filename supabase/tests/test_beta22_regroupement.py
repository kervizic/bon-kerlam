"""beta.22 : modèle société -> adresses, regroupements, fusion réversible,
détection de doublons. S'appuie sur la base seed migrée (0022 + 0023)."""

from pathlib import Path

from conftest import as_postgres, as_user

ROOT = Path(__file__).resolve().parents[2]
DOWN = ROOT / "supabase" / "down"


# --------------------------------------------------------------------------- #
# 1) Schéma en place                                                          #
# --------------------------------------------------------------------------- #
def test_schema_objets(conn):
    as_postgres(conn)
    with conn.cursor() as cur:
        for t in ("client_adresses", "site_societes", "aliases", "fusions"):
            cur.execute("SELECT to_regclass(%s)", (f"bon.{t}",))
            assert cur.fetchone()[0] is not None, t
        # colonnes additives
        cur.execute(
            "SELECT count(*) FROM information_schema.columns "
            "WHERE table_schema='bon' AND table_name='clients' AND column_name='merged_into_id'"
        )
        assert cur.fetchone()[0] == 1
        cur.execute(
            "SELECT count(*) FROM information_schema.columns "
            "WHERE table_schema='bon' AND table_name='sites' AND column_name='societe_id'"
        )
        assert cur.fetchone()[0] == 1
        cur.execute(
            "SELECT count(*) FROM information_schema.columns "
            "WHERE table_schema='bon' AND table_name='lettres_voiture' "
            "AND column_name IN ('client_adresse_id','dest_adresse_id')"
        )
        assert cur.fetchone()[0] == 2


# --------------------------------------------------------------------------- #
# 2) Résultats de 0023 sur la base seed                                       #
# --------------------------------------------------------------------------- #
def test_societes_de_sites_creees(conn):
    as_postgres(conn)
    with conn.cursor() as cur:
        cur.execute("SELECT nom FROM bon.site_societes ORDER BY nom")
        noms = {r[0] for r in cur.fetchall()}
        assert {"YPREMA", "KERLAM", "Veolia", "Cemex", "RFM", "Asten", "SPME", "Sofrat"} <= noms


def test_cemex_vingt_adresses(conn):
    as_postgres(conn)
    with conn.cursor() as cur:
        cur.execute(
            "SELECT count(*) FROM bon.sites s JOIN bon.site_societes ss ON ss.id=s.societe_id "
            "WHERE ss.nom='Cemex' AND s.statut='actif'"
        )
        assert cur.fetchone()[0] == 20


def test_nombre_sites_par_societe(conn):
    as_postgres(conn)
    expected = {"RFM": 7, "SPME": 2, "Sofrat": 2, "Asten": 1, "YPREMA": 6, "KERLAM": 1, "Veolia": 2}
    with conn.cursor() as cur:
        for soc, n in expected.items():
            cur.execute(
                "SELECT count(*) FROM bon.sites s JOIN bon.site_societes ss ON ss.id=s.societe_id "
                "WHERE ss.nom=%s AND s.statut='actif' AND s.merged_into_id IS NULL",
                (soc,),
            )
            got = cur.fetchone()[0]
            assert got == n, (soc, got)


def test_32_nouveaux_sites_inseres(conn):
    as_postgres(conn)
    with conn.cursor() as cur:
        # 32 nouveaux + Veolia - Noisy = 33 lignes created_by='migration-0023'
        cur.execute("SELECT count(*) FROM bon.sites WHERE created_by='migration-0023'")
        assert cur.fetchone()[0] == 33


def test_veolia_sites_nommage(conn):
    as_postgres(conn)
    with conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM bon.sites WHERE nom='Veolia - Usine des Terres'")
        assert cur.fetchone()[0] == 1
        cur.execute("SELECT count(*) FROM bon.sites WHERE nom='Veolia - Noisy'")
        assert cur.fetchone()[0] == 1
        # ancien nom conservé en alias
        cur.execute(
            "SELECT count(*) FROM bon.aliases "
            "WHERE cible_type='site' AND alias='Veolia Noisy-le-Grand (usine des Terres)'"
        )
        assert cur.fetchone()[0] == 1


def test_yterres_fusionne_dans_yprema(conn):
    as_postgres(conn)
    with conn.cursor() as cur:
        cur.execute("SELECT id, merged_into_id, statut FROM bon.sites WHERE nom='Yterres Émerainville'")
        row = cur.fetchone()
        assert row is not None
        _, merged_into, statut = row
        assert merged_into is not None and statut == "termine"
        cur.execute("SELECT id FROM bon.sites WHERE nom='YPREMA Émerainville'")
        yprema = cur.fetchone()[0]
        assert merged_into == yprema
        # Yterres devient alias cherchable de YPREMA Émerainville
        cur.execute(
            "SELECT count(*) FROM bon.aliases "
            "WHERE cible_type='site' AND cible_id=%s AND alias='Yterres Émerainville'",
            (yprema,),
        )
        assert cur.fetchone()[0] == 1


# --------------------------------------------------------------------------- #
# 3) Backfill client_adresses + fusion CLIENTS réversible                      #
# --------------------------------------------------------------------------- #
def _mk_client(cur, rs, adresse, siren=None):
    cur.execute(
        "INSERT INTO bon.clients (raison_sociale, adresse, siren) VALUES (%s,%s,%s) RETURNING id",
        (rs, adresse, siren),
    )
    cid = cur.fetchone()[0]
    cur.execute(
        "INSERT INTO bon.client_adresses (client_id, libelle, adresse, is_principale) "
        "VALUES (%s,'Principale',%s,true)",
        (cid, adresse),
    )
    return cid


def test_fusion_clients_puis_annulation(conn, actors):
    as_postgres(conn)
    with conn.cursor() as cur:
        a = _mk_client(cur, "Veolia Eau Épinay", "2 rue Pasteur, 93800 Épinay", "524334943")
        b = _mk_client(cur, "Veolia Eau Noisy", "6 rue de la Plaine, 93160 Noisy", "524334943")
        # une lettre pointant sur b (expéditeur) et une sur b (destinataire)
        cur.execute(
            "INSERT INTO bon.lettres_voiture (client_id, owner_email) VALUES (%s,%s) RETURNING id",
            (b, actors["chauffeur"]),
        )
        lv1 = cur.fetchone()[0]
        cur.execute(
            "INSERT INTO bon.lettres_voiture (destinataire_client_id, owner_email) VALUES (%s,%s) RETURNING id",
            (b, actors["chauffeur"]),
        )
        lv2 = cur.fetchone()[0]

    # fusion en tant que bureau
    as_user(conn, actors["bureau"])
    with conn.cursor() as cur:
        cur.execute("SELECT api.fusionner_clients(%s, ARRAY[%s]::bigint[])", (a, b))

    as_postgres(conn)
    with conn.cursor() as cur:
        # b désactivé et rattaché à a
        cur.execute("SELECT merged_into_id, actif FROM bon.clients WHERE id=%s", (b,))
        assert cur.fetchone() == (a, False)
        # lettres réaffectées vers a
        cur.execute("SELECT client_id FROM bon.lettres_voiture WHERE id=%s", (lv1,))
        assert cur.fetchone()[0] == a
        cur.execute("SELECT destinataire_client_id FROM bon.lettres_voiture WHERE id=%s", (lv2,))
        assert cur.fetchone()[0] == a
        # a possède maintenant 2 adresses
        cur.execute("SELECT count(*) FROM bon.client_adresses WHERE client_id=%s", (a,))
        assert cur.fetchone()[0] == 2
        # nom de b devenu alias de a
        cur.execute(
            "SELECT count(*) FROM bon.aliases WHERE cible_type='client' AND cible_id=%s AND alias='Veolia Eau Noisy'",
            (a,),
        )
        assert cur.fetchone()[0] == 1
        cur.execute("SELECT id FROM bon.fusions WHERE type='client' AND garde_id=%s AND fusionne_id=%s", (a, b))
        fusion_id = cur.fetchone()[0]

    # annulation
    as_user(conn, actors["bureau"])
    with conn.cursor() as cur:
        cur.execute("SELECT api.fusion_annuler(%s)", (fusion_id,))

    as_postgres(conn)
    with conn.cursor() as cur:
        cur.execute("SELECT merged_into_id, actif FROM bon.clients WHERE id=%s", (b,))
        assert cur.fetchone() == (None, True)
        cur.execute("SELECT client_id FROM bon.lettres_voiture WHERE id=%s", (lv1,))
        assert cur.fetchone()[0] == b
        cur.execute("SELECT destinataire_client_id FROM bon.lettres_voiture WHERE id=%s", (lv2,))
        assert cur.fetchone()[0] == b
        cur.execute("SELECT count(*) FROM bon.client_adresses WHERE client_id=%s", (a,))
        assert cur.fetchone()[0] == 1
        cur.execute(
            "SELECT count(*) FROM bon.aliases WHERE cible_type='client' AND cible_id=%s AND alias='Veolia Eau Noisy'",
            (a,),
        )
        assert cur.fetchone()[0] == 0


def test_fusion_sites_reaffecte_tours(conn, actors):
    as_postgres(conn)
    with conn.cursor() as cur:
        cur.execute("INSERT INTO bon.sites (nom, portee) VALUES ('Site Garde','commun') RETURNING id")
        garde = cur.fetchone()[0]
        cur.execute("INSERT INTO bon.sites (nom, portee) VALUES ('Site Doublon','commun') RETURNING id")
        doublon = cur.fetchone()[0]
        cur.execute(
            "INSERT INTO bon.lettres_voiture (owner_email) VALUES (%s) RETURNING id",
            (actors["chauffeur"],),
        )
        lv = cur.fetchone()[0]
        cur.execute(
            "INSERT INTO bon.tours (lv_id, site_chargement_id) VALUES (%s,%s) RETURNING id",
            (lv, doublon),
        )
        tour = cur.fetchone()[0]
    as_user(conn, actors["bureau"])
    with conn.cursor() as cur:
        cur.execute("SELECT api.fusionner_sites(%s, ARRAY[%s]::bigint[])", (garde, doublon))
    as_postgres(conn)
    with conn.cursor() as cur:
        cur.execute("SELECT site_chargement_id FROM bon.tours WHERE id=%s", (tour,))
        assert cur.fetchone()[0] == garde
        cur.execute("SELECT merged_into_id, statut FROM bon.sites WHERE id=%s", (doublon,))
        assert cur.fetchone() == (garde, "termine")


# --------------------------------------------------------------------------- #
# 4) Détection de doublons (jamais de fusion automatique)                      #
# --------------------------------------------------------------------------- #
def test_doublons_clients_meme_siren(conn, actors):
    as_postgres(conn)
    with conn.cursor() as cur:
        a = _mk_client(cur, "ACME Un", "1 rue A, 75001 Paris", "111222333")
        b = _mk_client(cur, "ACME Deux", "2 rue B, 75002 Paris", "111222333")
    as_user(conn, actors["bureau"])
    with conn.cursor() as cur:
        cur.execute(
            "SELECT meme_siren FROM api.doublons_clients WHERE id_a IN (%s,%s) AND id_b IN (%s,%s)",
            (a, b, a, b),
        )
        row = cur.fetchone()
        assert row is not None and row[0] is True


# --------------------------------------------------------------------------- #
# 5) Idempotence : réexécuter 0023 ne change rien                             #
# --------------------------------------------------------------------------- #
def test_0023_idempotente(conn):
    sql = (ROOT / "supabase" / "migrations" / "0023_regroupement_beta22.sql").read_text(encoding="utf-8")
    as_postgres(conn)
    with conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM bon.sites WHERE created_by='migration-0023'")
        before_sites = cur.fetchone()[0]
        cur.execute("SELECT count(*) FROM bon.site_societes")
        before_soc = cur.fetchone()[0]
        cur.execute(sql)  # réexécution intégrale
        cur.execute("SELECT count(*) FROM bon.sites WHERE created_by='migration-0023'")
        assert cur.fetchone()[0] == before_sites
        cur.execute("SELECT count(*) FROM bon.site_societes")
        assert cur.fetchone()[0] == before_soc
    conn.rollback()


# --------------------------------------------------------------------------- #
# 6) Scripts de retour arrière exécutables (down)                             #
# --------------------------------------------------------------------------- #
def test_down_scripts_executables(conn):
    down23 = (DOWN / "0023_down.sql").read_text(encoding="utf-8")
    down22 = (DOWN / "0022_down.sql").read_text(encoding="utf-8")
    as_postgres(conn)
    with conn.cursor() as cur:
        cur.execute(down23)
        cur.execute(down22)
        # tables 0022 supprimées
        for t in ("client_adresses", "site_societes", "aliases", "fusions"):
            cur.execute("SELECT to_regclass(%s)", (f"bon.{t}",))
            assert cur.fetchone()[0] is None, t
        # colonnes retirées
        cur.execute(
            "SELECT count(*) FROM information_schema.columns "
            "WHERE table_schema='bon' AND table_name='sites' AND column_name='societe_id'"
        )
        assert cur.fetchone()[0] == 0
        # vue api.clients restaurée (SELECT * : plus de colonne 'aliases')
        cur.execute(
            "SELECT count(*) FROM information_schema.columns "
            "WHERE table_schema='api' AND table_name='clients' AND column_name='aliases'"
        )
        assert cur.fetchone()[0] == 0
    conn.rollback()


# --------------------------------------------------------------------------- #
# 7) beta.22.3 : noms de groupe Veolia / Syneos (migration 0024 + down)        #
# --------------------------------------------------------------------------- #
def test_0024_noms_groupes_et_down(conn):
    sql = (ROOT / "supabase" / "migrations" / "0024_noms_groupes_veolia_syneos.sql").read_text(encoding="utf-8")
    down = (DOWN / "0024_down.sql").read_text(encoding="utf-8")
    as_postgres(conn)
    with conn.cursor() as cur:
        cur.execute("INSERT INTO bon.clients (raison_sociale, siren) VALUES "
                    "('Veolia Eau Épinay','524334943') RETURNING id")
        veolia = cur.fetchone()[0]
        cur.execute("INSERT INTO bon.clients (raison_sociale, siren) VALUES "
                    "('Syneos Gournay','708202833') RETURNING id")
        syneos = cur.fetchone()[0]
        cur.execute("INSERT INTO bon.aliases (cible_type,cible_id,alias,origine) VALUES "
                    "('client',%s,'Veolia Eau Noisy','fusion'),('client',%s,'Syneos Neuilly','fusion')",
                    (veolia, syneos))
        # Application de 0024.
        cur.execute(sql)
        cur.execute("SELECT raison_sociale, alias FROM bon.clients WHERE id=%s", (veolia,))
        assert cur.fetchone() == ("Veolia", None)
        cur.execute("SELECT raison_sociale, alias FROM bon.clients WHERE id=%s", (syneos,))
        assert cur.fetchone() == ("Syneos", None)
        cur.execute("SELECT count(*) FROM bon.aliases WHERE cible_type='client' AND cible_id IN (%s,%s)",
                    (veolia, syneos))
        assert cur.fetchone()[0] == 0
        # Retour arrière.
        cur.execute(down)
        cur.execute("SELECT raison_sociale FROM bon.clients WHERE id=%s", (veolia,))
        assert cur.fetchone()[0] == "Veolia Eau Épinay"
        cur.execute("SELECT count(*) FROM bon.aliases WHERE cible_type='client' AND cible_id=%s "
                    "AND alias='Veolia Eau Noisy'", (veolia,))
        assert cur.fetchone()[0] == 1
    conn.rollback()
