# bon.kerlam.fr — front

PWA statique (vanilla HTML/CSS/JS, modules ES, aucun bundler, aucun CDN) pour la
dématérialisation des lettres de voiture KERLAM. Parle à un Supabase self-hosted
(Postgres + GoTrue + PostgREST + Storage) via `supabase-js` vendoré.

## Arborescence

```
front/
  index.html               coquille (auth, nav mobile/desktop, vues)
  manifest.webmanifest      PWA (icônes SVG)
  sw.js                     service worker versionné
  Dockerfile, nginx.conf    image statique non-root
  assets/
    app.js                  logique applicative (module ES, point d'entrée)
    app-version.js          mise à jour forcée du shell
    config.js                config de DEV (placeholders localhost)
    config.example.js        modèle de config de déploiement
    supabase-client.js       client supabase-js configuré + helpers data/RPC
    styles.css                design system
    icons/icon.svg, maskable.svg
    vendor/supabase/supabase.js  supabase-js vendoré (UMD, pinned)
```

## Comment la coquille fonctionne

- **Chargement** : `config.js` (classique, définit `window.BON_CFG`) →
  `vendor/supabase/supabase.js` (classique, UMD, définit `window.supabase`) →
  `app.js` (`type="module"`, différé par le navigateur, s'exécute après les deux
  précédents). `app-version.js` est chargé à part, en `<script defer>`.
- **Auth** : Google OAuth via GoTrue (`signInWithOAuth({provider:'google'})`).
  Trois états : pas de session → écran de connexion ; session mais
  `api.profil` vide (compte pas sur la liste blanche, cf.
  `supabase/migrations/0004_rls.sql`) → écran « Accès non autorisé » ; sinon →
  coquille applicative.
- **Navigation** : routeur maison basé sur `location.hash` (pas de framework).
  Mobile (<900px) : bottom bar à 3 entrées (Aujourd'hui / Mes LV / Contrôle) —
  c'est l'app du chauffeur. Desktop (≥900px) : menu latéral à 11 entrées —
  c'est la vue bureau. Les deux se recoupent via le Tableau de bord (cartes de
  raccourci vers Aujourd'hui / Mes LV / Contrôle).
- **Autosave** : chaque champ du formulaire d'en-tête, de tour ou de ligne
  d'article sauvegarde individuellement, avec un debounce de 600ms, directement
  en base via PostgREST. Un indicateur global dans la barre du haut reflète
  l'état (`Enregistré` / `Envoi en cours` / `Hors ligne, sera envoyé`). En cas
  d'échec réseau, l'écriture est mise en file dans IndexedDB
  (`assets/app.js`, stores `cache`/`queue`) et rejouée au retour du réseau ou
  toutes les 30s.
- **Undo/redo** : pile client-side. Les éditions de champ (texte/select) sont
  groupées par session de focus et pleinement réversibles côté client. Les
  changements structurels (ajout/suppression de tour ou de ligne) poussent une
  entrée qui appelle `api.lv_undo` côté serveur pour l'« undo » ; il n'y a pas
  de vrai « redo » serveur pour ces cas (le redo recharge juste l'état courant)
  — limitation documentée, acceptable car `lv_undo` s'appuie sur l'audit log
  Postgres qui n'est pas conçu comme une pile bidirectionnelle.
  Flèches ↶/↷ toujours visibles dans la barre du haut ; `Ctrl+Z` /
  `Ctrl+Maj+Z` au clavier (interceptés globalement — l'undo natif du
  navigateur dans un champ texte est volontairement désactivé au profit de
  cette pile applicative).

## Mécanisme de mise à jour automatique

Adapté de `kertec.fr` (`assets/app-version.js`) : l'empreinte du shell = liste
ordonnée des `?v=N` présents dans le DOM + `<meta name="app-rev">`. Un fetch
périodique (`no-store`) du HTML courant compare son empreinte à celle
chargée ; en cas de différence, et **seulement à un « moment calme »**
(file de synchro vide **et** aucun champ au focus), on purge les caches et on
recharge.

Deux déclencheurs supplémentaires par rapport à kertec :
- **Service worker** : `app-version.js` enregistre `/sw.js`. Le SW fait lui-même
  `skipWaiting()` + `clients.claim()` à l'activation (cf. `sw.js`) ; l'event
  `controllerchange` déclenche alors la même séquence purge + reload sûr.
- **Signal serveur** : tout code appelant l'API peut émettre l'event
  `bon:api-version-mismatch` sur `window` (ou appeler
  `window.bonAppVersion.notifyServerVersionTooOld()`) pour forcer le même
  cycle — utilisé de façon heuristique dans `app.js` quand PostgREST renvoie
  une erreur de type « schema cache » (signe que le contrat API a changé).

**Convention de versionnage pour un déploiement** :
- Un changement FRONT → bump le `?v=` de l'asset modifié (et dans
  `index.html` si plusieurs assets changent).
- Un changement BACKEND qui doit forcer un refresh client → bump
  `<meta name="app-rev">` dans `index.html`.

## Implémenté vs stub

**Construit de bout en bout** (vrai contrat Supabase, pas de pseudo-code) :
- Coquille : auth, routage, thème (auto/clair/sombre), indicateur de synchro,
  undo/redo, file IndexedDB hors-ligne.
- **Aujourd'hui** : pré-remplissage (`api.prefill`), formulaire d'en-tête
  autosave, tours (sites, heure de départ, icône de navigation vers
  Google Maps/Waze/Plans selon la préférence locale), lignes d'article
  (article/quantité/unité), jauge de poids en direct (`api.lv_poids`),
  attribution du numéro `KER-#####` au premier tour.
- **Mes LV** : vraie liste (`api.lettres_voiture`), ouverture dans l'éditeur
  du jour.
- **Contrôle** : rendu depuis le dernier instantané IndexedDB — fonctionne
  réellement sans réseau.
- **Réglages** : thème + préférence d'appli de navigation (locale) +
  déconnexion.

**Stub « À venir »** (placeholder volontaire, pas de CRUD construit) : LV
(liste/recherche complète), Planning, Projets, Clients, Sites, Camions,
Chauffeurs, Articles, Utilisateurs.

**Limitations connues** :
- La préférence d'appli de navigation est locale au navigateur
  (`localStorage`), pas persistée sur `bon.chauffeurs.nav_app` : la RLS
  réserve l'écriture de ce référentiel au rôle bureau (cf.
  `supabase/migrations/0004_rls.sql`, policy `chauffeurs_write`).
