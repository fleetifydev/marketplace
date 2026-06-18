# Fleetify Marketplace

The official Fleet plugin catalog. Every plugin here ships as a sub-
directory with a `.fleetify-plugin/plugin.json` manifest. The top-level
`marketplace.json` indexes the lot — Fleet's desktop app reads this
file (anonymously from GitHub raw) and renders each card in **Browse**.

## What's inside

- **45 plugins** spanning Infrastructure, Productivity, Data,
  Communication, Search, and Development.
- One folder per plugin (`<slug>/`), each with its own
  `.fleetify-plugin/plugin.json` manifest.
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
└── .codex/                  ← Codex-only skills / prompts / hooks
```

Cross-cutting components (`mcp.json`, `templates/`, `workflows/`) live
at the root because they work on every provider. Per-provider
components live under `.claude/`, `.gemini/`, `.codex/` and the Fleet
installer materializes them into each provider's native paths
(`~/.claude/skills/`, `~/.gemini/commands/`, `~/.codex/prompts/`, …).

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
    "codex":  { "skills": 0, "prompts": 0, "hooks": 0 },
    "gemini": { "skills": 0, "commands": 0, "hooks": 0 }
  }
}
```

Cross-cutting components (`mcp_servers`, `templates`, `workflows`) sit
at the root because they install once per plugin. Per-provider
components nest under `declares.providers.<provider>` because the same
plugin can ship different counts per provider — for example,
Claude-tier skills only. Claude and Gemini use `commands`; Codex uses
`prompts` to match its native `~/.codex/prompts/` directory.

The Fleet installer cross-checks declared counts against the on-disk
files at install time. Mismatches reject the install with a 422 so
broken manifests never enter the registry.

## `marketplace.json` is generated — do not hand-edit

The catalog index at the repo root is a **build artifact**. Each
entry points at a plugin folder and **inlines that plugin's manifest**
so Browse renders without fetching every plugin file individually:

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
Inlining the manifest keeps Browse to a single HTTP call per source and
stays well under GitHub's anonymous 60-req/h limit.

**Single source of truth:** edit `<plugin>/.fleetify-plugin/plugin.json`
only. **Never hand-edit `marketplace.json`** — regenerate it with:

```bash
node scripts/build-marketplace.mjs        # rewrite marketplace.json
node scripts/build-marketplace.mjs --check # verify it's in sync (CI runs this)
```

The editorial header (`name` / `description` / `homepage` / `icon`)
and the curated `featured` list live in
`scripts/marketplace.meta.json`; everything else in `marketplace.json`
is derived from the plugin manifests. CI fails any PR whose
`marketplace.json` doesn't match a fresh regenerate.

## Versioning (SemVer)

Every plugin carries a `version` in its `plugin.json`, and **every
change must bump it** following [SemVer](https://semver.org/):

- **patch** (`0.1.0` → `0.1.1`) — a fix or docs/metadata tweak with no
  behaviour change.
- **minor** (`0.1.1` → `0.2.0`) — a new capability, a new *optional*
  secret, or additive `declares` (more skills/commands/MCP servers).
- **major** (`0.2.0` → `1.0.0`) — a breaking change: a removed or
  renamed *required* secret, a changed MCP server name or contract, a
  removed component, or a compatibility-breaking bump to
  `min_fleetify_version`.

The Fleet app shows an update whenever the catalog version is greater
than the installed version; **major** updates prompt the user before
applying.

## CHANGELOG

Every plugin has a `<plugin>/CHANGELOG.md` in
[Keep a Changelog](https://keepachangelog.com/) format — newest entry
on top, exactly one `## [X.Y.Z] - YYYY-MM-DD` section per released
version. The Fleet app **parses** this file and renders each release on
the plugin's **Changelog** tab as a structured view: a version header,
the date, and your changes grouped under the standard categories —
`### Added`, `### Changed`, `### Deprecated`, `### Removed`, `### Fixed`,
`### Security`.

See **[`CHANGELOG_TEMPLATE.md`](CHANGELOG_TEMPLATE.md)** for the full
format reference and a copy-paste starter.

When you bump a plugin's `version`, add a matching
`## [<new-version>] - <date>` section describing what changed. To
scaffold a baseline `CHANGELOG.md` for newly added plugins (idempotent
— it skips any plugin that already has one):

```bash
node scripts/seed-changelogs.mjs
```

## CI

Every PR runs `.github/workflows/validate.yml`, which:

1. Validates every manifest and checks `marketplace.json` is in sync
   (`build-marketplace.mjs --check`).
2. On pull requests, runs `check-bump.mjs` against the PR base: any
   plugin whose content changed must have **bumped its version** and
   added a **matching `## [X.Y.Z]` CHANGELOG section**. (A
   CHANGELOG-only edit needs no version bump.)

A green check means the PR will install cleanly for end users.

## Add your own

1. **Fork this repo.**
2. Add a new top-level folder `<your-plugin>/`.
3. Drop in `.fleetify-plugin/plugin.json` (copy from any neighbour for
   the schema) plus the component files
   (`mcp.json`, `templates/`, `.claude/skills/`, `.gemini/commands/`, …).
4. Run `node scripts/seed-changelogs.mjs` to scaffold
   `<your-plugin>/CHANGELOG.md`.
5. Run `node scripts/build-marketplace.mjs` to regenerate
   `marketplace.json`.
6. Commit the plugin files, the CHANGELOG, and the regenerated
   `marketplace.json`, then open a pull request.

**Editing an existing plugin?** The author workflow is:

1. Edit the plugin's files.
2. Bump `version` in `<plugin>/.fleetify-plugin/plugin.json` (see
   *Versioning* above).
3. Add a `## [X.Y.Z] - YYYY-MM-DD` section to `<plugin>/CHANGELOG.md`.
4. Run `node scripts/build-marketplace.mjs` to regenerate
   `marketplace.json`.
5. Commit the plugin files **+ CHANGELOG + `marketplace.json`** together
   and open a PR.

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
