# MCP `bon-kerlam` — serveur LECTURE SEULE (beta)

Serveur MCP (Model Context Protocol) en **lecture seule** pour l'application
**bon.kerlam.fr** (lettres de voiture KERLAM).

Le serveur **n'accede jamais directement a la base SQLite** de l'application.
Il interroge uniquement l'**API REST** (`/api/v1/...`) en GET, avec un jeton
Bearer de portee lecture. C'est le perimetre de la **beta** : aucune ecriture.

## Outils exposes

| Outil                 | Role                                                                 |
|-----------------------|----------------------------------------------------------------------|
| `lv_rechercher`       | Recherche des lettres de voiture (filtres : statut, chauffeur, jour).|
| `lv_lire`             | Lit une LV + son historique + son poids.                             |
| `alertes`             | Echeances a moins de 60 jours (CT / chrono camions, FCO / carte conducteur chauffeurs). |
| `referentiel_lister`  | Liste un referentiel (camions, chauffeurs, clients, contacts, projets, sites, articles). |

## Variables d'environnement

| Variable        | Role                                   | Defaut                  |
|-----------------|----------------------------------------|-------------------------|
| `BON_API_BASE`  | URL de base de l'API                   | `http://127.0.0.1:8095` |
| `BON_API_TOKEN` | Jeton d'API Bearer (portee **lecture**)| _(vide)_                |

## Installation et lancement

```bash
cd mcp
pip install -r requirements.txt
export BON_API_BASE="https://bon.kerlam.fr"
export BON_API_TOKEN="votre_jeton_lecture"
python server.py
```

Le serveur demarre en transport **stdio** (par defaut), pret a etre pilote par
un client MCP.

## Configuration client MCP

Extrait de configuration (format `mcpServers`) pointant vers `server.py` :

```json
{
  "mcpServers": {
    "bon-kerlam": {
      "command": "python",
      "args": [
        "/Users/emmanuelkervizic/Library/CloudStorage/Dropbox/KERLAM/Claude/bon-kerlam/mcp/server.py"
      ],
      "env": {
        "BON_API_BASE": "https://bon.kerlam.fr",
        "BON_API_TOKEN": "votre_jeton_lecture"
      }
    }
  }
}
```

> Adaptez `command` a votre environnement (`python3`, chemin d'un venv, etc.).

## Gestion des erreurs

Chaque outil renvoie un dict `{"error": "..."}` en cas d'echec (timeout, 401,
403, 404, erreur reseau, reponse non-JSON) plutot que de lever une exception :
le client MCP recoit toujours un message exploitable.

## Perimetre et point d'extension

La **beta est strictement en lecture seule**. Les outils d'**ecriture**
(creation ou modification de lettres de voiture, saisie de poids, changement de
statut, etc.) sont **HORS PERIMETRE** pour la beta.

Ils constituent le **point d'extension** naturel du serveur : il suffira
d'ajouter des outils `@mcp.tool()` effectuant des POST/PUT/PATCH vers l'API,
avec un jeton de portee **ecriture** distinct, une fois la beta validee.