- Pas d'autocomplétion d'adresse via `api-adresse.data.gouv.fr` dans cette
  livraison (CSP et Dockerfile l'autorisent déjà, câblage à faire).
- Pas de vrai « redo » serveur pour les changements structurels (voir
  ci-dessus).

## Déploiement : comment `config.js` est injecté

`assets/config.js` versionné ici contient des valeurs de **développement**
(URL localhost, clé anon placeholder) pour que le repo se clone et s'ouvre
sans erreur. En déploiement, la CI (ou un script de release) **écrase**
`assets/config.js` avec les vraies valeurs, sur le modèle de
`assets/config.example.js` :

```js
window.BON_CFG = {
  API_URL: "https://api.kerlam.fr",
  ANON_KEY: "<anon-jwt-de-prod>",
  GOOGLE_ENABLED: true,
};
```

Ce fichier n'est **pas** un module ES (chargé en `<script>` classique) afin
que `window.BON_CFG` existe déjà quand `vendor/supabase/supabase.js` puis
`app.js` s'exécutent (cf. ordre de chargement dans `index.html`).

## Image Docker

```
docker build -f front/Dockerfile -t bon-kerlam-front \
  --build-arg APP_VERSION=0.1.0-beta.1 \
  --build-arg GIT_SHA=$(git rev-parse --short HEAD) .
docker run --rm -p 8080:8080 bon-kerlam-front
```

nginx tourne entièrement non-root (utilisateur `nginx`, uid 101), écoute sur
le port 8080. `front/nginx.conf` applique la règle de cache à trois niveaux
(HTML/sw.js/app-version.js/manifest = no-cache ; assets `?v=...` = 1 an
immutable). `/version.json` expose `APP_VERSION`/`GIT_SHA` pour diagnostic.

## Vendoring supabase-js

`assets/vendor/supabase/supabase.js` est une copie **verbatim** (UMD, pinned)
de la version déjà vendorée pour `kertec.fr`
(`/Users/emmanuelkervizic/Documents/Claude/DICT/kertec.fr/public/assets/vendor/supabase/supabase.js`).
Il définit un global `window.supabase.createClient(...)` — pas un module ES,
d'où le chargement en `<script>` classique avant `app.js`.
