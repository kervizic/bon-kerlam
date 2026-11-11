"""beta.2 — la liste blanche s'applique quelle que soit la méthode de connexion
(Google ou code OTP e-mail) ; un e-mail non listé ne voit RIEN. Hook GoTrue."""

from conftest import as_postgres, as_user


def _add_user(cur, email, role):
    cur.execute(
        "INSERT INTO bon.utilisateurs (email, role, actif) VALUES (%s,%s,true)",
        (email, role),
    )


def test_allowlist_google_et_email_autorises(conn):
    # Deux utilisateurs autorisés : peu importe la méthode (même claim email).
    as_postgres(conn)
    with conn.cursor() as cur:
        _add_user(cur, "patron@gmail.com", "bureau")       # connexion Google
        _add_user(cur, "chauffeur@orange.fr", "chauffeur")  # connexion code e-mail

    for email in ("patron@gmail.com", "chauffeur@orange.fr"):
        as_user(conn, email)
        with conn.cursor() as cur:
            cur.execute("SELECT count(*) FROM api.profil")
            assert cur.fetchone()[0] == 1, email


def test_allowlist_non_autorise_ne_voit_rien(conn):
    as_postgres(conn)
    with conn.cursor() as cur:
        _add_user(cur, "patron@gmail.com", "bureau")
        cur.execute(
            "INSERT INTO bon.clients (raison_sociale) VALUES ('Secret') RETURNING id"
        )
        client = cur.fetchone()[0]
        cur.execute(
            "INSERT INTO bon.projets (client_id, nom) VALUES (%s,'P') RETURNING id", (client,)
        )
        projet = cur.fetchone()[0]
        cur.execute(
            "INSERT INTO bon.lettres_voiture (projet_id, owner_email) VALUES (%s,'patron@gmail.com')",
            (projet,),
        )
    # Adresse (Google ou e-mail) non listée : aucune donnée.
    as_user(conn, "intrus@hotmail.com")
    with conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM api.profil")
        assert cur.fetchone()[0] == 0
        cur.execute("SELECT count(*) FROM bon.lettres_voiture")
        assert cur.fetchone()[0] == 0
        cur.execute("SELECT count(*) FROM bon.clients")
        assert cur.fetchone()[0] == 0


def test_hook_before_user_created(conn):
    as_postgres(conn)
    with conn.cursor() as cur:
        _add_user(cur, "ok@kerlam.fr", "chauffeur")
        # Autorisé : l'événement est renvoyé tel quel (pas de clé 'error').
        cur.execute(
            "SELECT bon.gotrue_before_user_created(%s::jsonb)",
            ('{"user":{"email":"ok@kerlam.fr"}}',),
        )
        assert "error" not in cur.fetchone()[0]
        # Non autorisé : renvoie une erreur 403.
        cur.execute(
            "SELECT bon.gotrue_before_user_created(%s::jsonb)",
            ('{"user":{"email":"intrus@gmail.com"}}',),
        )
        res = cur.fetchone()[0]
        assert res["error"]["http_code"] == 403
