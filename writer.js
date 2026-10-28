// A floating button opens a panel where the user writes a message in Chinese or English, gets it translated to
// English and checked against the open conversation, and copies the result into Teams themselves. A send from
// Teams' own box that still contains Chinese is stopped and handed to the panel; every other send is untouched.
const WRITER_CLASS = "ctt-writer";

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

// Movement smaller than this is still a click, so a slightly shaky click on the button does not count as a drag.
const DRAG_THRESHOLD_PX = 4;

function placeWithinViewport(element, left, top) {
  const maxLeft = Math.max(0, window.innerWidth - element.offsetWidth);
  const maxTop = Math.max(0, window.innerHeight - element.offsetHeight);
  element.style.left = `${Math.min(Math.max(0, left), maxLeft)}px`;
  element.style.top = `${Math.min(Math.max(0, top), maxTop)}px`;
  element.style.right = "auto";
  element.style.bottom = "auto";
}

function restorePosition(element, saved) {
  if (saved) placeWithinViewport(element, saved.left, saved.top);
}

// Drags the fixed-position `element` by `handle` and saves where it ends up under `settingKey`.
// Returns a function telling whether the last press turned into a drag, so the click that ends it can be ignored.
function makeDraggable(element, handle, settingKey) {
  let dragged = false;
  handle.addEventListener("pointerdown", (down) => {
    if (down.button !== 0 || (down.target !== handle && down.target.closest("button"))) return;
    const start = element.getBoundingClientRect();
    dragged = false;
    const move = (event) => {
      const dx = event.clientX - down.clientX;
      const dy = event.clientY - down.clientY;
      if (!dragged && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      dragged = true;
      event.preventDefault();
      placeWithinViewport(element, start.left + dx, start.top + dy);
    };
    const up = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      if (!dragged) return;
      browser.storage.local.set({
        [settingKey]: { left: parseFloat(element.style.left), top: parseFloat(element.style.top) },
      });
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
  });
  return () => dragged;
}

// The user resizes the window with its corner handle, which fires no event of its own, so size changes are
// watched and saved once they settle.
const SIZE_SAVE_DELAY_MS = 500;

function rememberSize(panel) {
  let saveTimer;
  new ResizeObserver(() => {
    if (panel.hidden) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const size = { width: panel.offsetWidth, height: panel.offsetHeight };
      const saved = settings.writerSize;
      if (saved?.width === size.width && saved?.height === size.height) return;
      browser.storage.local.set({ writerSize: size });
    }, SIZE_SAVE_DELAY_MS);
  }).observe(panel);
}

function buildWriter() {
  const fab = element("button", "ctt-writer-fab", "译");
  fab.title = "写英文消息：翻译并检查";
  const panel = element("div", WRITER_CLASS);
  panel.hidden = true;

  const close = element("button", "ctt-writer-close", "×");
  close.title = "关闭（内容会保留）";
  const header = element("div", "ctt-writer-header");
  header.append(element("span", "ctt-heading", "写英文消息"), close);
  const notice = element("div", "ctt-writer-notice");
  notice.hidden = true;
  const draft = element("textarea", "ctt-writer-draft");
  draft.placeholder = "输入中文或英文，Ctrl+Enter 翻译并检查";
  const run = element("button", "ctt-writer-run", "翻译并检查");

  const result = element("div", "ctt-writer-result");
  result.hidden = true;
  const english = element("textarea", "ctt-writer-english");
  const checkBox = element("div", "ctt-send-check");
  checkBox.hidden = true;
  const status = element("div", "ctt-send-status");
  const copy = element("button", "ctt-writer-copy", "复制英文");
  result.append(element("div", "ctt-send-label", "英文（可以直接修改，复制后自己粘贴到 Teams 发送）"), english, checkBox,
    status, copy);
  panel.append(header, notice, draft, run, result);

  let verdict = "ok";

  const showCheck = (check) => {
    verdict = check.verdict;
    checkBox.hidden = false;
    checkBox.className = `ctt-send-check ctt-check-${check.verdict}`;
    copy.textContent = check.verdict === "block" ? "仍然复制" : "复制英文";
    if (check.verdict === "ok") {
      checkBox.replaceChildren(element("div", "", "检查通过"));
      return;
    }
    checkBox.replaceChildren(
      element("div", "ctt-heading", check.verdict === "block" ? "可能发错了，建议先别发" : "发送前请留意"),
      ...check.issues.map((issue) => element("div", "ctt-check-issue", issue))
    );
    if (check.suggestion) {
      const useSuggestion = element("button", "ctt-button ctt-use-suggestion", "用这个版本");
      const suggestionLine = element("div", "ctt-check-suggestion", check.suggestion);
      suggestionLine.append(useSuggestion);
      useSuggestion.addEventListener("click", () => {
        english.value = check.suggestion;
        useSuggestion.remove();
      });
      checkBox.append(suggestionLine);
    }
  };

  const translateAndCheck = async () => {
    const text = draft.value.trim();
    if (!text || run.disabled) return;
    run.disabled = true;
    result.hidden = false;
    checkBox.hidden = true;
    status.textContent = "";
    verdict = "ok";
    copy.textContent = "复制英文";
    try {
      if (containsSecret(text)) {
        english.value = "";
        showCheck(LOCAL_SECRET_RESULT);
        return;
      }
      const needsEnglish = containsChinese(text);
      const context = recentConversation(settings.insightContextMessageCount);
      english.value = needsEnglish ? "翻译中..." : text;
      if (needsEnglish) {
        try {
          english.value = await askBackground({ type: "draftToEnglish", draft: text, context });
        } catch (error) {
          english.value = "";
          status.textContent = `翻译失败: ${error.message}`;
          return;
        }
      }
      if (!english.value.trim()) {
        status.textContent = "没有得到英文，请重试";
        return;
      }
      if (containsChinese(english.value)) {
        status.textContent = "翻译结果里还有中文，请手动改成英文";
        english.focus();
        return;
      }
      if (!settings.checkBeforeSend) return;
      checkBox.hidden = false;
      checkBox.className = "ctt-send-check";
      checkBox.textContent = "正在结合上下文检查...";
      try {
        showCheck(await askBackground({
          type: "checkMessage",
          message: english.value.trim(),
          draft: needsEnglish ? text : "",
          context,
        }));
      } catch (error) {
        checkBox.textContent = `检查失败: ${error.message}。英文仍然可以复制`;
      }
    } finally {
      run.disabled = false;
    }
  };

  const copyEnglish = async () => {
    const text = english.value.trim();
    if (!text) return;
    if (containsChinese(text)) {
      status.textContent = "英文里还有中文，请改成英文再复制";
      return;
    }
    await navigator.clipboard.writeText(text);
    status.textContent = "";
    copy.textContent = "已复制";
    setTimeout(() => (copy.textContent = verdict === "block" ? "仍然复制" : "复制英文"), COPIED_FEEDBACK_MS);
  };

  const open = () => {
    panel.hidden = false;
    if (settings.writerSize) {
      panel.style.width = `${settings.writerSize.width}px`;
      panel.style.height = `${settings.writerSize.height}px`;
    }
    restorePosition(panel, settings.writerPosition);
    draft.focus();
  };

  const fabWasDragged = makeDraggable(fab, fab, "writerButtonPosition");
  makeDraggable(panel, header, "writerPosition");
  rememberSize(panel);
  fab.addEventListener("click", () => {
    if (fabWasDragged()) return;
    if (panel.hidden) open();
    else panel.hidden = true;
  });
  // A smaller window can leave a moved button or panel off screen.
  window.addEventListener("resize", () => {
    restorePosition(fab, settings.writerButtonPosition);
    if (!panel.hidden) restorePosition(panel, settings.writerPosition);
  });
  close.addEventListener("click", () => (panel.hidden = true));
  run.addEventListener("click", translateAndCheck);
  copy.addEventListener("click", copyEnglish);
  // Teams has global shortcuts, so keys typed in the panel must not reach it.
  panel.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Escape") panel.hidden = true;
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && event.target === draft) {
      event.preventDefault();
      translateAndCheck();
    }
  });

  // Called when a send containing Chinese was stopped: the Teams draft is moved here and translated.
  const takeOverDraft = (text) => {
    draft.value = text;
    notice.textContent = "Teams 输入框里有中文，这次没有发送。复制下面的英文，替换输入框里的内容后再发送";
    notice.hidden = false;
    open();
    translateAndCheck();
  };
  draft.addEventListener("input", () => (notice.hidden = true));

  return { fab, panel, takeOverDraft };
}

