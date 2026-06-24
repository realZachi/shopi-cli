# JSONL & staged uploads — bulk operation deep dive

Companion to `../SKILL.md`. Names below are verified against the Shopify Admin
GraphQL API **version 2026-04**. The store's live schema remains the source of
truth — confirm with `shopi ops show <name>` and `shopi schema show <Type>`.
`shopi` runs every GraphQL call here; the only non-GraphQL step is the multipart
file upload, which goes through `curl` to a storage URL.

---

## Part A — JSONL result format (exports)

A completed bulk **query** writes a JSONL file (download via the `url` field with
`curl`). Rules:

- **One JSON object per line.** No surrounding array, no commas between lines.
- **Connections are flattened.** Each nested-connection node gets its own line.
- **`__parentId`** links a child line to its parent's GID. Top-level objects have
  no `__parentId`.
- **Order:** a parent generally appears before its children, but do not rely on
  strict global ordering — group by `__parentId` rather than by position.

Example for `{ products { edges { node { id title variants { edges { node { id sku } } } } } } }`:

```jsonl
{"id":"gid://shopify/Product/1","title":"Tee"}
{"id":"gid://shopify/ProductVariant/11","sku":"TEE-S","__parentId":"gid://shopify/Product/1"}
{"id":"gid://shopify/ProductVariant/12","sku":"TEE-M","__parentId":"gid://shopify/Product/1"}
{"id":"gid://shopify/Product/2","title":"Hat"}
{"id":"gid://shopify/ProductVariant/21","sku":"HAT-OS","__parentId":"gid://shopify/Product/2"}
```

Reassemble parents + children (no extra deps):

```sh
python3 - products.jsonl <<'PY'
import json, sys, collections
parents, children = {}, collections.defaultdict(list)
for line in open(sys.argv[1]):
    o = json.loads(line)
    (children[o["__parentId"]].append(o) if "__parentId" in o else parents.__setitem__(o["id"], o))
for pid, p in parents.items():
    p["_children"] = children.get(pid, [])
    print(json.dumps(p))
PY
```

`groupObjects: true` on `bulkOperationRunQuery` makes Shopify nest children under
parents in the output instead of using `__parentId`. It slows the job and raises
timeout risk — only enable it if you genuinely depend on the grouped shape.

---

## Part B — JSONL variables format (imports)

A bulk **mutation** runs the inner mutation **once per line**, taking that line as
the variables object. Rules:

- **One object per line**, keys == the inner mutation's variable names.
- **Match the variable types exactly** — GIDs where `ID!` is expected, arrays
  where `[String!]!` is expected, nested input objects spelled exactly as the
  input type defines them.
- Verify the inner mutation's variables with `shopi ops show <mutation> --kind
  mutation` and `shopi schema show <InputType>` before writing the file.

For `mutation call($input: ProductUpdateInput!) { productUpdate(product: $input) { product { id } userErrors { field message } } }`:

```jsonl
{"input":{"id":"gid://shopify/Product/1","tags":["summer"]}}
{"input":{"id":"gid://shopify/Product/2","status":"DRAFT"}}
```

A line whose shape doesn't match fails for that line only; the failure shows up in
the **results** JSONL (download from the job's `url`), not as a top-level error.
Always scan the results JSONL for per-line `userErrors`.

---

## Part C — staged upload + run (full import flow)

### 1. Create the staged upload target

```sh
shopi write stagedUploadsCreate \
  --arg input='[{"resource":"BULK_MUTATION_VARIABLES","filename":"bulk_vars.jsonl","mimeType":"text/jsonl","httpMethod":"POST"}]' \
  --select 'stagedTargets { url resourceUrl parameters { name value } } userErrors { field message }' \
  --confirm --json --pretty
```

- `resource: BULK_MUTATION_VARIABLES` is the enum for bulk-mutation variable
  files. `mimeType: "text/jsonl"`, `httpMethod: POST`.
- Response gives `stagedTargets[0]`:
  - `url` — the storage endpoint you POST the file to.
  - `parameters` — name/value form fields you MUST include in the POST, in order.
  - among `parameters` is a **`key`** field; **its value is the `stagedUploadPath`**
    you pass to `bulkOperationRunMutation`.

### 2. Upload the JSONL with curl (the only non-shopi step)

This is object storage (e.g. Google Cloud Storage), not GraphQL, so it's a
multipart `curl`. Send every returned parameter as a `-F` field first, then the
file last as `-F "file=@bulk_vars.jsonl"`:

```sh
# Pseudo-pattern — substitute the real url and parameters from step 1.
curl -X POST "<stagedTargets[0].url>" \
  -F "key=<value of key parameter>" \
  -F "<param2.name>=<param2.value>" \
  -F "<param3.name>=<param3.value>" \
  # ... one -F per returned parameter, in order ...
  -F "file=@bulk_vars.jsonl"
```

The exact parameter list varies by storage backend and changes over time — read
them from the `stagedUploadsCreate` response, do not hardcode. For the canonical
multipart example see shopify.dev:
<https://shopify.dev/docs/api/usage/bulk-operations/imports> and
<https://shopify.dev/docs/api/admin-graphql/2026-04/mutations/stagedUploadsCreate>.

### 3. Run the bulk mutation with the returned key

```sh
shopi write bulkOperationRunMutation \
  --arg mutation=@inner-mutation.graphql \
  --arg stagedUploadPath='<value of the key parameter>' \
  --select 'bulkOperation { id status } userErrors { field message }' \
  --confirm --json --pretty
```

### 4. Poll, then read results

```sh
shopi read bulkOperations --first 1 --query 'status:completed' \
  --select 'nodes { id status objectCount url errorCode }' --json --pretty
# COMPLETED → curl the url for the per-line results JSONL.
```

---

## BulkOperation fields & status (2026-04)

Select any of these on `BulkOperation`:

| field | meaning |
| --- | --- |
| `id` | GID (`gid://shopify/BulkOperation/...`) |
| `status` | see enum below |
| `type` | `QUERY` or `MUTATION` |
| `objectCount` | running total of processed objects |
| `rootObjectCount` | root-level objects only (nested queries) |
| `fileSize` | bytes of the result file |
| `url` | signed JSONL download link (expires in 7 days) |
| `partialDataUrl` | partial results if it FAILED mid-run |
| `errorCode` | failure reason (`BulkOperationErrorCode`) |
| `createdAt` / `completedAt` | timestamps |

`BulkOperationStatus` values: `CREATED`, `RUNNING`, `COMPLETED`, `FAILED`,
`CANCELING`, `CANCELED`, `EXPIRED`. Terminal states to stop polling on:
`COMPLETED`, `FAILED`, `CANCELED`, `EXPIRED`.

Concurrency: one bulk **query** and one bulk **mutation** may run at once per
shop, but not two of the same kind. Starting a second of the same kind returns a
`userErrors` entry on the run mutation. Cancel an in-flight job with
`bulkOperationCancel(id: …)`.

---

## Verify everything against the live schema

```sh
shopi ops show bulkOperationRunQuery    --kind mutation --json --pretty
shopi ops show bulkOperationRunMutation --kind mutation --json --pretty
shopi ops show stagedUploadsCreate      --kind mutation --json --pretty
shopi ops show bulkOperationCancel      --kind mutation --json --pretty
shopi ops show bulkOperations           --kind query    --json --pretty
shopi schema show BulkOperation         --json --pretty
shopi schema show StagedUploadInput     --json --pretty
shopi schema show StagedMediaUploadTarget --json --pretty
```
