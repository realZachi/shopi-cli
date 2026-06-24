# Security

## Supported versions

Security fixes target the latest released version of `shopi-cli`.

## Reporting a vulnerability

Open a private security advisory in the repository, or contact the maintainers
through the published project channels. Do not include live Shopify access
tokens in reports.

## Token handling

`shopi` stores profile config with file mode `0600` where the operating system
supports it. Local config lives in `./.shopi/config.json`; global config lives
under `~/.config/shopi/config.json` or `$XDG_CONFIG_HOME/shopi/config.json`.

Never commit `config.json`, `.env`, or command transcripts containing Admin API
tokens.

## Operational safety

Mutation commands require `--confirm`. Shopify still enforces Admin API scopes,
so use the least-privileged token that can perform the workflow.
