# Changelog

Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/),
versionnage [SemVer](https://semver.org/lang/fr/). Ce journal ne décrit QUE ce
qui est réellement livré.

## [0.1.0-beta.8] — 2026-11-11

Lot 1 des gros chantiers (retours Manu). CI verte, image publiée, déployée.

### (e) Fin de l'abréviation « LV » dans l'interface
- **« lettre(s) de voiture » en toutes lettres partout** : titres, cartes,
  « Lettres de voiture aujourd'hui », boutons, menus latéral/« Plus », messages,
  aides, et le PDF. Onglet de la barre du bas : **« Lettres »**. Inchangés : le
  `short_name` du manifest (**« LV KERLAM »**) et les numéros **KER-xxxxx**.
- **Test CI anti-« LV »** (`scripts/check-no-lv.py`) : échoue si un libellé
  VISIBLE (texte HTML, attributs `aria-label`/`title`/`placeholder`, chaînes JS
  affichées) contient le mot « LV » isolé ; commentaires et code ignorés.

### (d) Vue chauffeur par défaut + sélecteur Chauffeur | Bureau
- **Vue chauffeur par défaut pour TOUS les utilisateurs** au premier lancement.
- **Sélecteur segmenté Chauffeur | Bureau** (icônes Lucide truck / briefcase),
  visible **uniquement pour les rôles bureau** : dans l'en-tête à droite du logo
  sur ordinateur, **en haut du menu « Plus »** sur mobile (l'en-tête mobile reste
  logo seul). Dernier mode **mémorisé sur l'appareil** (localStorage, try/catch).
- Le sélecteur ne donne **aucun droit** (RLS inchangée). **Pile d'annulation
  remise à zéro** au changement de mode. Navigation et contenu cohérents (un
  utilisateur bureau qui ouvre une section bureau bascule en vue bureau).

### (g) Fin du mode « Contrôle » → bouton PDF par lettre
- **Suppression complète** du mode/écran/carte/route « Contrôle ».
- **Bouton icône PDF** (Lucide file-down, `aria-label`/`title` « Exporter en
  PDF », aucun texte) dans chaque lettre ouverte **et** en action de ligne des
  listes. Génère le **PDF officiel** via le worker (WeasyPrint, mentions art. 4
  de l'arrêté du 9/11/1999 + état récapitulatif des tours, **bandeau « Non
  signée »** si la lettre n'est pas signée) et le partage via
  `navigator.share({files})` si disponible, sinon téléchargement.
- **Hors ligne** : le PDF de chaque lettre **non signée du chauffeur connecté**
  est régénéré (debounce) après chaque modification et mis en **cache local**
  (IndexedDB) ; sans réseau, le bouton affiche le PDF en cache avec
  **« généré le JJ/MM à HH:MM »**. **Cache purgé à la déconnexion.**
- Worker : nouveau point d'accès **`POST /worker/lv/{id}/pdf`** authentifié par
  le **jeton de session Supabase** (HS256, `JWT_SECRET`), contrôle d'accès
  explicite (bureau = tout ; chauffeur = ses lettres). Tests (génération, cache,
  purge, décodage de session, bandeau).

## [0.1.0-beta.7] — 2026-11-11

### En-tête épuré (retour Manu « point 0 »)
- L'en-tête ne contient plus que le **logo KERLAM**, le bouton **Annuler** (dans
  les formulaires) et l'**état de synchro affiché UNIQUEMENT en cas de problème**
  (envoi en cours = spinner discret ; hors ligne = nuage barré orange + « Hors
  ligne – N en attente » ; rien quand tout est enregistré). Supprimés de la barre :
  avatar/nom/rôles, **thème** (→ Réglages) et pastille « Enregistré ». Idem sur
  ordinateur. Déconnexion accessible depuis **Réglages** (menu Plus).

### Divers retours
- **(a)** Pied de l'écran de connexion : suppression du doublon « Installer
  l'appli » (on garde le bouton « Comment installer » + Confidentialité + Conditions).
- **(b)** **Liste blanche GoTrue réactivée** (hook `before_user_created`) : une
  adresse non autorisée reçoit « Accès non autorisé » (**403**) et **aucun mail**
  n'est envoyé ni aucun compte créé ; les utilisateurs listés (Google ou code
  e-mail) se connectent normalement. Testé (`intrus@example.invalid` → 403, 0 mail ;
  `manu@kervizic.fr` inchangé).
- **(c)** **Aucun émoji** comme icône dans le front : tout en **icônes Lucide**
  (boutons Fermer = X, etc.), sauf logo Google et logo texte KERLAM. **Test CI
  anti-émoji** (`scripts/check-no-emoji.py`).

### Reste à faire (gros chantiers, lots suivants)
- **(e)** « lettre(s) de voiture » en toutes lettres partout (abandon de « LV »).
- **(d)** vue chauffeur par défaut + sélecteur **Chauffeur | Bureau** (mémorisé).
- **(f)** accueil chauffeur = liste des lettres non signées + sélection/groupage +
  signature Documenso (sur place / par mail).
- **(g)** suppression du mode « Contrôle » → bouton **PDF** (icône) par lettre,
  hors ligne, via le worker WeasyPrint.
