# Changelog

Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/),
versionnage [SemVer](https://semver.org/lang/fr/). Ce journal ne décrit QUE ce
qui est réellement livré.

## [0.1.0-beta.2] — 2026-11-11

### Connexion — Google OU code e-mail (OTP)
- Deux méthodes de connexion : **« Continuer avec Google »** ou **« Recevoir un
  code par mail »** (code à usage unique à 6 chiffres, sans mot de passe, OTP
  e-mail GoTrue). Écran de connexion aux couleurs KERLAM, mode sombre auto,
  saisie e-mail puis code, renvoi du code après 60 s.
- **Session persistante** sur le téléphone (refresh token tournant : pas de
  reconnexion quotidienne).
- La **liste blanche** du bureau (e-mail + rôle chauffeur | bureau | désactivé)
  s'applique aux DEUX méthodes, par RLS **et** par un hook SQL optionnel
  « before user created » (`bon.gotrue_before_user_created`, migration 0009) qui
  refuse un e-mail non listé si GoTrue l'active. Une adresse non listée (Google
  ou e-mail) ne voit RIEN et obtient « Accès non autorisé, contactez le bureau ».
- **SMTP** : réutilise la connexion SMTP de Documenso du VPS (variables
  `GOTRUE_SMTP_*` uniquement dans le dépôt). Script
  `deploy/scripts/import-smtp-from-documenso.sh` qui recopie les valeurs depuis
  `/opt/documenso/.env` sans les afficher. Expéditeur : « KERLAM
  <bon@kerlam.fr> ». Modèle d'e-mail du code en français (`deploy/email/otp_fr.html`).
- Tests : liste blanche pour un e-mail Google et un e-mail OTP autorisés, et
  pour une adresse non autorisée (aucune donnée) ; hook de refus.

## [0.1.0-beta.1] — 2026-11-11

Première beta : socle complet, testé, avec CI et fichiers de déploiement.
**Aucun déploiement** n'est effectué par ce dépôt.

### Base de données (Supabase allégé)
- Schéma métier `bon` : utilisateurs (liste blanche), camions, chauffeurs,
  clients, contacts, projets, sites, articles, lettres de voiture, tours,
  lignes, compteur, mémoire d'unité, journal d'audit.
- Schéma exposé `api` : vues security_invoker + RPC (`lv_poids`, `prefill`,
  `sites_pour`, `site_doublon`, `lv_undo`, `set_derniere_unite`, `profil`).
- Schéma `svc` : jetons IA hachés (sha256), portée lecture/écriture, révocables.
- Règles métier en SQL : **numérotation KER-##### atomique** (continue, sans
  trou, attribuée au premier tour) ; **estimation de poids** vs PTAC (seuils
  100 %/105 %, « poids partiel ») ; **anti-doublon de site à 100 m** ;
  **liste de sites** ordonnée ; **pré-remplissage** avec priorité à la LV
  préparée ; **mémoire de la dernière unité** par chauffeur/article.
- **RLS** partout : chauffeur (ses LV), bureau (tout), non listé (rien).
- **Audit par triggers** + **undo** limité aux actions de son auteur et bloqué
  après signature ; suppressions douces.
- Migrations SQL numérotées (`0000`→`0008`) + **runner idempotent**
  (`supabase/apply.py`, table `meta.schema_migrations`, sauvegarde pg_dump).
- **Seed public** : 9 articles (nom + commentaire interne) et 9 sites communs
  YPREMA (géocodés via la BAN au premier démarrage).

### Worker (FastAPI)
- `/worker/version` (`{version, sha, schema_version}`), `/worker/healthz`.
- Lecture protégée par jeton IA : `/worker/lv`, `/worker/lv/{id}`,
  `/worker/alertes`, `/worker/referentiel/{kind}`.
- **PDF WeasyPrint** (gabarit A4 sobre, logo, **commentaire interne jamais
  imprimé**, destinataire identique recopié en entier, zone de signature
  réservée 44 × 22 mm pour Documenso).
- Clôture de minuit, géocodage du seed, OpenAPI `/worker/docs`. Rôle Postgres
  dédié `bon_worker` aux droits minimaux.

### Front (PWA vanilla ES)
- Coquille responsive (smartphone + bureau), charte KERLAM, **mode sombre
  automatique**, `supabase-js` vendorisé, service worker et **mise à jour
  automatique sûre** (`app-version.js`). Écrans « Aujourd'hui » et « Contrôle »
  les plus aboutis ; autres écrans présents en ébauche.

### MCP
- Serveur **lecture seule** : `lv_rechercher`, `lv_lire`, `alertes`,
  `referentiel_lister` (via l'API du worker, jeton haché).

### Déploiement & CI
- `deploy/` : `docker-compose.yml` (pile allégée réglée mémoire minimale, ports
  `127.0.0.1`, healthchecks), nginx `api.kerlam.fr` et `bon.kerlam.fr`, scripts
  de clés JWT et de sauvegarde S3 (rétention 30 j), `.env.example`, README
  (installation, contrôle mémoire, rollback, procédure Google OAuth).
- CI : ruff + tests worker + **tests SQL** (fonctions, RLS, rejouabilité) +
  **smoke compose** (seed, `/worker/version`, mémoire par service). Sur tag `v*`,
  publication des images `ghcr.io/kervizic/bon-kerlam-{worker,front}`.

### Hors périmètre (points d'extension prévus)
- Signature Documenso, envoi groupé, fin de mois / facturation, outils MCP en
  écriture.

[0.1.0-beta.2]: https://github.com/kervizic/bon-kerlam/releases/tag/v0.1.0-beta.2
[0.1.0-beta.1]: https://github.com/kervizic/bon-kerlam/releases/tag/v0.1.0-beta.1
