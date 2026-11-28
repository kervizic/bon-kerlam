#!/usr/bin/env python3
"""Vérification prod beta.36 « Mes documents » (identités de test, aucune donnée réelle).

À LANCER SUR LE SERVEUR, dans un conteneur jetable (pyjwt + httpx), APRÈS avoir
inséré les utilisateurs de test (superuser) et AVANT de les supprimer :
    b36-chauffeur-a / b36-chauffeur-b (chauffeur), b36-bureau (bureau),
    b36-admin (bureau + admin), domaine kerlam.invalid.
Environnement : API (https://api.kerlam.fr), ANON_KEY, JWT_SECRET, A_ID (id
utilisateur du chauffeur A), B_ID. Jetons de test : 10 min. Aucun secret affiché.
Sortie : une ligne ok/FAIL par contrôle ; code 1 si un contrôle échoue. Laisse un
document supprimé (=> file bon.storage_purge) que le worker doit purger.
"""

from __future__ import annotations

import os
import sys
import time
import uuid

import httpx
import jwt

API = os.environ.get("API", "https://api.kerlam.fr").rstrip("/")
ANON = os.environ["ANON_KEY"]
SECRET = os.environ["JWT_SECRET"]
A_ID, B_ID = int(os.environ["A_ID"]), int(os.environ["B_ID"])
DOM = "kerlam.invalid"
BUCKET = "documents-chauffeurs"
# Plus petit JPEG valide (1x1).
JPEG = bytes.fromhex(
    "ffd8ffe000104a46494600010100000100010000ffdb004300080606070605080707070909080a0c140d0c0b0b0c1912130f"
    "141d1a1f1e1d1a1c1c20242e2720222c231c1c2837292c30313434341f27393d38323c2e333432ffc0000b080001000101011100"
    "ffc4001f0000010501010101010100000000000000000102030405060708090a0bffc400b5100002010303020403050504040000"
    "017d01020300041105122131410613516107227114328191a1082342b1c11552d1f02433627282090a161718191a2526272829"
    "2a3435363738393a434445464748494a535455565758595a636465666768696a737475767778797a838485868788898a9293"
    "9495969798999aa2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae1e2e3e4e5e6e7e8"
    "e9eaf1f2f3f4f5f6f7f8f9faffda0008010100003f00fbd3ffd9"
)
fails: list[str] = []


def check(cond: bool, msg: str) -> None:
    print(("ok: " if cond else "FAIL: ") + msg)
    if not cond:
        fails.append(msg)


def token(local: str) -> str:
    now = int(time.time())
    claims = {"role": "authenticated", "aud": "authenticated", "email": f"{local}@{DOM}",
              "sub": str(uuid.uuid5(uuid.NAMESPACE_DNS, local)), "iat": now, "exp": now + 600}
    return jwt.encode(claims, SECRET, algorithm="HS256")


def hdr(tok: str | None) -> dict:
    h = {"apikey": ANON, "Accept-Profile": "api", "Content-Profile": "api"}
    h["Authorization"] = f"Bearer {tok or ANON}"
    return h


c = httpx.Client(timeout=20)
TA, TB, TBU, TAD = (token(x) for x in ("b36-chauffeur-a", "b36-chauffeur-b", "b36-bureau", "b36-admin"))
doc = str(uuid.uuid4())
recto = f"u/{A_ID}/{doc}/{uuid.uuid4()}.jpg"
thumb = recto.replace(".jpg", ".thumb.jpg")


def upload(tok, path, data=JPEG, ctype="image/jpeg"):
    return c.post(f"{API}/storage/v1/object/{BUCKET}/{path}", content=data,
                  headers={**hdr(tok), "Content-Type": ctype, "x-upsert": "false"})


def listing(tok):
    return c.get(f"{API}/rest/v1/documents_chauffeur?select=id,owner_id", headers=hdr(tok))


def sign(tok, path):
    return c.post(f"{API}/storage/v1/object/sign/{BUCKET}/{path}", json={"expiresIn": 120}, headers=hdr(tok))


def read_obj(tok, path):
    return c.get(f"{API}/storage/v1/object/authenticated/{BUCKET}/{path}", headers=hdr(tok))