- **(h)** Profil > **Mes documents** chauffeur (permis, carte conducteur, FCO,
  CACES) depuis le bucket privé `chauffeur-docs`.

## [0.1.0-beta.6] — 2026-11-11

### Retours iPhone de Manu
- **Annulation** : un seul bouton **« Annuler »** (icône Lucide rotate-ccw), plus
  de bouton « Refaire » (ni `Ctrl+Maj+Z`/`Ctrl+Y`). Le bouton n'apparaît QUE dans
  un formulaire et SEULEMENT après une modification, et se masque quand la pile
  est vide. La pile est **remise à zéro à chaque sortie de formulaire** (changement
  d'écran/onglet). Logique extraite dans `assets/undo-stack.js` (**testée**, 7 cas).
- **En-tête mobile** : pastille « Enregistré » remplacée par une **icône d'état
  compacte** (coche verte / spinner bleu / nuage barré orange, `aria-label`), texte
  complet seulement sur ordinateur. Nom « … · bureau » remplacé par un **avatar
  rond** (initiale) qui ouvre les Réglages. Bouton thème **déplacé dans Réglages**
  sur mobile.
- **Barre d'onglets** : émojis remplacés par des **icônes Lucide** (trait 2) —
  Tableau=layout-dashboard, LV=clipboard-list, Planning=calendar-days, Plus=ellipsis,
  Aujourd'hui=truck, Mes LV=list, Contrôle=check-circle, Réglages=settings. Gris
  **#595959** inactif, orange **#FD8008** actif. Plus aucun émoji comme icône
  (corbeille, liste de sites, navigation, position → Lucide).
- Job CI captures exécuté dans l'image **Playwright officielle** (fiabilise le test
  « pas de scroll horizontal », supprime la dépendance apt).

## [0.1.0-beta.5] — 2026-11-11

### Mobile — interface repensée (bug : illisible sur iPhone)
- Sous **900 px** : fini le menu latéral fixe qui mangeait l'écran → **barre
  d'onglets en bas** adaptée au rôle (chauffeur : Aujourd'hui · Mes LV · Contrôle ·
  Réglages ; bureau : Tableau · LV · Planning · **Plus**) + **tiroir « Plus »**
  plein écran (toutes les sections). Ordinateur (≥ 900 px) : menu latéral conservé.
- En-tête **collé en haut** et respectant l'encoche (`env(safe-area-inset-top)`),
  barre d'onglets avec `env(safe-area-inset-bottom)`, `viewport-fit=cover`.
- Titres mobiles ~23 px (plus de « Tableau de bord » géant), cartes de synthèse en
  **2 colonnes** pleine largeur, zones tactiles ≥ 44 px, **aucun débordement
  horizontal** (test automatique en CI sur chaque écran).
- **Chiffres des cartes** en police système (la **Sarpanch est réservée au logo**).

### Nom de l'application (installation)
- `name` = **« Lettre de Voiture KERLAM »**, `short_name` = **« LV KERLAM »**,
  meta `apple-mobile-web-app-title` et `application-name` alignés.

### Installation PWA — refonte « comme les pros »
- Nouveau moteur de détection **OS + navigateur + version** (`assets/install-detect.js`,
  pur et **testé**, 25 cas d'UA réels). N'affiche QUE les étapes de l'appareil courant,
  avec un dépliant **« autres appareils »** (liste complète). Pictos SVG inline proches
  de l'interface réelle, libellés FR **exacts**.
- Cas couverts : iOS 26 Safari (barre compacte « ••• » → Partager), iOS 16.4–18 Safari,
  iOS Chrome/Edge/Firefox, navigateur intégré iOS (Gmail/Facebook/Instagram… → « Ouvrir
  dans Safari » + copier le lien), Android Chrome/Edge/Samsung/Firefox/Opera (invite
  native `beforeinstallprompt` sinon étapes), Mac Safari 17+ (Fichier → Ajouter au Dock),
  Chrome/Edge ordinateur (barre d'adresse / menu), Firefox & Safari anciens (honnête :
  pas d'installation → Chrome/Edge ou mise à jour).
- Bouton adaptatif : **« Installer l'appli »** si invite native dispo, sinon
  **« Comment installer »**. Masqué si déjà installée. Page `/installer/` refondue
  (appareil courant en tête + tous les appareils).

### Robustesse
- `config.js` **versionné** (`?v=`) et servi **no-cache** : plus aucun téléphone ne
  garde l'ancien `config.js` (localhost) en cache. Cache du service worker bumpé (beta.5).
- Job CI **tests JS** (`node --test`) pour la détection d'installation.

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

[0.1.0-beta.8]: https://github.com/kervizic/bon-kerlam/releases/tag/v0.1.0-beta.8
[0.1.0-beta.3]: https://github.com/kervizic/bon-kerlam/releases/tag/v0.1.0-beta.3
[0.1.0-beta.2]: https://github.com/kervizic/bon-kerlam/releases/tag/v0.1.0-beta.2
[0.1.0-beta.1]: https://github.com/kervizic/bon-kerlam/releases/tag/v0.1.0-beta.1
