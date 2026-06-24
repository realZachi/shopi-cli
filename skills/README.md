# shopi CLI — Agent Skills

A pack of [Agent Skills](https://docs.claude.com/en/docs/claude-code/skills) for
driving the [`shopi`](../README.md) CLI — the JSON-first, schema-driven command
line over the Shopify Admin GraphQL API. These skills give coding agents
(Claude Code, the Claude Agent SDK, Claude.ai) the operational knowledge to run,
design, and debug `shopi` commands across the whole Admin API surface.

This pack is part of the open-source `shopi-cli` project (MIT) and is not
affiliated with, endorsed by, or sponsored by Shopify Inc. Shopify is a
trademark of Shopify Inc.

## How the pack is organized

`shopi` is intentionally thin: it doesn't hardcode resource commands, it reads
the live Admin schema and lets you address every QueryRoot and MutationRoot
field. So the pack has one **hub** skill that teaches the CLI mechanics
(discovery, `read`/`write`/`gql`, flags, output, write safety) and a set of
**domain** skills that layer the Shopify Admin field/mutation/input knowledge for
a specific area on top of it.

Start with the hub; load a domain skill when the task is specific.

| Skill | Use it when you want to… |
| --- | --- |
| [`shopi-cli-usage`](shopi-cli-usage/SKILL.md) | **(hub)** run/design/debug any `shopi` command, discover fields, read/write/gql, output formats, GIDs, pagination, write safety |
| [`shopi-auth-and-profiles`](shopi-auth-and-profiles/SKILL.md) | authenticate, set up credentials/scopes, manage global/local profiles, run in CI, debug 401/403 and auth errors |
| [`shopi-products-and-collections`](shopi-products-and-collections/SKILL.md) | create/update products & variants & options, attach media, publish to channels, manage collections, search the catalog |
| [`shopi-orders-and-fulfillment`](shopi-orders-and-fulfillment/SKILL.md) | list/update orders, fulfill & add tracking, hold/move fulfillment orders, draft orders, returns & refunds |
| [`shopi-customers`](shopi-customers/SKILL.md) | find/create/update customers, tags & addresses, marketing consent, customer segments, B2B companies |
| [`shopi-inventory-and-locations`](shopi-inventory-and-locations/SKILL.md) | set/adjust/move stock, check quantities per location, update cost/tracking, manage locations, reconcile inventory |
| [`shopi-metafields-and-metaobjects`](shopi-metafields-and-metaobjects/SKILL.md) | read/set metafields, create metafield definitions, model and reference metaobjects (custom data) |
| [`shopi-discounts-and-pricing`](shopi-discounts-and-pricing/SKILL.md) | create code/automatic discounts (amount, %, BXGY, free shipping), bulk codes, B2B price lists & markets |
| [`shopi-bulk-operations`](shopi-bulk-operations/SKILL.md) | export/import at scale with bulk operations + JSONL instead of paginating, staged uploads, polling |

Each skill is self-contained: a `SKILL.md` (the instructions) plus, where useful,
a `references/` folder with longer lookup material that is read only when needed.

## Install

These are standard Claude Code skills. Install them by copying each skill
directory to a skills location Claude Code reads:

- **Personal (available in every project):** `~/.claude/skills/`
- **Project (shared with your repo via git):** `<your-repo>/.claude/skills/`

```sh
# Personal install of the whole pack:
mkdir -p ~/.claude/skills
cp -R skills/shopi-* ~/.claude/skills/

# …or just the ones you need:
cp -R skills/shopi-cli-usage skills/shopi-products-and-collections ~/.claude/skills/
```

If you use the community [`skills`](https://github.com/obra/skills) CLI, you can
also add the pack directly from the repo:

```sh
npx skills add <your-github-user>/shopi-cli
```

Restart Claude Code (or start a new session) after installing so the new skills
are picked up. They trigger automatically when a request matches a skill's
description — you don't need to name them.

## Design principles these skills follow

- **Discover, then act.** The live schema is the source of truth. Skills lead with
  `shopi ops show <field>` and `shopi schema show <Type>` rather than memorizing
  argument shapes that drift between API versions.
- **Preview, then commit.** Every write is shown with `--dry-run` first, then
  re-run with `--confirm`. Mutations never run without `--confirm`.
- **Check `userErrors`.** A `200` response with non-empty `userErrors` means the
  mutation did not apply — examples always select and inspect them.
- **JSON for machines.** Examples pass `--json` for anything parsed downstream;
  tables/markdown are for humans.

Verified against Shopify Admin API version `2026-04`.
