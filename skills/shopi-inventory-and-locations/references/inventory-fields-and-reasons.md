# Inventory & locations — fields, quantity names, and reasons

Verified against Shopify Admin GraphQL API version **2026-04**. Names drift
between versions — always confirm with `shopi ops show <field>` and
`shopi schema show <Type>` for your store's version. This file backs the
`shopi-inventory-and-locations` SKILL.md; load that first.

## Data model recap

- `ProductVariant.inventoryItem` → one `InventoryItem` (1:1). Holds cost,
  tracking, country of origin.
- `InventoryItem.inventoryLevels` → one `InventoryLevel` per `Location` that
  stocks the item. The level holds the actual numbers.
- `InventoryLevel.quantities(names: [...])` → the named quantities (see below).
- Reach a level three ways: `inventoryLevel(id:)` (top-level by GID),
  `location.inventoryLevel(inventoryItemId:)`, or
  `location.inventoryLevels(first:)` / `inventoryItem.inventoryLevels(first:)`.

## Quantity names (the `names:` / `name:` strings)

Settable / movable / adjustable depending on the mutation:

| Name | Meaning |
| --- | --- |
| `available` | Sellable now. What buyers can purchase. |
| `on_hand` | Physically present = available + committed + reserved + (other states). |
| `committed` | Allocated to orders not yet fulfilled. |
| `reserved` | Held back (e.g. for a draft order or transfer). |
| `incoming` | Expected from a transfer/PO, not yet received. |
| `damaged` | Present but not sellable (damaged). |
| `safety_stock` | Buffer held out of `available`. |
| `quality_control` | Held pending inspection. |

- `inventorySetQuantities` accepts only `available` or `on_hand` for `name`.
- `inventoryAdjustQuantities` and `inventoryMoveQuantities` accept the broader
  set (move between states, e.g. `available` → `damaged`).
- `inventoryQuantity` on `ProductVariant` is a read-only roll-up of `available`
  across locations; you cannot write it directly.

## Reason strings (the `reason:` value)

Free-form strings, but Shopify recognizes a documented set (use these so the
admin shows a clean label):

`correction`, `cycle_count_available`, `damaged`, `movement_created`,
`movement_updated`, `movement_received`, `movement_canceled`, `other`,
`promotion`, `quality_control`, `received`, `reservation_created`,
`reservation_deleted`, `reservation_updated`, `restock`, `safety_stock`,
`shrinkage`.

`referenceDocumentUri` is a URI you choose to trace *why* a change happened
(e.g. `logistics://shopi/po/4471`). Optional on set/adjust; **required** on
`inventoryMoveQuantities`. In move's `from`/`to` you may also pass
`ledgerDocumentUri` to link a ledger entry.

## Mutation input shapes (2026-04, verified)

### inventorySetQuantities(input: InventorySetQuantitiesInput!)

```
InventorySetQuantitiesInput {
  name: String!                  # "available" | "on_hand"
  reason: String!
  referenceDocumentUri: String
  quantities: [InventoryQuantityInput!]!
}
InventoryQuantityInput {
  inventoryItemId: ID!
  locationId: ID!
  quantity: Int!
  changeFromQuantity: Int        # compare-and-swap (CAS) check; REQUIRED key — pass null to skip
}
```

- Absolute set. `changeFromQuantity` replaces the older
  `compareQuantity`/`ignoreCompareQuantity` pattern — those fields are **not**
  present in 2026-04. The set applies only if persisted == `changeFromQuantity`,
  else userError. In 2026-04 the key is **mandatory on every entry**: pass the
  expected current value, or `null` to opt out of the check. Omitting the key
  entirely returns an error.
- **Requires the `@idempotent(key: "…")` directive** on the mutation field in
  2026-04. `shopi write` cannot attach directives — use `shopi gql` with a
  hand-written document (SKILL.md Example 8).
- Payload: `inventoryAdjustmentGroup { reason createdAt changes { name delta quantityAfterChange } } userErrors { field message code }`.

### inventoryAdjustQuantities(input: InventoryAdjustQuantitiesInput!)

```
InventoryAdjustQuantitiesInput {
  name: String!
  reason: String!
  referenceDocumentUri: String
  changes: [InventoryChangeInput!]!   # { inventoryItemId, locationId, delta, ledgerDocumentUri? }
}
```

