"""Ordonnanceur de rendu PDF (beta.32).

Un SEUL rendu WeasyPrint à la fois (vCPU + RAM limités), avec :
- déduplication : une lettre déjà en cours de rendu n'est jamais re-rendue en
  parallèle ; les demandes concurrentes attendent le même résultat ;
- priorité : les demandes de signature / préparation (`PRIO_SIGN`) passent devant la
  file de fond (préchauffage, re-rendu après modification, `PRIO_BG`) ;
- basse priorité OS : le thread de rendu tourne « nice » pour ne pas voler le CPU à
  Documenso et aux requêtes HTTP.

L'appelant passe une fonction `do_render(lv_id) -> result` (le vrai rendu+cache, défini
dans pdf.py) pour éviter un import circulaire.
"""
from __future__ import annotations

import itertools
import os
import queue
import threading
from collections.abc import Callable
from concurrent.futures import Future
from typing import Any

PRIO_SIGN = 0   # utilisateur qui attend (signature / préparation)
PRIO_BG = 10    # tâches de fond (préchauffage, re-rendu après modification)

# Niceness du thread de rendu (plus haut = moins prioritaire). Toujours autorisé à
# AUGMENTER la niceness pour un process non-root.
_NICE = 5

_q: queue.PriorityQueue = queue.PriorityQueue()
_seq = itertools.count()
_inflight: dict[int, Future] = {}
_lock = threading.Lock()
_worker: threading.Thread | None = None
_do_render: Callable[[int], Any] | None = None


def configure(do_render: Callable[[int], Any]) -> None:
    """Enregistre la fonction de rendu réel (pdf._render_and_cache)."""
    global _do_render
    _do_render = do_render


def _ensure_worker() -> None:
    global _worker
    with _lock:
        if _worker is not None:
            return
        _worker = threading.Thread(target=_run, name="pdf-render", daemon=True)
        _worker.start()


def _run() -> None:
    try:
        os.nice(_NICE)  # basse priorité : ne vole pas le CPU à Documenso / aux requêtes
    except OSError:
        pass
    while True:
        _prio, _n, lv_id, fut = _q.get()
        if not fut.set_running_or_notify_cancel():
            with _lock:
                if _inflight.get(lv_id) is fut:
                    _inflight.pop(lv_id, None)
            _q.task_done()
            continue
        try:
            fut.set_result(_do_render(lv_id))  # type: ignore[misc]
        except BaseException as exc:  # noqa: BLE001
            fut.set_exception(exc)
        finally:
            with _lock:
                if _inflight.get(lv_id) is fut:
                    _inflight.pop(lv_id, None)
            _q.task_done()


def request_render(lv_id: int, priority: int = PRIO_SIGN) -> Future:
    """Demande le rendu+cache d'une lettre. Renvoie un Future (dé-dupliqué par lv_id).
    `priority` : PRIO_SIGN (devant) ou PRIO_BG (file de fond)."""
    _ensure_worker()
    with _lock:
        fut = _inflight.get(lv_id)
        if fut is not None:
            return fut  # déjà en file / en cours : même résultat
        fut = Future()
        _inflight[lv_id] = fut
        _q.put((priority, next(_seq), lv_id, fut))
    return fut


def render_now(lv_id: int, priority: int = PRIO_SIGN):
    """Confort : demande le rendu et attend le résultat (sérialisé + dé-dupliqué)."""
    return request_render(lv_id, priority).result()
