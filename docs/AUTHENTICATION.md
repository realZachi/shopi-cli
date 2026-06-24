# Authentication

`shopi` uses Shopify Admin API access tokens. For Dev Dashboard apps installed
on your own store, it can exchange `SHOPIFY_CLIENT_ID` and
`SHOPIFY_CLIENT_SECRET` for an Admin API access token at runtime.

## Dev Dashboard client credentials

1. Open the Shopify Dev Dashboard.
2. Select your app.
3. Go to Settings.
4. Copy the Client ID and Client secret.
5. Make sure the app is installed on the target store.

```sh
export SHOPIFY_SHOP=your-store.myshopify.com
export SHOPIFY_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
export SHOPIFY_CLIENT_SECRET=shpss_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
export SHOPIFY_API_VERSION=2026-04
shopi auth status --validate
```

Shopify validates scopes on every request. A read scope can run read operations
only. Write mutations require matching write scopes. Client-credentials access
tokens expire, so `shopi` requests a fresh token when it starts.

`SHOPIFY_ACCESS_TOKEN=shpat_...` remains supported as an explicit fallback.

## Global profile

```sh
shopi auth login \
  --shop your-store.myshopify.com \
  --token shpat_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx \
  --profile production \
  --validate
```

Global config is written to:

```text
~/.config/shopi/config.json
```

or `$XDG_CONFIG_HOME/shopi/config.json` when `XDG_CONFIG_HOME` is set.

## Local profile

```sh
shopi auth login --local --shop your-store --token shpat_xxx
```

Local config is written to:

```text
./.shopi/config.json
```

Do not commit this file.

## Environment-only auth

```sh
export SHOPIFY_SHOP=your-store.myshopify.com
export SHOPIFY_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
export SHOPIFY_CLIENT_SECRET=shpss_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
export SHOPIFY_API_VERSION=2026-04
shopi auth status --validate
```

Environment variables take precedence when no explicit `--profile` is passed.

## Health checks

```sh
shopi auth status --validate --json --pretty
shopi auth doctor --api-debug
```

`--api-debug` prints request status and timing to stderr. It never prints the
access token.
