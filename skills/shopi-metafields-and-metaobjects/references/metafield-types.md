# Metafield types & definition reference

Companion to `../SKILL.md`. Names below are verified against the Shopify Admin
GraphQL API **version 2026-04**. The store's live schema remains the source of
truth — confirm with `shopi schema show <Type>` / `shopi ops show <name>` and the
`metafieldDefinitionTypes` query (see bottom). All metafield **values are
strings**; for `json`, `list.*`, and object types the string is JSON-encoded.

## Metafield types

### Text
| type | value example |
| --- | --- |
| `single_line_text_field` | `"Blue cotton tee"` |
| `multi_line_text_field` | `"Wash cold\nLine dry"` |
| `rich_text_field` | JSON-encoded rich-text document string |
| `url` | `"https://example.com"` |
| `color` | `"#4B0082"` |
| `json` | `"{\"a\":1,\"b\":[2,3]}"` |

### Numbers, dates, measurements
| type | value example |
| --- | --- |
| `number_integer` | `"42"` |
| `number_decimal` | `"3.14"` |
| `boolean` | `"true"` |
| `date` | `"2026-06-24"` |
| `date_time` | `"2026-06-24T15:00:00Z"` |
| `money` | `"{\"amount\":\"19.99\",\"currency_code\":\"USD\"}"` |
| `rating` | `"{\"value\":\"4.5\",\"scale_min\":\"0\",\"scale_max\":\"5\"}"` |
| `weight` | `"{\"value\":2.5,\"unit\":\"KILOGRAMS\"}"` |
| `volume` | `"{\"value\":1.0,\"unit\":\"LITERS\"}"` |
| `dimension` | `"{\"value\":10.5,\"unit\":\"CENTIMETERS\"}"` |

### Reference types (value = a GID string)
| type | references |
| --- | --- |
| `product_reference` | `gid://shopify/Product/…` |
| `variant_reference` | `gid://shopify/ProductVariant/…` |
| `collection_reference` | `gid://shopify/Collection/…` |
| `file_reference` | `gid://shopify/MediaImage/…` (and other file types) |
| `page_reference` | `gid://shopify/OnlineStorePage/…` |
| `metaobject_reference` | `gid://shopify/Metaobject/…` |
| `mixed_reference` | a GID; valid metaobject definition types set via validations |
| `customer_reference` | `gid://shopify/Customer/…` |
| `order_reference` | `gid://shopify/Order/…` |
| `product_taxonomy_value_reference` | a taxonomy value GID |

### List types
Any scalar or reference type has a `list.<type>` form. The value is a
**JSON-encoded array** of the element's string form, e.g.:

- `list.single_line_text_field` → `"[\"red\",\"green\"]"`
- `list.number_integer` → `"[1,2,3]"`
- `list.product_reference` → `"[\"gid://shopify/Product/1\",\"gid://shopify/Product/2\"]"`
- `list.metaobject_reference` → `"[\"gid://shopify/Metaobject/9\"]"`

The full, version-correct list of types and their per-type supported validations
is returned by the `metafieldDefinitionTypes` query (below). Do not assume a type
exists in a given API version — verify.

## MetafieldsSetInput (write values)

`metafieldsSet(metafields: [MetafieldsSetInput!]!)` — bulk upsert, max **25**
metafields per call, atomic (nothing persists on error).

| field | required | notes |
| --- | --- | --- |
| `ownerId` | yes | GID of the owning resource |
| `key` | yes | 2–64 chars; alphanumeric, `-`, `_` |
| `value` | yes | always a string (JSON-encoded for json/list/object types) |
| `namespace` | no | 3–255 chars; omit to use the app-reserved namespace |
| `type` | conditionally | required when no definition exists for owner/namespace/key |
| `compareDigest` | no | compare-and-set for safe concurrent writes; query `metafield { compareDigest }` first, pass `null` to assert "must not exist" |

