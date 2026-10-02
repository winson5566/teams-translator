// Holds Teams' Enter-to-send and send button until the user confirms in a dialog.
const DIALOG_CLASS = "ctt-send-dialog";

// Normalized text the user approved in the dialog; their own next send of exactly this text goes through.
let approvedText = null;

// The editor and its send button share a compose area but neither contains the other.
function nearestInComposeArea(start, selector) {
  for (let node = start.parentElement; node; node = node.parentElement) {
    const match = node.querySelector(selector);
    if (match) return match;
  }
  return null;
}

function closeSendDialog() {
  document.querySelector(`.${DIALOG_CLASS}`)?.remove();
}

// Rich editors keep their own model of the text and sync the DOM selection asynchronously.
const EDITOR_SYNC_MS = 50;

const normalizedText = (text) => text.replace(/\s+/g, " ").trim();
const editorSync = () => new Promise((resolve) => setTimeout(resolve, EDITOR_SYNC_MS));

function selectEditorContents(editor) {
  editor.focus();
  const range = document.createRange();
  range.selectNodeContents(editor);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

// Teams' editor ignores direct DOM edits, so the text goes in the ways a user would put it there:
// a paste first, then typed input. The caller must not send unless this returns true.
async function replaceEditorText(editor, text) {
  const hasText = () => normalizedText(editor.innerText) === normalizedText(text);
  selectEditorContents(editor);
  await editorSync();
  const pasted = new DataTransfer();
  pasted.setData("text/plain", text);
  editor.dispatchEvent(new ClipboardEvent("paste", { clipboardData: pasted, bubbles: true, cancelable: true }));
  await editorSync();
  if (hasText()) return true;
  selectEditorContents(editor);
  document.execCommand("insertText", false, text);
  await editorSync();
  return hasText();
}

// Checked locally and never sent to DeepSeek, so a pasted secret does not leave the machine to be checked.
const SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{20,}/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /AccountKey=[A-Za-z0-9+/=]{20,}/,
  /\b(password|passwd|pwd|secret|token|api[_-]?key)\s*[:=]\s*\S{6,}/i,
];

function containsSecret(text) {
  return SECRET_PATTERNS.some((pattern) => pattern.test(text)) || Boolean(settings.apiKey && text.includes(settings.apiKey));
}

const LOCAL_SECRET_RESULT = {
  verdict: "block",
  issues: ["消息里像是有密码、密钥或 token，发出去可能会泄露。为了安全，这条消息没有发给 DeepSeek 翻译或检查"],
  suggestion: "",
};

function isApproved(editor) {
  return Boolean(editor) && approvedText !== null && normalizedText(editor.innerText) === approvedText;
}

