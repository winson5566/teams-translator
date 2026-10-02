// Edge and Chrome only expose chrome.*; under Manifest V3 it returns promises like Firefox's browser.*.
if (typeof browser === "undefined") globalThis.browser = chrome;

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

// Chrome and Edge drop a promise returned from onMessage, so the background answers through sendResponse
// with { ok, result } or { ok, error }, which works in Firefox too.
async function askBackground(message) {
  const reply = await browser.runtime.sendMessage(message);
  if (!reply) throw new Error("插件后台没有回应，请刷新这个页面再试");
  if (!reply.ok) throw new Error(reply.error);
  return reply.result;
}
