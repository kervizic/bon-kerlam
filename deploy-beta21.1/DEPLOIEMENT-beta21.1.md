# Déploiement v0.1.0-beta.21.1 — bon.kerlam.fr

## Contenu beta.21.1 (correctifs)
- **Tours facultatifs** : les tours ne bloquent plus jamais l'envoi en signature
  (règle « Aucun tour » et toute vérification liée au nombre/contenu des tours
  retirées de `lvCompleteness` et du bandeau). Front uniquement (le serveur
  n'imposait rien).
- **Barre d'onglets du bas & clavier** : la barre d'onglets (et la barre de
  sélection « Signer (N) ») se masque au clavier logiciel (focusin/focusout
  principal, visualViewport complément ; bug WebKit 218983 pris en compte) et
  réapparaît à la fermeture. Front uniquement.
- **Capture CI du swipe** corrigée (script de captures) + nouvelle capture clavier.

## Portée technique
- **Front** : `app.js`, `completeness.js`, `styles.css`, `index.html`, `sw.js`.
- **Worker** : aucune modif de code ; seul `APP_VERSION` passe à `0.1.0-beta.21.1`
  (nouvelle image ghcr construite par le tag ; `/worker/version` reflète la version).
- **Base de données** : AUCUNE migration (dernière inchangée = `0021_...`).
- **nginx** : AUCUN changement (la location `.mjs` de beta.21 reste en place).

## Pré-requis
- CI verte sur `feat/beta.21.1` (5/5).
- Merge ff-only → `main` + **tag `v0.1.0-beta.21.1` poussé** → `release.yml`
  construit/pousse l'image ghcr `bon-kerlam-worker:0.1.0-beta.21.1`. Attendre la fin.
- Accès : `ssh kerlam`. Disque VPS ~95 % : surveiller `df -h`, garder l'image
  **beta.21** pour le rollback, ne purger **beta.20** qu'APRÈS un déploiement vérifié.

## Procédure
```bash
TS=$(date +%Y%m%d-%H%M%S)
# 0) Sauvegarde horodatée (front + .env + nginx hôte + DUMP COMPLET par sécurité).
ssh kerlam '
  set -e
  mkdir -p /root/bon-beta21-'"$TS"'
  cd /opt/bon-kerlam
  cp deploy/.env /root/bon-beta21-'"$TS"'/.env.bak
  tar czf /root/bon-beta21-'"$TS"'/front.tar.gz front
  CONF=$(grep -rl "server_name bon.kerlam.fr" /etc/nginx/ | head -1)
  cp "$CONF" /root/bon-beta21-'"$TS"'/nginx-host.conf.bak 2>/dev/null || true
  docker exec bon-db pg_dump -Fc -U postgres postgres > /root/bon-beta21-'"$TS"'/bon-pre-beta21.1.dump
  df -h /
'
# 1) Sync front depuis le clone (config prod préservée). PAS de supabase/nginx.
rsync -a --delete ~/tmp/bon-kerlam-beta21/front/ kerlam:/opt/bon-kerlam/front.new/
ssh kerlam '
  set -e
  cd /opt/bon-kerlam
  cp front/assets/config.js front.new/assets/config.js   # config prod préservée
  rm -rf front.old && mv front front.old && mv front.new front
'
# 2) Worker beta.21.1 : bump APP_VERSION + pull image ghcr (construite par le tag).
ssh kerlam '
  set -e
  cd /opt/bon-kerlam/deploy
  sed -i "s/^APP_VERSION=.*/APP_VERSION=0.1.0-beta.21.1/" .env
  set -a; . ./.env; set +a
  docker compose pull worker
  docker compose up -d worker
'
# 3) (Option, seulement si déploiement VÉRIFIÉ) libérer de la place : purger
#    l image worker beta.20 — GARDER beta.21 pour le rollback.
ssh kerlam 'docker image ls | grep bon-kerlam-worker'
# ssh kerlam 'docker image rm ghcr.io/kervizic/bon-kerlam-worker:0.1.0-beta.20 || true'
```

## Vérifications (attendu)
- `curl -s https://bon.kerlam.fr | grep app-version` → `content="0.1.0-beta.21.1"`.
- `curl -s http://127.0.0.1:8099/worker/version` → `{"version":"0.1.0-beta.21.1", ...}`.
- Worker `healthy` (`docker compose ps`).
- `df -h /` reste sous contrôle.
- Smoke test démo (iPhone) :
  - lettre complète **sans aucun tour** → aucun bandeau « éléments à compléter »
    bloquant pour les tours ; envoi en signature possible.
  - champ en focus → la barre d'onglets du bas se masque ; au blur elle revient.

## Rollback
Voir `ROLLBACK-beta21.1.md` (retour front `front.old` + `APP_VERSION=0.1.0-beta.21`,
aucun rollback DB nécessaire).