// Only the top frame gets the floating button; content scripts also run inside Teams' embedded frames.
const writer = window.top === window ? buildWriter() : null;

function ensureWriterOnPage() {
  if (!writer || document.body.contains(writer.fab)) return;
  document.body.append(writer.fab, writer.panel);
  restorePosition(writer.fab, settings.writerButtonPosition);
}

PAGE_SCANNERS.push(ensureWriterOnPage);

// The editor and its send button share a compose area but neither contains the other.
function nearestInComposeArea(start, selector) {
  for (let node = start.parentElement; node; node = node.parentElement) {
    const match = node.querySelector(selector);
    if (match) return match;
  }
  return null;
}

function isSendKey(event) {
  return event.key === "Enter" && !event.shiftKey && !event.altKey && !event.isComposing;
}

// While the @mention list is open, Enter picks a person instead of sending. The editor marks the highlighted
// option with aria-activedescendant; a stale id pointing at nothing visible must not let Chinese through.
function isSuggestionListOpen(editor) {
  const optionId = editor.getAttribute("aria-activedescendant");
  const option = optionId && document.getElementById(optionId);
  return Boolean(option && option.getClientRects().length);
}

const TAKE_OVER_MESSAGE = "ctt-take-over-draft";

// A Teams box inside an embedded frame cannot reach the top frame's panel directly, so it posts the draft up.
function stopChineseSend(event, editor) {
  event.preventDefault();
  event.stopImmediatePropagation();
  const text = editor.innerText.trim();
  if (writer) writer.takeOverDraft(text);
  else window.top.postMessage({ type: TAKE_OVER_MESSAGE, text }, "*");
}

if (writer) {
  window.addEventListener("message", (event) => {
    if (event.source !== window && event.data?.type === TAKE_OVER_MESSAGE) writer.takeOverDraft(String(event.data.text));
  });
}

document.addEventListener(
  "keydown",
  (event) => {
    if (!settings.blockChineseOnSend || !isSendKey(event)) return;
    const editor = event.target.closest?.(TEAMS_SELECTORS.composeBox);
    if (!editor || isSuggestionListOpen(editor) || !containsChinese(editor.innerText)) return;
    stopChineseSend(event, editor);
  },
  true
);

document.addEventListener(
  "click",
  (event) => {
    const button = event.target.closest?.(TEAMS_SELECTORS.sendButton);
    if (!button || !settings.blockChineseOnSend) return;
    const editor = nearestInComposeArea(button, TEAMS_SELECTORS.composeBox);
    if (!editor || !containsChinese(editor.innerText)) return;
    stopChineseSend(event, editor);
  },
  true
);
