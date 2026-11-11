"""Règles de la LV : pré-remplissage, priorité planning, destinataire identique,
mémoire de la dernière unité."""

from __future__ import annotations

from app import services

from .conftest import (
    add_article,
    add_camion,
    add_chauffeur,
    add_client,
    add_projet,
)


def test_dest_identique_coche_doffice(conn):
    cam = add_camion(conn)
    ch = add_chauffeur(conn, camion_id=cam)
    cl = add_client(conn)
    pr = add_projet(conn, cl)
    lv = services.create_lv(conn, projet_id=pr, client_id=cl, jour="2026-11-11", chauffeur_id=ch)
    assert services.get_lv(conn, lv)["dest_identique_exp"] == 1


def test_date_etablissement_default_is_jour(conn):
    cam = add_camion(conn)
    ch = add_chauffeur(conn, camion_id=cam)
    cl = add_client(conn)
    pr = add_projet(conn, cl)
    lv = services.create_lv(conn, projet_id=pr, client_id=cl, jour="2026-11-11", chauffeur_id=ch)
    assert services.get_lv(conn, lv)["date_etablissement"] == "2026-11-11"


def test_prefill_uses_attributed_camion_and_last_lv(conn):
    cam = add_camion(conn)
    ch = add_chauffeur(conn, camion_id=cam)
    cl = add_client(conn)
    pr = add_projet(conn, cl)
    # Dernier bon du chauffeur.
    services.create_lv(conn, projet_id=pr, client_id=cl, jour="2026-11-10", chauffeur_id=ch, camion_id=cam)
    data = services.prefill_new_lv(conn, ch, "2026-11-11")
    assert data["source"] == "defaults"
    assert data["camion_id"] == cam
    assert data["client_id"] == cl
    assert data["projet_id"] == pr
    assert data["dest_identique_exp"] is True


def test_prepared_lv_takes_priority(conn):
    cam = add_camion(conn)
    ch = add_chauffeur(conn, camion_id=cam)
    cl = add_client(conn)
    pr = add_projet(conn, cl)
    other = add_client(conn, raison="Autre")
    pr_other = add_projet(conn, other)
    # Dernier bon « normal ».
    services.create_lv(conn, projet_id=pr_other, client_id=other, jour="2026-11-09", chauffeur_id=ch, camion_id=cam)
    # LV préparée par le bureau pour le 11, sans aucun tour.
    prep = services.create_lv(
        conn, projet_id=pr, client_id=cl, jour="2026-11-11", chauffeur_id=ch, camion_id=cam,
        prepared_by_bureau=True,
    )
    data = services.prefill_new_lv(conn, ch, "2026-11-11")
    assert data["source"] == "prepared"
    assert data["lv_id"] == prep
    assert data["projet_id"] == pr
    assert data["client_id"] == cl
    # Jamais de tour créé à l'avance.
    assert services.count_tours(conn, prep) == 0


def test_last_unit_memory(conn):
    cam = add_camion(conn)
    ch = add_chauffeur(conn, camion_id=cam)
    cl = add_client(conn)
    pr = add_projet(conn, cl)
    art = add_article(conn, nom="Gravats")
    lv = services.create_lv(conn, projet_id=pr, client_id=cl, jour="2026-11-11", chauffeur_id=ch)
    tour = services.add_tour(conn, lv, heure_depart="07:00")
    assert services.last_unit(conn, ch, art) is None
    services.add_tour_ligne(conn, tour["id"], article_id=art, quantite=3, unite="m3", chauffeur_id=ch)
    assert services.last_unit(conn, ch, art) == "m3"
    # Une nouvelle saisie met à jour la mémoire.
    services.add_tour_ligne(conn, tour["id"], article_id=art, quantite=2, unite="t", chauffeur_id=ch)
    assert services.last_unit(conn, ch, art) == "t"
