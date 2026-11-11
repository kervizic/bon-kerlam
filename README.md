# bon.kerlam.fr - Lettres de voiture KERLAM

Application de gestion des **lettres de voiture** (documents de transport routier
obligatoires) pour KERLAM. Saisie terrain par les chauffeurs sur smartphone,
supervision et référentiel côté bureau, édition du PDF A4 réglementaire.

> Dépôt public. Toutes les données affichées dans les démos sont **fictives**.

---

## Objectif

Produire, au fil de la journée, une lettre de voiture par projet conforme à
l'arrêté du 9 novembre 1999 (art. 4) : tours, tonnages, contrôle de charge
vs PTAC, et export PDF avec zone de signature. Voir [docs/SPEC.md](docs/SPEC.md).

---

## Stack

- **Backend** : FastAPI (uvicorn), Python.
- **Base de données** : SQLite en mode WAL.
- **Frontend** : PWA vanilla (sans framework), service worker.
- **PDF** : WeasyPrint (rendu A4).
- **Auth** : OIDC via Pocket ID (`https://id.kerlam.fr`).

---

## Démarrage local

```bash
# Environnement Python
python -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt

# Lancer l'app en mode dev (login OIDC bypassé via DEV_LOGIN)
APP_ENV=dev DEV_LOGIN=1 uvicorn app.main:app --port 8095

# Ouvrir
#   http://127.0.0.1:8095        (application)
#   http://127.0.0.1:8095/api/docs   (documentation OpenAPI)
```

---

## Tests et qualité

```bash
pytest        # tests
ruff check .  # lint
```

---

## Structure du dépôt

```
app/          backend FastAPI (API, modèles, génération PDF)
frontend/     PWA vanilla (HTML/CSS/JS, service worker, manifest)
mcp/          intégrations MCP
tests/        tests pytest
deploy/       docker-compose, nginx, Pocket ID, procédures d'exploitation
docs/         spécification métier (SPEC.md)
.github/      CI / workflows
VERSION       version applicative courante
README.md     ce fichier
```

---

## Versionnage et images

- La version courante est dans le fichier **`VERSION`**.
- Les releases sont taguées **`vX.Y.Z`** (ex. `v0.1.0-beta.1`).
- Chaque tag produit une image Docker **`ghcr.io/kervizic/bon-kerlam:<version>`**
  publiée sur le GitHub Container Registry.

---

## Authentification

- En **production**, l'authentification se fait par **OIDC** contre **Pocket ID**
  (`https://id.kerlam.fr`). Les rôles sont dérivés des groupes OIDC
  `bon-bureau` et `bon-chauffeur`.
- En **développement**, `DEV_LOGIN=1` (combiné à `APP_ENV=dev`) permet de bypasser
  l'OIDC pour travailler en local. **Ne jamais activer `DEV_LOGIN` en production.**

---

## Documentation

- Spécification métier : [docs/SPEC.md](docs/SPEC.md)
- Déploiement et exploitation : [deploy/README.md](deploy/README.md)

---

## Licence

Dépôt public. Les données présentes à des fins de démonstration sont **fictives**.
