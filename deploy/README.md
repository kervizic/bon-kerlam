# Déploiement bon.kerlam.fr

Procédure d'exploitation de l'application de lettres de voiture KERLAM sur le VPS.

Arborescence cible sur le VPS :

```
/opt/bon-kerlam/
  docker-compose.yml        (cf. deploy/docker-compose.yml)
  .env                      (copié depuis .env.example, valeurs réelles)
  data/                     (volume SQLite, monté sur /data dans le conteneur)
/opt/pocket-id/
  docker-compose.yml        (cf. deploy/pocket-id/docker-compose.yml)
  .env
  data/
/etc/nginx/sites-available/bon.kerlam.fr.conf   (cf. deploy/nginx/)
```

Le conteneur bind sur `127.0.0.1` uniquement (Docker contourne ufw) ; nginx fait
le TLS et le reverse proxy. Voir les commentaires dans `docker-compose.yml`.

---

## 1. Déploiement / mise à jour

Depuis `/opt/bon-kerlam/` :

```bash
# 1. Fixer le tag voulu dans .env
#    BON_VERSION=0.1.0-beta.1

# 2. SAUVEGARDER la base AVANT toute mise à jour (voir section Sauvegarde)

# 3. Tirer l'image du tag puis redémarrer
docker compose pull
docker compose up -d

# 4. Vérifier
docker compose ps
docker compose logs -f bon
curl -fsS https://bon.kerlam.fr/api/health
```

---

## 2. Sauvegarde avant mise à jour

Toujours sauvegarder la base SQLite **avant** un `up -d` qui change de version.
Utiliser la commande `.backup` de SQLite (cohérente même pendant l'écriture,
contrairement à une simple copie de fichier en mode WAL) :

```bash
mkdir -p /opt/bon-kerlam/backups
sqlite3 /opt/bon-kerlam/data/bon.db \
  ".backup /opt/bon-kerlam/backups/bon-$(date +%Y%m%d-%H%M%S).db"
```

Conserver au moins la dernière sauvegarde connue-bonne avant chaque montée de version.

---

## 3. Rollback

Si la nouvelle version pose problème :

```bash
# 1. Repasser BON_VERSION au tag précédent dans .env
#    Exemple : BON_VERSION=0.1.0-beta.0

# 2. Restaurer la base sauvegardée (arrêter le conteneur d'abord)
docker compose stop bon
cp /opt/bon-kerlam/backups/bon-<horodatage>.db /opt/bon-kerlam/data/bon.db
# supprimer les fichiers WAL/SHM résiduels pour éviter toute incohérence
rm -f /opt/bon-kerlam/data/bon.db-wal /opt/bon-kerlam/data/bon.db-shm

# 3. Redémarrer sur l'ancienne version
docker compose up -d
curl -fsS https://bon.kerlam.fr/api/health
```

---

## 4. Sauvegarde nocturne vers S3

Ajouter la base au job de backup existant via un dump `.backup` (jamais une copie
brute du `.db` pendant que l'app tourne). Exemple de ligne cron (3h15 chaque nuit) :

```cron
# m h  dom mon dow  commande
15 3 * * * sqlite3 /opt/bon-kerlam/data/bon.db ".backup /tmp/bon-nightly.db" && aws s3 cp /tmp/bon-nightly.db s3://kerlam-backups/bon/bon-$(date +\%Y\%m\%d).db && rm -f /tmp/bon-nightly.db
```

Adapter le bucket / préfixe au job de sauvegarde S3 déjà en place.

---

## 5. Pocket ID (fournisseur d'identité OIDC)

Instance sur `https://id.kerlam.fr` (cf. `pocket-id/docker-compose.yml`).

### a. Groupes

Créer les deux groupes applicatifs et y affecter les utilisateurs :

- `bon-bureau` : accès au rôle bureau de bon.kerlam.fr.
- `bon-chauffeur` : accès au rôle chauffeur de bon.kerlam.fr.

### b. Client OIDC pour bon.kerlam.fr

- Redirect URI : `https://bon.kerlam.fr/api/auth/callback`
- Scopes : `openid email profile groups`
- Récupérer le `client_id` et le `client_secret` générés : ils alimentent
  `OIDC_CLIENT_ID` et `OIDC_CLIENT_SECRET` dans `/opt/bon-kerlam/.env`.
- Vérifier que le claim des groupes est bien `groups` (cf. `OIDC_GROUPS_CLAIM`).

### c. Client OIDC pour sign.kerlam.fr (Documenso)

Créer un second client OIDC pour Documenso (signature électronique, hors périmètre
beta de bon mais provisionné sur le même Pocket ID) :

- Redirect URI : celui attendu par Documenso (`https://sign.kerlam.fr/...`).
- Scopes : `openid email profile`.
- Variables côté Documenso :
  - `NEXT_PRIVATE_OIDC_WELL_KNOWN=https://id.kerlam.fr/.well-known/openid-configuration`
  - `NEXT_PRIVATE_OIDC_CLIENT_ID=<client_id Documenso>`
  - `NEXT_PRIVATE_OIDC_CLIENT_SECRET=<client_secret Documenso>`
  - `PROVIDER_LABEL="KERLAM"`

---

## 6. Variables d'environnement à créer sur le VPS

### `/opt/bon-kerlam/.env` (cf. `.env.example`)

- `BON_VERSION`
- `APP_ENV`
- `APP_VERSION`
- `GIT_SHA`
- `CARRIER_SIREN`
- `SESSION_SECRET`
- `COOKIE_SECURE`
- `DATA_DIR`
- `OIDC_ISSUER`
- `OIDC_CLIENT_ID`
- `OIDC_CLIENT_SECRET`
- `OIDC_REDIRECT_URI`
- `OIDC_GROUPS_CLAIM`
- `OIDC_GROUP_BUREAU`
- `OIDC_GROUP_CHAUFFEUR`
- `DEV_LOGIN`

### `/opt/pocket-id/.env` (cf. `pocket-id/.env.example`)

- `APP_URL`
- `TRUST_PROXY`
- (éventuelle clé de chiffrement/maintenance selon la version Pocket ID)
