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
      browser.runtime.sendMessage({ type: "translate", ...request }).then(resolve, reject)
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
  const pending = browser.runtime.sendMessage({ type: "explain", ...request });
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

function copyButton(text) {
  const button = element("button", "ctt-button", "复制");
  button.addEventListener("click", async (event) => {
    event.stopPropagation();
    await navigator.clipboard.writeText(text);
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
      englishLine.append(copyButton(english));
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

async function translateBody(body) {
  const request = messageWithContext(body, settings.contextMessageCount);
  const text = request.message.text;
  if (!hasWords(text) || isMostlyChinese(text)) {
    body.setAttribute(STATE_ATTR, "skipped");
    return;
  }
  body.setAttribute(STATE_ATTR, "translating");
  const box = document.createElement("div");
  box.className = BOX_CLASS;
  box.classList.toggle("ctt-mine", request.message.isMine);
  box.textContent = "翻译中...";
  body.after(box);
  try {
    const translation = await requestTranslation(request);
    box.replaceChildren(element("span", "ctt-text", translation), insightButton(body, box, request.message.isMine));
    body.setAttribute(STATE_ATTR, "done");
  } catch (error) {
    box.textContent = `翻译失败: ${error.message}`;
    box.classList.add("ctt-error");
    body.setAttribute(STATE_ATTR, "failed");
  }
}

const visibilityObserver = new IntersectionObserver((entries) => {
  if (!settings.enabled) return;
  for (const entry of entries) {
    if (entry.isIntersecting && entry.target.getAttribute(STATE_ATTR) === "waiting") {
      visibilityObserver.unobserve(entry.target);
      translateBody(entry.target);
    }
  }
});

function observeNewMessages() {
  for (const body of allMessageBodies()) {
    if (!body.hasAttribute(STATE_ATTR)) {
      body.setAttribute(STATE_ATTR, "waiting");
      visibilityObserver.observe(body);
    }
  }
}

// IntersectionObserver only reports changes, so waiting messages are re-observed to get a fresh report after resuming.
function reobserveWaitingMessages() {
  for (const body of document.querySelectorAll(`[${STATE_ATTR}="waiting"]`)) {
    visibilityObserver.unobserve(body);
    visibilityObserver.observe(body);
  }
}

browser.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  for (const [key, { newValue }] of Object.entries(changes)) {
    settings[key] = newValue;
  }
  if (changes.enabled?.newValue) reobserveWaitingMessages();
});

loadSettings().then((loaded) => {
  settings = loaded;
  observeNewMessages();
  let scanPending = false;
  const scheduleScan = () => {
    if (scanPending) return;
    scanPending = true;
    setTimeout(() => {
      scanPending = false;
      observeNewMessages();
    }, SCAN_DELAY_MS);
  };
  new MutationObserver(scheduleScan).observe(document.body, { childList: true, subtree: true });
});
