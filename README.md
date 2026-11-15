# Fleetify Marketplace

The official Fleet plugin catalog. Every plugin here ships as a sub-
directory with a `.fleetify-plugin/plugin.json` manifest. The top-level
`marketplace.json` indexes the lot — Fleet's desktop app reads this
file (anonymously from GitHub raw) and renders each card in **Browse**.

## What's inside

- MCP servers, skills and agent templates spanning Infrastructure,
  Productivity, Data, Communication, Search, and Development.
- One folder per plugin (`<name>/`), each with its own
  `.fleetify-plugin/plugin.json` manifest, `README.md` and
  `CHANGELOG.md`.
- `marketplace.json` — a **generated** index with **inline manifests**
  so the desktop app can list every card in a single HTTP request — no
  per-plugin fetch loop, no GitHub anonymous rate-limit pain. Build it
  with `node scripts/build-marketplace.mjs`; never hand-edit it.
- Featured rotation driven by the `featured` list in
  `scripts/marketplace.meta.json` (surfaced as `featured: true` per
  entry in `marketplace.json`); the rest grouped by `tags` into Browse
  rows.

### At a glance

| Category       | Examples                                                  |
| -------------- | --------------------------------------------------------- |
| Infrastructure | AWS, Cloudflare, Docker, Kubernetes, Vercel, Stripe       |
| Data           | PostgreSQL, MongoDB, Redis, SQLite, Snowflake, Pinecone   |
| Productivity   | GitHub, GitLab, Linear, Jira, Notion, Figma, Slack        |
| Communication  | Discord, Gmail, Twilio, SendGrid                          |
| Search & Web   | Brave Search, Tavily, Perplexity, Fetch                   |
| Workflow       | Code Reviewer, Diff Summarizer, No Mocks Rule             |

## Using a plugin

In Fleet, open **Browse**, pick a plugin and click **Get**. Plugins
that need credentials ask for them in the install dialog; one install
reaches every coding agent the plugin supports.

## Contributing

Contributions are welcome — add a new plugin or improve an existing
one.

- **[CONTRIBUTING.md](CONTRIBUTING.md)** — what we accept, the local
  checks, and how review works.
- **[docs/plugin-reference.md](docs/plugin-reference.md)** — the plugin
  format: manifest fields, providers, `declares`, `mcp.json`, secrets,
  versioning.
- **[CHANGELOG_TEMPLATE.md](CHANGELOG_TEMPLATE.md)** — the per-plugin
  changelog format Fleet renders.

Quick start:

```bash
node scripts/new-plugin.mjs my-plugin --type mcp   # scaffold (or: skill, template)
node scripts/build-marketplace.mjs                 # validate + regenerate marketplace.json
```

Every pull request is checked by CI and reviewed by Fleetify
maintainers, with a security review for anything that runs on users'
machines. Please read the [Code of Conduct](CODE_OF_CONDUCT.md), and
report vulnerabilities privately as described in
[SECURITY.md](SECURITY.md).

## Self-hosting

You don't need this repo to be the source of your plugins — any
public GitHub repo with the same shape (a top-level
`marketplace.json`, or a single `.fleetify-plugin/plugin.json` for a
one-plugin marketplace) works. In Fleet desktop:
**Sources → + Add Marketplace → paste your repo URL.** Fleet reads the
repo's **default branch**.

Private team marketplaces follow the same recipe — host the repo
inside your org, share the URL with your team, and every member adds
it as their own source. No central registration step, no Fleet-side
gatekeeping.

## License

The catalog itself is MIT. Each plugin folder may declare its own
license in its manifest; please respect them.
