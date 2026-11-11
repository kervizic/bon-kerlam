# Changelog

Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/),
versionnage [SemVer](https://semver.org/lang/fr/). Ce journal ne décrit QUE ce
qui est réellement livré.

## [0.1.0-beta.4] — 2026-11-11

### Charte finale (validée Manu)
- Palette **définitive** : orange **#FD8008**, gris de marque **#808080**,
  gris texte **#595959** (dérivé AA ~7:1 pour le texte secondaire sur blanc),
  anthracite #2B2B2B, orange foncé #D46B06 (hover). Remplace #4C4C4C/#5E5E5E.
  `#808080` **jamais** utilisé pour du texte courant (contraste insuffisant),
  réservé logo/filets/accents non textuels. Mode sombre inchangé (suit le
  réglage du téléphone). Appliquée partout : front, **PDF** (worker/lv.html),
  **e-mail OTP**, `theme_color` du manifest.
- **Logo** : « KER » exactement **#808080**, « LAM » exactement **#FD8008**,
  identiques en clair et en sombre. Police **Sarpanch 900 (Black)** auto-hébergée
  (woff2 + OFL), remplace la graisse 800.

### Icônes (validées Manu)
- Jeu d'icônes définitif : `favicon.svg` (+ png 16/32), `apple-touch-icon.png`,
  `icon-192/512.png` et `icon-maskable-512.png`. `<link rel="icon"
  type="image/svg+xml">` + png + apple-touch ; manifest 192/512 « any » + 512
  « maskable ». **Fin de la génération au build** (Dockerfile + CI nettoyés ;
  `scripts/gen-icons.py` et `build-assets/Sarpanch.ttf` supprimés). Cache du
  service worker bumpé. Licence **ISC** (Lucide `clipboard-list`) + **OFL**
  (Sarpanch) dans `front/LICENSES-THIRD-PARTY.txt`.

### Installation de la PWA
- Bouton **« Installer l'appli »** sur l'écran de connexion (pied de page) et
  dans l'app (Réglages) ; **masqué si déjà installée** (`display-mode:
  standalone` / `navigator.standalone`).
  - Android/Chrome/Edge : capture de `beforeinstallprompt` → invite native ;
    sinon instructions manuelles (menu ⋮).
  - iOS/iPadOS : fiche d'aide FR (Safari → Partager → Sur l'écran d'accueil →
    Ajouter) avec pictos **SVG inline** ; message dédié si navigateur intégré
    (Gmail, Chrome iOS, Facebook, Instagram…) → « ouvrir dans Safari ».
- Page autonome **`/installer/`** (iOS + Android + ordinateur), liée en pied de
  page.

### Pages légales
- **`/confidentialite/`** et **`/conditions/`** intégrées au front (mêmes
  adresses), liens en pied de page.

### Connexion
- Google **OU** code e-mail à 6 chiffres (liste blanche) : documenté de bout en
  bout dans `deploy/README.md` (client OAuth générique « KERLAM web », redirect
  `https://api.kerlam.fr/auth/v1/callback`, secrets Bitwarden, SMTP Documenso,
  expéditeur `bon@kerlam.fr`).

### Correctifs / technique
- `worker` : alias **`/worker/health`** (= `/worker/healthz`).
- CSP stricte respectée : suppression des derniers `style=`/`onclick=` inline
  (Planning, sélecteur de site, documents chauffeur) → classes CSS + listeners.

## [0.1.0-beta.3] — 2026-11-11

### Charte & logo
- Nouvelle charte : orange **#FD8008**, gris **#4C4C4C** (remplacent #FF9300 /
  #5E5E5E partout : front, PDF, e-mails). Orange foncé recalculé **#D46B06**.
  Contrastes WCAG AA vérifiés : texte **anthracite** sur orange (5.57) ; l'orange
  n'est pas utilisé comme texte sur fond clair (réservé surfaces/logo/icônes).
- Logo = texte « KERLAM » en police **Sarpanch** (SIL OFL, graisse 800
  auto-hébergée en woff2 + `OFL.txt`) ; « KER » gris, « LAM » orange ; « KER »
  gris clair en mode sombre. Plus d'Arial Black.
- Icônes PWA générées **au build** (`scripts/gen-icons.py`, Pillow) : « KL » en
  Sarpanch sur fond anthracite (192, 512, maskable 192/512, apple-touch 180,
  favicon).

### Métier
- **Rôles cumulables** : un utilisateur peut être chauffeur ET bureau. RLS et
  helpers adaptés (`roles[]`).
- **Pré-remplissage des tours** : un nouveau tour reprend le lieu de déchargement
  du tour précédent comme lieu de chargement ; le premier tour reste vierge.
- **Documents chauffeur** (bureau seulement, RLS) : permis + catégories datées,
  FCO/code 95, carte conducteur chrono (+ dernier téléchargement), CACES (n par
  chauffeur). Scans recto/verso dans un bucket Storage **privé** `chauffeur-docs`
  (politique bureau, URL signées courtes). **Alertes 60 j**, document expiré en
  rouge, retard de téléchargement carte conducteur (> 28 j). **Purge** des scans
  au départ (`date_sortie`). Un chauffeur ne voit pas ces documents, même les siens.
- **Réglages** (table + écran bureau) : envoi en signature **manuel seulement**
  (jamais automatique), copie des mails finaux Documenso à `contact@kerlam.fr`,
  seuils d'alerte. **Envoi groupé en signature** déclenché uniquement par bouton
  (`/worker/signature/envoi-groupe`) — Documenso hors périmètre.

### Front
- Écrans bureau réels (fin des « À venir ») : Projets, Clients + Contacts, Sites,
  Camions, Chauffeurs (+ documents), Articles, Utilisateurs, Planning, Réglages,
  Tableau de bord. Autocomplétion d'adresse api-adresse.data.gouv.fr + géocodage
  inverse. Redo (↷) fonctionnel. Mode démo (`?demo=1`) pour les captures.

### CI / déploiement
- Job **captures Playwright** (mobile clair/sombre + bureau) publié en artefact.
- Procédure Google Cloud mise à jour : **client OAuth web générique « KERLAM web »**
  partagé (origines bon/sign, redirections GoTrue + Documenso), secrets Bitwarden.

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

[0.1.0-beta.3]: https://github.com/kervizic/bon-kerlam/releases/tag/v0.1.0-beta.3
[0.1.0-beta.2]: https://github.com/kervizic/bon-kerlam/releases/tag/v0.1.0-beta.2
[0.1.0-beta.1]: https://github.com/kervizic/bon-kerlam/releases/tag/v0.1.0-beta.1
