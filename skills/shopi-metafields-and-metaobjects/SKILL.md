---
name: shopi-metafields-and-metaobjects
description: >-
  Read, set, and model Shopify custom data with the shopi CLI (`shopi`) over the
  Admin GraphQL API. Use this skill whenever the user wants to set a metafield,
  read metafields, store custom data on a product (or variant, customer, order,
  collection, shop, etc.), work with custom fields, create or list metafield
  definitions, or model and reference metaobjects — even if they don't say
  "metafield", "metaobject", or "GraphQL". Covers metafieldsSet, metafieldsDelete,
  metafield/metafieldDefinition queries, metafieldDefinitionCreate/Update/Delete,
  metaobjectDefinitionCreate, metaobjects queries, and
  metaobjectCreate/Update/Upsert/Delete. Complements the `shopi-cli-usage` hub
  skill — load that first for global flags, output formats, GIDs, pagination, and
  write safety.
---

# shopi: metafields and metaobjects

This skill is for storing and reading **custom data** on a Shopify store with
`shopi`. It builds on **`shopi-cli-usage`** — load that hub first for discovery
(`shopi ops`/`shopi schema`), global flags, `--json`/`--pretty` output, GIDs,
pagination, and the dry-run → `--confirm` write safety rail. Everything here
assumes those basics.

> **Discover, then act.** Every Admin field below is real for API version
> 2026-04, but the store's live schema is the source of truth. Confirm shapes
> with `shopi ops show <name>` and `shopi schema show <Type>` before building.

## Concepts in 60 seconds

- **Metafield** = one typed piece of custom data attached to an owner resource.
  Its identity is the tuple **ownerId (GID) + namespace + key**, plus a **type**
  and a **value**. Example: a `custom.care_guide` text field on a product.
- **value is ALWAYS a string.** For `json`, `list.*`, `dimension`, `money`,
  `boolean`, etc. the string is JSON-encoded (e.g. `"true"`, `"42"`,
  `"[\"a\",\"b\"]"`, `"{\"amount\":\"19.99\",\"currency_code\":\"USD\"}"`).
- **Metafield definition** = a schema for a (ownerType, namespace, key): it sets
  the type, validations, admin pinning, and storefront/admin access. Definitions
  are optional for writing a value but unlock validation, the admin UI, storefront
  exposure, and list/filter. See `references/metafield-types.md`.
- **Metaobject** = a custom, standalone record of a given **type** (its own set
  of fields), identified by **type + handle**. A metafield can *reference* a
  metaobject (type `metaobject_reference` / `list.metaobject_reference`).
- **App-reserved namespace.** When you omit `namespace`, the app's reserved
  namespace (shown as `$app` in app config) is used. Set `namespace` explicitly
  (e.g. `custom`) for unstructured/merchant-facing metafields.

GIDs everywhere: `gid://shopify/Product/123`, `gid://shopify/MetafieldDefinition/1`,
`gid://shopify/Metaobject/9`. List args are Relay connections — page with
`first`/`after`.

## Common metafield types (compact)

| type | value (string) example |
| --- | --- |
| `single_line_text_field` | `"shopi-cli"` |
| `multi_line_text_field` | `"line 1\nline 2"` |
| `number_integer` | `"42"` |
| `boolean` | `"true"` |
| `json` | `"{\"k\":\"v\"}"` |
| `date` | `"2026-06-24"` |
| `dimension` | `"{\"value\":10.5,\"unit\":\"CENTIMETERS\"}"` |
| `money` | `"{\"amount\":\"19.99\",\"currency_code\":\"USD\"}"` |
| `list.single_line_text_field` | `"[\"a\",\"b\"]"` |
| `product_reference` | `"gid://shopify/Product/123"` |
| `metaobject_reference` | `"gid://shopify/Metaobject/9"` |
| `list.product_reference` | `"[\"gid://shopify/Product/1\",\"...2\"]"` |

This is a subset. For the authoritative, version-correct list (and per-type
validations), query the live store: `shopi read metafieldDefinitionTypes
--select 'name category supportedValidations { name type }' --json --pretty`.
Full type table and definition reference: **`references/metafield-types.md`**.

## Setting metafield values — `metafieldsSet`

`metafieldsSet(metafields: [MetafieldsSetInput!]!)` is a bulk **upsert** (max 25
per call). Because `metafields` is a *list* argument, pass it with
`--arg metafields=@file.json` (the repo's `examples/metafields-set.json` shows
the exact shape) rather than `--input`.

