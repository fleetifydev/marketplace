# Contributing to the Fleetify Marketplace

Thanks for helping grow the Fleet plugin catalog. This guide covers adding a
new plugin or improving an existing one: what we accept, how to check your
work locally, and how review works.

Everything that merges here can end up running on Fleet users' machines, so
Fleetify maintainers review every pull request, and anything that changes what
runs gets a security review first. The tooling below gives you the same checks
locally, so most problems surface before you open the PR.

**Quick links:** [Plugin reference](docs/plugin-reference.md) ·
[Code of Conduct](CODE_OF_CONDUCT.md) · [Security policy](SECURITY.md)

## What you can contribute

- **New plugins:** MCP servers, skills and agent templates.
- **Improvements to existing plugins:** fixes, new capabilities, support for
  more agents, better docs or metadata.
- **Bug reports and plugin proposals,** through the
  [issue forms](https://github.com/fleetifydev/marketplace/issues/new/choose).
- **Fixes to the docs and tooling** in this repo.

## What we accept

A new plugin needs to meet all of these. Items marked *(CI)* are also checked
automatically.

1. **Useful and not a duplicate.** If a plugin for the service already exists,
   improve that one instead of adding a near-copy.
2. **Open source wherever it runs on the user's machine.** That covers `npx` and
   `uvx` packages, skills and templates, which must be public under an
   OSI-approved license. The repo must not contain binaries, minified or
   obfuscated code, install scripts or symlinks.
3. **A trustworthy MCP source.** In order of preference:
   1. The vendor's official package, or the vendor's own hosted endpoint for
      its own service. A vendor-operated remote endpoint may be closed source,
      because users already trust that vendor with the same data through its
      API.
   2. A widely used, actively maintained, open-source community package with a
      public repository.

   **Community-hosted remote endpoints are not accepted:** they would receive
   users' credentials and data, and nobody can verify their code. Servers
   launch with `npx` (npm) or `uvx` (PyPI), or connect to an `https://`
   endpoint, and `args` must start with a plain npm or PyPI package. Shell
   commands, `curl`, `docker`, git URLs, local paths and custom registries
   are not accepted *(CI)*.
4. **Least privilege.** Ask only for the secrets the plugin needs, prefer
   read-only tokens, and document the scopes in the plugin README.
5. **A useful plugin README.** It says what the plugin does, which secrets it
   needs and where to create them, and links to the upstream source.
6. **Supported component types only.** Hooks, workflows, Fleetify prompts and
   sub-agents are [not accepted yet](docs/plugin-reference.md#not-accepted-yet)
   *(CI)*. Open an issue first if you need one.
7. **You are the author.** Put your own name in `author`. Maintainers may later
   update, feature or remove any plugin. The Featured row
   (`scripts/marketplace.meta.json`) is curated by maintainers, so please don't
   edit it.

## Before you start

- Search [existing issues](https://github.com/fleetifydev/marketplace/issues)
  and [pull requests](https://github.com/fleetifydev/marketplace/pulls) to avoid
  duplicate work.
- **New plugin?** Opening a
  [New plugin proposal](https://github.com/fleetifydev/marketplace/issues/new?template=new_plugin.yml)
  first is recommended but not required. A maintainer can confirm it fits
  before you spend time on it.
- Small fixes, such as a typo or a broken link, can go straight to a pull
  request.

## Setup

You need [Node.js](https://nodejs.org/) 22 or newer and Git. There are no
dependencies to install.

```bash
# Fork https://github.com/fleetifydev/marketplace on GitHub, then:
git clone https://github.com/<you>/marketplace.git
cd marketplace
git remote add upstream https://github.com/fleetifydev/marketplace.git
git switch -c feat/my-plugin
```

## Add a new plugin

1. **Scaffold the folder:**

   ```bash
   node scripts/new-plugin.mjs my-plugin --type mcp    # or: skill, template
   ```

   It asks for the display name, a one-line description and your name, then
   writes a manifest with the recommended providers for the type, a README, a
   CHANGELOG and a stub `mcp.json`, skill or template.

2. **Replace every `TODO(new-plugin)` placeholder.** For an MCP plugin, set the
   package in `mcp.json` and declare its secrets in `requires_secrets`. The
   [plugin reference](docs/plugin-reference.md) describes every field.
3. **Run the [local checks](#check-your-change-locally).**

## Update an existing plugin

1. Make your change.
2. **Bump `version`** in `<plugin>/.fleetify-plugin/plugin.json` following
   [SemVer](docs/plugin-reference.md#versioning):
   - **patch** for fixes and docs;
   - **minor** for new capabilities;
   - **major** for breaking changes, such as a renamed required secret.
3. **Add a `## [X.Y.Z] - YYYY-MM-DD` section** to the plugin's `CHANGELOG.md`
   (format: [CHANGELOG_TEMPLATE.md](CHANGELOG_TEMPLATE.md)). A CHANGELOG-only
   edit needs no version bump.
4. **Run the [local checks](#check-your-change-locally).**

## Check your change locally

```bash
node scripts/build-marketplace.mjs               # validate every plugin, regenerate marketplace.json
git fetch upstream
node scripts/check-bump.mjs upstream/main        # changed plugins bumped version + CHANGELOG
node scripts/security-report.mjs upstream/main   # preview the summary reviewers will see
node --test "scripts/test/*.test.mjs"            # only if you changed scripts/
```

- **Validation output.** `build-marketplace.mjs` lists every problem with the
  file, what is wrong, how to fix it, and a link to the matching section of the
  plugin reference. Warnings don't fail the build, but please address them.
- **`marketplace.json` is generated.** Never edit it by hand. Commit the
  regenerated file together with your plugin changes.

## Test in Fleet (optional, recommended)

CI is the required gate, so you can skip this step if you don't have Fleet.
To try your plugin end to end:

1. Get Fleet at <https://fleetify.dev/download>. Downloads may be behind a
   waitlist before launch.
2. Fleet reads a marketplace from its **default branch**. Push your branch to
   your fork and temporarily make it the fork's default branch
   (**Settings → General → Default branch**).
3. In Fleet, open **Sources → + Add Marketplace**, paste your fork's URL, and
   install your plugin.
4. Check that the MCP server starts and its tools work, or that the skill or
   template shows up for your agents.
5. Remove the source and restore your fork's default branch afterwards.

## Open a pull request

- **Title:** use a [Conventional Commits](https://www.conventionalcommits.org/)
  style, for example `feat(linear): add issue search tool`,
  `fix(postgres): handle SSL URLs` or `feat: add Acme plugin`. This is
  recommended, not enforced; maintainers may adjust the title when merging.
- **Scope:** keep one plugin per pull request where possible.
- **Template:** fill in the pull request template, especially **"What runs on
  users' machines"** for MCP changes.
- **Maintainer edits:** leave **Allow edits by maintainers** on so we can push
  small fixes.

## Review process

1. **CI (`validate`)** runs the plugin validator, checks that
   `marketplace.json` is in sync, checks version bumps and CHANGELOG entries,
   and runs the tooling tests. It must be green. Problems appear inline on your
   diff.
2. **Security summary.** A bot comment lists exactly what your change does on
   users' machines:
   - MCP servers, with their packages and pin status, arguments, endpoints and
     secrets;
   - new secrets or providers;
   - skill and template files that changed;
   - tooling edits.

   It also labels the PR (`new-plugin`, `plugin-update`, `security-review`,
   `tooling`).
3. **Maintainer review.** A Fleetify maintainer must approve before merge.
   Expect questions about the package source, the requested secrets and any
   agent-facing text. Changes to `scripts/` and `.github/` get line-by-line
   review.
4. **Merge.** Pull requests are squash-merged, and plugins update in Fleet once
   the change is on `main`.

## Resolving marketplace.json conflicts

Two open pull requests that both touch plugins will both change
`marketplace.json`. If yours conflicts, don't resolve it by hand. Regenerate it
instead:

```bash
git fetch upstream
git merge upstream/main
node scripts/build-marketplace.mjs   # rewrites marketplace.json from the manifests
git add marketplace.json
git commit
```

## Licensing

- By contributing, you agree that your contribution is licensed under the
  repository's [MIT license](LICENSE), or under the `license` declared by the
  plugin folder you are changing, and that you have the right to submit it.
- Plugins point to upstream packages; don't copy third-party code into this
  repo.

## Code of Conduct and getting help

- Everyone taking part is expected to follow the
  [Code of Conduct](CODE_OF_CONDUCT.md).
- **Questions about the catalog or a plugin:** open an
  [issue](https://github.com/fleetifydev/marketplace/issues/new/choose).
- **Questions about the Fleet app itself:** use <https://fleetify.dev/contact>.
- **Security problems:** please follow [SECURITY.md](SECURITY.md) and never open
  a public issue.
