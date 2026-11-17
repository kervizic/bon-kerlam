# Changelog

Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/),
versionnage [SemVer](https://semver.org/lang/fr/). Ce journal ne décrit QUE ce
qui est réellement livré.

## [0.1.0-beta.23.1] — 2026-11-17

Deux retouches du gabarit PDF (worker uniquement).

### Corrigé
- **Titre de section** : « État récapitulatif des tours » devient « État
  récapitulatif des transports ».
- **Gouttière des parties** : la colonne « Expéditeur et destinataire » touchait
  « Transporteur » (« …Noisy-le- KERLAM » sur KER-03006). La gouttière (10 mm) est
  désormais posée par une marge entre colonnes — et non par flex `gap`, ignoré par
  la version de WeasyPrint du worker (63.1) ; `min-width: 0` + `overflow-wrap`
  forcent le retour à la ligne au lieu de chevaucher la colonne suivante, y compris
  à 3 colonnes avec des noms et adresses longs.

## [0.1.0-beta.23] — 2026-11-17

Refonte du PDF (worker) : gabarit « Filet épurée » validé par le patron. Plus
aucun tableau. Signature. Aucune migration de schéma.

### Changé
- **Mise en page de la lettre de voiture** : parties sans bordure ; prestations et
  marchandises en listes à points de conduite (quantité + unité alignées à droite) ;
  tours sans tableau ni titre « Tour N ». Police Inter embarquée, logo KERLAM
  (Sarpanch). Gris choisis pour rester lisibles en impression laser N&B.
- **Parties** : si l'expéditeur et le destinataire sont la même société
  (destinataire « Identique au client », ou mêmes nom et adresse), une seule
  colonne « Expéditeur et destinataire » ; sinon trois colonnes.
- **Tours** : chaque extrémité affiche d'abord le NOM du site (« Société ·
  adresse », ex. « Cemex · Ivry béton ») puis l'adresse complète en petit gris ;
  flèche « → » entre chargement et déchargement ; ordre chronologique 1 → N.
- **Signature** : libellé « Signature », zone vide sans cadre ni lignes, épinglée
  en bas de la dernière page de CHAQUE lettre, aux ancres Documenso stables
  (SIGNATURE 17/245 mm 66×15 ; NOM 17/262 mm 66×5 ; label à x≈15 / y≈239 mm).
- **En-tête** : « Date : JJ/MM/AAAA » sous le numéro (plus de triptyque, de cas
  « rattrapage » ni de « quantité estimée de la journée »). Plus aucune mention
  légale en pied de page ; seule la pagination « Page X / Y » est conservée.
- **Quantités** au format français sans zéros inutiles (« 12 t », « 3,5 t »,
  « 1 jour »), jamais « 12.000 ». Projet et heures affichés seulement s'ils sont
  renseignés ; section Prestations masquée si vide.
- **Documenso** : PDF combiné (un par envoi, une lettre par page de départ) avec
  placement des champs SIGNATURE et NAME en % de page, sur la dernière page de
  CHAQUE lettre.
- **Correctif de rendu** : champs Véhicule / Chauffeur / Projet / Heures en
  inline-block (et non en flex imbriqué) — le flex imbriqué provoquait un
  chevauchement avec la version de WeasyPrint du worker (63.1).

## [0.1.0-beta.22.6] — 2026-11-16

Correctif clavier (front uniquement), signalé sur un vrai iPhone en PWA.

### Corrigé
- **Fermeture du clavier** : trois gestes iOS standards, qui coexistent, pour
  sortir d'un champ (auparavant aucun moyen évident) :
  1. **Tap hors du champ** (fond de page, titre de section, espace) ferme le
     clavier, sans déclencher d'autre action ni casser les listes et boutons.
  2. **Défilement tactile volontaire** (> ~10 px au doigt) ferme le clavier,
     comme dans Messages ou Réglages ; le recentrage automatique d'iOS (scroll
     programmatique) et le défilement d'une liste de combobox ouverte sont ignorés.
  3. **Touche « Terminé »** : `enterkeyhint="done"` et, sur Entrée, sortie du
     champ ; dans la recherche d'une feuille (« Choisir un site »…), Entrée
     sélectionne l'unique résultat s'il n'y en a qu'un, sinon ferme le clavier.
  La barre d'onglets réapparaît à la fermeture, et l'enregistrement automatique
  se déclenche bien au blur (aucune saisie perdue). Les formulaires à bouton de
  soumission (connexion par code) conservent leur comportement natif.

## [0.1.0-beta.22.5] — 2026-11-16

Correctif d'affichage (front uniquement), signalé sur un vrai iPhone en PWA.

