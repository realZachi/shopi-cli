---
name: shopi-auth-and-profiles
description: >-
  Authentication, credentials, scopes, and profiles for the shopi CLI
  (`shopi`). Use this whenever you need to authenticate, log in to a store,
  set up credentials, pick or switch which store/profile shopi talks to, run
  shopi in CI with env-only auth, or debug auth problems — "token not working",
  "401 / 403", "Access denied", "shop_not_permitted", "no profile configured",
  "which profile is active", "switch stores", "wrong API version", or "where
  does shopi store my token". Covers `shopi auth login|status|doctor|profiles|
  logout`, `shopi init`, the env-var precedence (client credentials vs access
  token vs saved profile), shop normalization, token redaction, config file
  locations, and scope failures. Complements the hub skill `shopi-cli-usage` —
  load that for general command/output mechanics; load this for everything
  about getting and keeping shopi authenticated.
---

# shopi auth & profiles

This skill covers how `shopi` decides *who it is* on each run: where credentials
come from, how scopes constrain it, how profiles work, and how to diagnose auth
failures. For the general command surface (read/write/gql/ops/schema, output
formats, GIDs), load **`shopi-cli-usage`** — this skill builds on it.

## How shopi resolves auth (precedence)

On every run `shopi` resolves exactly one identity, in this order (when **no**
`--profile` is passed):

1. **Client credentials (preferred).** `SHOPIFY_SHOP` + `SHOPIFY_CLIENT_ID` +
   `SHOPIFY_CLIENT_SECRET` set → shopi exchanges them at runtime for a
   short-lived Admin API token (OAuth `client_credentials` grant against
   `https://<shop>/admin/oauth/access_token`). `authMethod: client-credentials`.
2. **Explicit access token.** `SHOPIFY_SHOP` + `SHOPIFY_ACCESS_TOKEN` → shopi
   uses that `shpat_…` token directly. `authMethod: access-token`.
3. **Saved config profile.** Falls back to the config file: the named profile,
   else `defaultProfile`, else the first profile.

If none of these yields a shop+token, shopi errors:
`No Shopify profile configured. Set SHOPIFY_SHOP, SHOPIFY_CLIENT_ID, and
SHOPIFY_CLIENT_SECRET, or run \`shopi auth login …\`.`

> **Passing `--profile <name>` forces the config path and skips env-derived
> auth.** So `--profile staging` will *not* use `SHOPIFY_CLIENT_ID`/
> `SHOPIFY_ACCESS_TOKEN` even if they are set — it reads `staging` from the
> config file. Use this to pin a store regardless of ambient env.

**Why client credentials are preferred:** the token is minted fresh each run and
never written to disk, expires after ~24h, and is refreshed automatically just by
re-running the command. There is no long-lived secret sitting in a config file to
leak. The Client ID and Client secret live in the app's **Settings** in the
Shopify **Dev Dashboard** (the app must be installed on the store).

## Quick start (env-based, recommended)

Put credentials in a `.env` in your working directory (shopi reads it
automatically) or `export` them:

```sh
SHOPIFY_SHOP=your-store.myshopify.com
SHOPIFY_CLIENT_ID=your-client-id
SHOPIFY_CLIENT_SECRET=your-client-secret
SHOPIFY_API_VERSION=2026-04        # optional; default is 2026-04
```

Verify the connection (also fetches live shop info, plan, and granted scopes):

```sh
shopi auth status --validate
```

## `shopi auth` subcommands

`status` is the default when you run bare `shopi auth`.

```sh
# Inspect the resolved identity (shop, apiVersion, redacted token, source,
# authMethod, tokenExpiresIn, tokenScopes). Add --validate for a live check.
shopi auth status
shopi auth status --validate --json --pretty

# End-to-end check: profile, Admin endpoint, configReadable, and a live network
# probe (ok/error). --api-debug adds HTTP method/URL/status/timing on stderr.
shopi auth doctor
shopi auth doctor --api-debug

# List saved profiles in the active config (default marker, shop, apiVersion,
# redacted token, updatedAt).
shopi auth profiles          # alias: shopi auth list

# Save a profile (see below).
shopi auth login --shop your-store.myshopify.com --token shpat_xxxxxxxxxxxx

# Delete a profile (default `default`; also accepts a positional name).
shopi auth logout
shopi auth logout --profile staging
shopi auth logout staging
```

### `shopi auth login` (saving a profile)

`login` writes a profile to a config file. Prefer the env client-credentials flow
above for day-to-day use; reach for `login` when you want a named, persisted
store you can select with `--profile`, or when you only have a static
`shpat_…` token.

```sh
# Static Admin API access token, saved as the default profile.
shopi auth login --shop your-store.myshopify.com --token shpat_xxxxxxxxxxxx

# A named profile, saved to the LOCAL workspace config (./.shopi/config.json).
shopi auth login --profile staging --shop staging-store.myshopify.com \
  --token shpat_xxxxxxxxxxxx --local --validate

# Read the token from a file or stdin instead of the command line (safer).
shopi auth login --shop your-store.myshopify.com --token-file ./token.txt
echo "$TOKEN" | shopi auth login --shop your-store.myshopify.com --token -
```

Flag behavior:
- `--shop` falls back to `SHOPIFY_SHOP`.
- `--token` falls back to `--token-file` (read as `@file`), then
  `SHOPIFY_ACCESS_TOKEN`. The token value also supports `@file` and `-` (stdin).
- `--profile` defaults to `default`; the saved profile is made the default.
- `--local` writes to `./.shopi/config.json` instead of the global config.
- `--api-version` sets the profile's API version (falls back to
  `SHOPIFY_API_VERSION`, then `2026-04`).
