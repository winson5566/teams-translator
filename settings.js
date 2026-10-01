const DEFAULT_SETTINGS = {
  enabled: true,
  confirmBeforeSend: true,
  checkBeforeSend: true,
  apiKey: "",
  model: "deepseek-flash",
  targetLanguage: "简体中文",
  myName: "",
  contextMessageCount: 8,
  insightContextMessageCount: 15,
};

// Model names DeepSeek no longer accepts, mapped to the model that replaced them.
const RETIRED_MODELS = { "deepseek-chat": "deepseek-flash", "deepseek-reasoner": "deepseek-flash" };

async function loadSettings() {
  const settings = { ...DEFAULT_SETTINGS, ...(await browser.storage.local.get(DEFAULT_SETTINGS)) };
  return { ...settings, model: RETIRED_MODELS[settings.model] ?? settings.model };
}