### Corrigé
- **Libellé court d'une adresse de site** : après avoir retiré le préfixe du nom
  de société, on retire aussi le **séparateur restant** (`– — - · : , /`) et les
  espaces autour. « Veolia – Noisy » s'affiche désormais « Noisy » (au lieu de
  « – Noisy »), « Veolia – Usine des Terres » devient « Usine des Terres ».
  La recherche et le champ une fois l'adresse choisie lisent « Veolia · Noisy »
  (plus jamais « Veolia · – Noisy »). Fonction pure `stripSocietePrefix`
  couverte par des tests unitaires.

## [0.1.0-beta.22.4] — 2026-11-16

Correctifs d'affichage (front uniquement), signalés sur un vrai iPhone en PWA.

### Corrigé
- **Texte long fondu sous la flèche** : un texte trop long se **fond** vers la
  couleur de fond du champ juste avant la flèche (plus d'ellipse), en clair comme
  en sombre ; la flèche reste nette au-dessus et le texte ne la touche jamais.
  S'applique aux comboboxes (Client, Camion, Projet, Contact, Destinataire,
  articles), à leurs placeholders, et aux sites de chargement/déchargement des tours.
- **Adresse** : même format que les autres champs — c'est un **sélecteur**
  (combobox) avec flèche, fondu, ⓘ et même hauteur, en ligne.
- **Tour vide ouvert** : le tour vide affiché à l'ouverture est **ouvert** (prêt à
  remplir) ; le repli reste manuel, et le résumé n'apparaît que si l'utilisateur a
  replié le tour lui-même.
- **Barre d'onglets** : le contenu en fin de page a un `padding-bottom` =
  hauteur de la barre + `safe-area`, pour que la barre ne le recouvre jamais.

## [0.1.0-beta.22.3] — 2026-11-16

Front + migration de données (noms de groupe). Correctifs signalés sur un vrai
iPhone en PWA.

### Corrigé
- **Régression de disposition (beta.22.2)** : TOUS les champs d'en-tête (Date,
  Camion, Client, Adresse, Projet, Contact, Destinataire) sont de nouveau EN LIGNE
  avec une colonne de libellés commune ; la valeur prend tout le reste et se tronque
  à l'ellipse (chevron visible), sans jamais repasser en pile. L'infobulle est
  flottante (ne décale rien). Sous 340 px seulement, TOUS les champs passent en pile
  ensemble. Vérifié uniforme à 320/360/375/390/393/430 px (test e2e).
- **Contact** : même hauteur et même taille de texte que les autres champs (testé).
- **Heures** : les deux cases (début/fin) ont la même largeur et tiennent avec le
  ✕, sans débordement.

### Ajouté / modifié — Tours
- Affichés du plus RÉCENT en haut (Tour n°3, n°2, n°1). Le « + » crée le tour en
  haut et donne le focus à son premier champ.
- **Repli manuel** par un chevron dans le titre ; tous ouverts par défaut, aucun
  repli automatique. Un tour replié montre une ligne de résumé (sites + quantité).
- La numérotation reste chronologique (n°1 = premier créé) ; le PDF ordonne 1 → N.

### Base de données (migration de données)
- **0024** : la raison sociale des clients **Veolia** (524334943) et **Syneos**
  (708202833 / 340730787) devient « Veolia » / « Syneos » ; anciens noms et alias
  supprimés (base de test). SIREN et adresses conservés ; aucune lettre touchée. Le
  PDF affiche « Veolia » / « Syneos ». Idempotente, sauvegarde (bon.beta223_noms_backup)
  et down (`supabase/down/0024_down.sql`).

## [0.1.0-beta.22.2] — 2026-11-16

Correctifs front (aucune migration) signalés sur un vrai iPhone en PWA installée.

### Corrigé
- **Nom de groupe Veolia** : une société fusionnée (plusieurs adresses) s'affiche
  avec son **nom de groupe** (alias, « Veolia ») au lieu du nom d'un établissement
  (« Veolia Eau Épinay »), côté chauffeur ET Bureau. La **raison sociale légale**
  reste en base, sur la fiche et sur le PDF (inchangée) ; les anciens noms restent
  des alias cherchables. Pas de champ « nom affiché » distinct en base : le nom de
  groupe est l'alias, affiché quand le client a plus d'une adresse (`nb_adresses`).
- **Débordement horizontal (iPhone)** : corrigé à la racine — `minmax(0, 1fr)` sur
  les grilles (`lv-header-form`, créneaux), `min-width: 0` sur les enfants,
  troncature à l'ellipse dans le cadre. Filet de sécurité `overflow-x: clip` sur
  html/body. Vérifié sans aucun débordement à 320/360/375/390/393/430 px (test e2e).
