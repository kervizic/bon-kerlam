"""beta.36 - « Mes documents » (documents personnels du chauffeur).

Vérifie bon.documents_chauffeur / api.documents_chauffeur :
  - RLS : chauffeur A ne voit ni ne modifie ni ne supprime les documents de B ;
    le bureau (sans rôle admin) ne voit RIEN ; l'admin voit et supprime tout mais
    ne crée ni ne modifie pour autrui ; anon et non listé : rien ;
  - le rôle admin n'est attribuable/retirable que par un admin (garde-fou) ;
  - cohérence des chemins storage, propriétaire immuable, plafond ;
  - fichiers remplacés / documents supprimés (cascade utilisateur comprise) => file
    bon.storage_purge ; RPC admin des propriétaires ; down exécutable.
"""

import uuid
from pathlib import Path

import psycopg
import pytest
from conftest import as_postgres, as_user

ROOT = Path(__file__).resolve().parents[2]
DOWN = ROOT / "supabase" / "down"
ADMIN = "manu-admin@kerlam.fr"


def _uid(cur, email):
    cur.execute("SELECT id FROM bon.utilisateurs WHERE lower(email) = lower(%s)", (email,))
    return cur.fetchone()[0]


@pytest.fixture
def ids(conn, actors):
    as_postgres(conn)
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO bon.utilisateurs (email, role, roles, nom, actif) "
            "VALUES (%s, 'bureau', ARRAY['bureau','admin'], 'Manu', true)", (ADMIN,)
        )
        return {k: _uid(cur, actors[k]) for k in ("chauffeur", "chauffeur2", "bureau")} | {
            "admin": _uid(cur, ADMIN)
        }


def _path(owner, doc, ext="jpg"):
    return f"u/{owner}/{doc}/{uuid.uuid4()}.{ext}"


def _insert(cur, owner, doc=None, verso=True, typ="permis", expiration=None):
    doc = doc or str(uuid.uuid4())
    cur.execute(
        "INSERT INTO api.documents_chauffeur (id, type, numero, expiration, recto_path, verso_path) "
        "VALUES (%s, %s, '12AB', %s, %s, %s) RETURNING id",
        (doc, typ, expiration, _path(owner, doc), _path(owner, doc) if verso else None),
    )
    return str(cur.fetchone()[0])


def _visible(cur):
    cur.execute("SELECT id::text FROM api.documents_chauffeur")
    return {r[0] for r in cur.fetchall()}


def test_rls_proprietaire_seul(conn, actors, ids):
    as_user(conn, actors["chauffeur"])
    with conn.cursor() as cur:
        da = _insert(cur, ids["chauffeur"])
        cur.execute("SELECT owner_id FROM api.documents_chauffeur WHERE id = %s", (da,))
        assert cur.fetchone()[0] == ids["chauffeur"]  # propriétaire par défaut = soi
    as_user(conn, actors["chauffeur2"])
    with conn.cursor() as cur:
        db = _insert(cur, ids["chauffeur2"])
        assert _visible(cur) == {db}
        # B ne modifie ni ne supprime le document de A (invisible => 0 ligne).
        cur.execute("UPDATE api.documents_chauffeur SET numero = 'X' WHERE id = %s", (da,))
        assert cur.rowcount == 0
        cur.execute("DELETE FROM api.documents_chauffeur WHERE id = %s", (da,))
        assert cur.rowcount == 0
        # B ne crée pas de document au nom de A.
        cur.execute("SAVEPOINT s")
        doc = str(uuid.uuid4())
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            cur.execute(
                "INSERT INTO api.documents_chauffeur (id, owner_id, type, recto_path) VALUES (%s,%s,'permis',%s)",
                (doc, ids["chauffeur"], _path(ids["chauffeur"], doc)),
            )
        cur.execute("ROLLBACK TO s")
    as_user(conn, actors["chauffeur"])
    with conn.cursor() as cur:
        assert _visible(cur) == {da}


