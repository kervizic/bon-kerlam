# bon.kerlam.fr — Lettres de voiture dématérialisées

Application web des **lettres de voiture (LV)** de KERLAM (location de camions avec
chauffeur). Conforme à l'arrêté du 9/11/1999 (art. 4) : une LV par jour et par
projet, à en-tête KERLAM, avec état récapitulatif des tours ; format électronique.

> **Beta `0.1.0-beta.1`.** Ce dépôt ne déploie rien : il fournit le code, les
> tests, la CI et les fichiers de déploiement. Voir `deploy/README.md` pour la
> mise en service manuelle.

## Architecture

Pile **Supabase allégée**, auto-hébergée (sans Kong, Studio ni Realtime) :

```
Navigateur (PWA)  ──►  nginx  ──►  GoTrue (auth)  ┐
   supabase-js                     PostgREST (api) ├─►  Postgres 15
   /worker/*      ──►  bon-worker  Storage (S3 OVH)┘     schémas bon · api · svc
```

- **Postgres** : schéma métier `bon`, schéma exposé `api` (vues security_invoker
  + RPC portant les règles : numérotation atomique, pré-remplissage, poids,
  liste de sites, undo), RLS partout, schéma `svc` (jetons IA hachés). Migrations
  SQL numérotées + runner idempotent (`supabase/apply.py`, table
  `meta.schema_migrations`, sauvegarde pg_dump avant).
- **Front** : HTML/CSS/JS vanilla en modules ES, sans bundler, `supabase-js`
  vendorisé, PWA (manifest, service worker, mise à jour automatique sûre).
- **bon-worker** : FastAPI (Python 3.12) pour ce que le navigateur ne peut pas
  faire : PDF (WeasyPrint), clôture de minuit, géocodage du seed, API pour l'IA
  (jetons hachés, portée lecture/écriture), OpenAPI sur `/worker/docs`.
- **MCP** (`mcp/`) : serveur FastMCP **lecture seule** (beta) :
  `lv_rechercher`, `lv_lire`, `alertes`, `referentiel_lister`.

Connexion : Supabase Auth **Google uniquement**, inscription e-mail désactivée,
accès par **liste blanche** (`bon.utilisateurs` : e-mail, rôle
`chauffeur | bureau | desactive`). Une adresse non listée ne voit rien (RLS).

## Arborescence

```
bon-kerlam/
├── VERSION  CHANGELOG.md  README.md  LICENSE  pyproject.toml
├── docs/SPEC.md                     # spécification métier complète
├── supabase/
│   ├── migrations/0000..0008_*.sql  # rôles, schéma, règles, audit, RLS, api, svc, seed, worker
│   ├── apply.py                     # runner idempotent (versionné, sauvegarde)
│   └── tests/                       # tests SQL (fonctions + RLS + rejouabilité)
├── worker/                          # FastAPI + Dockerfile + tests
├── front/                           # PWA vanilla ES + service worker + Dockerfile
├── mcp/                             # serveur MCP lecture seule
├── deploy/                          # compose, nginx, scripts, .env.example, README
└── .github/workflows/               # ci.yml (tests) · release.yml (images ghcr)
```

## Développement & tests

Aucune installation globale : tout dans un `.venv` du projet ou dans la CI.

```bash
python3 -m venv .venv && . .venv/bin/activate
pip install ruff pytest fastapi "psycopg[binary]" jinja2 httpx
ruff check .
pytest worker/tests -q            # tests sans base

# Tests SQL (nécessitent un Postgres) — faits en CI, ou en local avec une base :
DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres \
  pytest supabase/tests -q
```

La CI (`.github/workflows/ci.yml`) exécute à chaque push : ruff, tests worker,
tests SQL (numérotation sans trou, seuils de poids 100/105 %, pré-remplissage et
priorité LV préparée, case destinataire identique, mémoire d'unité, RLS
chauffeur/bureau/non autorisé, ordre de la liste de sites, anti-doublon 100 m,
undo limité à ses actions et bloqué après signature, commentaire interne absent
du PDF, migrations rejouables), puis démarre la pile (`compose-smoke`), applique
le seed, vérifie `/worker/version` et rapporte la mémoire par service.

## Versionnage & mise à jour automatique

SemVer (`VERSION`, `CHANGELOG.md`, tags `vX.Y.Z[-beta.N]`). Les images sont
construites avec `APP_VERSION`/`GIT_SHA` ; la version est injectée dans le HTML
(`<meta app-version>`) et sur les assets (`?v=<version>`). `/worker/version`
renvoie `{version, sha, schema_version}`. Le front se met à jour seul
(`front/assets/app-version.js`) : re-vérification au chargement, toutes les 5 min,
au retour au premier plan et au bfcache ; jamais de rechargement tant que la file
d'envoi n'est pas vide ou qu'un champ a le focus ; service worker versionné.

Sur tag `v*`, la CI publie `ghcr.io/kervizic/bon-kerlam-worker` et
`ghcr.io/kervizic/bon-kerlam-front` (version + `beta`).

## Licence

MIT. Aucune donnée réelle (client, salarié, camion) dans ce dépôt public ; seules
les données de départ publiques (articles, sites communs YPREMA) sont présentes.