- Delta. Negative `delta` subtracts. No `@idempotent` requirement.

### inventoryMoveQuantities(input: InventoryMoveQuantitiesInput!)

```
InventoryMoveQuantitiesInput {
  reason: String!
  referenceDocumentUri: String!       # REQUIRED here
  changes: [InventoryMoveQuantityChange!]!
}
InventoryMoveQuantityChange {
  inventoryItemId: ID!
  quantity: Int!
  from: InventoryMoveQuantityTerminalInput!   # { locationId, name, ledgerDocumentUri?, changeFromQuantity? }
  to:   InventoryMoveQuantityTerminalInput!
}
```

- Moves between locations and/or between states. `changes(quantityNames: [...])`
  on the returned `inventoryAdjustmentGroup` filters which deltas to read back.

### inventoryActivate / inventoryDeactivate

```
inventoryActivate(inventoryItemId: ID!, locationId: ID!, available: Int, onHand: Int) {
  inventoryLevel { id quantities(names: [...]) { name quantity } }
  userErrors { field message }
}
inventoryDeactivate(inventoryLevelId: ID!) { userErrors { field message } }
```

- `inventoryActivate` creates the (item, location) level (optionally seeding
  stock). `inventoryDeactivate` removes it. These are about an **item at a
  location**, distinct from `locationActivate`/`locationDeactivate`.

### inventoryItemUpdate(id: ID!, input: InventoryItemInput!)

```
InventoryItemInput {
  cost: Decimal               # money string, e.g. "12.50" -> reads back as unitCost { amount currencyCode }
  tracked: Boolean
  countryCodeOfOrigin: CountryCode      # enum, e.g. US, CA, GB
  provinceCodeOfOrigin: String
  harmonizedSystemCode: String
  countryHarmonizedSystemCodes: [CountryHarmonizedSystemCodeInput!]
  requiresShipping: Boolean
  sku: String
}
```

- Read cost back as `inventoryItem { unitCost { amount currencyCode } }`.
- `tracked` lives here, not on the variant. Untracked items ignore quantities.

### locationActivate / locationDeactivate

```
locationActivate(locationId: ID!) {
  location { id name isActive }
  locationActivateUserErrors { field message code }
}
locationDeactivate(locationId: ID!, destinationLocationId: ID) {
  location { id isActive }
  locationDeactivateUserErrors { field message code }
}
```

- Typed user-error payloads (not the generic `userErrors`). `destinationLocationId`
  can move existing inventory off a location being deactivated.

## Useful read selections

```graphql
# inventoryItems connection
inventoryItems(first: 50, query: "sku:ABC-123") {
  nodes {
    id sku tracked requiresShipping
    unitCost { amount currencyCode }
    variants(first: 1) { nodes { id title product { id title } } }   # variant is deprecated; use variants
    inventoryLevels(first: 10) {
      nodes { id location { id name isActive }
              quantities(names: ["available","on_hand","committed","incoming","reserved"]) { name quantity } }
    }
  }
  pageInfo { hasNextPage endCursor }
}

# a single level at a location
location(id: "gid://shopify/Location/124656943") {
  id name isActive
  inventoryLevel(inventoryItemId: "gid://shopify/InventoryItem/30322695") {
    id quantities(names: ["available","on_hand"]) { name quantity }
  }
}

# from a variant
productVariant(id: "gid://shopify/ProductVariant/4567") {
  id inventoryQuantity                # read-only available roll-up
  inventoryItem { id tracked }
}
```

## Deprecation notes (2026-04)

- `inventorySetOnHandQuantities` → **deprecated**; use `inventorySetQuantities`
  with `name: "on_hand"`.
- `InventoryItem.variant` (singular) → **deprecated**; use `variants` (connection).
- `compareQuantity` / `ignoreCompareQuantity` on the set inputs → **gone**;
  the CAS check is `changeFromQuantity` on `InventoryQuantityInput`.

## Scopes

- Reads: `read_inventory`, `read_locations`, `read_products` (to walk to variants).
- Inventory writes: `write_inventory`.
- Location activate/deactivate: `write_locations`.
- Scope gaps surface as GraphQL/HTTP errors, never silent no-ops.
