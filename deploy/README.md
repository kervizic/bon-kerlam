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

## 5. Google Cloud — identifiant client OAuth (Supabase Auth)

1. Google Cloud Console → **APIs & Services → Credentials → Create credentials →
   OAuth client ID → Web application**.
2. **Authorized JavaScript origins** :
   - `https://bon.kerlam.fr`
   - `https://api.kerlam.fr`
3. **Authorized redirect URIs** (exact) :
   - `https://api.kerlam.fr/auth/v1/callback`
4. Copier *Client ID* et *Client secret* dans `.env`
   (`GOOGLE_CLIENT_ID`, `GOOGLE_SECRET`). Laisser `GOOGLE_HD` vide (option de
   restriction de domaine désactivée par défaut ; la mettre à `kerlam.fr` pour
   n'autoriser que ce domaine, en plus de la liste blanche).
5. L'accès reste gouverné par la **liste blanche** (`bon.utilisateurs`) et la
   RLS : une adresse Google non listée ne voit rien.

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
