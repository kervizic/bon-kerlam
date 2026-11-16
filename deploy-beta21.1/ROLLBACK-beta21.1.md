# Rollback v0.1.0-beta.21.1 → beta.21 — bon.kerlam.fr

Écrit AVANT tout déploiement. beta.21.1 est un correctif **front + version worker
uniquement** : aucune migration de base, aucune modification nginx, aucune donnée
touchée. Le rollback est donc rapide et sans risque DB.

Sauvegarde créée au déploiement : `/root/bon-beta21-<TS>/` (`.env.bak`,
`front.tar.gz`, `nginx-host.conf.bak`, `bon-pre-beta21.1.dump`).

## Front + worker (rapide)
```bash
ssh kerlam '
  set -e
  cd /opt/bon-kerlam
  # Restaure le front beta.21 (dossier précédent conservé en front.old).
  rm -rf front && mv front.old front
  cd deploy
  # Repasse la version worker à beta.21.
  sed -i "s/^APP_VERSION=.*/APP_VERSION=0.1.0-beta.21/" .env
  set -a; . ./.env; set +a
  # Image worker beta.21 conservée localement (ne PAS l avoir purgée).
  docker compose up -d worker
'
```

## Base de données
**Aucun rollback DB.** beta.21.1 n'ajoute ni ne modifie aucune migration
(dernière = `0021_beta21_corbeille_et_lot`, inchangée). Rien à défaire.

## nginx
Inchangé par beta.21.1 (la location `.mjs` de beta.21 reste en place). Rien à
restaurer. Si besoin malgré tout :
```bash
ssh kerlam '
  CONF=$(grep -rl "server_name bon.kerlam.fr" /etc/nginx/ | head -1)
  cp /root/bon-beta21-<TS>/nginx-host.conf.bak "$CONF" 2>/dev/null || true
  nginx -t && systemctl reload nginx
'
```

## Vérif rollback
- `curl -s http://127.0.0.1:8099/worker/version` → `0.1.0-beta.21`.
- `curl -s https://bon.kerlam.fr | grep app-version` → `content="0.1.0-beta.21"`.
- Worker `healthy` (`docker compose ps`).

## En dernier recours
Restaurer le dump `bon-pre-beta21.1.dump` (`pg_restore -c`) — perte des lettres
créées depuis le déploiement. À éviter ; le simple retour front+worker suffit car
beta.21.1 ne touche pas la base.