- `--validate` runs a shop-status query so a bad token fails *now*, not later.

## Profiles & config files

shopi stores named profiles in JSON. Config resolution:

- **Local:** `./.shopi/config.json` — used automatically if it exists, or forced
  with `--local`. Local takes precedence over global.
- **Global:** `~/.config/shopi/config.json` (or
  `$XDG_CONFIG_HOME/shopi/config.json`).
- **Override:** `$SHOPI_CONFIG` — when set, it wins over both local and global.

Config files are written mode `0600` (owner read/write only) because they may
hold a static token. **Tokens are redacted in all shopi output** (`shpat_…` is
shown as `shpat_…xxxx`) — so it's safe to paste `shopi auth status`/`profiles`
output into a ticket. `--api-debug` likewise never prints the token.

Scaffold a per-project workspace with `shopi init`:

```sh
shopi init                                   # creates ./.shopi/ + .gitignore + README
shopi init --shop your-store.myshopify.com --token shpat_xxxxxxxxxxxx --local
```

`init` creates `./.shopi/` with a `.gitignore` that ignores `config.json` and
`*.schema.json` (so secrets and cache never get committed). If `--shop` plus a
token (`--token` or `SHOPIFY_ACCESS_TOKEN`) are present, it saves a local
profile.

**Switching stores:** pin a config profile with `--profile <name>` (or
`--local` for the workspace config) on any command:

```sh
shopi read products --first 5 --profile staging
shopi auth status --profile production --validate
```

## Shop normalization, endpoint, and API version

- **Shop normalization:** input is lowercased; `https://` and
  `admin.shopify.com/store/` prefixes are stripped; a bare name gets
  `.myshopify.com` appended. So `--shop my-store` →
  `my-store.myshopify.com`, and pasting an admin URL works too.
- **Admin endpoint:** `https://<shop>/admin/api/<api-version>/graphql.json`
  (printed by `shopi auth doctor`).
- **API version:** default `2026-04` (`SHOPIFY_API_VERSION` or `--api-version`
  override it). The schema cache is keyed per shop+version, so changing the
  version effectively talks to a different schema.

## Scopes

shopi can **never exceed the scopes the app was granted**. A `read_*` scope can
only run reads; mutations need the matching `write_*` scope. Scopes are validated
by Shopify on every request, so missing scopes surface as GraphQL/HTTP errors
(e.g. `Access denied` on a field, or an HTTP `403`), never as silent no-ops.

Grant the **narrowest** set that covers your workflow, e.g.:

```text
read_products,write_products,read_orders,read_customers,read_inventory,write_inventory
```

`shopi auth status --validate` reports the live `tokenScopes` granted to the
current credentials — use it to confirm a scope is actually present before
blaming the query. After changing scopes in the Dev Dashboard, **reinstall/update
the app on the store**, then re-run.

For the full broad "manage most of the shop" scope string and the complete
environment-variable reference, read **`references/scopes.md`** (kept separate to
keep this file focused).

## Troubleshooting

Start with `shopi auth doctor` (and `--api-debug`); it checks the profile,
endpoint, config readability, and a live request in one shot. Add
`SHOPI_DEBUG=1` to any command to print structured, redacted error `details` to
stderr.

| Symptom | Likely cause & fix |
| --- | --- |
| `No Shopify profile configured…` | No creds resolved. Set `SHOPIFY_SHOP`+`SHOPIFY_CLIENT_ID`+`SHOPIFY_CLIENT_SECRET`, or `shopi auth login`. Check you're in the dir with your `.env`. |
| `Missing --shop` / `Missing --token…` | `login` got no shop/token from flags or env. Pass `--shop` and `--token`/`--token-file`. |
| `401` / "Invalid API key or access token" | Wrong/expired token or bad client id/secret, or app not installed. Re-check `SHOPIFY_CLIENT_ID`/`SHOPIFY_CLIENT_SECRET`; for a static token, `shopi auth login` again. |
| `403` / `Access denied` on a field | Missing scope. Add the `read_*`/`write_*` scope in the Dev Dashboard, reinstall the app, retry. Confirm with `shopi auth status --validate` (`tokenScopes`). |
| `shop_not_permitted` | App and store are in different Dev Dashboard orgs. Recreate the dev store from the Dev Dashboard's Stores page and reinstall. |
| `Invalid Shopify shop domain` | `--shop`/`SHOPIFY_SHOP` malformed. Use the `*.myshopify.com` domain (bare names get `.myshopify.com` appended). |
| Wrong/empty data or unexpected schema | Likely an API-version mismatch. Check `apiVersion` in `shopi auth status`; set `--api-version`/`SHOPIFY_API_VERSION`. |
| Network/HTTP 5xx (exit code `2`) | Transient or upstream. Re-run; inspect with `shopi auth doctor --api-debug`. |

`shopi auth status --validate` confirms the *token*; `shopi auth doctor` confirms
the *whole path* (endpoint, config, network). Reach for `--api-debug` when you
need the request line and timing, and `SHOPI_DEBUG=1` when you need the
underlying error body.

## CI / non-interactive usage

In CI, skip saved profiles entirely and authenticate from env. Output is JSON
when piped/non-TTY, but be explicit:

```sh
export SHOPIFY_SHOP=your-store.myshopify.com
export SHOPIFY_CLIENT_ID=…          # from your CI secret store
export SHOPIFY_CLIENT_SECRET=…
shopi auth status --validate --output json   # fails the step on bad creds/scopes
```

Use client-credentials env vars (no token on disk, auto-refreshed) and gate the
pipeline on `shopi auth status --validate --output json` before running real
operations.
