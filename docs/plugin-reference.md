# Plugin reference

Everything a plugin in this catalog must contain, and the rules CI checks.

The validator is the source of truth: the rules below are enforced by
[`scripts/lib/validate.mjs`](../scripts/lib/validate.mjs), using the values in
[`scripts/lib/constants.mjs`](../scripts/lib/constants.mjs). Run
`node scripts/build-marketplace.mjs` at any time to check your plugin; every
error message links back to the relevant section of this page.

New to the repo? Start with [CONTRIBUTING.md](../CONTRIBUTING.md). The quickest
way to get a valid plugin is the scaffolder:

```bash
node scripts/new-plugin.mjs my-plugin --type mcp      # or: skill, template
```

It writes every file below with `TODO(new-plugin)` placeholders. CI rejects a
plugin until all of them are replaced.

## Plugin layout

One plugin is one top-level folder, named exactly like the manifest's `name`:

```
my-plugin/
├── .fleetify-plugin/
│   └── plugin.json           required: the manifest
├── README.md                 required: what it does, secrets, upstream source
├── CHANGELOG.md              required: Keep a Changelog format
├── mcp.json                  MCP servers, for every agent with an MCP bridge
├── templates/
│   └── <template>.md         agent templates
└── .claude/                  per-agent components (see "Providers")
    ├── skills/<skill>/SKILL.md
    └── commands/<command>.md
```

Per-agent components live under the agent's vendor directory (`.claude/`,
`.codex/`, `.grok/`, …). Root-level `skills/`, `commands/`, `prompts/` or
`hooks/` folders are rejected; Fleet refuses to install them.

Fleet copies the whole folder to users' machines, so keep it to the files
above. Symlinks are rejected, and `plugin.json` and `mcp.json` may be at most
256 KiB each.

## Manifest fields

`.fleetify-plugin/plugin.json`:

| Field | Required | Rules | Example |
| --- | --- | --- | --- |
| `name` | yes | `^[a-z0-9][a-z0-9-]*$`, equal to the folder name, unique | `"github"` |
| `display_name` | yes | Name shown on the Browse card, proper casing | `"GitHub"` |
| `version` | yes | Strict SemVer `X.Y.Z` (see [Versioning](#versioning)) | `"0.1.0"` |
| `description` | yes | One line, at most 120 characters | `"Read issues, PRs and code in any GitHub repo."` |
| `author` | yes | `{ "name": …, "url"?: … }`; `url` must be `https://`. For community plugins, that's you | `{ "name": "Jane Doe", "url": "https://github.com/jane" }` |
| `providers` | yes | Non-empty list of [provider ids](#providers), no duplicates | `["claude-code", "codex-cli"]` |
| `tags` | yes | One or more of `productivity`, `infrastructure`, `data`, `dev` | `["productivity"]` |
| `icon` | yes | An `https://` URL; [Iconify](https://icon-sets.iconify.design/) is recommended, as `https://api.iconify.design/<prefix>/<name>.svg` (the old `<prefix>:<name>.svg` form answers 404). Fleet does not render relative paths | `"https://api.iconify.design/logos/github-icon.svg"` |
| `requires_secrets` | no | See [Secrets](#secrets) | `[]` |
| `declares` | yes | Component counts; see [declares](#declares) | |
| `homepage` | yes | An `https://` URL. For plugins in this repo use `https://github.com/fleetifydev/marketplace/tree/main/<name>` | |
| `license` | yes | An SPDX identifier | `"MIT"` |
| `min_fleetify_version` | no | SemVer; the oldest Fleet version the plugin supports | `"0.5.0"` |

Fleet parses every manifest strictly, and a single bad one would break the
whole catalog. CI therefore also rejects:

- `provides`: Fleet derives it from `declares`.
- Non-integer numbers, such as `1.0`.
- Strings that are not well-formed Unicode.

A complete example: [`github/.fleetify-plugin/plugin.json`](../github/.fleetify-plugin/plugin.json).

## Providers

Provider ids name the coding agents a plugin installs into. Per-agent
components go under the agent's vendor directory:

| Provider id | Vendor directory | Skills | Commands | MCP servers |
| --- | --- | --- | --- | --- |
| `claude-code` | `.claude` | yes | `commands/*.md` | yes |
| `codex-cli` | `.codex` | yes | `prompts/*.md` | yes |
| `kimi-code` | `.kimi` | yes | none | no (no MCP bridge) |
| `opencode` | `.opencode` | yes | `commands/*.md` | yes |
| `github-copilot` | `.github-copilot` | yes | none | yes |
| `cursor-cli` | `.cursor` | yes | none | yes |
| `hermes-agent` | `.hermes` | yes | none | yes |
| `antigravity-cli` | `.agy` | yes | none | yes |
| `grok-build` | `.grok` | yes | none | yes |
| `antigravity-sdk` | none | none | none | yes (MCP only) |

**Recommended `providers` per plugin type** (the scaffolder sets these):

- **MCP plugins:** every id except `kimi-code`.
- **Skill and template plugins:** every id except `antigravity-sdk`.

**Ship skills once.** If a provider's own vendor directory is missing, Fleet
installs the skills from the first vendor directory the plugin ships, in the
order of the table above. A single `.claude/skills/<skill>/SKILL.md` therefore
reaches every agent. Add `.codex/skills/…` and the like only for an
agent-specific variant. Commands work the same way: a provider's own directory
first, otherwise `.claude/commands/`.

## declares

`declares` tells the install dialog what a plugin will add ("1 MCP server,
2 skills, …") before anything touches disk. It also drives the Browse filters.
CI checks that every count matches the files in the plugin.

```json
"declares": {
  "mcp_servers": 1,
  "templates": 0,
  "workflows": 0,
  "prompts": 0,
  "providers": {
    "claude-code": { "skills": 1, "commands": 0, "hooks": 0 }
  }
}
```

| Count | Must equal |
| --- | --- |
| `mcp_servers` | The number of entries in `mcp.json` → `mcpServers`. Ship `mcp.json` only when this is above 0. |
| `templates` | The number of `templates/*.md` files. |
| `providers.<id>.skills` | The number of `<skill>/SKILL.md` folders Fleet installs for that provider (its own vendor directory, otherwise the fallback described under [Providers](#providers)). |
| `providers.<id>.commands` | The number of `*.md` commands Fleet installs for that provider (its own `commands/`, or `prompts/` for Codex, otherwise `.claude/commands/`). Always 0 for providers without commands. |
| `providers.<id>.hooks`, `workflows`, `prompts` | 0. These are [not accepted yet](#not-accepted-yet). |

Only providers listed in `providers` may appear under `declares.providers`, and
a missing entry counts as 0. MCP-only plugins usually use `"providers": {}`.

## mcp.json

MCP servers are defined once and work for every agent with an MCP bridge.

```json
{
  "mcpServers": {
    "github": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "${secret:GITHUB_TOKEN}" }
    }
  }
}
```

A vendor-hosted remote server:

```json
{
  "mcpServers": {
    "neon": { "type": "http", "url": "https://mcp.neon.tech/mcp" }
  }
}
```

Rules:

- **Server ids** must be the plugin's `name`, or start with `<name>-`. All
  plugins' servers share one registry on the user's machine.
- **`type`** is `stdio` or `http`.
- **`stdio` servers launch with `npx` (npm) or `uvx` (PyPI),** and `args` must
  start with the package:
  - `npx`: `["-y", "<package>[@version]", …server args]`. `-y`/`--yes` is the
    only flag allowed before the package.
  - `uvx`: `["<package>[==version]", …]`, or `["--from", "<package>[==version]", "<command>", …]`.

  The package must be a plain npm or PyPI name. Git URLs, tarballs, local
  paths, aliases and custom registries are rejected, as are shell commands,
  `curl`, `docker` and local binaries.
- **`http` servers** need an `https://` `url`. Only the vendor's own endpoint
  for its own service is accepted (see the acceptance criteria in
  [CONTRIBUTING.md](../CONTRIBUTING.md#what-we-accept)).
- **Allowed keys** are `type`, `command`, `args`, `env`, `url` and `headers`,
  and any other key is an error, because Fleet passes every key through to the
  agents. `env` and `headers` are objects of strings.
- **Placeholders:**
  - `${secret:KEY}` is replaced with a secret the user enters at install. See
    [Secrets](#secrets).
  - `${env:HOME}` is the user's home directory, and the only environment
    variable a plugin may read, so a plugin can't send the user's environment
    anywhere.

  No other `${…}` placeholder is allowed.
- **Version pinning is optional.** You can pin with `pkg@1.2.3` (npm) or
  `pkg==1.2.3` (PyPI). The security review flags unpinned packages so
  reviewers can weigh them.

## Secrets

Declare every credential the plugin needs in `requires_secrets`. Each entry
becomes a field in Fleet's install dialog:

```json
"requires_secrets": [
  {
    "key": "GITHUB_TOKEN",
    "label": "GitHub Personal Access Token",
    "url": "https://github.com/settings/tokens"
  }
]
```

- `key` is `UPPER_SNAKE_CASE` and unique within the plugin.
- `label` is what the user sees. `url` (optional, `https://`) links to the page
  where they create the credential.
- Every `${secret:KEY}` in `mcp.json` must be declared here, and a declared key
  that is never used produces a warning.
- Ask for the least privilege that works, and document the required scopes in
  the plugin README. Never commit a real token. Secrets are entered by the user
  at install time and are never stored in this repo.

## Skills

A skill is a folder with a `SKILL.md`:

```markdown
---
name: diff-summarizer
description: Turns a git diff into a concise PR description
---
Instructions the agent follows when the skill is active…
```

Fleet installs it for each agent as `<plugin>-<skill>` and rewrites the
frontmatter `name` to match. Skills are instructions that agents follow, so
reviewers read every line. See [`diff-summarizer`](../diff-summarizer).

## Templates

Agent templates live in `templates/<name>.md`:

```markdown
---
name: code-reviewer
description: Reviews PRs for safety, style, and missing tests
tools: Read, Grep, Glob, Bash
---
You are a senior code reviewer…
```

See [`code-reviewer`](../code-reviewer).

## Not accepted yet

CI currently rejects the following component types, either because Fleet's
support for them is partial or because the manifest cannot declare them yet:

| Component | Path |
| --- | --- |
| Hooks | `.<vendor>/hooks/`, `declares.providers.<id>.hooks` |
| Sub-agents | `.<vendor>/agents/` (ship an agent template in `templates/` instead) |
| Workflows | `workflows/`, `declares.workflows` |
| Fleetify prompts | `.fleetify/prompts/`, `declares.prompts` |

If your plugin needs one of these, open an issue first. Maintainers lift a
restriction in `scripts/lib/` once Fleet supports the component end to end.

## Versioning

Every change to a plugin bumps its `version` following [SemVer](https://semver.org/):

- **Patch** (`0.1.0` → `0.1.1`): a fix, or a docs or metadata tweak with no
  behaviour change.
- **Minor** (`0.1.1` → `0.2.0`): a new capability, a new *optional* secret, or
  additive `declares` (more skills, commands or MCP servers).
- **Major** (`0.2.0` → `1.0.0`): a breaking change. Examples: a removed or
  renamed *required* secret, a changed MCP server name or contract, a removed
  component, or a compatibility-breaking bump to `min_fleetify_version`.

Fleet offers an update whenever the catalog version is newer than the
installed one. Major updates ask the user before applying.

Add a matching `## [X.Y.Z] - YYYY-MM-DD` section to the plugin's `CHANGELOG.md`
in the same change. The format is in
[CHANGELOG_TEMPLATE.md](../CHANGELOG_TEMPLATE.md). A CHANGELOG-only edit needs
no version bump.

## Examples

| Plugin | Shows |
| --- | --- |
| [`github`](../github) | A `stdio` MCP server with a secret |
| [`neon`](../neon) | A vendor-hosted remote (`http`) MCP server, OAuth in the browser |
| [`diff-summarizer`](../diff-summarizer) | A skill, shipped for several agents |
| [`code-reviewer`](../code-reviewer) | An agent template |
