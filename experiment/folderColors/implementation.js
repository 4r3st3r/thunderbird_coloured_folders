"use strict";

var { ExtensionCommon } = ChromeUtils.importESModule(
  "resource://gre/modules/ExtensionCommon.sys.mjs"
);
var { ExtensionSupport } = ChromeUtils.importESModule(
  "resource:///modules/ExtensionSupport.sys.mjs"
);
// Services is already a built-in global in this privileged scope (there is
// no standalone module file to import it from) — importing it was invalid
// and crashed this whole script before any of the code below ever ran.

// ---------------------------------------------------------------------
// Folder-pane DOM assumptions
//
// These match Thunderbird's post-"Supernova" (115+) folder pane, where
// each row is a custom element `<li is="folder-tree-row">`. This is the
// one part of the extension that depends on Thunderbird internals rather
// than a public API, so it is the most likely thing to need a small fix
// after a future Thunderbird update.
//
// If folders stop getting coloured: open the Browser Console (Ctrl+Shift+J)
// — NOT the extension's own background-page console — reload the add-on,
// and look for "[Coloured Folders]" lines. They report which selector (if
// any) matched, and dump a sample row's outerHTML so the right selector
// can be read off directly instead of guessed at.
// ---------------------------------------------------------------------
const LOG = (...args) => console.log("[Coloured Folders]", ...args);
const LOG_ERR = (...args) => console.error("[Coloured Folders]", ...args);

// Tried in order; first one that matches anything under a document wins.
const TREE_SELECTORS = [
  '[is="folder-tree"]',
  "#folderTree",
  "tree-view-table#folderTree",
  "tree-view-table",
];
// Tried in order per tree; first one that matches anything wins.
const ROW_SELECTORS = [
  'li[is="folder-tree-row"]',
  '[is="folder-tree-row"]',
  "tr.folder-tree-row",
  ".folder-tree-row",
];

let resolvedRowSelector = null;

function findRowsIn(tree) {
  if (resolvedRowSelector) {
    const rows = tree.querySelectorAll(resolvedRowSelector);
    if (rows.length) {
      return rows;
    }
  }
  for (const selector of ROW_SELECTORS) {
    const rows = tree.querySelectorAll(selector);
    if (rows.length) {
      if (selector !== resolvedRowSelector) {
        LOG(`row selector "${selector}" matched ${rows.length} row(s), using it`);
        resolvedRowSelector = selector;
      }
      return rows;
    }
  }
  return [];
}

let loggedNoRowsOnce = false;

function getRowFolderURI(row) {
  try {
    if (row.uri) {
      return row.uri;
    }
    if (row.dataset && row.dataset.uri) {
      return row.dataset.uri;
    }
    if (row._folder && row._folder.URI) {
      return row._folder.URI;
    }
    if (row.folder && row.folder.URI) {
      return row.folder.URI;
    }
    // Fallback: ask the tree's own view (the data model backing the
    // virtualized list) for the folder at this row's index.
    const tree = row.closest('[is="folder-tree"], #folderTree, tree-view-table');
    const view = tree && tree.view;
    if (view && typeof row.rowIndex === "number") {
      const folder =
        (view.getFolderForIndex && view.getFolderForIndex(row.rowIndex)) ||
        (view.getFolderAtIndex && view.getFolderAtIndex(row.rowIndex));
      if (folder) {
        return folder.URI;
      }
    }
    if (!loggedNoRowsOnce) {
      loggedNoRowsOnce = true;
      LOG_ERR(
        "could not find a folder URI for a row via any known property; row markup was:",
        row.outerHTML && row.outerHTML.slice(0, 500)
      );
    }
  } catch (ex) {
    LOG_ERR("could not read folder for a row", ex);
  }
  return null;
}

function collectDescendants(folder, out = []) {
  for (const sub of folder.subFolders) {
    out.push(sub);
    collectDescendants(sub, out);
  }
  return out;
}

// #rrggbb -> "#000000" or "#ffffff", whichever reads better on top of it.
function readableTextColor(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#000000" : "#ffffff";
}

let resolvedTreeSelector = null;
let loggedDocScan = false;

