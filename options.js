const FIELDS = ["apiKey", "targetLanguage", "myName", "contextMessageCount", "insightContextMessageCount", "model"];
const NUMBER_FIELDS = ["contextMessageCount", "insightContextMessageCount"];
const CHECKBOX_FIELDS = ["confirmBeforeSend", "checkBeforeSend"];
const REQUIRED_ORIGINS = browser.runtime.getManifest().host_permissions;
const statusLine = document.getElementById("status");

async function showMissingPermissions() {
  const granted = await browser.permissions.contains({ origins: REQUIRED_ORIGINS });
  document.getElementById("permissions").style.display = granted ? "none" : "block";
}

async function fillForm() {
  const settings = await loadSettings();
  for (const field of FIELDS) {
    document.getElementById(field).value = settings[field];
  }
  for (const field of CHECKBOX_FIELDS) {
    document.getElementById(field).checked = settings[field];
  }
}

async function save() {
  const values = Object.fromEntries(FIELDS.map((f) => [f, document.getElementById(f).value.trim()]));
  for (const field of NUMBER_FIELDS) {
    values[field] = Number(values[field]) || 0;
  }
  for (const field of CHECKBOX_FIELDS) {
    values[field] = document.getElementById(field).checked;
  }
  await browser.storage.local.set(values);
  statusLine.textContent = "已保存";
}

const SAMPLE_CONVERSATION = {
  context: [{ author: "Alice", text: "Can you push the fix to staging before EOD?" }],
  message: { author: "Bob", text: "Sure, I'll ping you once it's up." },
};

async function testTranslation() {
  await save();
  statusLine.textContent = "测试翻译中...";
  try {
    const translation = await askBackground({ type: "translate", ...SAMPLE_CONVERSATION });
    statusLine.textContent = `翻译成功: ${translation}\n测试 “i” 按钮中...`;
  } catch (error) {
    statusLine.textContent = `翻译失败: ${error.message}`;
    return;
  }
  try {
    const insight = await askBackground({ type: "explain", ...SAMPLE_CONVERSATION });
    statusLine.textContent += `\n“i” 按钮成功: ${insight.explanation}`;
  } catch (error) {
    statusLine.textContent += `\n“i” 按钮失败: ${error.message}`;
  }
}

document.getElementById("grant").addEventListener("click", async () => {
  await browser.permissions.request({ origins: REQUIRED_ORIGINS });
  showMissingPermissions();
});
document.getElementById("save").addEventListener("click", save);
async function runDiagnostics() {
  await save();
  const output = document.getElementById("diagnostics");
  output.textContent = "";
  const port = browser.runtime.connect({ name: "diagnose" });
  port.onMessage.addListener((line) => {
    output.textContent += `${new Date().toLocaleTimeString()}  ${line}\n`;
  });
  port.onDisconnect.addListener(() => {
    output.textContent += "诊断结束\n";
  });
}

document.getElementById("test").addEventListener("click", testTranslation);
document.getElementById("diagnose").addEventListener("click", runDiagnostics);

fillForm();
showMissingPermissions();
