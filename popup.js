const TOGGLES = ["enabled", "blockChineseOnSend", "checkBeforeSend"];

async function fillToggles() {
  const settings = await loadSettings();
  for (const key of TOGGLES) {
    document.getElementById(key).checked = settings[key];
  }
  document.getElementById("missingKey").style.display = settings.apiKey ? "none" : "block";
}

for (const key of TOGGLES) {
  document.getElementById(key).addEventListener("change", (event) => {
    browser.storage.local.set({ [key]: event.target.checked });
  });
}

document.getElementById("moreSettings").addEventListener("click", async () => {
  await browser.runtime.openOptionsPage();
  window.close();
});

fillToggles();
