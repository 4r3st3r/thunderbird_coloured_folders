# Coloured Folders

Colour the **whole folder row** in Thunderbird's folder pane — background
and name, not just the icon — so you can spot the folder you want at a
glance while scrolling. Colour a folder and all of its subfolders pick up
the same colour automatically, unless a subfolder is given its own
override.

## Features

- 🎨 **Right-click any folder** → **Folder colour** to pick a colour, right
  from the folder pane.
- 🖌️ A curated set of pastel presets, plus a full custom colour picker for
  anything more specific.
- 📂 **Colours cascade to subfolders** automatically — colour a parent once
  and its whole branch is easy to pick out, with per-folder overrides
  whenever you need one.
- 🗂️ **A management page** listing every folder with a colour assigned, so
  you can review or clear them all in one place.
- 🔒 **Fully local** — no accounts, no network requests, no data collected.
  Everything is stored on your machine.
- 🧭 **Rename/move safe** — colour assignments follow a folder if it's
  renamed or moved, instead of getting silently lost.

## Installing

Not yet listed on addons.thunderbird.net. In the meantime:

1. Download the latest `.xpi` from this repository's
   [Releases](../../releases), or clone the repo.
2. In Thunderbird: **Tools → Developer Tools → Debug Add-ons**, then
   **Load Temporary Add-on…** and select the extension's `manifest.json`
   (or the `.xpi`, if installing permanently once signed).

## Why

Thunderbird's built-in folder colour picker only recolours the small
folder icon. Coloured Folders colours the entire row, which is much
easier to pick out at a glance in a long folder list.

## License

MIT — see [LICENSE](LICENSE).
