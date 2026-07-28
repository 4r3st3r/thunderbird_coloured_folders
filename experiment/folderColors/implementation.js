"use strict";

var { ExtensionCommon } = ChromeUtils.importESModule(
  "resource://gre/modules/ExtensionCommon.sys.mjs"
);
var { ExtensionSupport } = ChromeUtils.importESModule(
  "resource:///modules/ExtensionSupport.sys.mjs"
);
var { Services } = ChromeUtils.importESModule(
  "resource://gre/modules/Services.sys.mjs"
);

// ---------------------------------------------------------------------
// Folder-pane DOM assumptions
//
// These match Thunderbird's post-"Supernova" (115+) folder pane, where
// each row is a custom element `<li is="folder-tree-row">`. This is the
// one part of the extension that depends on Thunderbird internals rather
// than a public API, so it is the most likely thing to need a small fix
// after a future Thunderbird update.
//
// If folders stop getting coloured: open the Browser Toolbox (Tools >
// Developer Tools > Browser Toolbox, needs devtools.chrome.enabled +
// devtools.debugger.remote-enabled set in about:config), inspect a row
// in the folder pane, and update ROW_SELECTOR / getRowFolderURI() below
// to match whatever changed.
// ---------------------------------------------------------------------
const ROW_SELECTOR = 'li[is="folder-tree-row"]';
const STYLE_ID = "coloured-folders-injected-style";
const ROW_CLASS = "coloured-folder-row";

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
  } catch (ex) {
    console.error("Coloured Folders: could not read folder for a row", ex);
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

// Recursively find every folder-tree root in a window: the main folder
// pane usually lives in a content document loaded into a <browser>
// (about:3pane), so we search the chrome document and descend into any
// browsers we find, rather than assuming one specific location.
function findFolderTrees(doc, out = [], seen = new Set()) {
  if (!doc || seen.has(doc)) {
    return out;
  }
  seen.add(doc);
  try {
    const direct = doc.querySelectorAll('[is="folder-tree"], #folderTree');
    for (const el of direct) {
      out.push(el);
    }
    const browsers = doc.querySelectorAll("browser");
    for (const browser of browsers) {
      if (browser.contentDocument) {
        findFolderTrees(browser.contentDocument, out, seen);
      }
    }
  } catch (ex) {
    // Cross-origin or not-yet-loaded browsers throw; ignore and move on.
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
    for (const tree of trees) {
      if (!this.observers.has(tree)) {
        this.injectStyle(tree.ownerDocument);
        const observer = new tree.ownerGlobal.MutationObserver(() =>
          this.scheduleRepaint()
        );
        observer.observe(tree, { childList: true, subtree: true, attributes: true });
        this.observers.set(tree, observer);
      }
    }
    this.scheduleRepaint();
  }

  injectStyle(doc) {
    if (doc.getElementById(STYLE_ID)) {
      return;
    }
    const style = doc.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      ${ROW_SELECTOR}.${ROW_CLASS}:not([selected]) {
        background-color: var(--coloured-folders-bg);
      }
      ${ROW_SELECTOR}.${ROW_CLASS}:not([selected]) .container .name {
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
    for (const tree of this.observers.keys()) {
      const rows = tree.querySelectorAll(ROW_SELECTOR);
      for (const row of rows) {
        const uri = getRowFolderURI(row);
        const color = uri && currentColors.get(uri);
        if (color) {
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
              console.warn(
                `Coloured Folders: folder ${accountId} ${path} not found (renamed/deleted?)`,
                ex
              );
              continue;
            }
            if (!folder) {
              continue;
            }
            const value = { bg: hex, fg: readableTextColor(hex) };
            next.set(folder.URI, value);
            for (const sub of collectDescendants(folder)) {
              next.set(sub.URI, value);
            }
          }
          currentColors = next;
          registerWindowListenerOnce();
          // Make sure any already-open windows get picked up even if they
          // loaded before applyColors() was first called.
          for (const win of Services.wm.getEnumerator("mail:3pane")) {
            if (!windowControllers.has(win)) {
              windowControllers.set(win, new WindowController(win));
            }
          }
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
