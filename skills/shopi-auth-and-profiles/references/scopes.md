# Reference: scopes & environment variables

Read this when you need the full broad scope string, or a complete list of the
environment variables `shopi` reads for auth and config. For the day-to-day
flow, the parent `SKILL.md` is enough.

## Environment variables (complete)

| Variable | Purpose |
| --- | --- |
| `SHOPIFY_SHOP` | Store domain (e.g. `your-store.myshopify.com`). Required for env auth. |
| `SHOPIFY_CLIENT_ID` | Dev Dashboard app **Client ID**. Part of the preferred client-credentials flow. |
| `SHOPIFY_CLIENT_SECRET` | Dev Dashboard app **Client secret**. Part of the preferred client-credentials flow. |
| `SHOPIFY_ACCESS_TOKEN` | Explicit `shpat_…` Admin API token (fallback when client id/secret aren't set). |
| `SHOPIFY_API_VERSION` | Admin API version. Default `2026-04`. |
| `SHOPI_CONFIG` | Absolute path to a config file; overrides both local and global config. |
| `XDG_CONFIG_HOME` | Base dir for the global config (`$XDG_CONFIG_HOME/shopi/config.json`). |
| `XDG_CACHE_HOME` | Base dir for the schema cache (else `~/.cache`). |
| `HOME` | Fallback base for default config/cache locations. |
| `SHOPI_DEBUG` | When set, shopi prints structured (redacted) error `details` to stderr on failure. |

Auth precedence (no `--profile`): client credentials → `SHOPIFY_ACCESS_TOKEN` →
saved config profile. Passing `--profile <name>` forces the config path and skips
all env-derived auth.

## Choosing scopes

`shopi` can never exceed the scopes the app was installed with. A `read_*` scope
runs reads only; mutations need the matching `write_*` scope. Grant the
**narrowest** set that covers your workflow.

Typical starting point:

```text
read_products,write_products,read_orders,read_customers,read_inventory,write_inventory
```

## Broad "manage most of the shop" scope string

This is the wide scope string used against the test store. Most apps should NOT
request all of these — trim to what you actually use. Some scopes require app
review, a specific app type, or Shopify Plus; Shopify rejects scopes the app
isn't eligible for. After changing scopes, **reinstall/update the app on the
store**.

```text
read_assigned_fulfillment_orders,write_assigned_fulfillment_orders,read_customers,write_customers,read_price_rules,write_price_rules,read_discounts,write_discounts,write_draft_orders,read_draft_orders,read_files,write_files,read_fulfillments,write_fulfillments,write_inventory,read_inventory,read_legal_policies,read_locales,write_locales,write_locations,read_locations,write_marketing_events,read_marketing_events,read_markets,write_markets,read_merchant_managed_fulfillment_orders,write_merchant_managed_fulfillment_orders,read_metaobject_definitions,write_metaobject_definitions,read_metaobjects,write_metaobjects,read_online_store_pages,write_order_edits,read_order_edits,read_orders,write_orders,read_products,write_products,read_reports,read_returns,write_returns,read_shipping,write_shipping,read_content,write_content,read_themes,write_themes,read_third_party_fulfillment_orders,write_third_party_fulfillment_orders,read_translations,write_translations
```

## Verifying granted scopes

`shopi auth status --validate` reports the live `tokenScopes` for the current
credentials. Use it to confirm a scope is actually present before assuming the
problem is your query. A missing scope shows up as a GraphQL `Access denied`
error or HTTP `403`, never a silent empty result.
