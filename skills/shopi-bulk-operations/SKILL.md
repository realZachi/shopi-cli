---
name: shopi-bulk-operations
description: >-
  Run Shopify Admin **bulk operations** with the shopi CLI (`shopi`) to export or
  import data at scale instead of paginating. Use this skill whenever the user
  wants to export all products / all orders / all customers, dump the whole
  catalog, pull a large dataset to a file, bulk update or bulk tag thousands of
  records, mass-import products or metafields, run a large data job, get a JSONL
  export, or says paginating `shopi read` is "too slow" / "too many to page
  through" / "there are way too many records" — even if they don't say "bulk
  operation" or "JSONL". Covers bulkOperationRunQuery (export), bulkOperationRunMutation
  (import), stagedUploadsCreate, polling via bulkOperations/currentBulkOperation,
  bulkOperationCancel, JSONL shape (`__parentId`), and the bulk_operations/finish
  webhook. Complements the `shopi-cli-usage` hub skill — load that first for
  global flags, output, GIDs, pagination, and write safety.
---

# shopi: bulk operations (export & import at scale)

This is the **scale** skill for `shopi`. It builds on **`shopi-cli-usage`** — load
that hub first for discovery (`shopi ops`/`shopi schema`), global flags,
`--json`/`--pretty` output, GIDs, and the dry-run → `--confirm` write safety rail.
Everything here assumes those basics.

> **Discover, then act.** Every Admin field below is real for API version
> **2026-04**, but the store's live schema is the source of truth. Confirm shapes
> with `shopi ops show <name>` and `shopi schema show <Type>` before building.

## Why bulk operations (and when to switch)

A bulk operation is a single **async job**: you submit one GraphQL query (or
mutation), Shopify runs it server-side, and produces a **downloadable JSONL file**
with every matching record. There is **no pagination** and **no per-page cost
throttling** to manage — you trade waiting for a job to finish against looping
hundreds of `shopi read --first … --after …` calls.

Reach for bulk when:

- **Large exports** — "export all products", "every order from last year", "dump
  all customers". Deep pagination is slow and burns query cost on every page.
- **Large imports/writes** — "tag 50k products", "update prices on the whole
  catalog". One bulk mutation replaces thousands of individual `shopi write` calls.

Decide with cost. On a normal read, add `--full` to see `extensions.cost`
(requested/actual cost, throttle status). When you find yourself shrinking `first`
to avoid `THROTTLED` or making page after page, switch to a bulk op:

```sh
shopi read products --first 50 --select 'nodes { id } pageInfo { hasNextPage }' --full --json --pretty
# inspect extensions.cost.throttleStatus → if you're fighting it, go bulk.
```

**Limits:** a bulk **query** can run at the same time as a bulk **mutation**, but
only **one of each kind** per shop at a time. A bulk query supports **at least one
connection**, up to **5 connections**, nesting depth **2**. Result `url`s expire
after **7 days**.

## Lifecycle at a glance

`CREATED → RUNNING → COMPLETED` (or `FAILED` / `CANCELING → CANCELED`; a result
url can later become `EXPIRED`). The three phases for any job:

1. **Start** a job with a `bulkOperationRun*` mutation (it's a mutation → needs
   `--confirm`). Check `userErrors`.
2. **Poll** `bulkOperations` (or `currentBulkOperation`) until `status` is
   `COMPLETED` or terminal.
3. **Download** the JSONL from `url` (export) or read the results JSONL (import).

---

## Bulk QUERY — export to JSONL

### 1. Start the job

The inner query is a **GraphQL document passed as a STRING**, and it uses
connections **without `first`/pagination** — Shopify walks them for you. Because
that string is multi-line, the clean pattern is to keep the whole start mutation
in a file and run it with `shopi gql --file`:

```sh
# bulk-export-products.graphql contains the mutation below (inner query is a string)
shopi gql --file bulk-export-products.graphql --confirm \
  --select 'bulkOperation { id status } userErrors { field message }' --json --pretty
```

`bulk-export-products.graphql`:

```graphql
mutation {
  bulkOperationRunQuery(query: """
    {
      products {
        edges {
          node {
            id
            title
            handle
            status
            variants {
              edges { node { id sku price } }
            }
          }
        }
      }
    }
  """) {
    bulkOperation { id status }
    userErrors { field message }
  }
}
```

`shopi gql` runs the document exactly (no `--select`). Equivalent builder form —
the single `query` arg is read from a file holding just the inner `{ products {
edges { node …` document (no `mutation` wrapper):