- **Infobulle ⓘ** : s'affiche désormais **sous le champ** (nouvelle ligne pleine
  largeur) et ne le masque plus (ex. Contact).
- **ⓘ « Adresse »** ajouté : « Établissement du client pour cette lettre. »

### À signaler
- **Syneos** présentait le même schéma (garde « Syneos Gournay », alias de groupe
  « Syneos »). Le correctif étant à la racine (toute société à plusieurs adresses
  affiche son nom de groupe), Syneos s'affiche désormais aussi « Syneos » — ce qui
  correspond au regroupement décidé en beta.22. À confirmer avec Manu s'il veut un
  comportement différent pour Syneos.

## [0.1.0-beta.22.1] — 2026-11-16

Correctif (front uniquement, aucune migration) : le sélecteur de site de tour
regroupe enfin par société.

### Corrigé
- **Sélecteur de site hiérarchique** (« Site de chargement » / « Site de
  déchargement ») : la liste montre les **sociétés** (Cemex, RFM, YPREMA…), pas
  les adresses à plat. Une société à plusieurs adresses affiche « Nom — N
  adresses › » et se déplie (bouton retour « ‹ Sociétés ») ; une société à une
  seule adresse se choisit directement. Les adresses sont libellées sans le
  préfixe société (« Ivry béton »), triées « Près de moi » (ou alphabétique), la
  dernière utilisée en tête. La recherche porte sur sociétés ET adresses
  (« ivry » → « Cemex · Ivry béton »). Le champ affiche « Société · adresse ».
- **Démo** : ajout de sociétés de sites à plusieurs adresses (Cemex ×4, RFM ×2) et
  d'un client à 2 adresses, pour exercer le cas en démo et en test e2e.

## [0.1.0-beta.22] — 2026-11-16

Modèle « société → adresses » pour les clients et les sites de chargement, fusion
réversible des doublons, insertion des 32 sites, et correctifs d'interface de
l'écran lettre.

### Ajouté
- **Société → adresses (clients)** : une société (raison sociale + SIREN) porte 1
  à N adresses (`bon.client_adresses`). Le chauffeur choisit la société puis
  l'adresse ; s'il n'y a qu'une adresse, elle est prise d'office. La raison sociale
  exacte reste imprimée sur la lettre ; le PDF utilise l'adresse choisie.
- **Société → adresses (sites)** : `bon.site_societes` + `bon.sites.societe_id`.
  8 sociétés de sites (YPREMA, KERLAM, Veolia, Cemex, RFM, Asten, SPME, Sofrat).
- **32 nouveaux sites de chargement** (Cemex ×20, RFM ×7, Asten, SPME ×2, Sofrat
  ×2) avec coordonnées GPS ; 2 sites Veolia nommés exactement (« Veolia - Usine des
  Terres », « Veolia - Noisy »).
- **Fusion de doublons réversible** depuis le Bureau (Clients et Sites) :
  sélection de 2+ fiches, choix de la gardée ; les autres deviennent des alias
  cherchables, lettres et tours réaffectés. Journalisée et annulable (toast
  « Annuler »). **Bandeau « Doublons possibles »** (même SIREN / nom proche / GPS
  proche) ; jamais de fusion automatique.
- **Regroupements** : clients Veolia (Épinay + Noisy) et Syneos (Gournay +
  Neuilly) ; site Yterres Émerainville fusionné dans YPREMA Émerainville (alias).
- **« Près de moi »** : tri des sites par distance via la géolocalisation, avec
  permission ; sans permission, l'appli fonctionne normalement.

### Correctifs d'interface (écran lettre)
- **Signer** : la barre de sélection affiche « Signer » sans compteur.
- **Survol desktop** : la ligne ne glisse plus au survol (pointeur fin) ; la case
  reste visible et trois petites icônes (Signer, PDF, Corbeille en rouge)
  apparaissent à droite. Le glissement reste réservé au tactile.
- **Heures** affichées en HH:MM partout (plus de secondes).
- **« + » de section** : Heures, Prestations et Tours ont un « + » orange (zone
  tactile ≥ 44 px) dans leur titre, à la place des boutons « + Ajouter … ».
- **Tour vide** affiché dès l'ouverture d'une nouvelle lettre, non enregistré tant
  qu'il est vide, absent du PDF, sans blocage ni rappel.
- **Champs en ligne** (Date, Camion, Client, Projet, Contact, Destinataire) façon
  Réglages iOS : libellé + ⓘ à gauche, valeur à droite.
