# Déploiement — bon.kerlam.fr

Pile Supabase **allégée** (Postgres + GoTrue + PostgREST + Storage) + worker +
front, réglée pour un VPS à mémoire très limitée. **Cette procédure n'est lancée
par personne automatiquement : elle se fait à la main sur le serveur.**

> Cible : VPS KERLAM `51.68.197.98`, Ubuntu 18.04, Docker 24 / Compose v2.18,
> 1 vCPU, ~425 Mo de RAM libres. Documenso + Node-RED + sauvegarde caméras déjà
> en place. Tous les ports de la pile sont publiés sur `127.0.0.1` uniquement
> (Docker contourne ufw sur ce VPS) ; nginx de l'hôte est le seul frontal public.

## 0. Pré-vol mémoire

```bash
free -m            # noter MiB libres AVANT
docker stats --no-stream
```

La pile vise, limites dures (`mem_limit`) : db 256m, auth 64m, rest 64m,
storage 160m, worker 128m, front 48m. Total plafond ~720m ; consommation réelle
mesurée en CI bien inférieure (voir le job `compose-smoke`). Si la RAM manque,
démarrer sans `storage` (le beta n'écrit pas encore de fichiers) : la signature
Documenso et les PDF stockés sont hors périmètre beta.

## 1. Secrets (générés SUR LE SERVEUR, jamais committés)

```bash
cd /opt/bon-kerlam/deploy
cp .env.example .env

# Secrets de base
echo "POSTGRES_PASSWORD=$(openssl rand -base64 24)"
echo "WORKER_DB_PASSWORD=$(openssl rand -base64 24)"
echo "JWT_SECRET=$(openssl rand -hex 32)"

# Clés API dérivées du JWT_SECRET
JWT_SECRET=<valeur> python3 scripts/gen-jwt.py   # -> ANON_KEY, SERVICE_ROLE_KEY
```

Reporter toutes ces valeurs dans `.env`. Renseigner aussi les identifiants
Google (section 5) et les clés S3 OVH (bucket `kerlam-bon`, région
`eu-west-par`, endpoint `s3.eu-west-par.io.cloud.ovh.net`).

## 2. Premier démarrage

```bash
# a) base seule (les scripts d'init posent les mots de passe des rôles)
docker compose up -d db
until docker exec bon-db pg_isready -U postgres; do sleep 2; done

# b) migrations + seed (table meta.schema_migrations, sauvegarde pg_dump avant)
DATABASE_URL="postgres://postgres:${POSTGRES_PASSWORD}@127.0.0.1:5432/postgres" \
  python3 ../supabase/apply.py --apply

# c) rôle applicatif : LOGIN + mot de passe
docker exec bon-db psql -U postgres \
  -c "ALTER ROLE bon_worker LOGIN PASSWORD '${WORKER_DB_PASSWORD}';"

# d) le reste de la pile
docker compose up -d auth rest storage worker
docker compose up -d --build worker      # construit l'image worker si non publiée
```

Front : déposer le contenu de `front/` dans `/opt/bon-kerlam/front` (servi par
le nginx de l'hôte, cf. `nginx/bon.kerlam.fr.conf`) **ou** `docker compose up -d
--build front`. Écrire `front/assets/config.js` avec `API_URL`, `ANON_KEY`.

## 3. nginx + TLS (nginx 1.14 / certbot 0.31)

```bash
cp nginx/api.kerlam.fr.conf /etc/nginx/sites-available/
cp nginx/bon.kerlam.fr.conf /etc/nginx/sites-available/
ln -s /etc/nginx/sites-available/api.kerlam.fr.conf /etc/nginx/sites-enabled/
ln -s /etc/nginx/sites-available/bon.kerlam.fr.conf /etc/nginx/sites-enabled/
certbot --nginx -d api.kerlam.fr -d bon.kerlam.fr
nginx -t && systemctl reload nginx
```

## 4. Vérifications

```bash
curl -s https://api.kerlam.fr/ ; echo
curl -s http://127.0.0.1:8099/worker/version ; echo   # {version:0.1.0-beta.1,...}
free -m                                                # mémoire APRÈS
docker stats --no-stream
```

## 5. Google Cloud — identifiant client OAuth générique « KERLAM web »

**Un seul** client OAuth web, partagé par toutes les applis KERLAM (bon, sign…).
Projet Google Cloud **« KERLAM »**, compte **contact@kerlam.fr**.

1. Google Cloud Console (projet **KERLAM**) → **APIs & Services → OAuth consent
   screen** : type **Externe**, application **publiée** (pas en test), **sans
   logo** (évite la revue de marque). Scopes : `openid`, `.../auth/userinfo.email`,
   `.../auth/userinfo.profile`.
2. **Credentials → Create credentials → OAuth client ID → Web application**, nom
   **« KERLAM web »**.
3. **Authorized JavaScript origins** :
   - `https://bon.kerlam.fr`
   - `https://sign.kerlam.fr`
4. **Authorized redirect URIs** (exactes) :
   - `https://api.kerlam.fr/auth/v1/callback`  (bon.kerlam.fr / GoTrue)
   - `https://sign.kerlam.fr/api/auth/callback/google`  (Documenso)
5. Enregistrer *Client ID* et *Client secret* dans **Bitwarden** (projet
   **Kerlam**) : items **« Google OAuth KERLAM client ID »** et
   **« Google OAuth KERLAM client secret »**. Les reporter dans `.env`
   (`GOOGLE_CLIENT_ID`, `GOOGLE_SECRET`). `GOOGLE_HD` vide par défaut (mettre
   `kerlam.fr` pour restreindre au domaine, en plus de la liste blanche).
6. L'accès reste gouverné par la **liste blanche** (`bon.utilisateurs`) et la
   RLS : une adresse Google non listée ne voit rien.
7. Documenso réutilise **le même** client (origine `sign.kerlam.fr`, redirection
   `…/api/auth/callback/google`) via `NEXT_PRIVATE_GOOGLE_CLIENT_ID` /
   `NEXT_PRIVATE_GOOGLE_CLIENT_SECRET`. Ne pas toucher au conteneur Documenso.

## 5bis. Connexion par code e-mail (OTP) + SMTP

La beta.2 ajoute la connexion par **code e-mail à 6 chiffres** (en plus de
Google). GoTrue envoie le code par e-mail ; on réutilise le **SMTP de Documenso** :

```bash
cd /opt/bon-kerlam/deploy
# Recopie NEXT_PRIVATE_SMTP_* -> GOTRUE_SMTP_* dans .env, sans afficher les secrets
./scripts/import-smtp-from-documenso.sh /opt/documenso/.env ./.env
docker compose up -d auth        # recharge GoTrue
```

- Expéditeur des codes : **« KERLAM <bon@kerlam.fr> »** (alias de `sign@kerlam.fr`).
- Modèle FR du code : `email/otp_fr.html` (monté sur `/etc/gotrue/otp_fr.html`,
  référencé par `GOTRUE_MAILER_TEMPLATES_MAGIC_LINK=file:///etc/gotrue/otp_fr.html`).
- Hook de refus des e-mails hors liste blanche (optionnel) : mettre
  `GOTRUE_HOOK_BEFORE_USER_CREATED_ENABLED=true` et
  `GOTRUE_HOOK_BEFORE_USER_CREATED_URI=pg-functions://postgres/bon/gotrue_before_user_created`
  (la RLS reste le garde-fou dur dans tous les cas).

**Documenso** (hors périmètre de cette pile, connexion Google native propre) :
renseigner dans son déploiement `NEXT_PRIVATE_GOOGLE_CLIENT_ID` et
`NEXT_PRIVATE_GOOGLE_CLIENT_SECRET`. Ne pas toucher au conteneur Documenso.

## 5ter. Bucket privé des documents chauffeur

Les scans (permis, FCO, carte conducteur, CACES) vont dans un bucket Storage
**privé** `chauffeur-docs`. Créé via l'API Storage une fois la pile démarrée
(la politique RLS « bureau uniquement » est posée par la migration 0011) :

```bash
source .env
curl -s -X POST http://127.0.0.1:5000/storage/v1/bucket \
  -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"id":"chauffeur-docs","name":"chauffeur-docs","public":false}'
```

Le worker génère des **URL signées courtes** (`SERVICE_ROLE_KEY`, `STORAGE_URL`)
et supprime les scans au **départ d'un salarié** (`POST /worker/chauffeur/{id}/depart`).

## 6. Sauvegarde (cron quotidien)

```bash
install -m 755 scripts/backup-s3.sh /opt/backups/backup-s3.sh
# cron 03:15, variables S3_* chargées depuis l'env
15 3 * * * . /opt/bon-kerlam/deploy/.env && /opt/backups/backup-s3.sh >> /var/log/bon-backup.log 2>&1
```

pg_dump compressé → `s3://kerlam-bon/kerlam/backups/bon/`, rétention 30 jours.

## 7. ROLLBACK complet

```bash
cd /opt/bon-kerlam/deploy
docker compose down                       # arrêt (sans -v : on garde le volume)

# Restauration d'une sauvegarde
aws --endpoint-url "$S3_ENDPOINT" s3 cp \
  s3://kerlam-bon/kerlam/backups/bon/bon-<TS>.sql.gz /tmp/restore.sql.gz
docker compose up -d db
until docker exec bon-db pg_isready -U postgres; do sleep 2; done
gunzip -c /tmp/restore.sql.gz | docker exec -i bon-db psql -U postgres

# Retour à l'image précédente (tag antérieur)
export APP_VERSION=0.1.0-beta.0      # version connue bonne
docker compose pull worker front
docker compose up -d
```

En dernier recours (base corrompue) : `docker compose down -v` puis reprendre à
l'étape 2 avec la dernière sauvegarde.

## Variables d'environnement à créer sur le VPS (noms seulement)

`POSTGRES_DB`, `POSTGRES_PASSWORD`, `WORKER_DB_PASSWORD`, `JWT_SECRET`,
`JWT_EXPIRY`, `ANON_KEY`, `SERVICE_ROLE_KEY`, `API_EXTERNAL_URL`, `SITE_URL`,
`ADDITIONAL_REDIRECT_URLS`, `PGRST_DB_SCHEMAS`, `GOOGLE_ENABLED`,
`GOOGLE_CLIENT_ID`, `GOOGLE_SECRET`, `GOOGLE_HD`, `S3_BUCKET`, `S3_REGION`,
`S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `APP_VERSION`, `GIT_SHA`,
`GEOCODE_ON_START`, `KERLAM_SIREN`, `GOTRUE_SMTP_HOST`, `GOTRUE_SMTP_PORT`,
`GOTRUE_SMTP_USER`, `GOTRUE_SMTP_PASS`, `GOTRUE_SMTP_ADMIN_EMAIL`,
`GOTRUE_SMTP_SENDER_NAME`, `GOTRUE_MAILER_TEMPLATES_MAGIC_LINK`,
`GOTRUE_HOOK_BEFORE_USER_CREATED_ENABLED`, `GOTRUE_HOOK_BEFORE_USER_CREATED_URI`.

## 8. Déploiement réel bêta — bon.kerlam.fr (2026-11-11, v0.1.0-beta.4)

Pile déployée sur le VPS KERLAM (Ubuntu 18.04, nginx hôte 1.14). Points réels
rencontrés et procédure effectivement appliquée :

- **Images ghcr publiques** : `ghcr.io/kervizic/bon-kerlam-{front,worker}` sont
  tirables anonymement (pas de `docker login` nécessaire).
- **Port Postgres hôte** : `127.0.0.1:5432` déjà pris par un autre service →
  bon-db publié sur **`127.0.0.1:5434:5432`** (interne inchangé, `db:5432`).
- **Secrets** : `POSTGRES_PASSWORD`/`WORKER_DB_PASSWORD`/`JWT_SECRET` générés par
  `openssl` sur le serveur ; `ANON_KEY`/`SERVICE_ROLE_KEY` mintés via un conteneur
  `python:3.12` + PyJWT (l'hôte est en Python 3.6, incompatible avec `gen-jwt.py`).
  Google OAuth injecté depuis Bitwarden (Mac) par stdin. SMTP importé de Documenso.
  **S3 OVH non fourni** → `storage` non démarré, `PGRST_DB_SCHEMAS=api,svc`
  (documents chauffeur à activer plus tard, cf. §5ter).
- **Migrations** : `apply.py` lancé dans un conteneur `python:3.12` + `psycopg`
  sur le réseau `bon-kerlam_default` (`DATABASE_URL=postgres://postgres:…@db:5432`).
- **Propriété schéma `auth`** : le script d'init `zz-fix.sql` (sous-dossier
  `init-scripts/`) n'étant pas rejoué par l'image, GoTrue échouait
  (`must be owner of function uid`). Corrigé à la main :
  `ALTER SCHEMA auth OWNER TO supabase_auth_admin` + tables/fonctions/séquences,
  puis `docker restart bon-auth`.
- **nginx** : les vhosts du dépôt déclaraient `ssl_session_cache shared:SSL:10m`,
  en conflit avec `snippets/ssl.conf` (`shared:SSL:50m`, global). Lignes
  `ssl_session_cache`/`ssl_protocols` **retirées** des vhosts (le snippet global
  gère). `nginx -t` OK → `nginx -s reload` (jamais `restart`).
- **Front** : fichiers statiques extraits de l'image front (`docker cp`) vers
  `/opt/bon-kerlam/front` (option A du vhost), bascule atomique (`front.old`).

### Rollback complet (exact)

```bash
# 1. Arrêter/retirer la pile bon (conserve le volume db pour debug)
cd /opt/bon-kerlam/deploy && docker compose down
#    purge totale (supprime aussi les données) : docker compose down -v

# 2. Restaurer nginx (vhosts bon/api) tels qu'avant
cp /root/vhost-bon-before-*.conf /etc/nginx/sites-available/bon.kerlam.fr
cp /root/vhost-api-before-*.conf /etc/nginx/sites-available/api.kerlam.fr
#    ou l'archive complète : tar xzf /root/backup-nginx-20261111-143433.tgz -C /etc
nginx -t && nginx -s reload

# 3. Restaurer la page statique publique si besoin
tar xzf /root/backup-bon-public-20261111-143433.tgz -C /var/www

# 4. Retour à une image antérieure : éditer APP_VERSION dans .env puis
cd /opt/bon-kerlam/deploy && docker compose up -d
```

Sauvegardes présentes : `/root/backup-nginx-20261111-143433.tgz`,
`/root/backup-bon-public-20261111-143433.tgz`, copies `vhost-{bon,api}-before-*.conf`.
