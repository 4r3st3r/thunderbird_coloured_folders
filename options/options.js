const rowsEl = document.getElementById("rows");
const emptyEl = document.getElementById("empty");

async function accountNames() {
  const accounts = await browser.accounts.list();
  return new Map(accounts.map((a) => [a.id, a.name]));
}

async function render() {
  const [{ colors }, names] = await Promise.all([
    browser.storage.local.get({ colors: {} }),
    accountNames(),
  ]);

  const entries = Object.entries(colors);
  emptyEl.hidden = entries.length > 0;
  rowsEl.textContent = "";

  for (const [key, hex] of entries) {
    const { accountId, path } = splitFolderKey(key);
    const tr = document.createElement("tr");

    const accountTd = document.createElement("td");
    accountTd.textContent = names.get(accountId) || accountId;
    tr.appendChild(accountTd);

    const pathTd = document.createElement("td");
    pathTd.textContent = path;
    tr.appendChild(pathTd);

    const colorTd = document.createElement("td");
    const colorInput = document.createElement("input");
    colorInput.type = "color";
    colorInput.value = hex;
    colorInput.addEventListener("change", async () => {
      const { colors: current } = await browser.storage.local.get({ colors: {} });
      current[key] = colorInput.value;
      await browser.storage.local.set({ colors: current });
    });
    colorTd.appendChild(colorInput);
    tr.appendChild(colorTd);

    const removeTd = document.createElement("td");
    const removeButton = document.createElement("button");
    removeButton.textContent = "Remove";
    removeButton.addEventListener("click", async () => {
      const { colors: current } = await browser.storage.local.get({ colors: {} });
      delete current[key];
      await browser.storage.local.set({ colors: current });
    });
    removeTd.appendChild(removeButton);
    tr.appendChild(removeTd);

    rowsEl.appendChild(tr);
  }
}

browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.colors) {
    render();
  }
});

render();
