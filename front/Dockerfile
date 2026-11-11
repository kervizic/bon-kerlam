# Dockerfile — bon.kerlam.fr (front statique, nginx non-root)
#
# Build depuis la racine du repo (contexte = racine, PAS front/) :
#   docker build -f front/Dockerfile -t bon-kerlam-front \
#     --build-arg APP_VERSION=0.1.0-beta.1 --build-arg GIT_SHA=$(git rev-parse --short HEAD) .
#
# Tourne entièrement en non-root : on réutilise l'utilisateur "nginx" (uid 101)
# déjà créé par l'image officielle, on déplace le pid file et les dossiers
# temporaires vers /tmp (inscriptible par un non-root), et on écoute sur le
# port non privilégié 8080 (cf. front/nginx.conf).
# nginx non-root servant les fichiers statiques.
# Les icônes PWA (favicons, apple-touch, icônes 192/512 + maskable) sont des
# assets validés par le client, versionnés dans le dépôt sous front/ et
# front/assets/icons/ — plus de génération au build.
FROM nginx:1.27-alpine

ARG APP_VERSION=0.0.0-dev
ARG GIT_SHA=unknown

RUN sed -i -E 's/^user +nginx;//' /etc/nginx/nginx.conf \
  && sed -i -E "s#/var/run/nginx.pid#/tmp/nginx.pid#" /etc/nginx/nginx.conf \
  && mkdir -p /tmp/nginx_client_temp /tmp/nginx_proxy_temp /tmp/nginx_fastcgi_temp \
             /tmp/nginx_uwsgi_temp /tmp/nginx_scgi_temp \
  && chown -R nginx:nginx \
       /var/cache/nginx \
       /tmp/nginx_client_temp /tmp/nginx_proxy_temp /tmp/nginx_fastcgi_temp \
       /tmp/nginx_uwsgi_temp /tmp/nginx_scgi_temp \
       /usr/share/nginx/html /etc/nginx/conf.d

COPY front/nginx.conf /etc/nginx/conf.d/default.conf
COPY front/ /usr/share/nginx/html/

# Petit fichier diagnostic : utile pour vérifier en prod quelle image tourne
# (jamais caché côté nginx, cf. front/nginx.conf).
RUN printf '{"version":"%s","gitSha":"%s"}\n' "$APP_VERSION" "$GIT_SHA" \
      > /usr/share/nginx/html/version.json \
  && chown nginx:nginx /usr/share/nginx/html/version.json \
  && rm -f /usr/share/nginx/html/Dockerfile /usr/share/nginx/html/nginx.conf /usr/share/nginx/html/README.md

USER nginx
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
