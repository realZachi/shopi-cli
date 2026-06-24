---
name: shopi-inventory-and-locations
description: >-
  Inventory and location operations with the shopi CLI (`shopi`) over the
  Shopify Admin GraphQL API. Use whenever the user wants to set a stock level,
  adjust inventory, check a quantity at a location, move stock between locations,
  fix an out-of-stock or oversold item, run an inventory reconciliation, update a
  variant's cost or tracking, activate/deactivate inventory at a location, or
  list/manage locations — even when they don't say "shopi" or "GraphQL".
  Triggers on "set stock level", "adjust inventory", "check quantity at a
  location", "move stock between locations", "out of stock", "inventory
  reconciliation", "update cost", "is this tracked", "activate location".
  Complements the hub skill `shopi-cli-usage` (global flags, discovery, output,
  write safety) and defers to `shopi-bulk-operations` for store-wide reconciliation.
---

# shopi: inventory and locations

This skill covers the inventory and location domain through `shopi read`,
`shopi write`, and `shopi gql`. It assumes the **`shopi-cli-usage`** hub skill
for everything global — discovery (`ops`/`schema`), output formats, GIDs,
pagination, `--dry-run`/`--confirm` write safety, and auth. Load that first; this
skill only adds the inventory-specific fields, mutations, and gotchas.

> **Inventory changes are real money.** A bad absolute set or a delta with the
> wrong sign oversells or hides sellable stock. ALWAYS `--dry-run` first, read the
> generated mutation, then re-run with `--confirm`. Then re-read the level to
> confirm it landed.

> **The store's schema is the source of truth.** Admin API shapes drift between
> versions. The field/mutation/input/enum names below were verified against API
> version **2026-04**, but always confirm exact args for *your* version with
> discovery before a write:
>
> ```sh
> shopi ops show inventorySetQuantities --kind mutation --json --pretty
> shopi schema show InventorySetQuantitiesInput --json --pretty
> shopi schema show InventoryQuantityInput --json --pretty
> ```

Inventory needs scopes: `read_inventory` / `write_inventory`, plus
`read_locations` / `write_locations` for locations, and `read_products` to walk
from a variant. Scope gaps come back as GraphQL/HTTP errors, not silent no-ops.

## The data model in one breath

- A **ProductVariant** has exactly one **InventoryItem** (`variant.inventoryItem { id }`).
  The InventoryItem holds cost, tracking, and country of origin.
- An InventoryItem has one **InventoryLevel** per **Location** where it is stocked.
  The level is the (item × location) cell that holds the actual numbers.
- A level exposes **named quantities** via `quantities(names: [...])`. The valid
  names are `available`, `incoming`, `committed`, `on_hand`, `reserved`,
  `damaged`, `safety_stock`, `quality_control`. The identity is roughly
  `on_hand = available + committed + reserved + …`; `available` is what a buyer
  can purchase.
- **Every level change needs a Location GID.** There is no "default" location at
  the API level — a quantity only exists at a specific (item, location) pair, so
  `locationId` is required on every set/adjust/move/activate.

## Cheat sheet

| Goal | shopi field / mutation |
| --- | --- |
| List/search inventory items | `shopi read inventoryItems` (Relay, `query:` search) |
| One inventory item | `shopi read inventoryItem --id gid://shopify/InventoryItem/…` |
| Read a level at a location | `shopi read location --select 'inventoryLevel(inventoryItemId: …){…}'` |
| Read one level by id | `shopi read inventoryLevel --id gid://shopify/InventoryLevel/…` |
| All levels for a location | `shopi read location --select 'inventoryLevels(first: N){…}'` |
| List/manage locations | `shopi read locations` / `shopi read location` |
| **Absolute set** a quantity | `shopi write inventorySetQuantities` |
| **Delta** adjust a quantity | `shopi write inventoryAdjustQuantities` |
| Move stock (location/state → state) | `shopi write inventoryMoveQuantities` |
| Start stocking an item at a location | `shopi write inventoryActivate` |
| Stop stocking an item at a location | `shopi write inventoryDeactivate` |
| Update cost / tracked / origin | `shopi write inventoryItemUpdate` |
| Activate / deactivate a location | `shopi write locationActivate` / `locationDeactivate` |

