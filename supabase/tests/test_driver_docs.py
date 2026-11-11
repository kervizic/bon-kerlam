"""Documents du chauffeur : BUREAU uniquement. Un chauffeur ne voit PAS ces
documents, même les siens. Alertes réservées au bureau."""

from conftest import as_postgres, as_user


def _setup_docs(conn, actors):
    as_postgres(conn)
    with conn.cursor() as cur:
        ch = actors["chauffeur_id"]
        cur.execute("INSERT INTO bon.permis (chauffeur_id, numero) VALUES (%s,'12AB')", (ch,))
        cur.execute(
            "INSERT INTO bon.permis_categories (chauffeur_id, categorie, validite) "
            "VALUES (%s,'CE', CURRENT_DATE + 30)", (ch,)
        )
        cur.execute(
            "INSERT INTO bon.carte_conducteur (chauffeur_id, numero, expiration, dernier_telechargement) "
            "VALUES (%s,'CC1', CURRENT_DATE + 365, CURRENT_DATE - 40)", (ch,)
        )


def test_chauffeur_ne_voit_pas_les_documents(conn, actors):
    _setup_docs(conn, actors)
    # Le chauffeur (même propriétaire des documents) ne voit RIEN.
    as_user(conn, actors["chauffeur"])
    with conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM bon.permis")
        assert cur.fetchone()[0] == 0
        cur.execute("SELECT count(*) FROM bon.permis_categories")
        assert cur.fetchone()[0] == 0
        cur.execute("SELECT count(*) FROM api.permis")
        assert cur.fetchone()[0] == 0
        # Alertes documents : vide pour un chauffeur.
        cur.execute("SELECT count(*) FROM api.alertes_documents()")
        assert cur.fetchone()[0] == 0


def test_bureau_voit_les_documents_et_alertes(conn, actors):
    _setup_docs(conn, actors)
    as_user(conn, actors["bureau"])
    with conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM bon.permis")
        assert cur.fetchone()[0] == 1
        # Alertes : permis CE échoit dans 30 j (bientot) + retard carte conducteur (40>28).
        cur.execute("SELECT statut FROM api.alertes_documents() ORDER BY statut")
        statuts = [r[0] for r in cur.fetchall()]
        assert "bientot" in statuts
        assert "retard" in statuts


def test_purge_au_depart(conn, actors):
    as_postgres(conn)
    with conn.cursor() as cur:
        ch = actors["chauffeur_id"]
        cur.execute(
            "INSERT INTO bon.permis (chauffeur_id, numero, scan_recto, scan_verso) "
            "VALUES (%s,'X','chauffeur-docs/p-recto.jpg','chauffeur-docs/p-verso.jpg')", (ch,)
        )
        cur.execute("SELECT bon.purge_documents_chauffeur(%s)", (ch,))
        keys = cur.fetchone()[0]
        assert set(keys) == {"chauffeur-docs/p-recto.jpg", "chauffeur-docs/p-verso.jpg"}
        cur.execute("SELECT scan_recto, scan_verso FROM bon.permis WHERE chauffeur_id=%s", (ch,))
        assert cur.fetchone() == (None, None)
