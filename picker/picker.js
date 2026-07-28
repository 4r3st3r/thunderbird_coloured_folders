const colorInput = document.getElementById("colorInput");

document.getElementById("okButton").addEventListener("click", async () => {
  await browser.runtime.sendMessage({
    type: "picker-color-chosen",
    hex: colorInput.value,
  });
  window.close();
});

document.getElementById("cancelButton").addEventListener("click", () => {
  window.close();
});