- **« Contact »** (au lieu de « Contact signataire »), infobulle « Signe les
  lettres de voiture. » ; e-mail toujours obligatoire.

### Retiré
- **Quantité estimée de la journée** : retirée de l'interface et du PDF. La colonne
  en base est **conservée** (aucune migration destructive).

### Base de données
- Migrations **0022** (schéma : tables `client_adresses`, `site_societes`,
  `aliases`, `fusions` ; colonnes `merged_into_id`, `societe_id`,
  `client_adresse_id`, `dest_adresse_id` ; fonctions de fusion/annulation ; vues
  `api.doublons_*`) et **0023** (données : sociétés, 32 sites, regroupements,
  suppression de la fiche vide « Nouveau site » si non référencée). Additives,
  idempotentes, réversibles (`supabase/down/0022_down.sql`, `0023_down.sql`).

## [0.1.0-beta.21.1] — 2026-11-16

Correctifs ciblés sur la saisie mobile : tours facultatifs, barre d'onglets qui
s'efface au clavier, et capture CI du swipe corrigée.

### Correctifs
- **Tours facultatifs** : les tours (chargement / déchargement / marchandise) ne
  **bloquent plus jamais** l'envoi en signature. La règle « Aucun tour » et toute
  vérification liée au nombre ou au contenu des tours sont retirées du contrôle de
  complétude (`lvCompleteness`) et donc du bandeau « N éléments à compléter avant
  signature ». Le serveur n'imposait déjà aucune condition sur les tours. Une
  lettre complète **sans aucun tour** affiche désormais **0 élément manquant**.
- **Barre d'onglets du bas & clavier** (norme iOS/Android) : la barre d'onglets
  (et la barre de sélection « Signer (N) ») se **masque quand le clavier logiciel
  s'ouvre** — focus sur un champ éditable (input/textarea/select) ou `visualViewport`
  réduit — et **réapparaît à la fermeture**, sans saut de mise en page. Signal
  **principal** : `focusin`/`focusout` (fiable en PWA standalone, où `visualViewport`
  est bogué, cf. WebKit #218983) ; `visualViewport` en complément.
- **Capture CI du swipe** : l'image `webkit-iphone-swipe-actions-*` montrait en
  réalité la **visionneuse PDF restée ouverte** (le geste souris partait sur le
  bouton PDF de la ligne). Le script **réinitialise l'état** (ferme la visionneuse,
  referme tout swipe) **avant** la capture, ouvre le swipe de façon déterministe et
  **vérifie l'image** (ligne décalée laissant voir Signer / PDF / Corbeille, rouge
  en dernier). Nouvelle capture « barre d'onglets masquée au clavier ».

## [0.1.0-beta.21] — 2026-11-16

Liste « Mes lettres de voiture » : actions à la iOS, visionneuse PDF intégrée,
correction du badge « Clôturée », purge automatique de la corbeille.

### Liste — sélection & actions
- **Barre de sélection tout en bas** (modèle iOS Photos/Mail) : dès qu'une lettre
  est cochée, une barre **remplace la barre d'onglets** (plus de bouton flottant
  au-dessus d'un vide), **safe-area du bas** respectée. Elle contient un grand
  **« Signer (N) »**, une **petite corbeille**, et une **petite icône PDF** quand
  une seule lettre est cochée. Plus rien de coché → la barre d'onglets revient.
- **Corbeille groupée** : applique à chaque lettre cochée la règle existante
  (brouillon sans numéro → corbeille 30 j ; numérotée non signée → « Annulée »
  avec un motif commun ; **signée → ignorée**) via le RPC `lv_supprimer_lot`, avec
  un **récapitulatif** avant confirmation.
- **Swipe vers la gauche** sur une ligne (geste tactile) : révèle à droite
  **« Signer » / « PDF » / « Corbeille »** (corbeille en rouge, en dernier ;
  Signer absent si déjà signée/non signable ; Corbeille absente si signée). Pas
  d'action automatique en fin de course, retour élastique, une seule ligne ouverte
  à la fois, sans gêner le défilement ni la case à cocher. Sur ordinateur : mêmes
  actions révélées **au survol**.

### Visionneuse PDF intégrée
- Le PDF s'ouvre **dans l'app**, en plein écran (pdf.js embarqué **localement**),
  avec **« Télécharger »** en bas et une croix pour fermer — pour éviter les
  blocages iOS (nouvel onglet, téléchargement). Utilisée par l'icône PDF de la
  liste, le swipe et l'icône PDF de la lettre.

