/**
 * issues.mjs — printing validation issues for humans and for GitHub Actions.
 *
 * @typedef {{ level: "error"|"warning", file: string, message: string }} Issue
 */

/**
 * @param {Issue[]} issues
 * @returns {boolean}
 */
export function hasErrors(issues) {
  return issues.some((i) => i.level === "error");
}

/**
 * Print issues grouped by plugin (first path segment) to stderr, then a
 * one-line summary. Prints nothing when there are no issues.
 * @param {Issue[]} issues
 */
export function printIssues(issues) {
  if (issues.length === 0) return;
  const groups = new Map();
  for (const issue of issues) {
    const key = issue.file.split("/")[0];
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(issue);
  }
  for (const [key, list] of groups) {
    process.stderr.write(`\n${key}\n`);
    for (const i of list) {
      process.stderr.write(`  ${i.level === "error" ? "ERROR" : "WARN "}  ${i.file}: ${i.message}\n`);
    }
  }
  const errors = issues.filter((i) => i.level === "error").length;
  const warnings = issues.length - errors;
  process.stderr.write(`\n${errors} error(s), ${warnings} warning(s)\n`);
}

// Workflow-command escaping, per GitHub's toolkit (core/command.ts).
const escapeData = (s) => String(s).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
const escapeProperty = (s) => escapeData(s).replace(/:/g, "%3A").replace(/,/g, "%2C");

/**
 * Emit `::error file=…::msg` / `::warning file=…::msg` annotations so issues
 * show inline on the PR diff. No-op outside GitHub Actions.
 * @param {Issue[]} issues
 */
export function emitGithubAnnotations(issues) {
  if (process.env.GITHUB_ACTIONS !== "true") return;
  for (const i of issues) {
    const cmd = i.level === "error" ? "error" : "warning";
    process.stdout.write(`::${cmd} file=${escapeProperty(i.file)}::${escapeData(i.message)}\n`);
  }
}
