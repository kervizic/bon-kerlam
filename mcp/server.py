"""Serveur MCP en LECTURE SEULE pour l'application "bon.kerlam.fr".

Ce serveur n'accede JAMAIS directement a la base SQLite de l'application.
Il interroge uniquement l'API REST (`/api/v1/...`) en GET, avec un jeton
Bearer de portee lecture fourni par variable d'environnement.

Variables d'environnement :
  - BON_API_BASE  : URL de base de l'API (defaut http://127.0.0.1:8095)
  - BON_API_TOKEN : jeton Bearer (portee lecture)

Beta : seuls des outils en LECTURE SEULE sont exposes. Les outils en
ecriture (creation / modification de lettres de voiture) sont HORS PERIMETRE
pour la beta (cf. README, point d'extension).
"""

import os
from datetime import datetime, date
from typing import Any

import httpx
from mcp.server.fastmcp import FastMCP

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

BON_API_BASE = os.environ.get("BON_API_BASE", "http://127.0.0.1:8095").rstrip("/")
BON_API_TOKEN = os.environ.get("BON_API_TOKEN", "")

# Timeout global (connexion + lecture) pour toutes les requetes HTTP.
HTTP_TIMEOUT = httpx.Timeout(15.0, connect=5.0)

# Referentiels autorises pour `referentiel_lister` (liste blanche).
REFERENTIELS_AUTORISES = {
    "camions",
    "chauffeurs",
    "clients",
    "contacts",
    "projets",
    "sites",
    "articles",
}

# Champs d'echeance a surveiller pour les alertes (a moins de 60 jours).
ECHEANCES_CAMIONS = ("ct_echeance", "chrono_echeance")
ECHEANCES_CHAUFFEURS = ("fco_echeance", "carte_conducteur_echeance")
SEUIL_ALERTE_JOURS = 60

mcp = FastMCP("bon-kerlam")


# ---------------------------------------------------------------------------
# Helpers HTTP
# ---------------------------------------------------------------------------

def _headers() -> dict[str, str]:
    """En-tetes HTTP communs (Authorization Bearer + Accept JSON)."""
    headers = {"Accept": "application/json"}
    if BON_API_TOKEN:
        headers["Authorization"] = f"Bearer {BON_API_TOKEN}"
    return headers


def _api_get(path: str) -> Any:
    """Effectue un GET sur l'API et renvoie le JSON decode.

    En cas d'erreur (timeout, 401, 404, reseau, JSON invalide), renvoie un
    dict `{"error": "..."}` plutot que de lever une exception, afin que le
    client MCP recoive un message clair.
    """
    url = f"{BON_API_BASE}{path}"
    try:
        with httpx.Client(timeout=HTTP_TIMEOUT) as client:
            response = client.get(url, headers=_headers())
    except httpx.TimeoutException:
        return {"error": f"Timeout lors de l'appel a {url}"}
    except httpx.RequestError as exc:
        return {"error": f"Erreur reseau lors de l'appel a {url}: {exc}"}

    if response.status_code == 401:
        return {"error": "401 Non autorise : jeton BON_API_TOKEN manquant ou invalide"}
    if response.status_code == 403:
        return {"error": "403 Interdit : le jeton n'a pas les droits requis"}
    if response.status_code == 404:
        return {"error": f"404 Introuvable : {url}"}
    if response.status_code >= 400:
        return {
            "error": f"Erreur HTTP {response.status_code} sur {url}",
            "detail": response.text[:500],
        }

    try:
        return response.json()
    except ValueError:
        return {"error": f"Reponse non-JSON depuis {url}"}


def _is_error(payload: Any) -> bool:
    """Indique si la charge utile est un dict d'erreur renvoye par `_api_get`."""
    return isinstance(payload, dict) and "error" in payload


# ---------------------------------------------------------------------------
# Helpers metier
# ---------------------------------------------------------------------------

