-- Migration 001 — schéma initial bon.kerlam.fr
-- Lettres de voiture dématérialisées KERLAM.

-- ---------------------------------------------------------------------------
-- Référentiel : camions
-- ---------------------------------------------------------------------------
CREATE TABLE camions (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    immatriculation   TEXT NOT NULL,
    type              TEXT,
    ptac_kg           INTEGER,            -- F.2
    poids_vide_kg     INTEGER,            -- G.1
    volume_benne_m3   REAL,
    ct_echeance       TEXT,               -- date ISO (contrôle technique)
    chrono_echeance   TEXT,               -- date ISO (chronotachygraphe)
    actif             INTEGER NOT NULL DEFAULT 1,
    deleted_at        TEXT,
    created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
-- charge_utile_kg = ptac_kg - poids_vide_kg, calculée à la volée (cf. app).

-- ---------------------------------------------------------------------------
-- Référentiel : chauffeurs
-- ---------------------------------------------------------------------------
CREATE TABLE chauffeurs (
    id                       INTEGER PRIMARY KEY AUTOINCREMENT,
    nom                      TEXT NOT NULL,
    tel                      TEXT,
    email                    TEXT,
    camion_id                INTEGER REFERENCES camions(id),  -- attribution par défaut
    fco_echeance             TEXT,
    carte_conducteur_echeance TEXT,
    nav_app                  TEXT NOT NULL DEFAULT 'google_maps',  -- google_maps|waze|apple_plans|autre
    nav_app_autre            TEXT,
    actif                    INTEGER NOT NULL DEFAULT 1,
    oidc_sub                 TEXT UNIQUE,
    oidc_email               TEXT,
    deleted_at               TEXT,
    created_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ---------------------------------------------------------------------------
-- Référentiel : clients + contacts
-- ---------------------------------------------------------------------------
CREATE TABLE clients (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    raison_sociale TEXT NOT NULL,
    adresse        TEXT,
    siren          TEXT,
    deleted_at     TEXT,
    created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE contacts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id  INTEGER NOT NULL REFERENCES clients(id),
    nom        TEXT NOT NULL,
    tel        TEXT,
    email      TEXT NOT NULL,          -- obligatoire
    fonction   TEXT,
    signataire INTEGER NOT NULL DEFAULT 0,
    deleted_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ---------------------------------------------------------------------------
-- Référentiel : projets
-- ---------------------------------------------------------------------------
CREATE TABLE projets (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id         INTEGER NOT NULL REFERENCES clients(id),
    ref_contrat       TEXT,
    ref_ordre_mission TEXT,
    ligne_regie       TEXT,
    tarif             TEXT,
    contact_defaut_id INTEGER REFERENCES contacts(id),
    date_debut        TEXT,
    date_fin          TEXT,
    statut            TEXT NOT NULL DEFAULT 'actif',
    deleted_at        TEXT,
    created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ---------------------------------------------------------------------------
-- Référentiel : sites (commun / chantier)
-- ---------------------------------------------------------------------------
CREATE TABLE sites (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    nom                 TEXT NOT NULL,
    adresse             TEXT,
    lat                 REAL,
    lon                 REAL,
    type_site           TEXT,
    famille             TEXT NOT NULL DEFAULT 'commun',  -- commun|chantier
    client_id           INTEGER REFERENCES clients(id),  -- NULL si commun
    statut              TEXT NOT NULL DEFAULT 'actif',    -- actif|termine
    derniere_utilisation TEXT,
    created_by_chauffeur_id INTEGER REFERENCES chauffeurs(id),
    deleted_at          TEXT,
    created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    CHECK (famille IN ('commun','chantier')),
    CHECK (famille = 'commun' OR client_id IS NOT NULL)
);

-- ---------------------------------------------------------------------------
-- Référentiel : articles
-- ---------------------------------------------------------------------------
CREATE TABLE articles (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    nom                TEXT NOT NULL,
    unites             TEXT NOT NULL DEFAULT 't',  -- CSV : t,m3,unite
    densite_t_m3       REAL,                        -- facultatif
    poids_unitaire_t   REAL,                        -- facultatif
    created_by_chauffeur_id INTEGER REFERENCES chauffeurs(id),
    deleted_at         TEXT,
    created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Mémoire de la dernière unité utilisée par un chauffeur pour un article.
CREATE TABLE chauffeur_article_unite (
    chauffeur_id   INTEGER NOT NULL REFERENCES chauffeurs(id),
    article_id     INTEGER NOT NULL REFERENCES articles(id),
    derniere_unite TEXT NOT NULL,
    updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY (chauffeur_id, article_id)
);

-- ---------------------------------------------------------------------------
-- Compteur de numérotation (continu, 5 chiffres, démarre à 3000).
-- ---------------------------------------------------------------------------
CREATE TABLE lv_counter (
    id         INTEGER PRIMARY KEY CHECK (id = 1),
    next_value INTEGER NOT NULL
);
INSERT INTO lv_counter (id, next_value) VALUES (1, 3000);

-- ---------------------------------------------------------------------------
-- Lettres de voiture
-- ---------------------------------------------------------------------------
CREATE TABLE lettres_voiture (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    numero               TEXT UNIQUE,            -- NULL tant qu'aucun tour (KER-#####)
    jour                 TEXT NOT NULL,          -- date ISO (une LV par projet et par jour)
    date_etablissement   TEXT NOT NULL,          -- modifiable tant que non signée
    date_prise_en_charge TEXT,
    projet_id            INTEGER NOT NULL REFERENCES projets(id),
    client_id            INTEGER NOT NULL REFERENCES clients(id),
    camion_id            INTEGER REFERENCES camions(id),
    chauffeur_id         INTEGER REFERENCES chauffeurs(id),
    expediteur           TEXT,
    destinataire         TEXT,
    dest_identique_exp   INTEGER NOT NULL DEFAULT 1,  -- coché d'office
    heure_debut_regie    TEXT,
    heure_fin_regie      TEXT,
    statut               TEXT NOT NULL DEFAULT 'preparee',
    prepared_by_bureau   INTEGER NOT NULL DEFAULT 0,
    signed_at            TEXT,
    deleted_at           TEXT,
    created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    CHECK (statut IN ('preparee','en_cours','cloturee','a_signer','envoyee','signee','facturee','annulee'))
);

-- Une seule LV active par projet et par jour.
CREATE UNIQUE INDEX ux_lv_projet_jour
    ON lettres_voiture (projet_id, jour)
    WHERE deleted_at IS NULL AND statut <> 'annulee';

-- ---------------------------------------------------------------------------
-- Tours (état récapitulatif)
-- ---------------------------------------------------------------------------
CREATE TABLE tours (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    lv_id                 INTEGER NOT NULL REFERENCES lettres_voiture(id),
    ordre                 INTEGER NOT NULL,
    heure_depart          TEXT,
    gps_lat               REAL,      -- journal uniquement, jamais imprimé
    gps_lon               REAL,
    site_chargement_id    INTEGER REFERENCES sites(id),
    site_dechargement_id  INTEGER REFERENCES sites(id),
    exp_tour              TEXT,      -- seulement si différent de l'en-tête
    dest_tour             TEXT,
    deleted_at            TEXT,
    created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE tour_lignes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    tour_id    INTEGER NOT NULL REFERENCES tours(id),
    article_id INTEGER NOT NULL REFERENCES articles(id),
    quantite   REAL NOT NULL,
    unite      TEXT NOT NULL,
    deleted_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ---------------------------------------------------------------------------
-- Journal d'actions / historique (sert à l'undo-redo et à la traçabilité).
-- ---------------------------------------------------------------------------
CREATE TABLE lv_actions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    lv_id         INTEGER NOT NULL REFERENCES lettres_voiture(id),
    actor_key     TEXT NOT NULL,       -- identité de l'auteur (sub OIDC ou clé technique)
    actor_label   TEXT,                -- nom lisible (qui)
    kind          TEXT NOT NULL,       -- type d'action (quoi)
    champ         TEXT,
    ancienne_valeur TEXT,
    nouvelle_valeur TEXT,
    via_ia        INTEGER NOT NULL DEFAULT 0,
    is_signature  INTEGER NOT NULL DEFAULT 0,  -- barrière d'undo
    undone        INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX ix_lv_actions_lv ON lv_actions (lv_id, id);

-- ---------------------------------------------------------------------------
-- Jetons d'API (hachés, portée lecture/écriture, révocables).
-- ---------------------------------------------------------------------------
CREATE TABLE api_tokens (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    nom        TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,   -- sha256 hex du jeton clair
    scope      TEXT NOT NULL DEFAULT 'read',  -- read|write
    is_ia      INTEGER NOT NULL DEFAULT 1,
    revoked    INTEGER NOT NULL DEFAULT 0,
    last_used  TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    CHECK (scope IN ('read','write'))
);
