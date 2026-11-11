# Spécification métier - bon.kerlam.fr

Application de gestion des **lettres de voiture** (LV) pour le transport routier de
marchandises KERLAM.

---

## 1. Contexte réglementaire

- La **lettre de voiture** est le document de transport obligatoire accompagnant
  chaque opération de transport routier de marchandises.
- Référence : **arrêté du 9 novembre 1999, article 4**, qui fixe les mentions
  obligatoires.
- Règle de production retenue : **une lettre de voiture par jour et par projet**.
- **Mentions obligatoires** devant figurer sur la LV (a → h) :
  - a) date de l'opération de transport ;
  - b) nom et adresse de l'expéditeur ;
  - c) nom et adresse du transporteur (KERLAM, avec son SIREN) ;
  - d) nom et adresse du destinataire ;
  - e) nature de la marchandise ;
  - f) tonnage / quantité transportée ;
  - g) lieux de chargement et de déchargement ;
  - h) immatriculation du véhicule.

---

## 2. Données de base (référentiel)

- **Camions** : immatriculation, PTAC (poids total autorisé en charge), tare,
  caractéristiques utiles au calcul de charge.
- **Chauffeurs** : identité, rattachement éventuel à un camion.
- **Clients et contacts** : raison sociale, adresse, contacts rattachés.
- **Projets** : rattachés à un client ; unité métier d'une lettre de voiture
  (une LV par jour par projet).
- **Sites** : deux natures distinctes :
  - site **commun** (dépôt, carrière, usine, exutoire) ;
  - site **chantier** (lié à un projet).
  - **Anti-doublon géographique** : à la création d'un site, détection des sites
    existants dans un rayon de **100 m** pour éviter les doublons.
- **Articles** : catalogue des marchandises / matériaux transportés.

---

## 3. La lettre de voiture du jour

- **Numérotation** : format `KER-#####`. Le numéro est attribué **au premier tour**
  saisi (pas à la création à vide), pour éviter de consommer des numéros sur des
  LV jamais utilisées.
- **En-tête** : reprend les mentions obligatoires (date, expéditeur, transporteur
  KERLAM + SIREN, destinataire, véhicule, chauffeur, projet).
- **Tours / état récapitulatif** : une LV regroupe les tours (rotations) de la
  journée pour le projet ; un tableau récapitulatif agrège les tonnages par article
  et par site.
- **Contrôle de charge - poids vs PTAC** :
  - alerte lorsque le poids chargé approche ou dépasse le PTAC du camion ;
  - seuils : **100 %** (limite réglementaire) et **105 %** (surcharge, alerte forte).
- **Statuts** : la LV passe par des statuts (brouillon / en cours / clôturée, etc.)
  reflétant son avancement dans la journée.
- **Pré-remplissage et priorité au planning** : les champs sont pré-remplis à partir
  du référentiel et du **planning** ; en cas de donnée disponible au planning,
  celui-ci est **prioritaire** sur les valeurs par défaut.

---

## 4. Saisie et traçabilité

- **Enregistrement en temps réel** : chaque action est persistée au fil de la saisie.
- **Undo / redo** : annulation et rétablissement des modifications.
- **Historique** : journal des modifications d'une LV.
- **Corbeille 30 jours** : les éléments supprimés sont conservés 30 jours avant
  purge définitive (restauration possible dans l'intervalle).

---

## 5. Rôles et droits

- **Chauffeur** : saisit les tours de sa journée sur son smartphone, pré-remplissage
  depuis le planning, contrôle de charge, clôture de ses LV.
- **Bureau** : accès complet au référentiel, au planning, à toutes les LV, à
  l'historique, à la corbeille et aux exports.
- L'appartenance aux groupes OIDC `bon-chauffeur` / `bon-bureau` (Pocket ID)
  détermine le rôle.

---

## 6. Interfaces et charte graphique

- **Écran smartphone (chauffeur)** : saisie terrain rapide, orientée tours.
- **Écran bureau** : gestion du référentiel, planning, supervision, exports PDF.
- **Charte graphique** : identité KERLAM (gris `#5e5e5e`, orange `#ff9300`).

---

## 7. Document PDF

- **Format A4** reprenant l'en-tête et le récapitulatif de la LV.
- **Zone de signature réservée** sur le document (emplacement prévu pour la
  signature ultérieure, manuscrite ou électronique).

---

## 8. Hors périmètre de la beta

Les éléments suivants ne sont **pas** inclus dans la version beta :

- **Documenso** (signature électronique sur `sign.kerlam.fr`) ;
- **envoi groupé** des lettres de voiture ;
- **facturation Flectra** (intégration ERP) ;
- **MCP en écriture** (les intégrations MCP restent en lecture pour la beta).