def _parse_echeance(valeur: Any) -> date | None:
    """Parse une date d'echeance en acceptant plusieurs formats courants.

    Accepte `YYYY-MM-DD`, les formats ISO datetime, et `DD/MM/YYYY`.
    Renvoie None si la valeur est vide ou non parsable.
    """
    if not valeur:
        return None
    if isinstance(valeur, datetime):
        return valeur.date()
    if isinstance(valeur, date):
        return valeur
    texte = str(valeur).strip()
    if not texte:
        return None
    # Essai ISO (date ou datetime).
    try:
        return datetime.fromisoformat(texte.replace("Z", "+00:00")).date()
    except ValueError:
        pass
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(texte, fmt).date()
        except ValueError:
            continue
    return None


def _libelle_entite(entite: dict[str, Any], prefixe_id: int) -> str:
    """Construit un libelle lisible pour une entite (camion / chauffeur)."""
    for cle in ("immatriculation", "nom", "libelle", "label", "designation"):
        valeur = entite.get(cle)
        if valeur:
            prenom = entite.get("prenom")
            if cle == "nom" and prenom:
                return f"{prenom} {valeur}"
            return str(valeur)
    return f"#{prefixe_id}"


# ---------------------------------------------------------------------------
# Outils MCP (lecture seule)
# ---------------------------------------------------------------------------

@mcp.tool()
def lv_rechercher(
    statut: str | None = None,
    chauffeur_id: int | None = None,
    jour: str | None = None,
) -> Any:
    """Recherche des lettres de voiture (LV) avec filtres optionnels.

    Recupere la liste complete via GET /api/v1/lettres puis filtre cote
    serveur MCP sur les criteres fournis (les criteres a None sont ignores).

    Args:
        statut: filtre sur le statut de la LV (ex: "brouillon", "signee",
            "livree"). Comparaison insensible a la casse.
        chauffeur_id: identifiant du chauffeur affecte a la LV.
        jour: jour de la LV au format "YYYY-MM-DD". Compare la partie date
            du champ date/jour de la LV.

    Returns:
        La liste des lettres de voiture correspondant aux filtres, ou un dict
        {"error": "..."} en cas d'echec de l'appel API.
    """
    donnees = _api_get("/api/v1/lettres")
    if _is_error(donnees):
        return donnees

    # L'API peut renvoyer soit une liste, soit {"items": [...]} / {"data": [...]}.
    if isinstance(donnees, dict):
        lettres = donnees.get("items") or donnees.get("data") or donnees.get("lettres") or []
    else:
        lettres = donnees

    if not isinstance(lettres, list):
        return {"error": "Format de reponse inattendu pour /api/v1/lettres"}

    resultat = []
    for lv in lettres:
        if not isinstance(lv, dict):
            continue

        if statut is not None:
            valeur_statut = str(lv.get("statut", "")).lower()
            if valeur_statut != statut.lower():
                continue

        if chauffeur_id is not None:
            valeur_chauffeur = lv.get("chauffeur_id")
            if valeur_chauffeur != chauffeur_id:
                continue

        if jour is not None:
            # Cherche un champ date/jour et compare sur la partie date.
            brut = lv.get("jour") or lv.get("date") or lv.get("date_lv")
            d = _parse_echeance(brut)
            cible = _parse_echeance(jour)
            if d is None or cible is None or d != cible:
                continue

        resultat.append(lv)

    return resultat


@mcp.tool()
def lv_lire(lv_id: int) -> Any:
    """Lit une lettre de voiture complete avec son historique et son poids.

    Agrege trois appels API en lecture :
      - GET /api/v1/lettres/{lv_id}            -> la LV
      - GET /api/v1/lettres/{lv_id}/historique -> l'historique des evenements
      - GET /api/v1/lettres/{lv_id}/poids      -> les informations de poids

    Args:
        lv_id: identifiant de la lettre de voiture.

    Returns:
        Un dict {"lettre": ..., "historique": ..., "poids": ...}. Si la LV
        elle-meme est introuvable, renvoie directement le dict d'erreur. Si
        seul l'historique ou le poids echoue, son champ contient le dict
        d'erreur correspondant (la LV reste exploitable).
    """
    lettre = _api_get(f"/api/v1/lettres/{lv_id}")
    if _is_error(lettre):
        return lettre

    historique = _api_get(f"/api/v1/lettres/{lv_id}/historique")
    poids = _api_get(f"/api/v1/lettres/{lv_id}/poids")

    return {
        "lettre": lettre,
        "historique": historique,
        "poids": poids,
    }