### Correctifs
- **Badge « Clôturée » erroné** : cause = la clôture automatique de minuit du
  worker passait en `cloturee` **les brouillons ET les lettres numérotées** de la
  veille. L'auto-clôture est **neutralisée** (plus aucune lettre ne devient
  « Clôturée » toute seule ; rien n'en dépendait), et le badge d'un brouillon (sans
  numéro) affiche désormais **« Brouillon »**.
- **Purge de la corbeille** : suppression **physique** automatique des brouillons
  supprimés depuis plus de **30 jours** (tâche worker quotidienne idempotente et
  journalisée ; jamais une lettre numérotée ou signée).
- **Contraste** : onglets **Chauffeur / Bureau** actifs en **anthracite sur
  orange** (plus de texte blanc), vérifié par un test.

## [0.1.0-beta.17] — 2026-11-12

Saisie rendue utilisable : champs de recherche (combobox façon Odoo) et création
rapide, à la place des listes déroulantes natives. « On simplifie tout au max. »

### Comboboxes (champ de recherche)
- Les `<select>` Client, Projet, Contact, Camion, destinataire, sites de
  chargement/déchargement, articles, prestations et matériel deviennent des
  **champs de recherche** : on tape, la liste s'ouvre **juste sous le champ** et
  filtre en direct, **insensible à la casse ET aux accents**, sur le **nom** ET un
  **alias** éventuel (« jean » trouve **EJL (Jean Lefebvre)**, « svtp » trouve
  **Société Voirie de Travaux Publics (SVTP)**). Portion trouvée **surlignée**.
- **Champ vide au focus** : **récents d'abord** (derniers utilisés par ce
  chauffeur, mémorisés sur l'appareil), puis le reste **par ordre alphabétique**.
- Dernière ligne **« + Créer "texte" »** (comme Odoo) → ouvre la **fiche rapide**.
- **Croix** pour vider, **crayon** pour modifier la fiche choisie.
- **Projet et Contact filtrés par le client** ; changer de client purge une
  valeur devenue incohérente. Projet désormais **facultatif**.
- iOS : **font-size 16 px** (pas de zoom), liste scrollable, fermeture au tap à
  l'extérieur, **ARIA** combobox/listbox, placeholder gris « Choisir ou taper… ».
- Le `<select>` natif reste la source de vérité (value + autosave inchangés) :
  le combobox ne fait que le piloter. Fonctions pures testées (`combobox.test.mjs`).

### Fiche rapide (bottom sheet)
- Création / modification express **par-dessus le formulaire** : Client (raison
  sociale, **adresse imprimée sur la lettre**, SIREN), Projet (nom, client),
  Contact (nom, e-mail, téléphone, client), Site (nom, adresse), Article (nom).
  Après enregistrement, l'élément est **sélectionné automatiquement**.

### Client référencé directement sur la lettre
- La lettre porte désormais une colonne **`client_id`** (le client n'est plus
  déduit du projet). Migration **0018** additive : reprise des lettres existantes
  depuis le client de leur projet. PDF : ligne **Projet** masquée si vide.

### Droits (RLS) + tests
- **Chauffeur** : peut **créer** client / projet / contact / chantier, et modifier
  **les fiches qu'il a créées** (`created_by`). **Bureau** : tout. Un chauffeur ne
  modifie pas la fiche d'un autre. **Alias** de recherche sur les clients (jamais
  affiché comme raison sociale), **sans renommer** les clients. Tests SQL
  (`test_rls.py`, `test_client_direct.py`) et unitaires (filtrage accents/alias,
  récents, surbrillance).

## [0.1.0-beta.16] — 2026-11-12

Correctif iPhone (retour de Manu sur Safari iOS, formulaire en prod beta.15).

### Champs Date / Heures natifs (Safari iOS)
- **Alignement corrigé** : avec `-webkit-appearance:none`, iOS laissait le texte
  des champs **Date** et **Heures** **collé en haut** de la case, et la case Date
  **plus haute** que les autres champs. Les champs date/heure ont désormais la
  **même hauteur** (56 px, comme les selects Camion/Client…), le **même padding**,
  le **texte centré verticalement** et **aligné à gauche** (`display:flex;
  align-items:center`, `::-webkit-date-and-time-value { margin:0; text-align:left }`,
  `::-webkit-datetime-edit { padding:0 }`).
- **Icône Lucide** (calendrier / horloge) reposée à droite des champs, l'indicateur
  natif disparaissant avec `appearance:none`. Décorative : le picker natif s'ouvre
  toujours en touchant le champ.

### Listes déroulantes
- Les listes vides (**Client, Projet, Contact**, Camion, destinataire) affichent
  désormais l'invite grise **« Choisir… »** au lieu de **« — »**.

