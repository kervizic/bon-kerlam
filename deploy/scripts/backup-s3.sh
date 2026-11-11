#!/usr/bin/env bash
# Sauvegarde Postgres de la pile bon-kerlam : pg_dump compressé -> S3 OVH,
# rétention 30 jours. À brancher sur /opt/backups/backup-s3.sh (cron quotidien).
#
# Prérequis : conteneur bon-db up, awscli configuré (ou AWS_* dans l'env),
# variables S3_* (cf. deploy/.env). Secrets lus dans l'environnement : rien en dur.
set -euo pipefail

: "${S3_BUCKET:?S3_BUCKET requis}"
: "${S3_ENDPOINT:?S3_ENDPOINT requis}"
S3_PREFIX="${S3_PREFIX:-kerlam/backups/bon}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
TS="$(date -u +%Y%m%d-%H%M%S)"
TMP="$(mktemp -d)"
OUT="${TMP}/bon-${TS}.sql.gz"

cleanup() { rm -rf "${TMP}"; }
trap cleanup EXIT

echo "[backup] pg_dumpall depuis le conteneur bon-db..."
docker exec bon-db pg_dumpall -U postgres | gzip > "${OUT}"
SIZE="$(du -h "${OUT}" | cut -f1)"
echo "[backup] dump ${SIZE} -> ${OUT}"

echo "[backup] envoi vers s3://${S3_BUCKET}/${S3_PREFIX}/"
aws --endpoint-url "${S3_ENDPOINT}" s3 cp "${OUT}" \
    "s3://${S3_BUCKET}/${S3_PREFIX}/bon-${TS}.sql.gz"

# Rétention : supprime les sauvegardes plus vieilles que RETENTION_DAYS.
CUTOFF="$(date -u -d "-${RETENTION_DAYS} days" +%Y%m%d 2>/dev/null \
          || date -u -v-"${RETENTION_DAYS}"d +%Y%m%d)"
echo "[backup] purge des sauvegardes antérieures à ${CUTOFF}"
aws --endpoint-url "${S3_ENDPOINT}" s3 ls "s3://${S3_BUCKET}/${S3_PREFIX}/" \
  | awk '{print $4}' | while read -r key; do
    [ -z "${key}" ] && continue
    d="$(echo "${key}" | sed -E 's/.*bon-([0-9]{8})-.*/\1/')"
    if [ -n "${d}" ] && [ "${d}" -lt "${CUTOFF}" ] 2>/dev/null; then
      echo "[backup] suppression ${key}"
      aws --endpoint-url "${S3_ENDPOINT}" s3 rm "s3://${S3_BUCKET}/${S3_PREFIX}/${key}"
    fi
  done

echo "[backup] terminé."
