# Plugin CHANGELOG format

Every plugin ships a `<plugin>/CHANGELOG.md` in
[Keep a Changelog](https://keepachangelog.com/) format. Fleet's desktop
app **parses** this file and renders it as a structured, per-version view
on the plugin's **Changelog** tab — a version header, the date, and your
changes grouped under labeled categories. Following this template exactly
is what makes your changelog render cleanly; a file that doesn't match the
format still shows, but as raw text.

Copy the starter below into a new plugin's `CHANGELOG.md` (or run
`node scripts/seed-changelogs.mjs` to scaffold a baseline), then edit.

## Starter

```markdown
# Changelog

All notable changes to this plugin are documented in this file.
Format: [Keep a Changelog](https://keepachangelog.com/). Versioning: [SemVer](https://semver.org/).

## [0.1.0] - 2026-06-18

### Added
- Initial release.
```

## Rules

- **One section per released version, newest on top:**
  `## [X.Y.Z] - YYYY-MM-DD`. The square brackets around the version and
  the ISO date are the shape Fleet parses — keep them.
- **Bump and document together.** When you bump `version` in
  `.fleetify-plugin/plugin.json`, add a matching `## [X.Y.Z]` section
  here. CI enforces this (see the repo README's *CI* section); a
  CHANGELOG-only edit needs no version bump.
- **Group changes under the standard categories** (omit any you don't
  need). Fleet renders each as a labeled group:

  | Category         | Use for                                  |
  | ---------------- | ---------------------------------------- |
  | `### Added`      | New features / capabilities.             |
  | `### Changed`    | Changes to existing behavior.            |
  | `### Deprecated` | Soon-to-be-removed features.             |
  | `### Removed`    | Removed features.                        |
  | `### Fixed`      | Bug fixes.                               |
  | `### Security`   | Vulnerability fixes.                     |

- **One change per bullet** (`- …`) under a category. Inline markdown —
  links, `code`, **bold** — is preserved in the rendered view.
- The top `# Changelog` heading and the two intro lines are boilerplate.
  Fleet strips them from the rendered view, but keep them so the raw file
  stays self-describing.

## Example — multiple versions

```markdown
## [0.2.0] - 2026-06-18

### Added
- Per-plugin auto-update toggle.

### Fixed
- Crash when the manifest declared zero components.

## [0.1.0] - 2026-06-17

### Added
- Initial release.
```
