const MAX_CONCURRENT_REQUESTS = 3;
const STATE_ATTR = "data-ctt-state";
const BOX_CLASS = "ctt-translation";
const COPIED_FEEDBACK_MS = 1500;
// How far up from a message body to look for its sender's name before giving up.
const AUTHOR_SEARCH_DEPTH = 8;
// How many earlier messages to scan for the sender of the first message in a context window.
const AUTHOR_LOOKBACK = 50;
// Teams mutates the page constantly; new messages are looked for at most this often.
const SCAN_DELAY_MS = 100;
// Functions that add the extension's controls to new parts of the page; other content scripts append theirs.
const PAGE_SCANNERS = [];

let settings = { ...DEFAULT_SETTINGS };
const translationsByText = new Map();
const insightsByText = new Map();
const requestQueue = [];
let activeRequests = 0;

// innerText of the whole body would include reaction counts and emoji labels, so text nodes are collected by hand.
function messageText(body) {
  const parts = [];
  const collect = (node) => {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        parts.push(child.data);
      } else if (child.nodeType === Node.ELEMENT_NODE && !child.matches(TEAMS_SELECTORS.notMessageText)) {
        const display = getComputedStyle(child).display;
        if (display === "none") continue;
        const isBlock = child.tagName === "BR" || !display.startsWith("inline");
        if (isBlock) parts.push("\n");
        collect(child);
        if (isBlock) parts.push("\n");
      }
    }
  };
  collect(body);
  return parts.join("").replace(/[ \t]*\n\s*/g, "\n").trim();
}

function hasWords(text) {
  return /\p{L}/u.test(text);
}

function allMessageBodies() {
  return [...document.querySelectorAll(TEAMS_SELECTORS.messageBody)];
}

// The name sits in a different wrapper in chats and channel threads, so search outward from the body.
// A name found under an ancestor that also holds another message may be someone else's.
function authorNameOf(body) {
  let node = body.parentElement;
  for (let depth = 0; node && depth < AUTHOR_SEARCH_DEPTH; depth++, node = node.parentElement) {
    const name = node.querySelector(TEAMS_SELECTORS.authorName)?.innerText.trim();
    if (name) return node.querySelectorAll(TEAMS_SELECTORS.messageBody).length > 1 ? "" : name;
  }
  return "";
}

// Reading a body's text and sender touches layout, so each is computed once until the body's content changes.
const bodyDetailsCache = new WeakMap();

function bodyDetails(body) {
  const snapshot = body.textContent;
  const cached = bodyDetailsCache.get(body);
  if (cached?.snapshot === snapshot) return cached;
  const details = { snapshot, name: authorNameOf(body), text: messageText(body) };
  bodyDetailsCache.set(body, details);
  return details;
}

function isOwnMessage(body, name) {
  return Boolean(body.closest(TEAMS_SELECTORS.ownMessage)) || (Boolean(name) && name === settings.myName);
}

// Consecutive messages from one sender show the name only on the first, so the author carries forward.
// The user's own messages show no name at all, so they must not inherit the previous sender.
function withAuthors(bodies, precedingAuthor) {
  let lastAuthor = precedingAuthor;
  return bodies.map((body) => {
    const { name, text } = bodyDetails(body);
    const isMine = isOwnMessage(body, name);
    if (isMine) return { body, author: settings.myName || "Me", isMine, text };
    if (name) lastAuthor = name;
    return { body, author: lastAuthor, isMine, text };
  });
}

// The sender a message inherits when it shows no name: the nearest earlier named message from someone else.
function authorBefore(bodies, index) {
  for (let i = index - 1; i >= Math.max(0, index - AUTHOR_LOOKBACK); i--) {
    const { name } = bodyDetails(bodies[i]);
    if (name && !isOwnMessage(bodies[i], name)) return name;
  }
  return "";
}

// Messages bodies[..end) with senders, reaching back only far enough to hold `count` messages with text.
function messagesEndingAt(bodies, end, count) {
  let start = end;
  for (let withText = 0; start > 0 && withText < count; ) {
    start--;
    if (bodyDetails(bodies[start]).text) withText++;
  }
  return withAuthors(bodies.slice(start, end), authorBefore(bodies, start));
}

const toMessage = ({ author, isMine, text }) => ({ author, isMine, text });

function lastMessages(messages, count) {
  return messages.filter((m) => m.text).slice(-count).map(toMessage);
}

function messageWithContext(body, contextMessageCount) {
  const bodies = allMessageBodies();
  const messages = messagesEndingAt(bodies, bodies.indexOf(body) + 1, contextMessageCount + 1);
  return {
    message: toMessage(messages.at(-1)),
    context: lastMessages(messages.slice(0, -1), contextMessageCount),
  };
}

function recentConversation(contextMessageCount) {
  const bodies = allMessageBodies();
  return lastMessages(messagesEndingAt(bodies, bodies.length, contextMessageCount), contextMessageCount);
}

function runQueue() {
  while (activeRequests < MAX_CONCURRENT_REQUESTS && requestQueue.length) {
    const job = requestQueue.shift();
    activeRequests++;
    job().finally(() => {
      activeRequests--;
      runQueue();
    });
  }
}

function requestTranslation(request) {
  const cached = translationsByText.get(request.message.text);
  if (cached) return cached;
  const pending = new Promise((resolve, reject) => {
    requestQueue.push(() =>
      askBackground({ type: "translate", ...request }).then(resolve, reject)
    );
    runQueue();
  });
  translationsByText.set(request.message.text, pending);
  pending.catch(() => translationsByText.delete(request.message.text));
  return pending;
}

