// Presets shown directly in the right-click menu. Emoji act as a quick
// colour swatch without needing a set of icon image files.
const PRESETS = [
  { hex: "#e53935", label: "🔴 Red" },
  { hex: "#fb8c00", label: "🟠 Orange" },
  { hex: "#fdd835", label: "🟡 Yellow" },
  { hex: "#43a047", label: "🟢 Green" },
  { hex: "#1e88e5", label: "🔵 Blue" },
  { hex: "#8e24aa", label: "🟣 Purple" },
  { hex: "#6d4c41", label: "🟤 Brown" },
  { hex: "#757575", label: "⚫ Grey" },
];

async function loadColors() {
  const { colors } = await browser.storage.local.get({ colors: {} });
  return colors;
}

async function saveColors(colors) {
  // Writing here is enough: the storage.onChanged listener below is the
  // single place that pushes colours to the folder pane, so any context
  // (background, options page) can save without knowing about that.
  await browser.storage.local.set({ colors });
}

async function setFolderColor(folder, hex) {
  const colors = await loadColors();
  colors[folderKey(folder.accountId, folder.path)] = hex;
  await saveColors(colors);
}

async function clearFolderColor(folder) {
  const colors = await loadColors();
  delete colors[folderKey(folder.accountId, folder.path)];
  await saveColors(colors);
}

// Rewrite (or drop) stored keys when a folder's identity changes, so a
// rename/move doesn't silently orphan the user's colour choice. Handles
// both the folder itself and any coloured descendants under it.
async function migrateFolderKey(original, updated) {
  const oldKey = folderKey(original.accountId, original.path);
  const newKey = folderKey(updated.accountId, updated.path);
  if (oldKey === newKey) {
    return;
  }
  const oldDescendantPrefix = oldKey + "/";
  const colors = await loadColors();
  let changed = false;
  const next = {};
  for (const [key, value] of Object.entries(colors)) {
    if (key === oldKey) {
      next[newKey] = value;
      changed = true;
    } else if (key.startsWith(oldDescendantPrefix)) {
      next[newKey + key.slice(oldKey.length)] = value;
      changed = true;
    } else {
      next[key] = value;
    }
  }
  if (changed) {
    await saveColors(next);
  }
}

async function removeFolderKey(folder) {
  const key = folderKey(folder.accountId, folder.path);
  const prefix = key + "/";
  const colors = await loadColors();
  let changed = false;
  const next = {};
  for (const [k, v] of Object.entries(colors)) {
    if (k === key || k.startsWith(prefix)) {
      changed = true;
      continue;
    }
    next[k] = v;
  }
  if (changed) {
    await saveColors(next);
  }
}

browser.folders.onRenamed.addListener((originalFolder, renamedFolder) =>
  migrateFolderKey(originalFolder, renamedFolder)
);
browser.folders.onMoved.addListener((originalFolder, movedFolder) =>
  migrateFolderKey(originalFolder, movedFolder)
);
browser.folders.onDeleted.addListener((folder) => removeFolderKey(folder));

// --- Context menu -------------------------------------------------------

function createMenus() {
  browser.menus.create({
    id: "coloured-folders-root",
    title: "Folder colour",
    contexts: ["folder_pane"],
  });
  for (const preset of PRESETS) {
    browser.menus.create({
      id: `preset:${preset.hex}`,
      parentId: "coloured-folders-root",
      title: preset.label,
      contexts: ["folder_pane"],
    });
  }
  browser.menus.create({
    id: "coloured-folders-sep",
    parentId: "coloured-folders-root",
    type: "separator",
    contexts: ["folder_pane"],
  });
  browser.menus.create({
    id: "custom",
    parentId: "coloured-folders-root",
    title: "Custom colour…",
    contexts: ["folder_pane"],
  });
  browser.menus.create({
    id: "clear",
    parentId: "coloured-folders-root",
    title: "Clear colour",
    contexts: ["folder_pane"],
  });
}

browser.menus.onShown.addListener(async (info) => {
  const folders = info.selectedFolders || [];
  if (!folders.length) {
    return;
  }
  const colors = await loadColors();
  const anyHasOwnColor = folders.some(
    (f) => colors[folderKey(f.accountId, f.path)]
  );
  browser.menus.update("clear", { enabled: anyHasOwnColor });
  browser.menus.refresh();
});

let pendingCustomFolders = null;

browser.menus.onClicked.addListener(async (info) => {
  const folders = info.selectedFolders || [];
  if (!folders.length) {
    return;
  }
  if (info.menuItemId.startsWith("preset:")) {
    const hex = info.menuItemId.slice("preset:".length);
    for (const folder of folders) {
      await setFolderColor(folder, hex);
    }
  } else if (info.menuItemId === "clear") {
    for (const folder of folders) {
      await clearFolderColor(folder);
    }
  } else if (info.menuItemId === "custom") {
    pendingCustomFolders = folders;
    await browser.windows.create({
      url: browser.runtime.getURL("picker/picker.html"),
      type: "popup",
      width: 260,
      height: 160,
    });
  }
});

browser.runtime.onMessage.addListener(async (message) => {
  if (message.type === "picker-color-chosen" && pendingCustomFolders) {
    for (const folder of pendingCustomFolders) {
      await setFolderColor(folder, message.hex);
    }
    pendingCustomFolders = null;
  }
});

// --- Startup -------------------------------------------------------------

browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.colors) {
    browser.folderColors.applyColors(changes.colors.newValue || {});
  }
});

async function init() {
  createMenus();
  const colors = await loadColors();
  await browser.folderColors.applyColors(colors);
}

init();