`MetafieldsSetInput` fields: `ownerId` (ID!, required), `key` (required),
`value` (required), `namespace` (optional — defaults to the app namespace),
`type` (required only when no definition exists for that owner/namespace/key),
and optional `compareDigest` for safe concurrent writes.

`examples/metafields-set.json`:

```json
[
  {
    "ownerId": "gid://shopify/Product/1234567890",
    "namespace": "custom",
    "key": "source",
    "type": "single_line_text_field",
    "value": "shopi-cli"
  }
]
```

```sh
# 1) Preview the generated mutation. No --confirm needed.
shopi write metafieldsSet --arg metafields=@examples/metafields-set.json \
  --select 'metafields { id namespace key type value } userErrors { field message }' \
  --dry-run --json --pretty

# 2) Run it for real.
shopi write metafieldsSet --arg metafields=@examples/metafields-set.json \
  --select 'metafields { id namespace key type value } userErrors { field message }' \
  --confirm --json --pretty
```

**Always select and check `userErrors`** — a 200 with non-empty `userErrors`
means nothing was written. Confirm the input shape with
`shopi schema show MetafieldsSetInput` and `shopi ops show metafieldsSet`.

## Reading metafields on an owner

Metafields are read through the owning resource. Use `metafield(namespace, key)`
for one, or the `metafields(first:)` connection for many. Alias each metafield
load for a stable shape.

```sh
# A single metafield (namespace defaults to the app namespace if omitted).
shopi read product --id gid://shopify/Product/1234567890 \
  --select 'id title metafield(namespace:"custom", key:"source") { type value }' \
  --json --pretty

# All metafields on the owner.
shopi read product --id gid://shopify/Product/1234567890 \
  --select 'metafields(first: 20) { nodes { namespace key type value } pageInfo { hasNextPage endCursor } }' \
  --json --pretty
```

Prefer `value` for round-tripping; many object/reference types also expose
`jsonValue` (a parsed JSON form) and `reference`/`references` for dereferencing.

## Deleting metafields — `metafieldsDelete`

`metafieldsDelete(metafields: [MetafieldIdentifierInput!]!)` removes metafields
by `ownerId` + `namespace` + `key` (also a list arg → use `--arg`).

```sh
shopi write metafieldsDelete \
  --arg metafields='[{"ownerId":"gid://shopify/Product/1234567890","namespace":"custom","key":"source"}]' \
  --select 'deletedMetafields { ownerId namespace key } userErrors { field message }' \
  --dry-run --json --pretty
# add --confirm to apply
```

## Metafield definitions

Definitions give a (ownerType, namespace, key) a fixed type, validations, admin
pinning, and storefront/admin access — and enable list/filter in the admin.

- **List / inspect:** `metafieldDefinitions(first:, ownerType:)` query;
  `metafieldDefinition(identifier:)` for one (by ownerType+namespace+key or GID).
- **Create:** `metafieldDefinitionCreate(definition: MetafieldDefinitionInput!)`.
- **Update:** `metafieldDefinitionUpdate(definition: MetafieldDefinitionUpdateInput!)`.
- **Delete:** `metafieldDefinitionDelete(id | identifier, deleteAllAssociatedMetafields)`.
  Deleting a definition in the `$app` namespace requires
  `deleteAllAssociatedMetafields: true`.

`MetafieldDefinitionInput`: `name`, `namespace`, `key`, `ownerType`
(a `MetafieldOwnerType` enum, e.g. `PRODUCT`, `PRODUCTVARIANT`, `CUSTOMER`,
`ORDER`, `COLLECTION`, `SHOP`), `type`, plus optional `description`,
`validations`, `access`, `pin`, `capabilities`, `constraints`.

```sh
# List product definitions.
shopi read metafieldDefinitions --first 50 --owner-type PRODUCT \
  --select 'nodes { id name namespace key type { name } description }' --json --pretty

# Create a definition (single Input arg → --input works here).
shopi write metafieldDefinitionCreate \
  --input '{"name":"Care guide","namespace":"custom","key":"care_guide","ownerType":"PRODUCT","type":"multi_line_text_field"}' \
  --select 'createdDefinition { id name namespace key type { name } } userErrors { field message code }' \
  --dry-run --json --pretty
# add --confirm to apply
```