def test_bureau_refuse(conn, actors, ids):
    as_user(conn, actors["chauffeur"])
    with conn.cursor() as cur:
        _insert(cur, ids["chauffeur"])
    as_user(conn, actors["bureau"])
    with conn.cursor() as cur:
        assert _visible(cur) == set()
        cur.execute("SELECT * FROM api.documents_proprietaires()")
        assert cur.fetchall() == []
        cur.execute("DELETE FROM api.documents_chauffeur")
        assert cur.rowcount == 0


def test_admin_lit_et_supprime(conn, actors, ids):
    as_user(conn, actors["chauffeur"])
    with conn.cursor() as cur:
        da = _insert(cur, ids["chauffeur"], expiration="2027-01-31")
    as_user(conn, actors["chauffeur2"])
    with conn.cursor() as cur:
        db = _insert(cur, ids["chauffeur2"])
    as_user(conn, ADMIN)
    with conn.cursor() as cur:
        assert _visible(cur) == {da, db}
        cur.execute("SELECT owner_id, nb, prochaine_expiration FROM api.documents_proprietaires()")
        rows = {r[0]: r[1:] for r in cur.fetchall()}
        assert rows[ids["chauffeur"]][0] == 1
        assert str(rows[ids["chauffeur"]][1]) == "2027-01-31"
        assert ids["chauffeur2"] in rows
        # Lecture seule pour autrui : pas de modification.
        cur.execute("UPDATE api.documents_chauffeur SET numero = 'X' WHERE id = %s", (da,))
        assert cur.rowcount == 0
        # Suppression autorisée.
        cur.execute("DELETE FROM api.documents_chauffeur WHERE id = %s", (db,))
        assert cur.rowcount == 1


def test_anon_et_non_liste_refuses(conn, actors, ids):
    as_user(conn, actors["chauffeur"])
    with conn.cursor() as cur:
        _insert(cur, ids["chauffeur"])
    as_user(conn, actors["outsider"])
    with conn.cursor() as cur:
        assert _visible(cur) == set()
        cur.execute("SAVEPOINT s")
        doc = str(uuid.uuid4())
        with pytest.raises(psycopg.Error):
            cur.execute(
                "INSERT INTO api.documents_chauffeur (id, type, recto_path) VALUES (%s,'permis',%s)",
                (doc, f"u/1/{doc}/{uuid.uuid4()}.jpg"),
            )
        cur.execute("ROLLBACK TO s")
    as_user(conn, actors["desactive"])
    with conn.cursor() as cur:
        assert _visible(cur) == set()
    # anon : aucun privilège sur la table ni la vue.
    with conn.cursor() as cur:
        cur.execute("RESET ROLE; SET LOCAL ROLE anon;")
        for rel in ("api.documents_chauffeur", "bon.documents_chauffeur"):
            cur.execute("SAVEPOINT s")
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                cur.execute(f"SELECT 1 FROM {rel}")
            cur.execute("ROLLBACK TO s")
        cur.execute("SAVEPOINT s")
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            cur.execute("SELECT * FROM api.documents_proprietaires()")
        cur.execute("ROLLBACK TO s")


