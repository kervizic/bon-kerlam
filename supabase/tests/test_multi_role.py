"""Un utilisateur peut cumuler chauffeur ET bureau (gérants qui conduisent)."""

from conftest import as_postgres, as_user


def test_double_role(conn):
    as_postgres(conn)
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO bon.utilisateurs (email, role, roles, actif) "
            "VALUES ('patron@kerlam.fr','bureau',ARRAY['chauffeur','bureau'],true)"
        )
    as_user(conn, "patron@kerlam.fr")
    with conn.cursor() as cur:
        cur.execute("SELECT bon.is_bureau(), bon.is_chauffeur(), bon.is_member()")
        assert cur.fetchone() == (True, True, True)


def test_role_simple_reste_simple(conn):
    as_postgres(conn)
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO bon.utilisateurs (email, role, actif) VALUES ('seul@kerlam.fr','bureau',true)"
        )
    as_user(conn, "seul@kerlam.fr")
    with conn.cursor() as cur:
        cur.execute("SELECT bon.is_bureau(), bon.is_chauffeur()")
        assert cur.fetchone() == (True, False)  # roles dérivé de role (compat)
