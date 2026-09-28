const TOGGLES = ["enabled", "confirmBeforeSend", "checkBeforeSend"];
const checkToggle = document.getElementById("checkToggle");
const checkBeforeSendBox = document.getElementById("checkBeforeSend");

// The content check runs inside the confirmation dialog, so it has no effect without it.
function showCheckAvailability(confirmBeforeSend) {
  checkBeforeSendBox.disabled = !confirmBeforeSend;
  checkToggle.classList.toggle("disabled", !confirmBeforeSend);
}

async function fillToggles() {
  const settings = await loadSettings();
  for (const key of TOGGLES) {
    document.getElementById(key).checked = settings[key];
  }
  showCheckAvailability(settings.confirmBeforeSend);
  document.getElementById("missingKey").style.display = settings.apiKey ? "none" : "block";
}

for (const key of TOGGLES) {
  document.getElementById(key).addEventListener("change", async (event) => {
    await browser.storage.local.set({ [key]: event.target.checked });
    if (key === "confirmBeforeSend") showCheckAvailability(event.target.checked);
  });
}

document.getElementById("moreSettings").addEventListener("click", async () => {
  await browser.runtime.openOptionsPage();
  window.close();
});

fillToggles();
