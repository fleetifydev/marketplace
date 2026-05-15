# Fleetify Marketplace

The official Fleet plugin catalog. Every plugin here ships as a sub-
directory with a `.fleetify-plugin/plugin.json` manifest. The top-level
`marketplace.json` indexes the lot — Fleet's desktop app reads this
file (anonymously from GitHub raw) and renders each card in **Browse**.

## What's inside

- **44 plugins** spanning Infrastructure, Productivity, Data,
  Communication, Search, and Development.
- One folder per plugin (`<slug>/`).
- `marketplace.json` with inline manifests so the desktop app can list
  every card in a single HTTP request.

## Add your own

1. Fork this repo.
2. Add a new top-level folder `<your-plugin>/`.
3. Inside, drop a `.fleetify-plugin/plugin.json` (see any existing plugin
   for the schema) and the component files (`mcp.json`, `skills/`,
   `templates/`, etc).
4. Add an entry to `marketplace.json` under `plugins[]`.
5. Open a pull request.

Fleet's review process is the same as Cursor's: open-source-only, no
binary blobs, no obfuscated install scripts. Reviewers verify the
manifest counts match the on-disk files and that no `setup.sh` runs
arbitrary code at install time.

## Self-hosting

You don't need this repo to be the source of your plugins — any
GitHub repo with the same shape works. In Fleet desktop:
**Sources → + Add Marketplace → paste your repo URL.**

## License

The catalog itself is MIT. Each plugin folder may declare its own
license in its manifest; please respect them.