def test_role_admin_reserve_aux_admins(conn, actors, ids):
    as_user(conn, actors["bureau"])
    with conn.cursor() as cur:
        # Le bureau ne peut pas s'octroyer le rôle admin…
        cur.execute("SAVEPOINT s")
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            cur.execute(
                "UPDATE bon.utilisateurs SET roles = roles || 'admin' WHERE id = %s", (ids["bureau"],)
            )
        cur.execute("ROLLBACK TO s")
        # …ni créer un admin, ni retirer / supprimer l'admin existant.
        for sql, args in (
            ("INSERT INTO bon.utilisateurs (email, role, roles, actif) "
             "VALUES ('x@kerlam.fr','bureau',ARRAY['bureau','admin'],true)", ()),
            ("UPDATE bon.utilisateurs SET roles = ARRAY['bureau'] WHERE id = %s", (ids["admin"],)),
            ("UPDATE bon.utilisateurs SET role = 'desactive' WHERE id = %s", (ids["admin"],)),
            ("DELETE FROM bon.utilisateurs WHERE id = %s", (ids["admin"],)),
        ):
            cur.execute("SAVEPOINT s")
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                cur.execute(sql, args)
            cur.execute("ROLLBACK TO s")
        # Modifier un autre champ d'un admin (rôles inchangés) reste possible.
        cur.execute("UPDATE bon.utilisateurs SET nom = 'Manu K' WHERE id = %s", (ids["admin"],))
        assert cur.rowcount == 1
    as_user(conn, ADMIN)
    with conn.cursor() as cur:
        cur.execute("UPDATE bon.utilisateurs SET roles = roles || 'admin' WHERE id = %s", (ids["bureau"],))
        assert cur.rowcount == 1
        cur.execute("SELECT bon.is_admin()")
        assert cur.fetchone()[0] is True
    as_user(conn, actors["chauffeur"])
    with conn.cursor() as cur:
        cur.execute("SELECT bon.is_admin()")
        assert cur.fetchone()[0] is False


def test_coherence_chemins_et_proprietaire(conn, actors, ids):
    as_user(conn, actors["chauffeur"])
    me, other = ids["chauffeur"], ids["chauffeur2"]
    with conn.cursor() as cur:
        doc = str(uuid.uuid4())
        bad = [
            _path(other, doc),  # dossier d'un autre
            _path(me, str(uuid.uuid4())),  # autre document
            f"u/{me}/{doc}/x.jpg",  # nom invalide
            _path(me, doc, "png"),  # extension refusée
        ]
        for p in bad:
            cur.execute("SAVEPOINT s")
            with pytest.raises(psycopg.errors.CheckViolation):
                cur.execute(
                    "INSERT INTO api.documents_chauffeur (id, type, recto_path) VALUES (%s,'permis',%s)", (doc, p)
                )
            cur.execute("ROLLBACK TO s")
        cur.execute("SAVEPOINT s")
        with pytest.raises(psycopg.errors.CheckViolation):
            cur.execute(
                "INSERT INTO api.documents_chauffeur (id, type, recto_path) VALUES (%s,'passeport',%s)",
                (doc, _path(me, doc)),
            )
        cur.execute("ROLLBACK TO s")
        # PDF accepté ; libellé / n° vides normalisés à NULL.
        cur.execute(
            "INSERT INTO api.documents_chauffeur (id, type, libelle, numero, recto_path) "
            "VALUES (%s,'caces','  ','',%s) RETURNING libelle, numero",
            (doc, _path(me, doc, "pdf")),
        )
        assert cur.fetchone() == (None, None)
        # Propriétaire immuable (la RLS refuse déjà ; le trigger aussi pour le superuser).
    as_postgres(conn)
    with conn.cursor() as cur:
        cur.execute("SAVEPOINT s")
        with pytest.raises(psycopg.errors.CheckViolation):
            cur.execute("UPDATE bon.documents_chauffeur SET owner_id = %s WHERE id = %s", (other, doc))
        cur.execute("ROLLBACK TO s")


def test_plafond(conn, actors, ids):
    as_postgres(conn)
    me = ids["chauffeur"]
    with conn.cursor() as cur:
        for _ in range(40):
            d = str(uuid.uuid4())
            cur.execute(
                "INSERT INTO bon.documents_chauffeur (id, owner_id, type, recto_path) VALUES (%s,%s,'autre',%s)",
                (d, me, _path(me, d)),
            )
        d = str(uuid.uuid4())
        with pytest.raises(psycopg.errors.CheckViolation):
            cur.execute(
                "INSERT INTO bon.documents_chauffeur (id, owner_id, type, recto_path) VALUES (%s,%s,'autre',%s)",
                (d, me, _path(me, d)),
            )