### Heures par défaut
- Un chauffeur **sans historique** (aucune lettre précédente) voit un créneau
  **07:00–16:00** pré-rempli. Sinon, la **mémoire de la dernière lettre** est
  conservée (inchangé).

### Tests
- Nouvelle vérification **Playwright WebKit** (moteur Safari, UA iPhone iOS 26,
  393×852, fr-FR / Europe-Paris) : `getBoundingClientRect` contrôle que la hauteur
  des champs Date/Heures == celle d'un select (écart < 2 px) et que le centrage
  vertical est en place. Captures WebKit clair + sombre du bloc Date + Heures.

## [0.1.0-beta.15] — 2026-11-12

Simplification du formulaire (décisions de Manu : « on simplifie tout au max »).

### Heures en créneaux (remplace « Heures régie »)
- Le champ texte libre **« Heures régie »** devient **« Heures »** : une liste de
  **créneaux** (heure de début + heure de fin, sélecteur d'heure natif 24 h, pas
  de 15 min). Boutons **« + Ajouter un créneau »** et croix pour supprimer.
  Exemple : `8h00–17h00` ou `8h00–12h00 · 13h00–17h00`.
- **Astreinte** : si la fin est antérieure au début, c'est un passage au
  lendemain, accepté **sans message ni mention**.
- **Mémoire** : une nouvelle lettre **reprend les créneaux de la dernière lettre
  du même chauffeur** (RPC `dernieres_heures`).
- **Stockage** : colonne `heures` **jsonb** (migration **0017** additive et
  idempotente). L'ancien texte `heures_regie` est **migré au mieux** (créneau
  unique quand le format est reconnu), sinon **conservé en lecture**.
- **PDF** : une ligne **« Heures 8h00–12h00 · 13h00–17h00 »**, uniquement si au
  moins un créneau.

### Date unique
- Un seul champ **« Date »** (le jour du transport). Suppression de la **« Date
  d'établissement »** séparée et de l'**« Heure de départ » par tour**. Date
  librement modifiable (passé compris) par tous. `created_at` / `updated_at`
  conservés en base, jamais affichés.
- **PDF** : une seule ligne **« Établie et prise en charge le JJ/MM/AAAA »**.

### Suppression / annulation des lettres NON signées
- **Brouillon sans numéro** → **corbeille** (restaurable **30 jours**).
- **Lettre numérotée non signée** → statut **« Annulée »** + **motif court**
  (Doublon / Erreur / Autre + précision), **numéro conservé**, masquée des listes.
- **Lettre signée** → **jamais supprimable** (bouton caché, refus serveur).
- **Chauffeur** : ses propres lettres non signées ; **bureau** : toutes.
  **Journal qui / quand** via l'audit générique. RPC `lv_supprimer` /
  `lv_restaurer`, vue `lv_corbeille`. **RLS + tests SQL** (`test_suppression.py`).

### Catalogue (démo alignée sur le vrai catalogue)
- Démo : article **« Grave »** unique (plus de « Grave 0/31,5 ») ; la
  granulométrie reste en **commentaire interne** uniquement. Le seed serveur
  (0007) avait déjà une seule « Grave ».

### Saisie des quantités
- **Virgule décimale française** **affichée** (`3,5`) **et acceptée** (tours et
  prestations).

### Divers
- Version `0.1.0-beta.15` (VERSION, service worker, cache `?v=15`, smoke CI).
- Captures Playwright : **formulaire (Date + Heures 2 créneaux)** et **menu de
  suppression / annulation** (iPhone, clair + sombre).

## [0.1.0-beta.14] — 2026-11-12

Correctif (retours iPhone de Manu).

### Logo
- **Régression corrigée** : sur iPhone, le logo KERLAM de l'en-tête retombait en
  police système (Arial) au lieu de **Sarpanch**. La police (réservée au logo
  depuis beta.11) est désormais **préchargée** (`<link rel="preload">`),
  **précachée par le service worker** et servie **immuable** (`?v=`), et déclarée
  en **`font-display: block`** (plus de flash). Sarpanch utilisée pour le logo
  partout — **en-tête, écran de connexion, PDF** — et toujours interdite ailleurs
  (`scripts/check-sarpanch.py`).
- **Test Playwright** : vérifie via `document.fonts` + `getComputedStyle` que le
  logo est bien rendu en Sarpanch (police chargée) et capture un gros plan du logo
  (clair + sombre).

### Formulaire
- **Lignes de chargement** : le nom d'article occupe toute la largeur (sur sa
  propre ligne) ; quantité + unité + suppression en dessous. Nom complet lisible
  sur 393 px (plus de « Grave 0/… » tronqué).

