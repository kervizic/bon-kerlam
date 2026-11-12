"""beta.17 : client référencé directement sur la lettre (projet facultatif),
alias de recherche sur les clients, prefill qui expose le client."""

import json

from conftest import as_postgres, as_user


def test_lettre_sans_projet_avec_client(conn, actors):
    # Un chauffeur crée une lettre rattachée à un CLIENT, sans projet.
    as_user(conn, actors["chauffeur"])
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO bon.lettres_voiture (client_id, owner_email) "
            "VALUES (%s,%s) RETURNING id, projet_id, client_id",
            (actors["client_id"], actors["chauffeur"]),
        )
        row = cur.fetchone()
        assert row[1] is None             # projet facultatif
        assert row[2] == actors["client_id"]
        # Exposé par la vue API (security_invoker).
        cur.execute("SELECT client_id FROM api.lettres_voiture WHERE id = %s", (row[0],))
        assert cur.fetchone()[0] == actors["client_id"]


def test_alias_colonne_et_recherche(conn, actors):
    as_postgres(conn)
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE bon.clients SET alias = 'Jean Lefebvre' WHERE id = %s",
            (actors["client_id"],),
        )
    as_user(conn, actors["chauffeur"])
    with conn.cursor() as cur:
        # Recherche insensible à la casse via l'alias (exposé par l'API).
        cur.execute(
            "SELECT raison_sociale FROM api.clients WHERE lower(alias) LIKE '%jean%'"
        )
        assert cur.fetchone() is not None


def test_prefill_expose_client_id(conn, actors):
    as_postgres(conn)
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO bon.lettres_voiture (client_id, projet_id, chauffeur_id, owner_email) "
            "VALUES (%s,%s,%s,%s)",
            (actors["client_id"], actors["projet_id"], actors["chauffeur_id"], actors["chauffeur"]),
        )
    as_user(conn, actors["chauffeur"])
    with conn.cursor() as cur:
        cur.execute("SELECT api.prefill(%s)", (actors["chauffeur_id"],))
        data = cur.fetchone()[0]
        if isinstance(data, str):
            data = json.loads(data)
        assert "client_id" in data
        assert data["client_id"] == actors["client_id"]
