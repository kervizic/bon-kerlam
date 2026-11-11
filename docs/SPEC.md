# Spécification fonctionnelle et technique — bon.kerlam.fr

Lettres de voiture dématérialisées de KERLAM.

Statut : brouillon de référence. Version 1.0 — 2026-11-11.

---

## Sommaire

1. [Contexte et objectif](#1-contexte-et-objectif)
2. [Cadre réglementaire](#2-cadre-réglementaire)
3. [Modèles de données](#3-modèles-de-données)
4. [Lettre de voiture (LV du jour)](#4-lettre-de-voiture-lv-du-jour)
5. [Enregistrement et historique](#5-enregistrement-et-historique)
6. [Connexion et rôles](#6-connexion-et-rôles)
7. [Écrans et charte graphique](#7-écrans-et-charte-graphique)
8. [Architecture technique](#8-architecture-technique)
9. [Hors périmètre (bêta)](#9-hors-périmètre-bêta)
10. [Données de départ (seed)](#10-données-de-départ-seed)

---

## 1. Contexte et objectif

KERLAM loue des camions avec chauffeur (exemple : 15 t bibenne grue GV-398-JH, en régie pour Veolia/Franciliane). L'application **bon.kerlam.fr** a pour objectif de dématérialiser la lettre de voiture (LV) que le chauffeur doit avoir à bord, tout en respectant les obligations réglementaires de traçabilité du transport.

Déclencheur direct : contrôle DRIEAT du 29/10/2026, ayant constaté l'absence de lettre de voiture conforme à bord.

---

## 2. Cadre réglementaire

- **Référence légale** : arrêté du 9 novembre 1999, article 4.
- **Support** : la lettre de voiture doit être à en-tête KERLAM et présente à bord du véhicule. Le format électronique est admis.
- **Granularité** : une lettre de voiture par jour et par projet, accompagnée d'un état récapitulatif de chaque tour effectué dans la journée.

### 2.1 Mentions obligatoires

| Repère | Mention | Détail |
|---|---|---|
| a | Date d'établissement | Date de création de la LV |
| b | Transporteur | KERLAM, 2 rue des Plantes, 77410 Villevaudé, SIREN (paramètre applicatif) |
| c | Date de prise en charge | Date de prise en charge de la marchandise |
| d | Nature et quantité | Nature de la marchandise, quantité / poids / volume |
| e | Expéditeur | Identité de l'expéditeur |
| f | Lieu de chargement | Adresse complète du lieu de chargement |
| g | Destinataire | Identité du destinataire |
| h | Lieu de déchargement | Adresse complète du lieu de déchargement |

---

## 3. Modèles de données

### 3.1 Camions

| Champ | Type | Notes |
|---|---|---|
| immatriculation | texte | Identifiant métier du camion |
| type | texte | Ex. « 15 t bibenne grue » |
| PTAC | nombre (kg ou t) | Poids total autorisé en charge |
| poids_a_vide | nombre | Poids du véhicule à vide |
| charge_utile | nombre (calculé) | = PTAC − poids à vide |
| volume_benne | nombre (m³) | Capacité volumique de la benne |
| echeance_ct | date | Contrôle technique ; alerte 60 jours avant |
| echeance_chrono | date | Chronotachygraphe ; alerte 60 jours avant |
| actif | booléen | Camion en service ou non |

### 3.2 Chauffeurs

| Champ | Type | Notes |
|---|---|---|
| nom | texte | |
| telephone | texte | |
| email | texte | Compte Google utilisé pour la connexion |
| camion_attribue | référence Camion | Pré-remplissage du véhicule ; changeable ponctuellement sur un bon sans modifier l'attribution de référence. Alerte si le camion attribué est déjà présent sur la LV d'un autre chauffeur le même jour |
| fco_expiration | date | Formation continue obligatoire ; alerte 60 jours avant |
| carte_conducteur_expiration | date | Alerte 60 jours avant |
| app_navigation | énum | `google_maps` \| `waze` \| `apple_plans` (liste extensible) |
| theme | énum | `auto` \| `clair` \| `sombre` |
| actif | booléen | Chauffeur en service ou non |

### 3.3 Clients et contacts

#### Clients

| Champ | Type | Notes |
|---|---|---|
| raison_sociale | texte | |
| adresse | texte | |
| siren | texte | |

#### Contacts

| Champ | Type | Notes |
|---|---|---|
| client | référence Client | Plusieurs contacts possibles par client |
| nom | texte | |
| telephone | texte | |
| email | texte | **Obligatoire** |
| fonction | texte | |
| signataire | booléen | Indique si le contact est habilité à signer |

### 3.4 Projets

| Champ | Type | Notes |
|---|---|---|
| client | référence Client | |
| reference_contrat | texte | |
| reference_ordre_mission | texte | |
| ligne_de_regie | texte | |
| tarif | nombre | |
| contact_par_defaut | référence Contact | |
| date_debut / date_fin | date | |
| statut | énum | Statut métier du projet |

### 3.5 Sites

| Champ | Type | Notes |
|---|---|---|
| nom | texte | |
| adresse | texte | Adresse complète |
| latitude / longitude | nombre | Coordonnées GPS |
| type | énum | `commun` (visible pour tous les clients) ou `chantier` (lié à un seul client, visible uniquement quand ce client est sélectionné) |
| client | référence Client | Renseigné uniquement pour les sites de type chantier |
| statut | énum | `actif` \| `termine` |

Règles de gestion :

- **Anti-doublon** : un nouveau site à moins de 100 m d'un site existant est considéré comme doublon potentiel (alerte à la création).
- **Cycle de vie des chantiers** : un chantier inutilisé depuis 60 jours passe automatiquement au statut « terminé » ; il sort des listes actives mais reste trouvable par recherche.
- **Fusion de doublons** : réservée au bureau.
- **Géocodage** : adresses saisies via `api-adresse.data.gouv.fr` (autocomplétion à la saisie, géocodage inverse depuis la position GPS). Le chauffeur vérifie l'adresse proposée avant validation.
- **Affichage sur la LV** : seule l'adresse textuelle est imprimée, jamais les coordonnées GPS brutes.
- **Navigation** : une icône carte accolée à chaque adresse ouvre l'application de navigation configurée pour le chauffeur, pointée sur les coordonnées lat/lon du site (sur ordinateur : Google Maps web).
- **Correction de position** : le bureau peut déplacer l'épingle d'un site sur la carte.

### 3.6 Articles

| Champ | Type | Notes |
|---|---|---|
| nom | texte | Imprimé sur la LV |
| commentaire_interne | texte | **Jamais imprimé sur la LV**, visible uniquement dans l'application |
| unites | liste | `t` (tonne), `m³`, `unité` |
| densite | nombre (facultatif) | Utilisée pour convertir un volume en poids |
| poids_unitaire | nombre (facultatif) | Utilisé pour convertir une quantité en unités en poids |

Règles de gestion :

- Liste commune à tous les clients/projets.
- Création libre par les chauffeurs.
- Fusion des doublons réservée au bureau ; une fusion met à jour les LV non signées qui référencent les articles fusionnés.
- La quantité saisie sur un tour est un couple (chiffre, unité) ; il n'y a pas de notion de « remplissage de benne ».
- L'application mémorise la dernière unité utilisée, par chauffeur et par article, pour pré-remplir la saisie suivante.

---

## 4. Lettre de voiture (LV du jour)

### 4.1 Principe général

- Une LV par projet et par jour.
- Numérotation : `KER-03000`, puis incrémentation continue sur 5 chiffres, sans trou.
  - Le numéro est attribué au **premier tour** de la LV (et non à la création de la LV), via une fonction SQL atomique garantissant l'absence de doublon et de trou.
  - Une LV préparée puis supprimée sans qu'aucun tour n'ait été créé ne consomme pas de numéro.
  - Une LV annulée conserve son numéro (pas de réattribution).

### 4.2 En-tête

| Champ | Comportement |
|---|---|
| Date d'établissement | Renseignée automatiquement à la création ; **modifiable tant que la LV n'est pas signée**, toute modification est tracée dans l'historique |
| Date de prise en charge | Saisie |
| Expéditeur | Saisie |
| Destinataire | Case **« Destinataire identique à l'expéditeur »** cochée d'office. Sur le PDF, le nom complet est imprimé dans les deux champs (jamais la mention « idem ») |
| Véhicule | Pré-rempli depuis le camion attribué au chauffeur |
| Chauffeur | Chauffeur connecté |
| Projet / contrat / ligne de régie | Issus du projet sélectionné |
| Heures de régie | Saisie |

### 4.3 Tours

Chaque tour comporte :

- Heure de départ, capturée par un bouton **« Départ »**, avec relevé GPS associé au journal d'audit (le GPS n'est **jamais imprimé** sur le PDF).
- Site de chargement.
- Site de déchargement.
- Expéditeur / destinataire du tour, si différents de ceux de l'en-tête.
- Une ou plusieurs lignes : article + quantité + unité.

Règles de gestion :

- Les tours sont **non bloquants** : une LV peut être clôturée sans aucun tour, moyennant un avertissement affiché à l'utilisateur.
- Le premier tour d'une LV est toujours créé vierge (jamais pré-rempli avec des données d'un tour précédent).

### 4.4 Estimation de la masse transportée

- Masse totale estimée = poids à vide du camion + poids du chargement cumulé des tours.
- Conversion du chargement par ligne article :
  - Ligne en tonnes (`t`) : quantité comptée directement.
  - Ligne en m³ : quantité × densité de l'article.
  - Ligne en unité : quantité × poids unitaire de l'article.
  - Ligne sans facteur de conversion disponible (ni densité, ni poids unitaire) : **non comptée** dans le total, et la LV porte la mention « poids partiel ».
- Comparaison au PTAC du camion :
  - ≥ 100 % du PTAC → alerte **orange**.
  - ≥ 105 % du PTAC → alerte **rouge**.
  - Il s'agit d'un **simple affichage informatif** : aucune confirmation ni blocage n'est requis de l'utilisateur.

### 4.5 Statuts de la LV

| Statut | Signification |
|---|---|
| `preparee` | LV créée (éventuellement par le bureau), pas encore de tour |
| `en_cours` | Au moins un tour en cours de saisie |
| `cloturee` | Clôturée par le chauffeur ou automatiquement |
| `a_signer` | En attente de signature |
| `envoyee` | Transmise (hors périmètre bêta pour l'envoi groupé, cf. §9) |
| `signee` | Signée — **la LV est alors figée**, plus aucune modification possible |
| `facturee` | Intégrée à la facturation (hors périmètre bêta, cf. §9) |
| `annulee` | Annulée, conserve son numéro |

- **Clôture automatique à minuit** : une tâche planifiée (dans `bon-worker` ou via `pg_cron`) clôture les LV encore ouvertes en fin de journée.

### 4.6 Pré-remplissage

Pré-remplissage par défaut à l'ouverture d'une nouvelle LV :

- Date du jour.
- Camion attribué au chauffeur.
- Client / projet / contact repris du dernier bon du chauffeur.

**Priorité à la préparation du bureau** : si le bureau a préparé une LV à l'avance depuis l'écran Planning, cette préparation prime sur le pré-remplissage automatique :

- L'en-tête est déjà rempli par le bureau.
- Les sites prévus apparaissent en tête de la liste de sites proposée au chauffeur.
- **Aucun tour n'est jamais créé à l'avance** par cette préparation — seuls l'en-tête et la liste de sites suggérés sont anticipés.

### 4.7 Liste de sites proposée au chauffeur

Ordre d'affichage lors du choix d'un site de chargement/déchargement :

1. Les 5 derniers sites utilisés par ce chauffeur pour ce client.
2. Les chantiers du client sélectionné.
3. Les sites communs, triés par fréquence d'utilisation.

Une recherche libre et un bouton **« + Nouveau site »** complètent la liste.

### 4.8 Mode contrôle

- Bouton « Mode contrôle » toujours visible dans l'interface chauffeur.
- Affiche, **hors ligne**, la ou les LV du jour avec un rendu local reproduisant la mise en page du PDF officiel.
- Lorsque la connexion est disponible, le PDF généré côté serveur est utilisé à la place du rendu local.

---

## 5. Enregistrement et historique

### 5.1 Enregistrement en temps réel

- **Aucun bouton « Enregistrer »** dans l'application : chaque champ est sauvegardé en temps réel.
- Chaîne de sauvegarde : IndexedDB local → file d'envoi → synchronisation vers Supabase.
- Un indicateur d'état est affiché en permanence : « Enregistré » / « Envoi en cours » / « Hors ligne, sera envoyé ».

### 5.2 Annulation / rétablissement (undo/redo)

- Flèches ↶ (annuler) / ↷ (rétablir) toujours visibles, avec plusieurs niveaux d'historique.
- Raccourcis clavier `Ctrl+Z` / `Ctrl+Maj+Z` disponibles côté bureau.
- Chaque utilisateur ne peut annuler que ses propres actions.
- **Limite stricte** : l'annulation ne peut jamais remonter au-delà d'une signature apposée sur la LV.

### 5.3 Historique et audit

- Historique complet par LV, alimenté par des **triggers** de base de données dans une table d'audit, enregistrant : qui, quoi, quand, et si l'action a été effectuée « via IA » (présence d'un jeton IA).
- Le bureau peut **restaurer une version antérieure** d'une LV à partir de l'historique.

### 5.4 Suppressions

- Toutes les suppressions sont **douces** (soft delete).
- Corbeille conservée **30 jours** avant purge définitive.

---

## 6. Connexion et rôles

### 6.1 Authentification (depuis beta.2)

- Fournisseur : **Supabase Auth (GoTrue)**. Deux méthodes au choix :
  - **« Continuer avec Google »** (OAuth) ;
  - **« Recevoir un code par mail »** : code à usage unique à **6 chiffres**
    envoyé par e-mail (OTP GoTrue, **sans mot de passe**), n'importe quel domaine.
- L'inscription « libre » par mot de passe est **désactivée** ; c'est la **liste
  blanche** qui gouverne l'accès pour les deux méthodes.
- Écran de connexion : deux choix clairs aux couleurs KERLAM (mode sombre auto),
  saisie de l'adresse puis des 6 chiffres, **renvoi du code après 60 s**.
- **Session persistante** sur le téléphone (refresh token tournant : pas de
  reconnexion quotidienne).
- SMTP : réutilise la connexion SMTP de **Documenso** déjà présente sur le VPS
  (`smtp.gmail.com:587` STARTTLS, boîte `sign@kerlam.fr`). Expéditeur des codes :
  **« KERLAM <bon@kerlam.fr> »**. Dans le dépôt : uniquement des variables
  (`GOTRUE_SMTP_*`) + le script `deploy/scripts/import-smtp-from-documenso.sh`
  qui recopie les valeurs depuis `/opt/documenso/.env` sans les afficher. Modèle
  d'e-mail du code en français : `deploy/email/otp_fr.html`.
- Option de restriction de domaine Google (`hd`) disponible en variable
  d'environnement, **désactivée par défaut**.

### 6.2 Contrôle d'accès

- Accès géré par **liste blanche** : la table `utilisateurs` associe chaque
  e-mail (Google ou e-mail OTP) à un rôle (`chauffeur` \| `bureau` \| `desactive`).
- Elle s'applique aux **deux méthodes** de connexion, par **RLS** et, si GoTrue
  l'active, par un **hook « before user created »**
  (`bon.gotrue_before_user_created`) qui refuse un e-mail non listé.
- Un e-mail non présent dans la liste blanche :
  - Ne voit **aucune donnée** (appliqué par RLS — Row Level Security PostgreSQL).
  - Affiche l'écran « Accès non autorisé, contactez le bureau ».

### 6.3 Rôles

| Rôle | Périmètre |
|---|---|
| `chauffeur` | Voit et gère ses propres LV ; voit l'ensemble des clients, projets et sites ; peut créer un chantier et un article |
| `bureau` | Accès complet à toutes les données et tous les écrans |

Ces règles sont appliquées au niveau base de données via RLS, pas seulement côté interface.

### 6.4 Note Documenso

Documenso (signature électronique, cf. §9) disposera de sa **propre connexion Google native**, indépendante de celle de bon.kerlam.fr — hors périmètre de la présente application.

---

## 7. Écrans et charte graphique

### 7.1 Principe général

Une application unique, **responsive**, déclinée en deux contextes d'usage :

#### Smartphone (chauffeur)

- Boutons de taille minimale **56 px**.
- Texte de taille minimale **16 px**.
- Action principale positionnée en bas de l'écran.
- Barre de navigation basse à trois entrées : **Aujourd'hui · Mes LV · Contrôle**.

#### Bureau (ordinateur)

- Menu latéral : **Tableau de bord · LV · Planning · Projets · Clients · Sites · Camions · Chauffeurs · Articles · Utilisateurs · Réglages**.
- Tableaux de données filtrables.
- Aperçu PDF affiché à droite de l'écran.

### 7.2 Charte graphique

| Couleur | Code | Usage |
|---|---|---|
| Orange | `#FD8008` | Action principale |
| Orange foncé | `#D46B06` | Variante / hover de l'action principale |
| Gris | `#4C4C4C` | Texte secondaire, logo « KER » |
| Anthracite | `#2B2B2B` | Texte principal |
| Fond | `#F4F4F2` | Arrière-plan |
| Blanc | `#FFFFFF` | Surfaces |
| Vert | `#2E7D32` | États positifs / validés |
| Rouge | `#C62828` | États d'erreur / alerte critique |
| Bleu | `#1565C0` | Informations / liens |

- Logo texte : « KER » en gris + « LAM » en orange, police Arial Black.
- Police générale : police système (pas de web-font chargée).
- Chiffres : affichés avec des **chiffres tabulaires** (alignement des colonnes numériques).

### 7.3 Mode sombre

- **Mode sombre automatique**, basé sur `prefers-color-scheme`, avec bascule en direct (sans rechargement).
- Choix utilisateur explicite possible : `Auto` / `Clair` / `Sombre` (cf. champ `theme` du chauffeur, §3.2).

### 7.4 PDF de la lettre de voiture

- Format A4, mise en page sobre.
- Logo KERLAM en couleur.
- **Zone de signature réservée en bas** du document, dimensions **44 × 22 mm**, prévue pour l'intégration future de Documenso.

---

## 8. Architecture technique

### 8.1 Backend — Supabase allégé

Stack Postgres + GoTrue (auth) + PostgREST (API) + Storage, **sans** Kong, Studio ni Realtime.

- Schéma `bon` : schéma métier (tables de données).
- Schéma `api` : schéma exposé au front, composé de vues et de fonctions RPC, notamment :
  - Numérotation atomique des LV (cf. §4.1).
  - Pré-remplissage (cf. §4.6).
  - Calcul du poids estimé (cf. §4.4).
  - Liste de sites proposée (cf. §4.7).
  - Fonctions d'undo (cf. §5.2).
- **RLS activée partout** (cf. §6.3).
- Schéma `svc` : jetons d'accès IA, stockés **hachés**.
- Migrations SQL numérotées, appliquées par un runner idempotent (voir `supabase/migrations/` et `supabase/apply.py` dans le dépôt).

### 8.2 Frontend

- HTML/CSS/JavaScript vanilla, ES moderne.
- PWA (Progressive Web App) — installable, fonctionnement hors ligne partiel (cf. §5.1 et §4.8).
- `supabase-js` vendorisé (pas de dépendance via CDN externe au runtime).

### 8.3 bon-worker

Service **FastAPI** (Python 3.12), en charge des traitements serveur :

- Génération des PDF de LV via **WeasyPrint**.
- Clôture automatique de minuit (cf. §4.5).
- Géocodage du jeu de données initial (seed, cf. §10).
- API de gestion des jetons IA.
- Documentation API auto-générée, exposée sur `/worker/docs` (OpenAPI).

### 8.4 Serveur MCP

Serveur MCP **en lecture seule**, exposant :

- `lv_rechercher` — recherche de lettres de voiture.
- `lv_lire` — lecture détaillée d'une LV.
- `alertes` — remontée des alertes (échéances véhicules/chauffeurs, dépassement PTAC, etc.).
- `referentiel_lister` — consultation des référentiels (clients, sites, articles, etc.).

---

## 9. Hors périmètre (bêta)

Les éléments suivants sont explicitement exclus du périmètre de la version bêta. Des points d'extension sont néanmoins prévus pour les intégrer ultérieurement sans refonte majeure.

| Fonctionnalité | Point d'extension prévu |
|---|---|
| Signature électronique Documenso | Zone de signature réservée sur le PDF (§7.4) ; statuts `a_signer` / `signee` déjà modélisés (§4.5) ; connexion Google native indépendante prévue côté Documenso (§6.4) |
| Envoi groupé des LV | Statut `envoyee` déjà modélisé (§4.5) |
| Fin de mois / facturation | Statut `facturee` déjà modélisé (§4.5) ; champ `tarif` déjà présent sur le projet (§3.4) |
| Outils MCP en écriture | Serveur MCP actuel volontairement limité à la lecture seule (§8.4) |

---

## 10. Données de départ (seed)

> **Source de vérité** : le contenu exact et à jour du jeu de données initial est défini dans la migration `supabase/migrations/0007_seed.sql`. La liste ci-dessous est fournie à titre d'annexe documentaire et doit être recoupée avec ce fichier en cas de divergence.

### 10.1 Articles

| # | Nom | Commentaire interne |
|---|---|---|
| 1 | Grave | Recyclée 0/31,5 · 0/70 · concassée industrielle 0/31,5 · béton concassé 0/20 · 0/31,5 · cailloux 30/70 · 0/63 · industrielle VRD 0/31,5, 3 % liant |
| 2 | URBASOL | Terres traitées à la chaux |
| 3 | Sable | Recyclé 0/6 · silico-calcaire 0/4 · sablon |
| 4 | Gravillon | Recyclé 4/20 · silico-calcaire 5/25, roulé ou concassé |
| 5 | Gravats | — |
| 6 | Béton de démolition | 170101 · non ferraillé · ferraillé · fortement ferraillé |
| 7 | Couches de chaussée | 170302 · prêtes à concasser · à cribler |
| 8 | Déconstructions inertes | 170302 · tuiles, briques, céramique, pavés, pierres |
| 9 | Terres inertes | 170504 |

### 10.2 Sites communs YPREMA

Horaires par défaut : lundi-vendredi 6h-17h30, sauf mention contraire.

| Nom | Adresse | Horaires |
|---|---|---|
| Lagny 1 | 6 rue Freycinet, Port de Lagny, 77400 Lagny-sur-Marne | Défaut |
| Lagny 2 | 6 rue Freycinet, Port de Lagny, 77400 Lagny-sur-Marne | Défaut |
| Émerainville | 11 allée de la Briarde, 77184 Émerainville | Défaut |
| Yterres Émerainville | 11 allée de la Briarde, 77184 Émerainville | 7h-18h30 |
| Bonneuil | 63-64 route de l'Île St Julien, Port de Bonneuil, 94380 Bonneuil-sur-Marne | Défaut |
| Massy 1 | 11 route de la Bonde, ZI de la Bonde, 91300 Massy | Défaut |
| Massy 2 | 14 route de la Bonde, ZI de la Bonde, 91300 Massy | Défaut |
| Trappes | Allée Basile Levraud, 78190 Trappes | Défaut |
| Gennevilliers | 7 route du Môle Central, Port de Gennevilliers, 92230 Gennevilliers | Défaut |

Tous ces sites sont de type `commun` (cf. §3.5), visibles pour l'ensemble des clients.

---

## 11. Évolutions beta.3

### 11.1 Charte & logo
- Couleurs : orange **#FD8008** (action principale, texte en **anthracite** par-dessus pour le contraste AA), orange foncé **#D46B06**, gris **#4C4C4C**, anthracite #2B2B2B, fond #F4F4F2, vert #2E7D32, rouge #C62828, bleu #1565C0. L'orange n'est jamais utilisé comme texte sur fond clair (contraste insuffisant) : il est réservé aux surfaces, au logo et aux icônes.
- Logo = texte « KERLAM » en police **Sarpanch** (SIL OFL, graisse 800, auto-hébergée en woff2) ; « KER » gris, « LAM » orange ; « KER » gris clair en mode sombre.
- Icônes PWA « KL » (Sarpanch sur fond anthracite) générées au build.

### 11.2 Rôles cumulables
Un utilisateur peut cumuler **chauffeur ET bureau** (gérants qui conduisent). Modélisé par un tableau `roles[]` ; la RLS applique l'union des droits.

### 11.3 Pré-remplissage des tours
À la création d'un nouveau tour, le **lieu de chargement** est pré-rempli avec le **lieu de déchargement du tour précédent** (modifiable). Le **premier tour** du bon reste vierge.

### 11.4 Documents réglementaires du chauffeur (bureau uniquement)
- Permis (numéro, visite médicale) + **catégories datées** (validité par catégorie) ; carte **FCO / code 95** (numéro, délivrance, expiration) ; **carte conducteur** chronotachygraphe (numéro, expiration, **date du dernier téléchargement**) ; **CACES** (type ex. R490/R482, catégories, expiration ; plusieurs par chauffeur).
- Scans recto/verso dans un bucket Storage **privé** `chauffeur-docs` ; politiques Storage **bureau uniquement** ; accès par **URL signées courtes**.
- **Alertes** 60 j avant expiration ; document expiré en **rouge** au tableau de bord ; **retard** de téléchargement de la carte conducteur (> 28 j) signalé.
- **Suppression** des scans au départ du salarié (`date_sortie`).
- Un **chauffeur ne voit pas** ces documents, même les siens (RLS).

### 11.5 Réglages & signature
- Table de **réglages** (bureau) : `signature_envoi_auto` (toujours manuel), `documenso_cc_contact` (copie des mails finaux Documenso à `contact@kerlam.fr`), seuils d'alerte.
- **Envoi groupé en signature** : déclenché **uniquement par un bouton** (chauffeur ou bureau), jamais automatiquement. L'envoi Documenso lui-même reste hors périmètre (point d'extension).

### 11.6 Connexion Google — client générique
Identifiant **OAuth web générique « KERLAM web »** (projet Google Cloud « KERLAM », compte contact@kerlam.fr) partagé par toutes les applis KERLAM. Origines `bon.kerlam.fr` et `sign.kerlam.fr` ; redirections `https://api.kerlam.fr/auth/v1/callback` et `https://sign.kerlam.fr/api/auth/callback/google`. Secrets dans Bitwarden (projet Kerlam). Cf. `deploy/README.md` §5.