A fuller field/quantity-name/reason reference lives in
[`references/inventory-fields-and-reasons.md`](references/inventory-fields-and-reasons.md).

> **`inventorySetOnHandQuantities` is deprecated in 2026-04.** Use
> `inventorySetQuantities` with `name: "on_hand"` (or `"available"`) instead. If a
> tool suggests the `…OnHand…` mutation, confirm with
> `shopi ops list --kind mutation --filter inventory`.

## Reading inventory

`inventoryItems` is a Relay connection — page with `first`/`after` and read
`pageInfo { hasNextPage endCursor }`. Walk to the variant via `variants` (a
connection; the old singular `inventoryItem.variant` is **deprecated** in 2026-04):

```sh
shopi read inventoryItems --first 10 --query 'sku:ABC-123' \
  --select 'nodes { id sku tracked
                    variants(first: 1) { nodes { id title product { title } } }
                    inventoryLevels(first: 5) {
                      nodes { id location { id name }
                              quantities(names: ["available","on_hand","committed"]) { name quantity } } } }
            pageInfo { hasNextPage endCursor }' \
  --json --pretty
```

The level at one specific location (you need the **Location GID** and the
**InventoryItem GID**):

```sh
shopi read location --id gid://shopify/Location/124656943 \
  --select 'id name isActive
            inventoryLevel(inventoryItemId: "gid://shopify/InventoryItem/30322695") {
              id quantities(names: ["available","on_hand","committed","incoming","reserved"]) { name quantity } }' \
  --json --pretty
```

Other read shapes: one level by id with
`shopi read inventoryLevel --id gid://shopify/InventoryLevel/…`, and every item
stocked at a location with
`shopi read location --select 'inventoryLevels(first: 50) { nodes { item { id sku } quantities(names:["available"]) { name quantity } } }'`.

## Connecting a variant to its inventory

From a product variant you reach inventory in three fields:

```sh
shopi read productVariant --id gid://shopify/ProductVariant/4567 \
  --select 'id title
            inventoryQuantity                 # total available across locations (read-only)
            inventoryItem { id tracked }' \
  --json --pretty
```

- `inventoryItem { id }` — the GID you feed to every inventory mutation.
- `inventoryQuantity` — a convenience read-only total of `available`; you cannot
  write it directly. To change stock, mutate the InventoryItem's level(s).
- `tracked` lives on the **InventoryItem**, not the variant. An untracked item
  ignores quantities entirely — set `tracked: true` (via `inventoryItemUpdate`)
  before stock numbers mean anything.

## Locations

```sh
shopi read locations --first 20 --arg includeInactive=true \
  --select 'nodes { id name isActive shipsInventory fulfillsOnlineOrders
                    address { city country } }' --json --pretty
```

Every quantity belongs to a `(InventoryItem, Location)` pair, so you must know the
Location GID before any write. Activate or deactivate a *location* (a store
concept — whether it can hold/fulfill inventory) with `locationActivate` /
`locationDeactivate`; these use typed `locationActivateUserErrors` /
`locationDeactivateUserErrors` payloads. Do **not** confuse this with
`inventoryActivate`/`inventoryDeactivate`, which connect a *single item* to a
location's stock ledger (below).

## Writing: absolute set vs. delta vs. move

All inventory mutations return `userErrors { field message code }` (set adds a
typed `*UserError` with `code`). **Always select and check them** — a 200 with
non-empty `userErrors` means nothing changed. Use GIDs everywhere
(`gid://shopify/InventoryItem/…`, `gid://shopify/Location/…`). Preview with
`--dry-run`, then `--confirm`.

Pick the right verb:

- **`inventorySetQuantities` — absolute.** "Make it exactly N." Input:
  `name` (`"available"` or `"on_hand"`), `reason`, optional `referenceDocumentUri`,
  and `quantities: [{ inventoryItemId, locationId, quantity, changeFromQuantity }]`.
  In 2026-04 `changeFromQuantity` is **required on every entry** — it is a
  **compare-and-swap (CAS) safety check**: the set only applies if the persisted
  value still equals `changeFromQuantity`, else it errors (guards against
  concurrent writers). Pass the value you believe is current, or `null` to skip
  the check — but the key must be present; omitting it returns an error. Only
  `available` and `on_hand` are settable here.