> **App config note.** Shopify app developers usually declare definitions
> declaratively in `shopify.app.toml` (`[product.metafields.app.<key>]`) so they
> are version-controlled and auto-installed, and reserve
> `metafieldDefinitionCreate` for apps that create types at *runtime*. `shopi` is
> a runtime GraphQL client, so the mutation path above is the right tool when you
> are operating a live store from the CLI rather than editing app config.

## Metaobjects

A metaobject has a **type** (its schema) and a unique **handle** within that
type. The runtime flow with `shopi`:

1. **Define the type** with `metaobjectDefinitionCreate(definition:
   MetaobjectDefinitionCreateInput!)` — `type`, `name`, `displayNameKey`,
   `access`, and `fieldDefinitions: [MetaobjectFieldDefinitionCreateInput!]`
   (each has `key`, `name`, `type`, `required`, `validations`).
2. **Write records** with `metaobjectCreate` / `metaobjectUpdate` /
   `metaobjectUpsert` / `metaobjectDelete`. Prefer **`metaobjectUpsert`** for
   idempotent writes: it creates or updates by `handle`+`type`.
3. **Read** with `metaobjects(type:, first:)` and `metaobject(id | handle:)`.

```sh
# Create a metaobject definition.
shopi write metaobjectDefinitionCreate \
  --input '{"type":"author","name":"Author","displayNameKey":"name","fieldDefinitions":[{"key":"name","name":"Name","type":"single_line_text_field","required":true}]}' \
  --select 'metaobjectDefinition { id type name fieldDefinitions { key type { name } } } userErrors { field message code }' \
  --dry-run --json --pretty

# Upsert a record (handle + metaobject are two args → use --arg per arg).
shopi write metaobjectUpsert \
  --arg handle='{"type":"author","handle":"jane-doe"}' \
  --arg metaobject='{"fields":[{"key":"name","value":"Jane Doe"}]}' \
  --select 'metaobject { id handle type fields { key value } } userErrors { field message code }' \
  --dry-run --json --pretty

# List records of a type.
shopi read metaobjects --type author --first 25 \
  --select 'nodes { id handle displayName fields { key value jsonValue } } pageInfo { hasNextPage endCursor }' \
  --json --pretty
```

Add `--confirm` to the writes after reviewing the dry run.

**Referencing a metaobject from a metafield:** define the metafield with type
`metaobject_reference` (or `list.metaobject_reference`) and set its `value` to
the metaobject's GID (`gid://shopify/Metaobject/...`); a list value is a
JSON-encoded array of GIDs.

```sh
shopi write metafieldsSet \
  --arg metafields='[{"ownerId":"gid://shopify/Product/1234567890","namespace":"custom","key":"author","type":"metaobject_reference","value":"gid://shopify/Metaobject/9876543210"}]' \
  --select 'metafields { id key type value } userErrors { field message }' \
  --dry-run --json --pretty
```

## Verify with discovery (do this when unsure)

The names above are verified for 2026-04, but always confirm exact arg/input
shapes against the live store before writing:

```sh
shopi ops show metafieldsSet --kind mutation --json --pretty
shopi ops show metaobjectUpsert --kind mutation --json --pretty
shopi schema show MetafieldsSetInput --json --pretty
shopi schema show MetafieldDefinitionInput --json --pretty
shopi schema show MetaobjectDefinitionCreateInput --json --pretty
shopi schema show MetafieldOwnerType --json --pretty   # valid ownerType enum values
shopi read metafieldDefinitionTypes --select 'name category' --json --pretty
```

## Reminders

- `value` is **always a string**; JSON-encode it for `json`/`list.*`/object types.
- `metafieldsSet` and `metafieldsDelete` take **list** args → `--arg name=@file.json`.
  Single-input mutations (`metafieldDefinitionCreate`, `metaobjectCreate`) take `--input`.
- Identity is **ownerId + namespace + key**; omitting `namespace` uses the app
  namespace. `type` is required on first write without a definition.
- Always **`--dry-run` first**, select and check **`userErrors`**, then `--confirm`.
- Writes need matching scopes (`write_products`/`write_metaobjects`/
  `write_metaobject_definitions`, etc.); scope failures surface as GraphQL errors.
- More depth (full type table, definition input/access/validations, owner types):
  **`references/metafield-types.md`**.