# 1. Propriétaire A : ajout + lecture.
for p in (recto, thumb):
    r = upload(TA, p)
    check(r.status_code == 200, f"A envoie {p.rsplit('/', 1)[1]} : {r.status_code}")
r = c.post(f"{API}/rest/v1/documents_chauffeur", headers={**hdr(TA), "Prefer": "return=minimal"},
           json={"id": doc, "type": "permis", "numero": "TEST-B36", "expiration": "2027-01-10",
                 "recto_path": recto})
check(r.status_code == 201, f"A insère le document : {r.status_code} {r.text[:120]}")
r = listing(TA)
check(r.status_code == 200 and [d["id"] for d in r.json()] == [doc], f"A lit son document : {r.status_code}")
r = sign(TA, recto)
url = r.json().get("signedURL") if r.status_code == 200 else None
check(bool(url), f"A obtient une URL signée : {r.status_code}")
if url:
    g = c.get(f"{API}/storage/v1{url}")
    check(g.status_code == 200 and g.content[:2] == b"\xff\xd8", f"URL signée -> JPEG : {g.status_code}")

# 2. Chauffeur B, bureau, anonyme : refusés.
for name, tok in (("B", TB), ("bureau", TBU)):
    r = listing(tok)
    check(r.status_code == 200 and r.json() == [], f"{name} : aucun document visible ({r.status_code})")
    check(read_obj(tok, recto).status_code >= 400, f"{name} : objet refusé")
    check(sign(tok, recto).status_code >= 400, f"{name} : URL signée refusée")
r = upload(TB, f"u/{A_ID}/{doc}/{uuid.uuid4()}.jpg")
check(r.status_code >= 400, f"B ne peut pas déposer dans le dossier de A : {r.status_code}")
r = c.post(f"{API}/rest/v1/rpc/documents_proprietaires", headers=hdr(TBU), json={})
check(r.status_code == 200 and r.json() == [], f"bureau : RPC admin vide ({r.status_code})")
r = c.delete(f"{API}/rest/v1/documents_chauffeur?id=eq.{doc}", headers={**hdr(TBU), "Prefer": "return=representation"})
check(r.status_code in (200, 204) and r.text.strip() in ("", "[]"),
      f"bureau : suppression sans effet ({r.status_code})")
r = listing(None)
check(r.status_code in (401, 403), f"anonyme : table refusée ({r.status_code})")
check(read_obj(None, recto).status_code >= 400, "anonyme : objet refusé")
check(c.get(f"{API}/storage/v1/object/public/{BUCKET}/{recto}").status_code >= 400, "anonyme : URL publique refusée")
check(sign(None, recto).status_code >= 400, "anonyme : URL signée refusée")
check(upload(None, f"u/{A_ID}/{doc}/{uuid.uuid4()}.jpg").status_code >= 400, "anonyme : dépôt refusé")

# 3. Admin : lecture.
r = listing(TAD)
check(r.status_code == 200 and doc in [d["id"] for d in r.json()], f"admin lit le document de A ({r.status_code})")
r = c.post(f"{API}/rest/v1/rpc/documents_proprietaires", headers=hdr(TAD), json={})
check(r.status_code == 200 and any(o["owner_id"] == A_ID for o in r.json()),
      f"admin : RPC propriétaires ({r.status_code})")
r = sign(TAD, recto)
check(r.status_code == 200, f"admin : URL signée ({r.status_code})")
r = c.patch(f"{API}/rest/v1/documents_chauffeur?id=eq.{doc}", headers={**hdr(TAD), "Prefer": "return=representation"},
            json={"numero": "X"})
check(r.status_code == 200 and r.json() == [], f"admin : pas de modification pour autrui ({r.status_code})")

# 4. Suppression par le propriétaire (=> file de purge storage).
r = c.delete(f"{API}/rest/v1/documents_chauffeur?id=eq.{doc}", headers={**hdr(TA), "Prefer": "return=representation"})
check(r.status_code == 200 and len(r.json()) == 1, f"A supprime son document ({r.status_code})")
print("DOC", doc)
sys.exit(1 if fails else 0)