@mcp.tool()
def alertes() -> Any:
    """Calcule les alertes d'echeance a 60 jours (camions et chauffeurs).

    Recupere GET /api/v1/camions et GET /api/v1/chauffeurs, puis repere les
    echeances a moins de 60 jours de la date du jour :
      - camions    : champs `ct_echeance` et `chrono_echeance`
      - chauffeurs : champs `fco_echeance` et `carte_conducteur_echeance`

    Les echeances deja depassees (jours_restants negatif) sont incluses :
    elles meritent une alerte immediate.

    Returns:
        Une liste d'alertes, chaque alerte etant un dict :
        {type, entite, id, champ, echeance, jours_restants}
        - type: "camion" ou "chauffeur"
        - entite: libelle lisible (immatriculation / nom)
        - id: identifiant de l'entite
        - champ: nom du champ d'echeance
        - echeance: date d'echeance (YYYY-MM-DD)
        - jours_restants: nombre de jours avant echeance (negatif si depassee)
        La liste est triee par jours_restants croissant (plus urgent d'abord).
        En cas d'echec d'un appel API, renvoie le dict d'erreur.
    """
    aujourdhui = date.today()
    resultat: list[dict[str, Any]] = []

    sources = (
        ("camion", "/api/v1/camions", ECHEANCES_CAMIONS),
        ("chauffeur", "/api/v1/chauffeurs", ECHEANCES_CHAUFFEURS),
    )

    for type_entite, path, champs in sources:
        donnees = _api_get(path)
        if _is_error(donnees):
            return donnees

        if isinstance(donnees, dict):
            elements = donnees.get("items") or donnees.get("data") or []
        else:
            elements = donnees
        if not isinstance(elements, list):
            return {"error": f"Format de reponse inattendu pour {path}"}

        for element in elements:
            if not isinstance(element, dict):
                continue
            entite_id = element.get("id")
            libelle = _libelle_entite(element, entite_id if isinstance(entite_id, int) else 0)

            for champ in champs:
                echeance = _parse_echeance(element.get(champ))
                if echeance is None:
                    continue
                jours_restants = (echeance - aujourdhui).days
                if jours_restants <= SEUIL_ALERTE_JOURS:
                    resultat.append(
                        {
                            "type": type_entite,
                            "entite": libelle,
                            "id": entite_id,
                            "champ": champ,
                            "echeance": echeance.isoformat(),
                            "jours_restants": jours_restants,
                        }
                    )

    resultat.sort(key=lambda a: a["jours_restants"])
    return resultat


@mcp.tool()
def referentiel_lister(nom: str) -> Any:
    """Liste un referentiel de l'application (lecture seule).

    Effectue GET /api/v1/{nom} ou `nom` est valide contre une liste blanche.

    Args:
        nom: nom du referentiel. Valeurs autorisees :
            camions, chauffeurs, clients, contacts, projets, sites, articles.

    Returns:
        La liste des enregistrements du referentiel, ou un dict
        {"error": "..."} si le nom est invalide ou si l'appel API echoue.
    """
    if nom not in REFERENTIELS_AUTORISES:
        autorises = ", ".join(sorted(REFERENTIELS_AUTORISES))
        return {
            "error": f"Referentiel '{nom}' non autorise. Valeurs permises : {autorises}"
        }
    return _api_get(f"/api/v1/{nom}")


if __name__ == "__main__":
    mcp.run()