def _purge(cur, prefix):
    cur.execute(
        "SELECT path FROM bon.storage_purge WHERE bucket = 'documents-chauffeurs' AND path LIKE %s ORDER BY path",
        (prefix + "%",),
    )
    return [r[0] for r in cur.fetchall()]


def test_purge_storage(conn, actors, ids):
    me = ids["chauffeur"]
    as_user(conn, actors["chauffeur"])
    with conn.cursor() as cur:
        doc = str(uuid.uuid4())
        old_recto = _path(me, doc)
        verso_pdf = _path(me, doc, "pdf")
        cur.execute(
            "INSERT INTO api.documents_chauffeur (id, type, recto_path, verso_path) VALUES (%s,'permis',%s,%s)",
            (doc, old_recto, verso_pdf),
        )
        new_recto = _path(me, doc)
        cur.execute(
            "UPDATE api.documents_chauffeur SET recto_path = %s, expiration = '2030-01-01' WHERE id = %s",
            (new_recto, doc),
        )
        assert cur.rowcount == 1
    as_postgres(conn)
    with conn.cursor() as cur:
        assert sorted(_purge(cur, f"u/{me}/{doc}/")) == sorted(
            [old_recto, old_recto.replace(".jpg", ".thumb.jpg")]
        )
    as_user(conn, actors["chauffeur"])
    with conn.cursor() as cur:
        cur.execute("DELETE FROM api.documents_chauffeur WHERE id = %s", (doc,))
        assert cur.rowcount == 1
    as_postgres(conn)
    with conn.cursor() as cur:
        assert set(_purge(cur, f"u/{me}/{doc}/")) == {
            old_recto, old_recto.replace(".jpg", ".thumb.jpg"),
            new_recto, new_recto.replace(".jpg", ".thumb.jpg"), verso_pdf,
        }
        # Cascade : suppression de l'utilisateur => documents purgés.
        d2 = str(uuid.uuid4())
        p2 = _path(me, d2)
        cur.execute(
            "INSERT INTO bon.documents_chauffeur (id, owner_id, type, recto_path) VALUES (%s,%s,'autre',%s)",
            (d2, me, p2),
        )
        cur.execute("DELETE FROM bon.utilisateurs WHERE id = %s", (me,))
        assert p2 in _purge(cur, f"u/{me}/{d2}/")


def test_helpers_chemin(conn):
    as_postgres(conn)
    d, f = uuid.uuid4(), uuid.uuid4()
    with conn.cursor() as cur:
        cur.execute(
            "SELECT bon.doc_chauffeur_path_owner(%s), bon.doc_chauffeur_path_owner(%s), "
            "bon.doc_chauffeur_path_owner(%s), bon.doc_chauffeur_path_owner('u/1/../x.jpg')",
            (f"u/12/{d}/{f}.jpg", f"u/12/{d}/{f}.thumb.jpg", f"u/7/{d}/{f}.pdf"),
        )
        assert cur.fetchone() == (12, 12, 7, None)
        cur.execute("SELECT bon.doc_chauffeur_objects(%s)", (f"u/1/{d}/{f}.pdf",))
        assert cur.fetchone()[0] == [f"u/1/{d}/{f}.pdf"]


def test_down_executable(conn):
    as_postgres(conn)
    sql = (DOWN / "0034_down.sql").read_text(encoding="utf-8")
    with conn.cursor() as cur:
        cur.execute(sql)
        cur.execute("SELECT to_regclass('bon.documents_chauffeur'), to_regclass('api.documents_chauffeur')")
        assert cur.fetchone() == (None, None)
        cur.execute("SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_zz_admin_guard'")
        assert cur.fetchone()[0] == 0
    conn.rollback()