### Libellés
- **« Projet / régie » → « Projet »** partout (front, PDF, tests).

### Catalogue / parc
- **Article commun ajouté** : « DIB (déchets industriels banals) »
  (migration 0016 additive et idempotente).
- **Matériel « 20 t 8×4 bi-benne »** (SANS grue) **désactivé** (`actif=false`,
  jamais supprimé) ; les 4 autres restent actifs.

### Captures CI
- Playwright force la locale **fr-FR** et le fuseau **Europe/Paris** (dates en
  JJ/MM/AAAA, heures en 24 h).

## [0.1.0-beta.13] — 2026-11-12

Item **H** du lot reporté : bloc **« Prestations »**, à part, placé **AVANT les
tours** dans le formulaire de la lettre de voiture **et** sur le PDF. **C**
(création rapide) reste à faire.

### (H) Prestations
- **Bloc « Prestations » distinct**, au-dessus des tours. Une ligne =
  **prestation + quantité + unité + matériel**. Le **matériel** (type de
  véhicule) est **déduit du camion** de la lettre (`bon.camions.materiel_id`) et
  reste **modifiable** sur la ligne. Choisir une prestation applique son **unité
  par défaut** (catalogue).
- **Report automatique** : à chaque **nouvelle lettre**, la **première prestation
  de la dernière lettre du chauffeur** est reprise (modifiable / supprimable),
  via l'RPC `api.derniere_prestation`. Persistée dès que la lettre existe.
- **Catalogue commun `bon.prestations`** (libellé, unité par défaut, commentaire
  interne **jamais imprimé**, actif) — **écran bureau « Prestations »** (liste +
  Nouveau + édition + désactivation), comme Articles. Seed : *Jour de régie avec
  chauffeur* (jour) · *Heure supplémentaire jour* · *… nuit* · *… week-end*
  (heure) · *Astreinte* (unité).
- **`bon.materiels`** seed : *15 t 6×4 bi-benne grue* · *20 t 8×4 bi-benne* ·
  *20 t 8×4 bi-benne grue* · *20 t 8×4 ampliroll grue* · *Mini-pelle sur
  chenilles 2–2,8 t*.
- **PDF** : tableau **« Prestations » sobre** (Prestation | Quantité | Unité |
  Matériel) **avant** l'état récapitulatif des tours. **Pluriels FR** corrects
  (1 jour / 2 jours, 1 heure / 3 heures).
- **Migration 0015** additive et idempotente : tables `bon.materiels`,
  `bon.prestations`, `bon.lv_prestations` (rattachée à la lettre), colonne
  `bon.camions.materiel_id`, vues `api.*`, RPC de report. **RLS** identique aux
  articles (lecture tous rôles, écriture bureau ; lignes de prestation écrites
  par le chauffeur de la lettre, comme les lignes de chargement). **Tests** RLS +
  seed + report, tests worker (rendu + pluriels).

## [0.1.0-beta.12] — 2026-11-11

Item **D** du lot reporté + retouches. H (prestations) et C (création rapide)
restent à faire (budget).

### (D) Un seul « Client », plus d'« expéditeur » dans l'appli
- **Suppression du champ « Expéditeur »** et de la case « destinataire identique
  à l'expéditeur ». Le mot **« expéditeur » n'apparaît plus dans le front** —
  **test CI** `scripts/check-no-expediteur.py`. L'expéditeur figure uniquement sur
  le **PDF**, **dérivé du client** (raison sociale + adresse).
- **« Destinataire » = sélecteur** : **Identique (client)** par défaut, **un autre
  client**, ou **Autre…** (saisie libre).
- **Migration 0014** : sauvegarde (table `bon.lv_expediteur_backup` = liste des
  lettres touchées) puis neutralisation de l'ancien expéditeur « KERLAM ».

### Retouches (demandes de Manu)
- **PDF** : plus aucun **badge/filigrane de statut** (« Non signée » retiré).
- **Accord singulier/pluriel** partout (« 1 lettre de voiture » / « 2 lettres de
  voiture »…), plus de « lettre(s) ».

## [0.1.0-beta.11] — 2026-11-11

Lot correctif (retours iPhone de Manu). Items A, B, E, F, G, I livrés ; C, D, H
reportés (budget) au lot suivant.

- **(A)** En-tête du formulaire : plus de « — ». Tant qu'aucun numéro n'est
  attribué, un discret **« Brouillon »** ; dès l'attribution, **« KER-xxxxx » en
  police système** (plus de Sarpanch).
- **(B)** Champs **date / heure / nombre** qui débordaient sur iPhone : largeur
  100 %, `appearance:none`, `min-width:0`, `box-sizing`, alignés comme les autres
  champs. Le test « pas de scroll horizontal » couvre les formulaires ouverts.
