# Fleetify Marketplace

The official Fleet plugin catalog. Every plugin here ships as a sub-
directory with a `.fleetify-plugin/plugin.json` manifest. The top-level
`marketplace.json` indexes the lot — Fleet's desktop app reads this
file (anonymously from GitHub raw) and renders each card in **Browse**.

## What's inside

- **44 plugins** spanning Infrastructure, Productivity, Data,
  Communication, Search, and Development.
- One folder per plugin (`<slug>/`), each with its own
  `.fleetify-plugin/plugin.json` manifest.
- `marketplace.json` with **inline manifests** so the desktop app can
  list every card in a single HTTP request — no per-plugin fetch loop,
  no GitHub anonymous rate-limit pain.
- Featured rotation driven by `marketplace.json` `featured: true`
  flags; the rest grouped by `tags` into Browse rows.

### At a glance

| Category       | Examples                                                  |
| -------------- | --------------------------------------------------------- |
| Infrastructure | AWS, Cloudflare, Docker, Kubernetes, Vercel, Stripe       |
| Data           | PostgreSQL, MongoDB, Redis, SQLite, Snowflake, Pinecone   |
| Productivity   | GitHub, GitLab, Linear, Jira, Notion, Figma, Slack        |
| Communication  | Discord, Gmail, Twilio, SendGrid                          |
| Search & Web   | Brave Search, Tavily, Perplexity, Fetch                   |
| Workflow       | Code Reviewer, Diff Summarizer, No Mocks Rule             |

## Repo layout

Every plugin folder follows the auto-discovery convention from the
foundation spec — Fleet picks up files by location, the manifest just
declares counts.

```
<plugin>/
├── .fleetify-plugin/
│   └── plugin.json          ← required manifest
├── README.md
├── icon.png                 ← optional; an Iconify URL also works
├── mcp.json                 ← cross-provider MCP server definition
├── templates/               ← cross-provider agent templates
├── workflows/               ← cross-provider workflow definitions
├── .claude/                 ← Claude-only skills / commands / hooks
├── .gemini/                 ← Gemini-only skills / commands / hooks
└── .codex/                  ← Codex-only skills / hooks (no commands)
```

Cross-cutting components (`mcp.json`, `templates/`, `workflows/`) live
at the root because they work on every provider. Per-provider
components live under `.claude/`, `.gemini/`, `.codex/` and the Fleet
installer materializes them into each provider's native paths
(`~/.claude/skills/`, `~/.gemini/commands/`, `~/.codex/hooks.json`, …).

## Manifest schema

The minimum viable `.fleetify-plugin/plugin.json`:

```json
{
  "name": "github",
  "display_name": "GitHub",
  "version": "0.1.0",
  "description": "Read issues, PRs, file contents, and search any GitHub repo.",
  "author": { "name": "Fleetify", "url": "https://github.com/fleetifydev" },
  "providers": ["claude", "codex", "gemini"],
  "tags": ["productivity", "infrastructure"],
  "icon": "https://api.iconify.design/logos:github-icon.svg",
  "requires_secrets": [
    { "key": "GITHUB_TOKEN", "label": "GitHub Personal Access Token",
      "url": "https://github.com/settings/tokens" }
  ],
  "declares": { ... },
  "homepage": "https://github.com/fleetifydev/marketplace/tree/main/github",
  "license": "MIT"
}
```

Field rules worth knowing:

- **`name`** — slug, `^[a-z0-9][a-z0-9-]*$`, unique across the
  marketplace. Used as the install ID and the namespace prefix when
  components materialize into provider tiers.
- **`display_name`** — human-readable name the UI shows. Use proper
  casing (`GitHub`, `PostgreSQL`, `MongoDB`) — not the slug.
- **`providers`** — explicit array of `"claude" | "codex" | "gemini"`.
  No `"all"` sentinel; if a plugin only works on one provider, list
  just that one.
- **`requires_secrets`** — each entry triggers a form field in the
  install dialog. Pass `url` so users can jump straight to the issuer
  page.
- **`tags`** — drive Browse-page categorization.
- **`icon`** — local path or absolute URL. We default to Iconify
  (`https://api.iconify.design/logos:<name>.svg`) for crisp colored
  logos on every screen size.

### The `declares` block

Counts of what the plugin ships, used by the install dialog to show a
preview ("This plugin will add 1 MCP server, 3 skills, …") before any
files touch disk:

```json
"declares": {
  "mcp_servers": 1,
  "templates": 0,
  "workflows": 0,
  "providers": {
    "claude": { "skills": 0, "commands": 0, "hooks": 0 },
    "codex":  { "skills": 0, "commands": 0, "hooks": 0 },
    "gemini": { "skills": 0, "commands": 0, "hooks": 0 }
  }
}
```

Cross-cutting components (`mcp_servers`, `templates`, `workflows`) sit
at the root because they install once per plugin. Per-provider
components (`skills`, `commands`, `hooks`) nest under
`declares.providers.<provider>` because the same plugin can ship
different counts per provider — for example, Claude-tier skills only.

The Fleet installer cross-checks declared counts against the on-disk
files at install time. Mismatches reject the install with a 422 so
broken manifests never enter the registry.

> **Note:** `providers.codex.commands` must be `0`. Codex custom
> prompts are deprecated upstream — ship Codex commands as skills
> instead.

## `marketplace.json`

The catalog index at the repo root. Each entry points at a plugin
folder and may **inline its manifest** so Browse renders without
fetching every plugin file individually:

```json
{
  "name": "Fleetify Official",
  "description": "Curated plugins by the Fleetify team.",
  "homepage": "https://github.com/fleetifydev/marketplace",
  "icon": "icon.png",
  "plugins": [
    {
      "path": "github",
      "featured": true,
      "manifest": { "name": "github", "display_name": "GitHub", "...": "..." }
    }
  ]
}
```

`featured: true` lifts a plugin into the Browse "Featured" hero row.
The inline `manifest` block is optional but **strongly recommended**
for repos with more than a handful of plugins — it keeps Browse to a
single HTTP call per source and stays well under GitHub's anonymous
60-req/h limit.

## Add your own

1. **Fork this repo.**
2. Add a new top-level folder `<your-plugin>/`.
3. Drop in `.fleetify-plugin/plugin.json` (copy from any neighbour for
   the schema) plus the component files
   (`mcp.json`, `templates/`, `.claude/skills/`, `.gemini/commands/`, …).
4. Add a matching entry to `marketplace.json` under `plugins[]`. Inline
   the manifest if you want Browse to render your card without an
   extra fetch.
5. Open a pull request.

Fleet's review process is the same as Cursor's: open-source-only, no
binary blobs, no obfuscated install scripts. Reviewers verify that
manifest counts match the on-disk files and that no `setup.sh` runs
arbitrary code at install time. CI runs the same validation a fresh
Fleet install would, so a green check means it'll install cleanly for
end users.

## Self-hosting

You don't need this repo to be the source of your plugins — any
public GitHub repo with the same shape (a top-level
`marketplace.json`, or a single `.fleetify-plugin/plugin.json` for a
one-plugin marketplace) works. In Fleet desktop:
**Sources → + Add Marketplace → paste your repo URL.**

Private team marketplaces follow the same recipe — host the repo
inside your org, share the URL with your team, and every member adds
it as their own source. No central registration step, no Fleet-side
gatekeeping.

## License

The catalog itself is MIT. Each plugin folder may declare its own
license in its manifest; please respect them.