function showSendDialog(editor) {
  const original = editor?.innerText.trim() || "";
  const needsEnglish = containsChinese(original);
  const overlay = element("div", DIALOG_CLASS);
  const dialog = element("div", "ctt-send-box");
  const messageInput = element("textarea", "ctt-send-message");
  messageInput.value = original;
  messageInput.placeholder = "(没有文字，可能是图片或附件)";
  const checkBox = element("div", "ctt-send-check");
  checkBox.hidden = true;
  const status = element("div", "ctt-send-status");
  const sendButtonInDialog = element("button", "ctt-send-confirm", needsEnglish ? "放入英文" : "确认");
  const cancelButton = element("button", "ctt-send-cancel", "取消");
  let verdict = "ok";

  const setBusy = (busy) => {
    messageInput.disabled = busy;
    sendButtonInDialog.disabled = busy;
  };
  const cancel = () => {
    closeSendDialog();
    editor?.focus();
  };
  // Confirming never sends: it leaves the approved text in Teams' box for the user to send themselves.
  const send = async () => {
    if (!editor) {
      status.textContent = "找不到 Teams 的输入框，请在输入框里按回车再试";
      return;
    }
    const message = messageInput.value.trim();
    if (containsChinese(message)) {
      status.textContent = "英文里还有中文，请改成英文再确认";
      return;
    }
    approvedText = normalizedText(message);
    if (message !== original) {
      setBusy(true);
      if (!(await replaceEditorText(editor, message))) {
        status.textContent = "没能自动替换输入框里的内容。";
        navigator.clipboard.writeText(message).then(
          () => (status.textContent += "要发送的内容已复制：请取消，在输入框里全选后粘贴，再自己按发送"),
          () => (status.textContent += "请手动复制上面的内容，取消后在输入框里全选粘贴，再自己按发送")
        );
        return;
      }
    }
    closeSendDialog();
    editor.focus();
  };

  const showCheck = (result) => {
    verdict = result.verdict;
    checkBox.hidden = false;
    checkBox.className = `ctt-send-check ctt-check-${result.verdict}`;
    if (result.verdict === "ok") {
      checkBox.replaceChildren(element("div", "", "检查通过"));
      return;
    }
    checkBox.replaceChildren(
      element("div", "ctt-heading", result.verdict === "block" ? "可能发错了，建议先别发" : "发送前请留意"),
      ...result.issues.map((issue) => element("div", "ctt-check-issue", issue))
    );
    if (result.suggestion) {
      const useSuggestion = element("button", "ctt-button ctt-use-suggestion", "用这个版本");
      const suggestionLine = element("div", "ctt-check-suggestion", result.suggestion);
      suggestionLine.append(useSuggestion);
      useSuggestion.addEventListener("click", () => {
        messageInput.value = result.suggestion;
        useSuggestion.remove();
      });
      checkBox.append(suggestionLine);
    }
    if (result.verdict === "block") sendButtonInDialog.textContent = needsEnglish ? "仍然放入英文" : "仍然确认";
  };

  const prepare = async () => {
    setBusy(true);
    if (containsSecret(original)) {
      showCheck(LOCAL_SECRET_RESULT);
      setBusy(false);
      cancelButton.focus();
      return;
    }
    if (needsEnglish) {
      messageInput.value = "翻译中...";
      try {
        messageInput.value = await askBackground({
          type: "draftToEnglish",
          draft: original,
          context: recentConversation(settings.contextMessageCount),
        });
      } catch (error) {
        messageInput.value = "";
        status.textContent = `翻译失败: ${error.message}`;
        setBusy(false);
        messageInput.focus();
        return;
      }
    }
    const message = messageInput.value.trim();
    if (containsChinese(message)) {
      status.textContent = "翻译结果里还有中文，请手动改成英文再发送";
      setBusy(false);
      messageInput.focus();
      return;
    }
    if (settings.checkBeforeSend && message) {
      checkBox.hidden = false;
      checkBox.className = "ctt-send-check";
      checkBox.textContent = "正在结合上下文检查...";
      try {
        showCheck(await askBackground({
          type: "checkMessage",
          message,
          draft: needsEnglish ? original : "",
          context: recentConversation(settings.insightContextMessageCount),
        }));
      } catch (error) {
        checkBox.textContent = `检查失败: ${error.message}。可以直接发送`;
      }
    }
    setBusy(false);
    (verdict === "block" ? cancelButton : sendButtonInDialog).focus();
  };

  sendButtonInDialog.addEventListener("click", send);
  cancelButton.addEventListener("click", cancel);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) cancel();
  });
  // Teams has global shortcuts, so keys pressed in the dialog must not reach it.
  overlay.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Escape") cancel();
  });
  // A blocked message is only approved by clicking the button, never by a reflexive Enter.
  messageInput.addEventListener("keydown", (event) => {
    if (!isSendKey(event)) return;
    event.preventDefault();
    if (verdict !== "block" && !sendButtonInDialog.disabled) send();
  });

  const actions = element("div", "ctt-send-actions");
  actions.append(cancelButton, sendButtonInDialog);
  dialog.append(element("div", "ctt-heading", needsEnglish ? "翻译成英文" : "发送前确认"));
  if (needsEnglish) {
    dialog.append(element("div", "ctt-send-label", "原文"), element("div", "ctt-send-preview", original));
  }
  dialog.append(element("div", "ctt-send-label", needsEnglish ? "英文（可以直接修改）" : "要发送的内容（可以直接修改）"),
    messageInput, checkBox, status, actions);
  overlay.append(dialog);
  document.body.append(overlay);
  sendButtonInDialog.focus();
  prepare();
}

function isSendKey(event) {
  return event.key === "Enter" && !event.shiftKey && !event.altKey && !event.isComposing;
}

// While the @mention list is open, Enter picks a person instead of sending. The editor marks the highlighted
// option with aria-activedescendant; a stale id pointing at nothing visible must not disable the dialog.
function isSuggestionListOpen(editor) {
  const optionId = editor.getAttribute("aria-activedescendant");
  const option = optionId && document.getElementById(optionId);
  return Boolean(option && option.getClientRects().length);
}

document.addEventListener(
  "keydown",
  (event) => {
    if (!settings.confirmBeforeSend || !isSendKey(event)) return;
    const editor = event.target.closest?.(TEAMS_SELECTORS.composeBox);
    if (!editor || isSuggestionListOpen(editor)) return;
    if (isApproved(editor)) {
      approvedText = null;
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!document.querySelector(`.${DIALOG_CLASS}`)) showSendDialog(editor);
  },
  true
);

document.addEventListener(
  "click",
  (event) => {
    const button = event.target.closest?.(TEAMS_SELECTORS.sendButton);
    if (!button || !settings.confirmBeforeSend) return;
    const editor = nearestInComposeArea(button, TEAMS_SELECTORS.composeBox);
    if (isApproved(editor)) {
      approvedText = null;
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    showSendDialog(editor);
  },
  true
);
