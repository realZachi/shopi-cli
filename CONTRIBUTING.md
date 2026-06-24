# Contributing

Thanks for improving `shopi-cli`.

## Setup

```sh
bun install
bun run check
```

## Development rules

- Prefer Bun commands over npm commands.
- Keep runtime dependencies small. The CLI currently has no runtime
  dependencies.
- Keep output scriptable. JSON output should remain stable and suitable for
  agents and CI.
- Do not log or snapshot Shopify access tokens.
- Add tests for argument parsing, operation building, and user-facing behavior.

## Release checklist

```sh
bun run check
bun run build
shopi --help
```

Update `README.md`, `docs/COMMANDS.md`, and examples when command behavior
changes.