- **`inventoryAdjustQuantities` — delta.** "Add/subtract N." Input: `name`,
  `reason`, optional `referenceDocumentUri`, and
  `changes: [{ inventoryItemId, locationId, delta }]` (negative `delta` subtracts).
  Use for receiving stock, sales corrections, restocks — anywhere you know the
  change, not the target.
- **`inventoryMoveQuantities` — relocate.** Move between locations and/or between
  states (e.g. `available` → `reserved`). Input: `reason`,
  `referenceDocumentUri` (**required here**), and
  `changes: [{ inventoryItemId, quantity, from: { locationId, name }, to: { locationId, name } }]`.

> `name`/`reason` are **strings**, not enums. Quantity names: `available`,
> `on_hand`, `committed`, `reserved`, `incoming`, `damaged`, `safety_stock`,
> `quality_control`. Reason strings include `correction`, `cycle_count_available`,
> `damaged`, `movement_created`, `received`, `restock`, `safety_stock`,
> `quality_control`, `other`. See the reference for the full lists.

> **2026-04 idempotency.** `inventorySetQuantities` (and the deprecated
> on-hand variant) require an `@idempotent(key: "…")` directive on the mutation
> field for retry-safety. With `shopi write` you can't attach a directive, so for
> production set-quantity calls write the document yourself with `shopi gql`
> (Example 8) — confirm the requirement with `shopi ops show inventorySetQuantities`.

## Examples

### 1) Check stock at one location (read)

```sh
shopi read location --id gid://shopify/Location/124656943 \
  --select 'name inventoryLevel(inventoryItemId: "gid://shopify/InventoryItem/30322695") {
              quantities(names: ["available","on_hand","committed"]) { name quantity } }' \
  --json --pretty
```

### 2) Absolute set: make available exactly 42 at a location

```sh
echo '{ "name":"available", "reason":"correction",
  "referenceDocumentUri":"logistics://shopi/correction/2026-06-24",
  "quantities":[{ "inventoryItemId":"gid://shopify/InventoryItem/30322695",
                  "locationId":"gid://shopify/Location/124656943",
                  "quantity":42, "changeFromQuantity":null }] }' > set.json

shopi write inventorySetQuantities --input @set.json \
  --select 'inventoryAdjustmentGroup { reason changes { name delta quantityAfterChange } }
            userErrors { field message code }' \
  --dry-run --json --pretty        # review, then add --confirm
```

### 3) Safe absolute set with compare-and-swap

Add `changeFromQuantity` (the value you believe is persisted). If reality has
drifted, the set fails instead of clobbering a concurrent change.

```sh
echo '{ "name":"on_hand", "reason":"cycle_count_available",
  "referenceDocumentUri":"logistics://shopi/count/2026-06-24",
  "quantities":[{ "inventoryItemId":"gid://shopify/InventoryItem/30322695",
                  "locationId":"gid://shopify/Location/124656943",
                  "quantity":42, "changeFromQuantity":40 }] }' > set-cas.json

shopi write inventorySetQuantities --input @set-cas.json \
  --select 'userErrors { field message code }' --dry-run --json --pretty
```

### 4) Delta adjust: received 5 more units

```sh
echo '{ "name":"available", "reason":"received",
  "referenceDocumentUri":"logistics://shopi/po/4471",
  "changes":[{ "inventoryItemId":"gid://shopify/InventoryItem/30322695",
               "locationId":"gid://shopify/Location/124656943", "delta":5 }] }' > adjust.json

shopi write inventoryAdjustQuantities --input @adjust.json \
  --select 'inventoryAdjustmentGroup { changes { name delta quantityAfterChange } }
            userErrors { field message }' \
  --confirm --json --pretty
```

A negative `delta` (e.g. `-3`) subtracts — handy to correct an oversell.

### 5) Move stock between locations

```sh
echo '{ "reason":"movement_created", "referenceDocumentUri":"logistics://shopi/transfer/889",
  "changes":[{ "inventoryItemId":"gid://shopify/InventoryItem/30322695", "quantity":3,
    "from":{ "locationId":"gid://shopify/Location/124656943", "name":"available" },
    "to":{ "locationId":"gid://shopify/Location/987654321", "name":"available" } }] }' > move.json

shopi write inventoryMoveQuantities --input @move.json \
  --select 'inventoryAdjustmentGroup { reason } userErrors { field message }' \
  --dry-run --json --pretty        # add --confirm to move
```

