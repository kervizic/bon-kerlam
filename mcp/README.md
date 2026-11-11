# bon-kerlam MCP server (read-only beta)

MCP server exposing **read-only** access to the KERLAM "bon" app data. It
does not talk to Postgres directly: every tool call is forwarded as an HTTP
GET request to the **bon-worker** API (FastAPI), authenticated with a
hashed AI token.

This is a beta: no write tools are exposed. See "Extension point" below.

## Requirements

- Python 3.12
- bon-worker running and reachable (default `http://127.0.0.1:8099`)
- An AI token issued by bon-worker with scope `read` (a `write`-scope token
  also works, since write scope is accepted by the worker's read endpoints,
  but is not required here)

Install dependencies:

```bash
pip install -r mcp/requirements.txt
```

## Environment variables

| Variable         | Required | Default                   | Description                                      |
|------------------|----------|----------------------------|---------------------------------------------------|
| `BON_WORKER_URL` | no       | `http://127.0.0.1:8099`   | Base URL of the bon-worker API                    |
| `BON_AI_TOKEN`   | yes      | —                          | Hashed AI token sent as the `X-AI-Token` header   |

If `BON_AI_TOKEN` is missing, every tool call fails immediately with a clear
error instead of silently calling the worker without auth.

## Running it

```bash
export BON_AI_TOKEN="<your-hashed-token>"
export BON_WORKER_URL="http://127.0.0.1:8099"   # optional, this is the default
python mcp/server.py
```

The server speaks MCP over stdio (the FastMCP default), so it's meant to be
launched by an MCP client (Claude Desktop, Claude Code, etc.), not used as a
standalone HTTP service.

## Registering in an MCP client (e.g. Claude Desktop)

Add to the client's MCP config (e.g. `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "bon-kerlam": {
      "command": "python",
      "args": ["/absolute/path/to/mcp/server.py"],
      "env": {
        "BON_WORKER_URL": "http://127.0.0.1:8099",
        "BON_AI_TOKEN": "<your-hashed-token>"
      }
    }
  }
}
```

Use an absolute path to `mcp/server.py` and make sure the `python`
interpreter resolved by `command` has `mcp` and `httpx` installed (e.g. point
`command` at the venv's interpreter if not using the system/global one).

## Tools

| Tool                 | Description                                                                 |
|----------------------|-------------------------------------------------------------------------------|
| `lv_rechercher`      | Search LV (lettres de voiture) summaries, with optional query/date/statut filters |
| `lv_lire`            | Read one LV in full detail (header, tours, lines) by id                     |
| `alertes`            | List upcoming CT/chrono (camions) and FCO/carte (chauffeurs) expirations within 60 days |
| `referentiel_lister` | List reference data: camions, chauffeurs, clients, projets, sites, or articles |

All tools are read-only and map 1:1 to a `GET /worker/...` endpoint on
bon-worker.

## Extension point

Write tools (creating/updating LV, tours, referentiels, ...) are **out of
scope for this beta**. When the bon-worker exposes authenticated write
endpoints, corresponding `@mcp.tool()` functions can be added here following
the same pattern (`httpx` call with `X-AI-Token`, 10s timeout, clear error
messages) — but they should require a `write`-scope token and should be
reviewed separately given the higher risk of mutating production data.