- **(E)** **Suppression totale de la charge estimée / alerte de surcharge / %
  PTAC** (formulaire, PDF, hors-ligne). Le PTAC et le poids à vide restent sur la
  **fiche camion** uniquement.
- **(F)** Police **Sarpanch réservée au logo KERLAM** (front + PDF) — **test CI**
  `scripts/check-sarpanch.py`.
- **(G)** **Adresse KERLAM = « 2 rue des Plantes, 77410 Villevaudé »** partout :
  PDF (config `KERLAM_ADRESSE`), e-mails `otp_fr.html` / `action_fr.html`, pages
  légales du front, SPEC. Plus aucune occurrence « Victor Drouet » / « Marguerites ».
- **(I)** Unité de chargement **« big bag »** ajoutée (tonne, m³, unité, big bag) ;
  **pluriel sur le PDF (« 3 big bags »)**, mémoire de dernière unité par
  chauffeur/article conservée. `unite_label()` worker testé.

## [0.1.0-beta.10] — 2026-11-11

Lot 2 — (f) accueil chauffeur + signature électronique Documenso.

### Accueil chauffeur = lettres non signées
- L'**accueil du chauffeur** est désormais la **liste de ses lettres de voiture
  non signées** (la plus récente en haut) : numéro / brouillon, date, statut
  (brouillon / à signer / en attente de signature).
- **Gros bouton « Nouvelle lettre de voiture »** (Lucide plus) en haut.
- **Case à cocher par ligne** + **« Tout sélectionner »**. Toucher une ligne
  ouvre la lettre. Filtre **« Signées »** (les signées sortent de la liste).
- **Groupage** limité aux lettres d'un **même contact signataire** (message clair
  sinon). Logique pure testée (`assets/signature-group.js`).
- **Barre « Signer (N) »** collée en bas dès qu'une case est cochée → choix
  **« Sur place (sur ce téléphone) »** / **« Par mail »** (Lucide pen-line / mail).

### Signature Documenso (sign.kerlam.fr)
- **Sur place** : une enveloppe Documenso par lettre (sans e-mail) ; le front
  enchaîne les liens de signature sur le téléphone.
- **Par mail** : **une seule enveloppe groupée** (PDF des N lettres fusionné)
  envoyée au contact signataire ; les lettres passent **« en attente de
  signature »** jusqu'au retour, détecté par **polling worker** (toutes les 3 min),
  puis le **PDF signé est archivé** (bucket privé) et les lettres **marquées
  signées**.
- **Clé API Documenso UNIQUEMENT côté worker** (`DOCUMENSO_API_KEY`, `.env` VPS
  chmod 600) : jamais exposée au front, ni en base, ni committée. Client v1
  (`worker/app/documenso.py`), orchestration (`worker/app/signature.py`),
  endpoints `POST /worker/signature/{sur-place,par-mail,poll}` authentifiés par le
  jeton de session Supabase, contrôle d'accès bureau/chauffeur. Migration 0013
  (suivi `documenso_document_id`, `signature_mode`, `signed_pdf_path`). Tests
  (client mocké, groupage, états).

## [0.1.0-beta.9] — 2026-11-11

Lot 1b (finitions des retours beta.8). CI verte, images publiées, déployé.

- **Statuts en français + pastilles de couleur** : plus aucun code brut affiché
  (« preparee » → **Préparée**, « a_signer » → **À signer**, « en_cours » →
  **En cours**, « envoyee » → **En attente de signature**, « signee » →
  **Signée**, etc.). Libellés centralisés (`assets/status-labels.js`, testé) ; la
  classe CSS de la pastille garde le code brut (couleur). **Test CI** : la passe
  captures (Playwright) **échoue si un code de statut brut s'affiche** à l'écran.
- **Dates au format français JJ/MM/AAAA** partout : listes (fin de l'ISO
  2026-11-12) **et PDF** (« Établie le 11/11/2026 »).
- **PDF — identité KERLAM** : **SIREN 838 377 331** (du Kbis) renseigné, mis en
  **paramètre de configuration du worker** (`KERLAM_SIREN`) ; adresse du **siège**
  (13 allée des Marguerites, 77410 Claye-Souilly) également configurable
  (`KERLAM_ADRESSE`). **Logo du PDF en police Sarpanch 900** (même woff2 que
  l'appli), KER #808080 / LAM #FD8008.
- **Brouillon sans numéro** : affiché **« Brouillon du JJ/MM — client »** (date +
  client si connu) au lieu de « (brouillon) ».

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
