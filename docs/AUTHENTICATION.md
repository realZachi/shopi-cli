# Authentication

`shopi` connects to the Shopify Admin API with a **Client ID** and **Client
secret** from a Dev Dashboard app that is installed on your store. It exchanges
them for a short-lived Admin API token on every run (via the OAuth
[client credentials grant](https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/client-credentials-grant)),
so no long-lived token is ever stored on disk.

## 1. Create and install an app

1. Open **<https://admin.shopify.com/settings/apps/development>** in your store
   admin and click through to the **Dev Dashboard**.
2. **Create an app** and name it (visible only to you).
3. Configure the **Admin API access scopes** your workflow needs, then save/release.
4. **Install the app on your store.**
   - The app and the store must be in the **same** Dev Dashboard organization. If
     the store isn't listed under **Stores**, create a development store from the
     Dev Dashboard's **Stores** page and install into that one. (A store created
     from the Shopify admin is not in your org and will fail with
     `shop_not_permitted`.)
5. Open the app's **Settings** and copy the **Client ID** and **Client secret**.

## 2. Provide your credentials

Create a `.env` file in your working directory (`shopi` loads it automatically),
or `export` the variables in your shell:

```sh
SHOPIFY_SHOP=your-store.myshopify.com
SHOPIFY_CLIENT_ID=your-client-id
SHOPIFY_CLIENT_SECRET=your-client-secret
SHOPIFY_API_VERSION=2026-04        # optional, defaults to 2026-04
```

Then verify the connection:

```sh
shopi auth status --validate
```

A successful run prints your shop name, plan, and granted scopes. The token
`shopi` obtains expires after 24 hours and is refreshed automatically — just run
the command again. Shopify validates scopes on every request, so a read scope can
only run reads and mutations require matching write scopes.

## Save a profile (alternative to `.env`)

Instead of environment variables, you can store the same credentials in a named
profile. `shopi` keeps refreshing the token for you on every run:

```sh
shopi auth login \
  --shop your-store.myshopify.com \
  --client-id your-client-id \
  --client-secret your-client-secret \
  --profile production \
  --validate
```

If you already have an Admin API access token, pass `--token shpat_…` instead of
the client ID/secret. Profiles live in `~/.config/shopi/config.json` (or
`$XDG_CONFIG_HOME/shopi/config.json`, or the path in `SHOPI_CONFIG`), created with
`0600` permissions. They hold your credentials — never commit them. Use `--local`
to scope a profile to a single repo (`./.shopi/config.json`), select one with
`--profile <name>`, and remove one with `shopi auth logout --profile <name>`.

## Health checks

```sh
shopi auth status --validate --json --pretty
shopi auth doctor --api-debug
```

`--api-debug` prints request status and timing to stderr. It never prints the
access token.

## Troubleshooting

- **`shop_not_permitted`** — the app and store aren't in the same Dev Dashboard
  organization. Recreate the dev store from the Dev Dashboard and reinstall.
- **`401` / "Invalid API key or access token"** — re-check `SHOPIFY_CLIENT_ID` /
  `SHOPIFY_CLIENT_SECRET` and that the app is installed on the store.
- **`Access denied` on a field** — missing scope. Add it in the Dev Dashboard,
  reinstall/update the app, then retry.
