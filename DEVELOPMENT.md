# Development notes

## Architecture

- **`menus` API** (public, stable): adds the "Folder colour" entry to the
  folder pane's right-click menu — preset swatches, a custom colour
  picker, and "Clear colour".
- **`browser.storage.local`**: stores explicit colour assignments, keyed
  by `accountId + path` (see `shared.js`). Listens to `folders.onRenamed` /
  `onMoved` / `onDeleted` so a rename or move doesn't orphan a colour
  assignment.
- **A privileged Experiment API** (`experiment/folderColors`): there is no
  public WebExtension API to reach into the folder pane's DOM, so this is
  the one part of the extension that talks to Thunderbird's internals
  directly, to find each folder row and set its background colour, and to
  keep that applied as rows scroll in and out of the virtualized tree.

## If colouring stops working after a Thunderbird update

`experiment/folderColors/implementation.js` tries a short list of
candidate selectors for the folder-tree root and for each row (see
`TREE_SELECTORS` / `ROW_SELECTORS` near the top of the file), since the
folder pane's internal markup isn't a documented, stable API and can
change between Thunderbird versions.

If folders stop getting coloured:

1. Open the Browser Console (`Ctrl+Shift+J`) and reload the add-on
   (Tools → Developer Tools → Debug Add-ons → Reload). Look for
   `[Coloured Folders]` log lines — they report which selector (if any)
   matched, and how many rows resolved to a folder.
2. If nothing matches, open the Browser Toolbox (Tools → Developer Tools
   → Browser Toolbox; requires `devtools.chrome.enabled` and
   `devtools.debugger.remote-enabled` set to `true` in `about:config`),
   inspect a row in the folder pane, and add the new tag/class to
   `TREE_SELECTORS` / `ROW_SELECTORS`.

Everything else (menus, storage, rename/move handling, the options page)
uses documented, stable WebExtension APIs and shouldn't need touching.

## Local development

1. **Tools → Developer Tools → Debug Add-ons** (or `about:debugging` →
   *This Thunderbird*) → **Load Temporary Add-on…** → select this
   repository's `manifest.json`.
2. Right-click any folder in the folder pane → **Folder colour**.
3. Reload the temporary add-on after editing files to pick up changes.

## About `web-ext lint` warnings

Running `web-ext lint` reports one error (`experiment_apis: privileged
manifest fields are only allowed in privileged extensions`) and several
`UNSUPPORTED_API` warnings (`folders.onRenamed`, `folderColors.applyColors`,
`accounts.list`, etc.), plus an `accountsRead` permission warning. All
expected and safe to ignore: `web-ext`/`addons-linter` is calibrated for
Firefox's AMO rules, where `experiment_apis` really is restricted to
Mozilla-signed "privileged" extensions. Thunderbird has no such
restriction — `experiment_apis` is a normal, documented mechanism for any
third-party MailExtension (see
[Introducing Experiments](https://developer.thunderbird.net/add-ons/mailextensions/experiments)),
and addons.thunderbird.net's own review process is what actually applies.
The linter also doesn't know about Thunderbird-only APIs like `folders`,
`accounts`, and `accountsRead`, hence those warnings.

## Packaging

```sh
npx web-ext build --source-dir . --artifacts-dir dist
```

Produces a `.xpi` in `dist/`.

## Publishing to addons.thunderbird.net

1. **Sign in** at https://addons.thunderbird.net/developers/ with a
   Mozilla account.
2. **Choose listed vs. unlisted**:
   - *Listed*: public, searchable on ATN, gets a full review.
   - *Unlisted*: not published/searchable, but still reviewed and signed.
   Either way, Thunderbird refuses to permanently install an unsigned
   add-on on release builds, so one of these two routes is required.
3. **Build the `.xpi`** (above) and upload it.
4. **Because this extension ships an Experiment API**, review is manual
   rather than fully automated. A short note to the reviewer explaining
   why the privileged API is needed (no public API reaches the folder
   pane DOM) speeds this up.
5. **Fill in the listing**: summary, description, support URL, licence
   (MIT, see `LICENSE`), and the data-collection declaration — answer "no
   data is collected", which is accurate.
6. **Keep `browser_specific_settings.gecko.id`** in `manifest.json` stable
   across versions — that's what lets future uploads be treated as
   updates to the same add-on rather than a new one.
7. For future changes: bump `version` in `manifest.json`, rebuild the
   `.xpi`, and upload it as a new version of the same listing.

### `strict_max_version` is mandatory here

Because this extension ships an Experiment API, ATN's validator requires
both `strict_min_version` *and* `strict_max_version` under
`browser_specific_settings.gecko` in `manifest.json` — omitting
`strict_max_version` fails validation outright ("A 'strict_max_version'
is required for Thunderbird Mail Experiments"). This isn't a formality:
experiments hook into undocumented internals (the folder-pane DOM) that
can change between versions, so Thunderbird wants an explicit ceiling
you've actually verified, rather than an open-ended claim of support for
versions you haven't tested. Keep it set to the newest version you've
confirmed still works (currently `153.*`), and bump it — a small
manifest edit, rebuild, and "upload new version" — each time you verify
compatibility with a newer release. Resist the temptation to set it far
ahead "just in case"; that defeats the point of the check.
