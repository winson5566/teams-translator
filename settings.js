const DEFAULT_SETTINGS = {
  enabled: true,
  confirmBeforeSend: true,
  checkBeforeSend: true,
  apiKey: "",
  model: "deepseek-chat",
  targetLanguage: "简体中文",
  myName: "",
  contextMessageCount: 8,
  insightContextMessageCount: 15,
};

async function loadSettings() {
  return { ...DEFAULT_SETTINGS, ...(await browser.storage.local.get(DEFAULT_SETTINGS)) };
}