// Recursively find every folder-tree root in a window: the main folder
// pane usually lives in a content document loaded into a <browser>
// (about:3pane), so we search the chrome document and descend into any
// browsers we find, rather than assuming one specific location.
function findFolderTrees(doc, out = [], seen = new Set(), depth = 0) {
  if (!doc || seen.has(doc)) {
    return out;
  }
  seen.add(doc);
  try {
    let found = false;
    if (resolvedTreeSelector) {
      const direct = doc.querySelectorAll(resolvedTreeSelector);
      if (direct.length) {
        for (const el of direct) out.push(el);
        found = true;
      }
    }
    if (!found) {
      for (const selector of TREE_SELECTORS) {
        const direct = doc.querySelectorAll(selector);
        if (direct.length) {
          LOG(
            `tree selector "${selector}" matched ${direct.length} element(s) in`,
            doc.location && doc.location.href
          );
          resolvedTreeSelector = selector;
          for (const el of direct) out.push(el);
          break;
        }
      }
    }
    const browsers = doc.querySelectorAll("browser");
    for (const browser of browsers) {
      if (browser.contentDocument) {
        findFolderTrees(browser.contentDocument, out, seen, depth + 1);
      }
    }
  } catch (ex) {
    // Cross-origin or not-yet-loaded browsers throw; ignore and move on.
    LOG("findFolderTrees: skipped a document", ex && ex.message);
  }
  if (depth === 0 && !loggedDocScan) {
    loggedDocScan = true;
    LOG(
      `initial scan of window done: found ${out.length} folder-tree root(s), searched ${seen.size} document(s)`
    );
  }
  return out;
}

class WindowController {
  constructor(win) {
    this.win = win;
    this.observers = new Map(); // tree element -> MutationObserver
    this.repaintScheduled = false;
    this.scan();

    this.onTabOpen = () => this.scan();
    const tabmail = win.document.getElementById("tabmail");
    if (tabmail) {
      tabmail.addEventListener("TabOpen", this.onTabOpen);
      tabmail.addEventListener("TabSwitchDone", this.onTabOpen);
    }
  }

  scan() {
    const trees = findFolderTrees(this.win.document);
    let added = 0;
    for (const tree of trees) {
      if (!this.observers.has(tree)) {
        added++;
        this.injectStyle(tree.ownerDocument);
        const observer = new tree.ownerGlobal.MutationObserver(() =>
          this.scheduleRepaint()
        );
        observer.observe(tree, { childList: true, subtree: true, attributes: true });
        this.observers.set(tree, observer);
      }
    }
    if (added) {
      LOG(`scan: now observing ${this.observers.size} folder-tree root(s) in this window (+${added})`);
    }
    this.scheduleRepaint();
  }

  injectStyle(doc) {
    if (doc.getElementById(STYLE_ID)) {
      return;
    }
    const style = doc.createElement("style");
    style.id = STYLE_ID;
    // Class-based only (not tag/attribute-specific) so this keeps working
    // regardless of which candidate in ROW_SELECTORS actually matched.
    style.textContent = `
      .${ROW_CLASS}:not([selected]) {
        background-color: var(--coloured-folders-bg);
      }
      .${ROW_CLASS}:not([selected]) .container .name,
      .${ROW_CLASS}:not([selected]) .name {
        color: var(--coloured-folders-fg);
      }
    `;
    (doc.head || doc.documentElement).appendChild(style);
  }

  scheduleRepaint() {
    if (this.repaintScheduled) {
      return;
    }
    this.repaintScheduled = true;
    this.win.requestAnimationFrame(() => {
      this.repaintScheduled = false;
      this.repaint();
    });
  }

  repaint() {
    let rowCount = 0;
    let uriCount = 0;
    let colorCount = 0;
    for (const tree of this.observers.keys()) {
      const rows = findRowsIn(tree);
      rowCount += rows.length;
      for (const row of rows) {
        const uri = getRowFolderURI(row);
        if (uri) uriCount++;
        const color = uri && currentColors.get(uri);
        if (color) {
          colorCount++;
          row.classList.add(ROW_CLASS);
          row.style.setProperty("--coloured-folders-bg", color.bg);
          row.style.setProperty("--coloured-folders-fg", color.fg);
        } else {
          row.classList.remove(ROW_CLASS);
          row.style.removeProperty("--coloured-folders-bg");
          row.style.removeProperty("--coloured-folders-fg");
        }
      }
    }
    if (!this._loggedRepaintOnce || rowCount === 0) {
      this._loggedRepaintOnce = true;
      LOG(
        `repaint: ${this.observers.size} tree(s), ${rowCount} row(s) found, ${uriCount} resolved a folder URI, ${colorCount} matched a stored colour (currentColors has ${currentColors.size} entries)`
      );
    }
  }

