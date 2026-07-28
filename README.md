# Coloured Folders

A Thunderbird extension that colours the **whole folder row** (background
and name label) in the folder pane, not just the folder icon, so you can
spot the folder you want at a glance while scrolling. Colouring a folder
colours all of its subfolders too, unless a subfolder is given its own
override colour.

## Why this exists

Thunderbird has a built-in "icon colour" picker (folder Properties), but
it only recolours the small icon glyph. Every older add-on that coloured
the full row background (Colored Folders, Color Folders, Account Colors)
was built on the legacy XUL-overlay extension system, which Thunderbird
removed entirely when it moved to WebExtensions (TB74-78), and none were
ported forward. Thunderbird's folder pane was then rewritten again in
TB115 ("Supernova") into a virtualized HTML component. This extension is
a fresh WebExtension (MailExtension) targeting that current architecture.

## How it works

- **`menus` API** (public, stable): adds a "Folder colour" entry to the
  folder pane's right-click menu — preset swatches, a custom colour
  picker, and "Clear colour".
- **`browser.storage.local`**: stores explicit colour assignments, keyed
  by `accountId + path` (the most stable folder identifier the `folders`
  API offers — see `shared.js`). Listens to `folders.onRenamed` /
  `onMoved` / `onDeleted` to keep assignments from being orphaned by a
  rename or move.
- **A small privileged "Experiment API"** (`experiment/folderColors`):
  there is no public WebExtension API to reach into the folder pane's
  DOM, so this is the one part of the extension that talks to
  Thunderbird's internals directly, to find each folder row and set its
  background colour, and to keep that applied as rows scroll in and out
  of the virtualized tree.

## Known risk / if colouring stops working

`experiment/folderColors/implementation.js` assumes the current (TB115+)
folder pane renders rows as `<li is="folder-tree-row">`. That's the one
assumption in this codebase that isn't a documented, stable API — it was
confirmed against real user CSS tweaks for TB115, not Thunderbird's own
source, since this environment has no way to run Thunderbird locally to
verify DOM details directly. If a future Thunderbird update changes this
and folders stop getting coloured:

1. Open the Browser Toolbox (Tools → Developer Tools → Browser Toolbox;
   requires `devtools.chrome.enabled` and
   `devtools.debugger.remote-enabled` set to `true` in `about:config`).
2. Inspect a row in the folder pane and see what tag/class it uses now.
3. Update `ROW_SELECTOR` and `getRowFolderURI()` at the top of
   `experiment/folderColors/implementation.js` to match.

Everything else (menus, storage, rename/move handling, the options page)
uses documented, stable WebExtension APIs and shouldn't need touching.

## Try it out (development)

1. In Thunderbird: **Settings → General → Config Editor**, confirm
   `xpinstall.signatures.required` doesn't block temporary installs (it
   doesn't affect temporary add-ons, only permanent `.xpi` installs).
2. **Tools → Developer Tools → Debug Add-ons** (or `about:debugging` →
   *This Thunderbird*) → **Load Temporary Add-on…** → select this
   repository's `manifest.json`.
3. Right-click any folder in the folder pane → **Folder colour**.

Reload the temporary add-on after editing files to pick up changes.

## About `web-ext lint` warnings

Running `web-ext lint` against this extension reports one error
(`experiment_apis: privileged manifest fields are only allowed in
privileged extensions`) and several `UNSUPPORTED_API` warnings for
`folders.onRenamed`, `folderColors.applyColors`, `accounts.list`, etc.,
plus an `accountsRead` permission warning. All of these are expected and
safe to ignore here: `web-ext`/`addons-linter` is built and calibrated
for Firefox's AMO rules, where `experiment_apis` really is restricted to
Mozilla-signed "privileged" extensions. Thunderbird has no such
restriction — `experiment_apis` is a normal, documented mechanism for
any third-party MailExtension (see
[Introducing Experiments](https://developer.thunderbird.net/add-ons/mailextensions/experiments)),
and addons.thunderbird.net's own review process is what actually applies.
The linter also simply doesn't know about Thunderbird-only APIs like
`folders`, `accounts`, and `accountsRead`, hence the `UNSUPPORTED_API`
warnings on standard Thunderbird API calls.

## Packaging

```sh
npx web-ext build --source-dir . --artifacts-dir dist \
  --ignore-files "*.md" ".git/**"
```

This produces a `.xpi` in `dist/` that can be submitted to
addons.thunderbird.net or installed permanently.
