"""Numérotation : KER-03000, pas de trou, attribué au premier tour."""

from __future__ import annotations

from app import numbering, services

from .conftest import add_camion, add_chauffeur, add_client, add_projet


def _base(conn):
    cam = add_camion(conn)
    ch = add_chauffeur(conn, camion_id=cam)
    cl = add_client(conn)
    pr = add_projet(conn, cl)
    return cam, ch, cl, pr


def test_first_number_is_ker_03000(conn):
    cam, ch, cl, pr = _base(conn)
    lv = services.create_lv(conn, projet_id=pr, client_id=cl, jour="2026-11-11", chauffeur_id=ch, camion_id=cam)
    # Pas de numéro tant qu'aucun tour.
    assert services.get_lv(conn, lv)["numero"] is None
    res = services.add_tour(conn, lv, heure_depart="07:00")
    assert res["numero"] == "KER-03000"
    assert services.get_lv(conn, lv)["numero"] == "KER-03000"


def test_number_assigned_only_at_first_tour_idempotent(conn):
    cam, ch, cl, pr = _base(conn)
    lv = services.create_lv(conn, projet_id=pr, client_id=cl, jour="2026-11-11", chauffeur_id=ch, camion_id=cam)
    services.add_tour(conn, lv, heure_depart="07:00")
    # Un second tour ne change pas le numéro ni le compteur.
    before = numbering.peek_next(conn)
    services.add_tour(conn, lv, heure_depart="09:00")
    assert services.get_lv(conn, lv)["numero"] == "KER-03000"
    assert numbering.peek_next(conn) == before


def test_prepared_lv_without_tour_does_not_consume_number(conn):
    cam, ch, cl, pr = _base(conn)
    # LV préparée supprimée sans tour : ne consomme pas de numéro.
    lv1 = services.create_lv(conn, projet_id=pr, client_id=cl, jour="2026-11-10", chauffeur_id=ch, camion_id=cam)
    assert services.get_lv(conn, lv1)["numero"] is None
    conn.execute("UPDATE lettres_voiture SET deleted_at = '2026-11-10' WHERE id = ?", (lv1,))
    conn.commit()
    # LV suivante avec tour obtient quand même KER-03000 (aucun trou).
    lv2 = services.create_lv(conn, projet_id=pr, client_id=cl, jour="2026-11-11", chauffeur_id=ch, camion_id=cam)
    res = services.add_tour(conn, lv2, heure_depart="07:00")
    assert res["numero"] == "KER-03000"


def test_no_gap_in_sequence(conn):
    cam, ch, cl, pr = _base(conn)
    numeros = []
    for i in range(3):
        cl_i = add_client(conn, raison=f"Client {i}")
        pr_i = add_projet(conn, cl_i)
        lv = services.create_lv(conn, projet_id=pr_i, client_id=cl_i, jour="2026-11-11", chauffeur_id=ch, camion_id=cam)
        numeros.append(services.add_tour(conn, lv, heure_depart="07:00")["numero"])
    assert numeros == ["KER-03000", "KER-03001", "KER-03002"]


def test_cancelled_lv_keeps_number(conn):
    cam, ch, cl, pr = _base(conn)
    lv = services.create_lv(conn, projet_id=pr, client_id=cl, jour="2026-11-11", chauffeur_id=ch, camion_id=cam)
    services.add_tour(conn, lv, heure_depart="07:00")
    conn.execute("UPDATE lettres_voiture SET statut = 'annulee' WHERE id = ?", (lv,))
    conn.commit()
    assert services.get_lv(conn, lv)["numero"] == "KER-03000"
