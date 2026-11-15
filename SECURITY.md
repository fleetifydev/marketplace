# Security policy

Plugins in this catalog run code on Fleet users' machines (MCP servers) and give
instructions to their agents (skills and templates). We take reports about
them seriously.

## Scope

Please report:

- **A malicious or compromised plugin,** or a compromised upstream package or
  endpoint that a plugin uses.
- **A manifest that leaks secrets,** or one that asks for far more access than
  the plugin needs.
- **Vulnerabilities in this repository's scripts or GitHub workflows.**

Out of scope, and where to go instead:

- **Vulnerabilities in the Fleet app itself:** email
  [security@fleetify.dev](mailto:security@fleetify.dev).
- **Bugs in an upstream MCP server:** report them to that project. Tell us too
  if you think the catalog should pull the plugin until it's fixed.

## Reporting a vulnerability

**Please do not open a public issue or pull request.**

1. **Preferred:** report it privately through GitHub at
   <https://github.com/fleetifydev/marketplace/security/advisories/new>.
2. **Alternatively:** email [security@fleetify.dev](mailto:security@fleetify.dev).

Please include:

- the plugin and its version (from `.fleetify-plugin/plugin.json`);
- what you found and why it matters;
- steps to reproduce, or a proof of concept;
- any suggested fix.

## What to expect

- **Acknowledgement within 3 business days.**
- **Updates** as we investigate, and a heads-up before anything is published.
- **Credit** in the advisory if you'd like it.

## When a plugin is pulled

If a plugin turns out to be malicious or compromised, maintainers remove it from
the catalog, or revert it to a known-good version. We then publish a
[GitHub Security Advisory](https://github.com/fleetifydev/marketplace/security/advisories)
that tells affected users how to uninstall it and rotate any credentials they
entered.

## Supported versions

Only the current `main` branch of this catalog is supported. Fixes ship as new
plugin versions.