Same shape moves *states* at one location, e.g. `from.name:"available"` →
`to.name:"reserved"` with `reason:"damaged"`.

### 6) Activate / deactivate an item at a location

`inventoryActivate` starts tracking one item at a location (optionally seeding
`available`/`onHand`); `inventoryDeactivate` removes the level.

```sh
shopi write inventoryActivate \
  --arg inventoryItemId=gid://shopify/InventoryItem/30322695 \
  --arg locationId=gid://shopify/Location/987654321 \
  --arg available=10 \
  --select 'inventoryLevel { id quantities(names:["available"]) { name quantity } }
            userErrors { field message }' \
  --confirm --json --pretty

shopi write inventoryDeactivate \
  --arg inventoryLevelId=gid://shopify/InventoryLevel/123 \
  --select 'userErrors { field message }' --confirm --json
```

### 7) Update cost, tracking, and country of origin

`inventoryItemUpdate(id, input: InventoryItemInput)` — `cost` is a money string,
`tracked` a boolean, `countryCodeOfOrigin` a `CountryCode` enum (e.g. `US`).

```sh
shopi write inventoryItemUpdate \
  --arg id=gid://shopify/InventoryItem/30322695 \
  --arg input='{"cost":"12.50","tracked":true,"countryCodeOfOrigin":"US","harmonizedSystemCode":"123456"}' \
  --select 'inventoryItem { id unitCost { amount currencyCode } tracked countryCodeOfOrigin }
            userErrors { field message }' \
  --dry-run --json --pretty        # add --confirm to apply
```

### 8) Set quantities with the required @idempotent directive (`shopi gql`)

Because `inventorySetQuantities` requires `@idempotent` in 2026-04 and
`shopi write` can't attach directives, write the document by hand:

```graphql
# set-qty.graphql
mutation SetQty($input: InventorySetQuantitiesInput!) {
  inventorySetQuantities(input: $input) @idempotent(key: "9b1c-correction-2026-06-24") {
    inventoryAdjustmentGroup { reason changes { name delta quantityAfterChange } }
    userErrors { field message code }
  }
}
```

```sh
# Unlike `shopi write` (which wraps your --input/--arg into the operation's
# variables), `shopi gql` passes --variables through VERBATIM, so the file must
# match the document's variable definitions exactly — here a top-level "input":
echo '{ "input": { "name":"available", "reason":"correction",
  "referenceDocumentUri":"logistics://shopi/correction/2026-06-24",
  "quantities":[{ "inventoryItemId":"gid://shopify/InventoryItem/30322695",
                  "locationId":"gid://shopify/Location/124656943",
                  "quantity":42, "changeFromQuantity":null }] } }' > set-qty.vars.json

shopi gql --file set-qty.graphql --variables @set-qty.vars.json --dry-run --json --pretty
shopi gql --file set-qty.graphql --variables @set-qty.vars.json --confirm --json --pretty
```

## Store-wide reconciliation

To reconcile thousands of items against a warehouse export, don't loop
single-item mutations or deep-paginate `inventoryItems` — use the Bulk Operations
API (`bulkOperationRunQuery` to pull current levels,
`bulkOperationRunMutation` to apply `inventorySetQuantities`/
`inventoryAdjustQuantities` from a JSONL file). That flow, including staged
uploads and polling, is the **`shopi-bulk-operations`** skill.

## Verify with discovery

Before any write, anchor on the live schema rather than this page:

```sh
shopi ops list --kind mutation --filter inventory     # discover inventory mutations
shopi ops list --kind mutation --filter location       # discover location mutations
shopi ops show inventorySetQuantities --kind mutation --json --pretty
shopi schema show InventorySetQuantitiesInput --json --pretty
shopi schema show InventoryQuantityInput --json --pretty   # confirm changeFromQuantity
shopi schema show InventoryItemInput --json --pretty
```

Then preview with `--dry-run`, run with `--confirm`, and re-read the level
(`shopi read inventoryLevel --id <gid>` or the `location.inventoryLevel(...)`
selection) to confirm the change landed. For store-wide reconciliation prefer
**`shopi-bulk-operations`**.