`metafieldsDelete(metafields: [MetafieldIdentifierInput!]!)` deletes by
`ownerId` + `namespace` + `key`. Returns `deletedMetafields` (null entry if a
given identifier wasn't found) and `userErrors`.

## Metafield definitions

| operation | shape |
| --- | --- |
| `metafieldDefinitions` (query) | `(first:, ownerType:, namespace:, key:, query:)` → connection of `MetafieldDefinition` |
| `metafieldDefinition` (query) | `(identifier: MetafieldDefinitionIdentifierInput)` (ownerType+namespace+key) or `(id:)` |
| `metafieldDefinitionCreate` | `(definition: MetafieldDefinitionInput!)` → `createdDefinition`, `userErrors { field message code }` |
| `metafieldDefinitionUpdate` | `(definition: MetafieldDefinitionUpdateInput!)` → `updatedDefinition`, `userErrors` |
| `metafieldDefinitionDelete` | `(id \| identifier, deleteAllAssociatedMetafields)` → `deletedDefinitionId`, `userErrors` |

`MetafieldDefinitionInput` fields: `name` (required), `key` (required, 2–64 chars),
`ownerType` (required, `MetafieldOwnerType` enum), `type` (required), plus
`namespace` (omit → app namespace), `description`, `validations`
(`[MetafieldDefinitionValidationInput!]` — each `{ name, value }`), `access`
(`MetafieldAccessInput` — `admin`, `storefront`, `customerAccount`),
`pin` (Boolean), `capabilities`, `constraints`.

`MetafieldDefinitionUpdateInput` is similar but `key`, `namespace`, `ownerType`
are identity-only and cannot be changed.

**Deleting `$app` (app-reserved) definitions requires
`deleteAllAssociatedMetafields: true`.**

### Common `MetafieldOwnerType` enum values
`PRODUCT`, `PRODUCTVARIANT`, `COLLECTION`, `CUSTOMER`, `ORDER`, `DRAFTORDER`,
`COMPANY`, `COMPANY_LOCATION`, `LOCATION`, `MARKET`, `SHOP`, `PAGE`, `BLOG`,
`ARTICLE`, `DISCOUNT`. Verify the full set:
`shopi schema show MetafieldOwnerType --json --pretty`.

### Why definitions matter
- **Validation** of values on write (min/max, choices, allowed reference types).
- **Admin UI** editing + pinning (`pin: true`).
- **Access control** — storefront/admin/customer-account read/write exposure.
- **List & filter** in the admin and in search `query:` arguments.

## Metaobjects

| operation | shape |
| --- | --- |
| `metaobjectDefinitionCreate` | `(definition: MetaobjectDefinitionCreateInput!)` → `metaobjectDefinition`, `userErrors` |
| `metaobjectDefinitionUpdate` | `(id:, definition: MetaobjectDefinitionUpdateInput!)` → `metaobjectDefinition`, `userErrors` |
| `metaobjectDefinitionDelete` | `(id:)` → `deletedId`, `userErrors` |
| `metaobjects` (query) | `(type:, first:, query:, sortKey:)` → connection of `Metaobject` |
| `metaobject` (query) | `(id:)` or `(handle: MetaobjectHandleInput)` |
| `metaobjectCreate` | `(metaobject: MetaobjectCreateInput!)` → `metaobject`, `userErrors` |
| `metaobjectUpdate` | `(id:, metaobject: MetaobjectUpdateInput!)` → `metaobject`, `userErrors` |
| `metaobjectUpsert` | `(handle: MetaobjectHandleInput!, metaobject: MetaobjectUpsertInput!)` → `metaobject`, `userErrors` |
| `metaobjectDelete` | `(id:)` → `deletedId`, `userErrors` |

`MetaobjectDefinitionCreateInput`: `type` (required, 3–255 chars, can't change),
`name`, `description`, `displayNameKey`, `access` (`MetaobjectAccessInput`),
`capabilities` (`MetaobjectCapabilityCreateInput`),
`fieldDefinitions: [MetaobjectFieldDefinitionCreateInput!]` — each field has
`key`, `name`, `type`, `required` (Boolean), `description`, `validations`.

`MetaobjectCreateInput` / `MetaobjectUpsertInput`: `type` (create) /
`handle` arg (upsert), `handle` (auto-generated when omitted on create),
`fields: [MetaobjectFieldInput!]` (each `{ key, value }`), `capabilities`.

`MetaobjectHandleInput`: `{ type, handle }` — the metaobject's identity tuple.

### Reading metaobject fields
On the `Metaobject` object: `field(key:)` for one field, `fields { key value
jsonValue }` for all, `displayName`, `handle`, `type`. Prefer `jsonValue` for
complex/reference field values; `field(key:) { reference / references }`
dereferences reference fields.

## Discovery commands (authoritative for the live store)

```sh
# Supported metafield types + per-type validations for this API version.
shopi read metafieldDefinitionTypes \
  --select 'name category supportedValidations { name type }' --json --pretty

# Exact arg/input contracts.
shopi ops show metafieldsSet --kind mutation --json --pretty
shopi ops show metaobjectDefinitionCreate --kind mutation --json --pretty
shopi schema show MetafieldsSetInput --json --pretty
shopi schema show MetafieldDefinitionInput --json --pretty
shopi schema show MetaobjectDefinitionCreateInput --json --pretty
shopi schema show MetafieldOwnerType --json --pretty
```

Docs: https://shopify.dev/docs/apps/build/custom-data
