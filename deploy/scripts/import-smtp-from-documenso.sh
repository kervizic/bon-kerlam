#!/usr/bin/env bash
# Recopie la configuration SMTP de Documenso vers le .env de la pile bon-kerlam,
# SUR LE SERVEUR, sans jamais afficher les valeurs secrètes.
#
# Source : /opt/documenso/.env  (NEXT_PRIVATE_SMTP_*)
# Cible  : deploy/.env          (GOTRUE_SMTP_*)
# Expéditeur des codes : « KERLAM <bon@kerlam.fr> » (alias de la boîte sign@).
#
# Usage : ./import-smtp-from-documenso.sh [chemin_documenso_env] [chemin_cible_env]
set -euo pipefail

SRC="${1:-/opt/documenso/.env}"
DST="${2:-$(dirname "$0")/../.env}"

[ -r "$SRC" ] || { echo "Source introuvable ou illisible : $SRC" >&2; exit 1; }
[ -w "$DST" ] || { echo "Cible non inscriptible : $DST" >&2; exit 1; }

# Lit une variable dans un fichier .env sans l'afficher.
read_env() { grep -E "^${1}=" "$SRC" | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'; }

SMTP_HOST="$(read_env NEXT_PRIVATE_SMTP_HOST)"
SMTP_PORT="$(read_env NEXT_PRIVATE_SMTP_PORT)"
SMTP_USER="$(read_env NEXT_PRIVATE_SMTP_USERNAME)"
SMTP_PASS="$(read_env NEXT_PRIVATE_SMTP_PASSWORD)"

: "${SMTP_HOST:=smtp.gmail.com}"
: "${SMTP_PORT:=587}"

# Écrit/renplace une clé dans le .env cible (valeur jamais imprimée).
set_env() {
  local key="$1" val="$2"
  if grep -qE "^${key}=" "$DST"; then
    local tmp; tmp="$(mktemp)"
    grep -vE "^${key}=" "$DST" > "$tmp"
    printf '%s=%s\n' "$key" "$val" >> "$tmp"
    cat "$tmp" > "$DST"; rm -f "$tmp"
  else
    printf '%s=%s\n' "$key" "$val" >> "$DST"
  fi
}

set_env GOTRUE_SMTP_HOST        "$SMTP_HOST"
set_env GOTRUE_SMTP_PORT        "$SMTP_PORT"
set_env GOTRUE_SMTP_USER        "$SMTP_USER"
set_env GOTRUE_SMTP_PASS        "$SMTP_PASS"
set_env GOTRUE_SMTP_ADMIN_EMAIL "bon@kerlam.fr"
set_env GOTRUE_SMTP_SENDER_NAME "KERLAM"
set_env GOTRUE_MAILER_TEMPLATES_MAGIC_LINK "file:///etc/gotrue/otp_fr.html"

echo "SMTP importé depuis $SRC vers $DST (valeurs masquées)."
echo "Expéditeur des codes : KERLAM <bon@kerlam.fr>. Pensez à redémarrer : docker compose up -d auth"