  destroy() {
    for (const observer of this.observers.values()) {
      observer.disconnect();
    }
    for (const tree of this.observers.keys()) {
      const style = tree.ownerDocument.getElementById(STYLE_ID);
      if (style) {
        style.remove();
      }
      for (const row of tree.querySelectorAll(`.${ROW_CLASS}`)) {
        row.classList.remove(ROW_CLASS);
        row.style.removeProperty("--coloured-folders-bg");
        row.style.removeProperty("--coloured-folders-fg");
      }
    }
    this.observers.clear();
    const tabmail = this.win.document.getElementById("tabmail");
    if (tabmail) {
      tabmail.removeEventListener("TabOpen", this.onTabOpen);
      tabmail.removeEventListener("TabSwitchDone", this.onTabOpen);
    }
  }
}

// uri -> { bg, fg }, rebuilt on every applyColors() call.
let currentColors = new Map();
let windowControllers = new Map(); // window -> WindowController
let windowListenerRegistered = false;

function repaintAllWindows() {
  for (const controller of windowControllers.values()) {
    controller.repaint();
  }
}

function registerWindowListenerOnce() {
  if (windowListenerRegistered) {
    return;
  }
  windowListenerRegistered = true;
  ExtensionSupport.registerWindowListener("coloured-folders", {
    chromeURLs: ["chrome://messenger/content/messenger.xhtml"],
    onLoadWindow(win) {
      windowControllers.set(win, new WindowController(win));
    },
    onUnloadWindow(win) {
      const controller = windowControllers.get(win);
      if (controller) {
        controller.destroy();
        windowControllers.delete(win);
      }
    },
  });
}

function unregisterWindowListener() {
  if (!windowListenerRegistered) {
    return;
  }
  windowListenerRegistered = false;
  ExtensionSupport.unregisterWindowListener("coloured-folders");
  for (const controller of windowControllers.values()) {
    controller.destroy();
  }
  windowControllers.clear();
}

this.folderColors = class extends ExtensionCommon.ExtensionAPI {
  getAPI(context) {
    return {
      folderColors: {
        async applyColors(colors) {
          LOG(`applyColors: ${Object.keys(colors).length} explicit entr(y/ies) in storage`);
          const next = new Map();
          // Sort shallowest-path-first so a deeper explicit colour always
          // overwrites what a shallower ancestor's cascade set for it.
          const entries = Object.entries(colors).sort(
            (a, b) => a[0].split("/").length - b[0].split("/").length
          );
          for (const [key, hex] of entries) {
            const sep = key.indexOf(" ");
            const accountId = key.slice(0, sep);
            const path = key.slice(sep + 1);
            let folder;
            try {
              folder = context.extension.folderManager.get(accountId, path);
            } catch (ex) {
              LOG_ERR(
                `folder ${accountId} ${path} not found (renamed/deleted?)`,
                ex
              );
              continue;
            }
            if (!folder) {
              LOG_ERR(
                `folderManager.get(${accountId}, ${path}) returned nothing`
              );
              continue;
            }
            LOG(`resolved ${accountId} ${path} -> ${folder.URI}, colour ${hex}`);
            const value = { bg: hex, fg: readableTextColor(hex) };
            next.set(folder.URI, value);
            for (const sub of collectDescendants(folder)) {
              next.set(sub.URI, value);
            }
          }
          currentColors = next;
          LOG(`applyColors: resolved to ${next.size} URI(s) needing colour`);
          registerWindowListenerOnce();
          // Make sure any already-open windows get picked up even if they
          // loaded before applyColors() was first called.
          for (const win of Services.wm.getEnumerator("mail:3pane")) {
            if (!windowControllers.has(win)) {
              LOG("applyColors: found an already-open mail:3pane window, attaching");
              windowControllers.set(win, new WindowController(win));
            }
          }
          LOG(`applyColors: ${windowControllers.size} window(s) tracked`);
          repaintAllWindows();
        },

        async clear() {
          currentColors = new Map();
          unregisterWindowListener();
        },
      },
    };
  }

  onShutdown(isAppShutdown) {
    if (isAppShutdown) {
      return;
    }
    unregisterWindowListener();
  }
};
