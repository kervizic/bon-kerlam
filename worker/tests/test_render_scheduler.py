"""beta.32 : ordonnanceur de rendu PDF (render.py) — sérialisation, déduplication,
priorité. Aucune dépendance WeasyPrint/DB (do_render simulé)."""

import threading

from app import render


def test_dedup_serialisation_et_priorite():
    started = threading.Event()
    gate = threading.Event()
    order = []

    def do(lv_id):
        if lv_id == 1:
            started.set()
            gate.wait(3)  # bloque le 1er rendu pour remplir la file pendant ce temps
        order.append(lv_id)
        return lv_id

    render.configure(do)

    f1 = render.request_render(1, render.PRIO_BG)  # démarre et bloque
    assert started.wait(3)

    # Pendant que 1 est en cours : une tâche de FOND (3) puis une SIGNATURE (2).
    f3 = render.request_render(3, render.PRIO_BG)
    f2 = render.request_render(2, render.PRIO_SIGN)
    # Déduplication : une 2e demande pour 2 renvoie le MÊME future (pas de 2e rendu).
    f2bis = render.request_render(2, render.PRIO_SIGN)
    assert f2 is f2bis

    gate.set()
    assert f1.result(3) == 1
    assert f2.result(3) == 2
    assert f3.result(3) == 3

    # Un seul rendu à la fois ; après le 1er, la SIGNATURE (2) passe devant le FOND (3).
    assert order == [1, 2, 3]
