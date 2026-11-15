/**
 * constants.mjs — the single source of truth for marketplace rules.
 *
 * Provider ids, vendor dirs, and fan-out order mirror the Fleet app's plugin
 * installer. When the app adds a provider or component type, update this file
 * first; the validator, scaffolder, security report, and docs all follow it.
 */

/** Manifest location inside a plugin dir (POSIX; also used in messages). */
export const MANIFEST_SUBPATH = ".fleetify-plugin/plugin.json";

/** Every provider id a manifest's `providers` array may name. */
export const KNOWN_PROVIDERS = Object.freeze([
  "claude-code",
  "codex-cli",
  "kimi-code",
  "opencode",
  "github-copilot",
  "cursor-cli",
  "hermes-agent",
  "antigravity-cli",
  "grok-build",
  "antigravity-sdk",
]);

/**
 * Providers whose components (skills, commands, …) install to disk, in the
 * app's fan-out order: when a provider's own vendor dir is missing, the app
 * reads the first of these dirs the plugin ships. `antigravity-sdk` is
 * MCP-only, so it is excluded.
 */
export const COMPONENT_PROVIDERS = Object.freeze(
  KNOWN_PROVIDERS.filter((p) => p !== "antigravity-sdk")
);

/** The `.<vendor>/` dir a plugin uses to ship each provider's components. */
export const VENDOR_DIRS = Object.freeze({
  "claude-code": ".claude",
  "codex-cli": ".codex",
  "kimi-code": ".kimi",
  opencode: ".opencode",
  "github-copilot": ".github-copilot",
  "cursor-cli": ".cursor",
  "hermes-agent": ".hermes",
  "antigravity-cli": ".agy",
  "grok-build": ".grok",
});

/** Providers with a slash-command surface, and the subdir they read. */
export const COMMAND_SUBDIRS = Object.freeze({
  "claude-code": "commands",
  opencode: "commands",
  "codex-cli": "prompts",
});

/** Recommended `providers` per plugin type (kimi-code has no MCP bridge). */
export const PROVIDER_SETS = Object.freeze({
  mcp: Object.freeze(KNOWN_PROVIDERS.filter((p) => p !== "kimi-code")),
  skill: COMPONENT_PROVIDERS,
  template: COMPONENT_PROVIDERS,
});

/** Tags Fleet's Browse page knows how to group. */
export const ALLOWED_TAGS = Object.freeze(["productivity", "infrastructure", "data", "dev"]);

/** Launchers allowed for `stdio` MCP servers (npm and PyPI packages). */
export const ALLOWED_STDIO_COMMANDS = Object.freeze(["npx", "uvx"]);

/** MCP transports the marketplace accepts. */
export const ALLOWED_TRANSPORTS = Object.freeze(["stdio", "http"]);

/** Root-level component dirs from the legacy layout; the app rejects them. */
export const LEGACY_ROOT_DIRS = Object.freeze(["skills", "commands", "prompts", "hooks"]);

/** Max length of a plugin `description` (one line on the Browse card). */
export const DESCRIPTION_MAX = 120;

export const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

// Strict semver: X.Y.Z with optional -prerelease and +build.
// Numeric identifiers (major/minor/patch and numeric pre-release identifiers)
// must not contain leading zeros. Mirrors the official semver.org pattern.
export const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

/** `requires_secrets[].key` format. */
export const SECRET_KEY_RE = /^[A-Z][A-Z0-9_]*$/;

/** Marker the scaffolder leaves in every value a contributor must replace. */
export const SCAFFOLD_MARKER = "TODO(new-plugin)";

export const REFERENCE_DOC_URL =
  "https://github.com/fleetifydev/marketplace/blob/main/docs/plugin-reference.md";

export const MARKETPLACE_TREE_URL = "https://github.com/fleetifydev/marketplace/tree/main";

/** Top-level directory names that are never plugins. */
export const IGNORED_DIRS = new Set([".git", "scripts", "node_modules", "docs"]);
