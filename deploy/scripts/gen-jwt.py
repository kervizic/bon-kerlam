#!/usr/bin/env python3
"""Génère les clés API (JWT HS256) anon et service_role depuis JWT_SECRET.

À LANCER SUR LE SERVEUR. Ne jamais committer les clés produites.
    JWT_SECRET=... python3 gen-jwt.py            # 10 ans d'expiration
    JWT_SECRET=... python3 gen-jwt.py --exp 3600 # jeton de test court

anon         -> à mettre dans le front (ANON_KEY). N'ouvre RIEN (RLS).
service_role -> secret serveur (SERVICE_ROLE_KEY). BYPASSRLS. À garder caché.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time

try:
    import jwt  # PyJWT
except ImportError:
    sys.exit("PyJWT requis : pip install PyJWT")

TEN_YEARS = 10 * 365 * 24 * 3600


def mint(secret: str, role: str, exp_seconds: int = TEN_YEARS) -> str:
    now = int(time.time())
    payload = {"role": role, "iss": "bon-kerlam", "iat": now, "exp": now + exp_seconds}
    return jwt.encode(payload, secret, algorithm="HS256")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--exp", type=int, default=TEN_YEARS)
    args = ap.parse_args()
    secret = os.environ.get("JWT_SECRET")
    if not secret:
        return int(bool(sys.stderr.write("JWT_SECRET manquant dans l'environnement\n")))
    out = {
        "ANON_KEY": mint(secret, "anon", args.exp),
        "SERVICE_ROLE_KEY": mint(secret, "service_role", args.exp),
    }
    print(json.dumps(out, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
