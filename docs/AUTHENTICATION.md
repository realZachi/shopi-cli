# Authentication

`shopi` uses Shopify Admin API access tokens. It does not run OAuth itself and
does not create Shopify apps for you.

## Create a token

1. Open the Shopify admin for your store.
2. Go to app development and create a custom app.
3. Enable only the Admin API scopes needed for your workflows.
4. Install the custom app.
5. Copy the Admin API access token.

Shopify validates scopes on every request. A read token can run read operations
only. Write mutations require matching write scopes.

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
export SHOPIFY_ACCESS_TOKEN=shpat_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
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
