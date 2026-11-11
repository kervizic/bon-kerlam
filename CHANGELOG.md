# Changelog

Toutes les évolutions notables de `bon.kerlam.fr` (lettres de voiture dématérialisées KERLAM).

Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/),
versionnage [SemVer](https://semver.org/lang/fr/).

## [0.1.0-beta.1] - 2026-11-11

### Ajouté (première beta)
- Backend FastAPI (Python 3.12) + SQLite (mode WAL) dans un volume `/data`.
- Migrations SQL numérotées appliquées au démarrage (`schema_version`, sauvegarde
  automatique de la base avant chaque migration).
- Numérotation des lettres de voiture `KER-#####` (compteur continu 5 chiffres,
  attribué au premier tour, sans trou).
- Calcul de la masse estimée et comparaison au PTAC (seuils 100 % / 105 %).
- Pré-remplissage d'une nouvelle LV et priorité de la LV préparée par le bureau.
- Référentiels : camions, chauffeurs, clients/contacts, projets, sites (commun /
  chantier, anti-doublon 100 m), articles.
- Rôles chauffeur / bureau déduits du claim OIDC `groups`.
- Historique par LV, corbeille 30 j, undo/redo limité aux actions propres et bloqué
  après signature.
- API REST `/api/v1` + OpenAPI (`/api/docs`), jetons d'API hachés à portée
  lecture/écriture (marquage « via IA »).
- Génération PDF A4 de la LV (WeasyPrint) avec zone de signature réservée.
- Frontend PWA vanilla ES modules (sans bundler), service worker hors-ligne,
  mécanisme de mise à jour automatique sûr (file d'envoi vide / focus).
- Serveur MCP en lecture seule (`mcp/`).
- CI GitHub Actions (pytest + ruff) et publication d'image
  `ghcr.io/kervizic/bon-kerlam` sur tag `v*`.
- Déploiement : `docker-compose`, config nginx, Pocket ID, `README` de déploiement.

### Hors périmètre (prévu, non implémenté)
- Signature électronique Documenso, envoi groupé, facturation Flectra,
  outils MCP en écriture.

[0.1.0-beta.1]: https://github.com/kervizic/bon-kerlam/releases/tag/v0.1.0-beta.1