function requestInsight(request) {
  const cached = insightsByText.get(request.message.text);
  if (cached) return cached;
  const pending = askBackground({ type: "explain", ...request });
  insightsByText.set(request.message.text, pending);
  pending.catch(() => insightsByText.delete(request.message.text));
  return pending;
}

function element(tag, className, text = "") {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

// The text is read on click, so a message edited after the button was added copies its current text.
function copyButton(textToCopy) {
  const button = element("button", "ctt-button ctt-copy-button", "复制");
  button.addEventListener("click", async (event) => {
    event.stopPropagation();
    await navigator.clipboard.writeText(textToCopy());
    button.textContent = "已复制";
    setTimeout(() => (button.textContent = "复制"), COPIED_FEEDBACK_MS);
  });
  return button;
}

function renderInsight(panel, { explanation, replies }, isMine) {
  panel.replaceChildren(
    element("div", "ctt-heading", isMine ? "别人读到会怎么理解" : "解读"),
    element("div", "ctt-explanation", explanation),
    element("div", "ctt-heading", isMine ? "更好的说法" : "建议回复"),
    ...replies.map(({ english, translation }) => {
      const reply = element("div", "ctt-reply");
      const englishLine = element("div", "ctt-reply-english", english);
      englishLine.append(copyButton(() => english));
      reply.append(englishLine, element("div", "ctt-reply-translation", translation));
      return reply;
    })
  );
}

async function toggleInsight(body, box, isMine) {
  const existing = box.nextElementSibling;
  if (existing?.classList.contains("ctt-insight")) {
    existing.hidden = !existing.hidden;
    return;
  }
  const panel = element("div", "ctt-insight", "正在结合上下文分析...");
  box.after(panel);
  try {
    const insight = await requestInsight(messageWithContext(body, settings.insightContextMessageCount));
    renderInsight(panel, insight, isMine);
  } catch (error) {
    panel.textContent = `分析失败: ${error.message}`;
    panel.classList.add("ctt-error");
  }
}

function insightButton(body, box, isMine) {
  const button = element("button", "ctt-button ctt-insight-button", "i");
  button.title = isMine ? "检查我的表达" : "解读 & 建议回复";
  button.setAttribute("aria-label", button.title);
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleInsight(body, box, isMine);
  });
  return button;
}

// Translation runs only when the user clicks a message's button; its result sits in a container after
// the message's action bar so one click can hide or show the translation and any insight panel together.
async function translateBody(body, actions) {
  const request = messageWithContext(body, settings.contextMessageCount);
  const result = element("div", "ctt-result");
  const box = element("div", BOX_CLASS, "翻译中...");
  box.classList.toggle("ctt-mine", request.message.isMine);
  result.append(box);
  actions.after(result);
  try {
    const translation = await requestTranslation(request);
    box.replaceChildren(element("span", "ctt-text", translation), insightButton(body, box, request.message.isMine));
    body.setAttribute(STATE_ATTR, "done");
  } catch (error) {
    box.textContent = `翻译失败: ${error.message}。再点一次“译”重试`;
    box.classList.add("ctt-error");
    body.setAttribute(STATE_ATTR, "failed");
  }
}

function toggleTranslation(body, actions, button) {
  const result = actions.nextElementSibling?.classList.contains("ctt-result") ? actions.nextElementSibling : null;
  if (result && !result.querySelector(".ctt-error")) {
    result.hidden = !result.hidden;
    button.classList.toggle("ctt-open", !result.hidden);
    return;
  }
  result?.remove();
  button.classList.add("ctt-open");
  translateBody(body, actions);
}

// Every message with words can be copied; only those not already in Chinese can be translated.
function messageActions(body, canTranslate) {
  const actions = element("div", "ctt-actions");
  if (canTranslate) {
    const button = element("button", "ctt-button ctt-translate-button", "译");
    button.title = "翻译这条消息";
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleTranslation(body, actions, button);
    });
    actions.append(button);
  }
  const copy = copyButton(() => bodyDetails(body).text);
  copy.title = "复制这条消息的原文";
  actions.append(copy);
  return actions;
}

function addMessageActions() {
  for (const body of allMessageBodies()) {
    if (body.hasAttribute(STATE_ATTR)) continue;
    const { text } = bodyDetails(body);
    if (!hasWords(text)) {
      body.setAttribute(STATE_ATTR, "skipped");
      continue;
    }
    const canTranslate = !isMostlyChinese(text);
    body.setAttribute(STATE_ATTR, canTranslate ? "ready" : "copy-only");
    body.after(messageActions(body, canTranslate));
  }
}

PAGE_SCANNERS.push(addMessageActions);

// Turning the extension off hides its buttons and results rather than removing them.
function showExtensionElements(enabled) {
  document.documentElement.classList.toggle("ctt-hidden", !enabled);
}

browser.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  for (const [key, { newValue }] of Object.entries(changes)) {
    settings[key] = newValue;
  }
  if (changes.enabled) showExtensionElements(changes.enabled.newValue);
});

loadSettings().then((loaded) => {
  settings = loaded;
  showExtensionElements(settings.enabled);
  const scanPage = () => PAGE_SCANNERS.forEach((scan) => scan());
  scanPage();
  let scanPending = false;
  const scheduleScan = () => {
    if (scanPending) return;
    scanPending = true;
    setTimeout(() => {
      scanPending = false;
      scanPage();
    }, SCAN_DELAY_MS);
  };
  new MutationObserver(scheduleScan).observe(document.body, { childList: true, subtree: true });
});