```sh
shopi write bulkOperationRunQuery --arg query=@products-export.graphql \
  --select 'bulkOperation { id status } userErrors { field message }' \
  --dry-run --json --pretty            # then re-run with --confirm
```

**Always check `userErrors`** on the response — a non-empty list means the job
never started.

### 2. Poll for completion

`bulkOperations(query: "status:…")` is the current way to find the job.
`currentBulkOperation(type: QUERY)` still works but is **deprecated** in 2026-04 —
prefer `bulkOperations`. Re-run until `status` is `COMPLETED`:

```sh
# Preferred (2026-04):
shopi read bulkOperations --first 1 --query 'status:completed' \
  --select 'nodes { id status type objectCount fileSize url errorCode }' --json --pretty

# Older alternative (deprecated but functional):
shopi read currentBulkOperation \
  --select 'id status objectCount fileSize url errorCode' --json --pretty
```

Useful `BulkOperation` fields: `id status type objectCount rootObjectCount
fileSize url partialDataUrl errorCode createdAt completedAt`. While `RUNNING`,
`objectCount` ticks up. On `FAILED`, read `errorCode`; `partialDataUrl` may hold
the rows gathered before failure.

### 3. Download the JSONL

When `COMPLETED`, `url` is a signed link to a JSONL file. `shopi` does not
download it (it's plain HTTPS, not GraphQL) — use `curl`:

```sh
# Capture the url, then fetch the file:
URL=$(shopi read bulkOperations --first 1 --query 'status:completed' \
  --select 'nodes { url }' --json | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["bulkOperations"]["nodes"][0]["url"])')
curl -L -o products.jsonl "$URL"
```

**JSONL shape:** one JSON object per line. Child records from nested connections
are flattened onto their own lines and linked to the parent via a `__parentId`
field holding the parent's GID. Example (a product followed by its variants):

```jsonl
{"id":"gid://shopify/Product/1","title":"Tee","handle":"tee","status":"ACTIVE"}
{"id":"gid://shopify/ProductVariant/11","sku":"TEE-S","price":"19.99","__parentId":"gid://shopify/Product/1"}
{"id":"gid://shopify/ProductVariant/12","sku":"TEE-M","price":"19.99","__parentId":"gid://shopify/Product/1"}
```

To reassemble parents with their children, group lines by `__parentId`. (The
`groupObjects: true` arg on `bulkOperationRunQuery` nests children under parents
in the output, but it slows the job and risks timeouts — only use it if you truly
need the grouped format.)

---

## Bulk MUTATION — import / mass-update from JSONL

A bulk mutation runs **one inner mutation per line** of a JSONL file of
variables. You must stage-upload that file first. Steps:

1. Build a **JSONL file of variables** — one JSON object per line, each matching
   the inner mutation's variables exactly.
2. `stagedUploadsCreate` → get an upload `url` + `parameters` (and a returned
   path/key).
3. **`curl` the JSONL** to that storage `url` as a multipart form (this is object
   storage, not GraphQL — `shopi` can't do it).
4. `bulkOperationRunMutation(mutation: "…", stagedUploadPath: "<key>")` with the
   key returned by the upload.
5. Poll exactly like a bulk query; download the **results** JSONL from `url`.

`shopi` handles the GraphQL calls (steps 2, 4, 5). The file upload in step 3 is
the only `curl` part. The full multipart walkthrough (exact form fields, which
parameter becomes `stagedUploadPath`) is in
[`references/jsonl-and-staged-uploads.md`](references/jsonl-and-staged-uploads.md).

### Stage the upload

```sh
shopi write stagedUploadsCreate \
  --arg input='[{"resource":"BULK_MUTATION_VARIABLES","filename":"bulk_vars.jsonl","mimeType":"text/jsonl","httpMethod":"POST"}]' \
  --select 'stagedTargets { url resourceUrl parameters { name value } } userErrors { field message }' \
  --dry-run --json --pretty      # review, then swap --dry-run for --confirm
```

From the response: `stagedTargets[0].url` is where you POST the file, the
`parameters` are the form fields you must include, and the `key` parameter's value
is what you pass as `stagedUploadPath`. See the reference for the exact `curl`.

### Run the bulk mutation

Keep the inner mutation in a file and use `--arg name=@file` for both string args:

```sh
shopi write bulkOperationRunMutation \
  --arg mutation=@tag-mutation.graphql \
  --arg stagedUploadPath='tmp/12345/bulk/abcdef/bulk_vars.jsonl' \
  --select 'bulkOperation { id status } userErrors { field message }' \
  --dry-run --json --pretty      # review, then --confirm
```

`tag-mutation.graphql` (one execution per JSONL line; variables come from the
file):

```graphql
mutation call($id: ID!, $tags: [String!]!) {
  tagsAdd(id: $id, tags: $tags) {
    node { id }
    userErrors { field message }
  }
}
```

Matching `bulk_vars.jsonl` (one object per line, keys == the mutation's variables):

```jsonl
{"id":"gid://shopify/Product/1","tags":["summer","sale"]}
{"id":"gid://shopify/Product/2","tags":["summer"]}
```

The JSONL **must match the inner mutation's variables exactly** — same names,
GIDs where IDs are expected. A mismatch fails per-line (visible in the results
JSONL), not loudly. Check `userErrors` on the run mutation too.

---

## Canceling and webhooks

Cancel a running job (find its GID via the poll query first):

```sh
shopi write bulkOperationCancel --arg id='gid://shopify/BulkOperation/123' \
  --select 'bulkOperation { id status } userErrors { field message }' \
  --dry-run --json --pretty      # then --confirm
```

Instead of polling, you can subscribe to the **`bulk_operations/finish`** webhook
(topic `BULK_OPERATIONS_FINISH`) and react when a job completes:

```sh
shopi write webhookSubscriptionCreate \
  --arg topic=BULK_OPERATIONS_FINISH \
  --arg webhookSubscription='{"uri":"https://example.com/hooks","format":"JSON"}' \
  --select 'webhookSubscription { id } userErrors { field message }' \
  --dry-run --json --pretty      # then --confirm
```

---

## End-to-end examples

**1. Export all products (+ variants) to JSONL.** Start (`shopi gql --file
bulk-export-products.graphql --confirm`), poll `bulkOperations status:completed`,
`curl -L -o products.jsonl "$URL"`. Group lines by `__parentId` to nest variants.

**2. Export all orders from a date range.** Inner query with a search filter:

```graphql
mutation {
  bulkOperationRunQuery(query: """
    { orders(query: "created_at:>=2026-01-01 created_at:<=2026-06-30") {
        edges { node { id name createdAt displayFinancialStatus } } } }
  """) { bulkOperation { id status } userErrors { field message } }
}
```

**3. Export all customers.** Same pattern, inner `{ customers { edges { node { id
email numberOfOrders } } } }`. Then poll + `curl` the `url`.

**4. Bulk-tag thousands of products.** Build `bulk_vars.jsonl` (id + tags per
line) → `stagedUploadsCreate` → `curl` upload → `bulkOperationRunMutation` with
`tag-mutation.graphql` + the returned `stagedUploadPath` → poll → read results
JSONL for per-line `userErrors`.

**5. Bulk price update.** Inner mutation `productVariantsBulkUpdate` (verify args
via `shopi ops show productVariantsBulkUpdate --kind mutation`), JSONL with the
variant/price variables per line, same staged-upload flow.

**6. Bulk-set metafields.** Inner `metafieldsSet(metafields: $metafields)` with a
JSONL line per owner. Confirm the input shape with `shopi schema show
MetafieldsSetInput` and the `shopi-metafields-and-metaobjects` skill.

**7. Watch a long export.** Poll in a loop until terminal:

```sh
shopi read bulkOperations --first 1 --query 'status:running OR status:completed' \
  --select 'nodes { id status objectCount url errorCode }' --json --pretty
```

## Verify with discovery (do this before every job)

Names above are verified for 2026-04, but always confirm against the live schema:

```sh
shopi ops show bulkOperationRunQuery    --kind mutation --json --pretty
shopi ops show bulkOperationRunMutation --kind mutation --json --pretty
shopi ops show stagedUploadsCreate      --kind mutation --json --pretty
shopi schema show BulkOperation         --json --pretty   # fields, status enum
shopi ops show bulkOperations           --kind query    --json --pretty
```

For the inner query/mutation you embed, discover that operation the same way
(`shopi ops show productUpdate --kind mutation`, `shopi schema show
ProductUpdateInput`) so the JSONL variables match exactly. The full JSONL +
staged-upload mechanics live in
[`references/jsonl-and-staged-uploads.md`](references/jsonl-and-staged-uploads.md).
