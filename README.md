# pi-searxng-search

Local web search for [pi](https://pi.dev) backed by your own **SearXNG** instance.
Unlike `pi-web-search` (which needs a *cloud model* with provider-native search),
this extension works with **any model, including local LLMs** — all searching
happens server-side in SearXNG; the model just reads the results.

Two tools are registered:

| Tool | What it does |
|---|---|
| `web_search` | Query SearXNG's JSON API (`GET /search?q=...&format=json`). Returns up to 10 results with titles, URLs, snippets and the engine that provided them. |
| `url_context` | Fetch up to 5 public URLs directly, strip markup, and hand readable text to the model (capped at 8000 chars per page). |

## Requirements

- pi (v0.80.x or newer) — the extension declares no runtime dependencies;
  it uses only Node's built-in `fetch` plus the packages pi provides to
  extensions.
- A reachable SearXNG instance with the **JSON format enabled**
  (`search.formats: [html, json]` in its `settings.yml`).

## 1. Run SearXNG

### You already have SearXNG (your setup: `http://192.168.1.69:8080`)

Just make sure JSON output is allowed. Check:

```bash
curl -s 'http://192.168.1.69:8080/search?q=test&format=json' | head -c 200
```

- Response starts with `{"query": ...` → done.
- `403 Forbidden` → edit SearXNG's `settings.yml`, add under `search:`:

  ```yaml
  search:
    formats:
      - html
      - json
  ```

  then restart the container.

### You need a SearXNG instance

Two options, both in this repo:

**A. docker compose (recommended)**

```bash
cd /path/to/pi-searxng-search
docker compose -f docker-compose.example.yml up -d
# → available at http://127.0.0.1:8080
```

This mounts `searxng/settings.yml`, which already enables the JSON API.

**B. plain Dockerfile**

```bash
cd /path/to/pi-searxng-search
docker build -t searxng-local .
docker run -d --name searxng-local -p 8080:8080 searxng-local
```

Both bind port 8080 on all interfaces so other LAN machines (including the
machine running pi) can reach it. SearXNG is a metasearch *proxy*: it needs
outbound internet access to its upstream engines. No other ports required.

> **Security note:** these settings are tuned for a *private LAN* instance
> (`limiter: false`, no public-instance features). If you ever expose the
> instance beyond your network, set `server.limiter: true`, regenerate
> `secret_key` (`openssl rand -hex 32`), and consider TLS.

## 2. Install the extension in pi

```bash
pi install /path/to/pi-searxng-search
```

(local path install — the folder is loaded as-is, nothing is copied or
modified; `pi list` should show `pi-searxng-search`).

To try it without installing:

```bash
pi -e /path/to/pi-searxng-search
```

## 3. Point the extension at your SearXNG

The base URL is resolved in this order (first hit wins):

1. `SEARXNG_BASE_URL` environment variable
2. `searxngSearch.baseUrl` in pi's settings (`~/.pi/agent/settings.json`,
   or `$PI_CODING_AGENT_DIR/settings.json`)
3. built-in default: `http://192.168.1.69:8080` ← **your instance**

So for your setup nothing to do — the default already points at
`192.168.1.69:8080`. To change it:

```json
// ~/.pi/agent/settings.json
{
  "searxngSearch": {
    "baseUrl": "http://192.168.1.69:8080"
  }
}
```

or per-session:

```bash
SEARXNG_BASE_URL=http://192.168.1.69:8080 pi
```

## 4. Use it

Start pi with any model (local qwen, OpenAI, whatever). Then just ask:

```
> web_search: latest post on the React blog
> url_context: summarize https://react.dev/blog and https://example.com
```

The model calls the tools; results come back with numbered sources. Successful
calls are collapsed in the TUI — expand the tool call to see the full output.

Verify the wiring:

```bash
# SearXNG side
curl -s 'http://192.168.1.69:8080/search?q=react&format=json' | python3 -m json.tool | head

# plugin unit tests (needs Node 22+, no SearXNG needed — all network mocked)
cd /path/to/pi-searxng-search
node --test tests/*.test.mjs
```

## Configuration reference

| Setting | Where | Default | Meaning |
|---|---|---|---|
| `SEARXNG_BASE_URL` | env | — | SearXNG base URL (highest priority) |
| `searxngSearch.baseUrl` | pi settings.json | — | Same, persistent |
| base URL | — | `http://192.168.1.69:8080` | Your LAN SearXNG |

Hard-coded limits (change in source if needed):

- `web_search`: up to **10** results surfaced, 20 s request timeout
- `url_context`: up to **5** URLs, 8000 chars/page, 20 s timeout each

## How it works / security posture

- `web_search` → `GET {base}/search?q=<query>&format=json` on *your* SearXNG
  only. Responses are validated structurally; entries without a valid
  `http(s)` URL are dropped.
- `url_context` → plain `fetch` of each requested URL (http/https only),
  HTML→text extraction, truncation at 8000 chars.
- Every request honors pi's `AbortSignal` plus a 20 s timeout; nothing runs
  at install time (no lifecycle scripts, zero runtime dependencies).
- No telemetry, no other endpoints, no writes to disk.
- Prompt-injection caveat: like any web search tool, results are untrusted
  content — that's inherent to the feature, not a defect of this package.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `SearXNG API error (403)` | JSON format not enabled — see §1 |
| `Cannot reach SearXNG at ...` | instance down, wrong host/port, or firewall between pi's machine and 192.168.1.69:8080 |
| `SearXNG request timed out` | instance overloaded or upstream engines slow; raise `timeoutMs` in `src/searxng.ts` |
| `No SearXNG results for "..."` | all upstream engines suspended/rate-limited; wait a bit or enable more engines in SearXNG settings |
| `url_context` failed entries | listed per URL with HTTP status; the model still gets the pages that succeeded |
| `url_context`: "No readable text extracted" | page is JavaScript-rendered (SPA) — nothing static to read; fetch a static page instead |

## Files

```
package.json              pi package manifest (extension entry, no deps)
src/index.ts              tool registration (web_search, url_context)
src/searxng.ts            SearXNG JSON API client + validation
src/url_fetch.ts          URL fetch + readable-text extraction
src/config.ts             base-URL resolution (env → settings → default)
src/format.ts             result rendering
tests/                    unit tests (all network mocked, `node --test`)
searxng/settings.yml      SearXNG settings template (JSON API enabled)
docker-compose.example.yml  optional SearXNG host
Dockerfile                optional SearXNG host (plain docker)
```

## License

MIT (SearXNG itself is AGPL-3.0; this package only talks to it over HTTP).
