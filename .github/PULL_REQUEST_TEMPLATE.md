<!--
Thanks for contributing! Please read the contributing guide first:
https://github.com/fleetifydev/marketplace/blob/main/CONTRIBUTING.md
-->

## What does this PR do?

<!-- One or two sentences. Link the issue if there is one, e.g. "Closes #123". -->

## Type of change

- [ ] New plugin
- [ ] Update to an existing plugin
- [ ] Bug fix
- [ ] Docs
- [ ] Tooling / CI

## What runs on users' machines

<!--
Required for new plugins and for any change to mcp.json, skills or templates.
Delete this section otherwise.
-->

- **Package or endpoint:** <!-- e.g. npm `@scope/server`, PyPI `mcp-server-x`, or https://mcp.vendor.com/mcp -->
- **Source repository and license:** <!-- link + SPDX id; "closed source (vendor-hosted)" for an official endpoint -->
- **Official or community:** <!-- official vendor package/endpoint, or community package and why this one -->
- **Secrets requested and their scopes:** <!-- e.g. GITHUB_TOKEN: read-only repo access; or "none" -->

## Checklist

- [ ] The plugin meets the [acceptance criteria](https://github.com/fleetifydev/marketplace/blob/main/CONTRIBUTING.md#what-we-accept)
- [ ] I ran `node scripts/build-marketplace.mjs` (no errors) and committed the regenerated `marketplace.json`
- [ ] Every plugin I changed has a bumped `version` and a matching `CHANGELOG.md` section
- [ ] No tokens, secrets or personal data are committed
- [ ] Tested in Fleet (optional; say how below)

## Notes for reviewers

<!-- How you tested, trade-offs, anything a reviewer should look at closely. -->
