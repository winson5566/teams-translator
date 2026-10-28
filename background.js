const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const TRANSLATION_TIMEOUT_MS = 30000;
// Diagnostics wait longer than real requests so a slow answer is measured instead of cut off.
const DIAGNOSE_MODELS_TIMEOUT_MS = 15000;
const DIAGNOSE_CHAT_TIMEOUT_MS = 90000;
const DIAGNOSE_PROGRESS_MS = 10000;
// The insight answer is several times longer than a translation.
const INSIGHT_TIMEOUT_MS = 60000;
// DeepSeek's documented recommendation for translation tasks.
const TRANSLATION_TEMPERATURE = 1.3;
// A pre-send check should give the same verdict for the same message.
const CHECK_TEMPERATURE = 0;
const CHECK_VERDICTS = ["ok", "warn", "block"];

const formatLine = (m) => `[${m.author || "Unknown"}${m.isMine ? " (the user)" : ""}]: ${m.text}`;

function contextBlock(context) {
  return context.length
    ? `Context (earlier messages, oldest first):\n${context.map(formatLine).join("\n")}\n\n`
    : "";
}

function conversationBlock({ message, context }, focusLabel) {
  return `${contextBlock(context)}${focusLabel}:\n${formatLine(message)}`;
}

function buildTranslationPrompt(request, targetLanguage) {
  const system =
    `You translate Microsoft Teams work chat messages into ${targetLanguage}. ` +
    "You are given earlier messages from the same conversation as context, then one message to translate. " +
    "Use the context only to resolve pronouns, abbreviations, jargon and tone. " +
    "Translate only the final message. Keep names, product names, code, URLs, @mentions and emoji unchanged. " +
    "Output only the translation, with no notes or quotes.";
  return [
    { role: "system", content: system },
    { role: "user", content: conversationBlock(request, "Message to translate") },
  ];
}

const REPLY_STYLE =
  "Write replies exactly like a real person typing in a Microsoft Teams chat with a coworker: " +
  "short, relaxed, often a fragment, lowercase starts are fine. Use contractions. " +
  "Chat abbreviations such as thx, btw, lmk or eod are allowed but sparing: at most one per reply, " +
  "and most replies should have none. The occasional simple emoji such as 👍 is fine, never more than one. " +
  "Match the formality of the conversation. No greetings, no sign-offs, no filler such as " +
  '"Certainly", "Absolutely", "Great question", "I hope this helps" or "Please let me know", ' +
  "no dashes, and do not end a reply with a full stop. " +
  'Good examples: "yep on it", "sounds good 👍", "which branch?", "sure, I\'ll push it later today", ' +
  '"can we move it to tomorrow? kinda swamped today", "thx, will take a look". ';

// Models still add a closing full stop sometimes; a trailing "..." is kept because it reads as human.
function withoutClosingFullStop(reply) {
  return reply.trim().replace(/(?<!\.)\.$/, "");
}

const READING_RULES =
  "Before judging a message, work out who is talking to whom: in group chats and threads most messages are " +
  "between other people, not addressed to the user. Work out which earlier message the focus message responds to. " +
  "If it does not make literal sense as an answer to that message, it is probably a joke: a pun, a deliberate " +
  "misreading of a word, sarcasm or banter. A common pattern is replying to an idiom or phrasal verb as if it " +
  "were meant literally, or answering a different sense of a word than the one intended. ";

const EXPLANATION_RULES =
  "In the explanation, refer to people by name and only say \"you\" when the message is addressed to the user. " +
  "When the message is a joke, spell out the joke: which word or phrase is being played on, its two meanings, " +
  "and how the message twists it. ";

const GROUNDED_REPLIES =
  "Every reply must belong to this exact conversation: pick up its concrete details, such as the names, times, " +
  "tasks or the joke being made. A reply that could be pasted into any other chat is wrong. " +
  "If the user has written earlier messages in this conversation, match their voice: length, capitalisation, " +
  "punctuation and the words they use. ";

function insightTask(isMine, targetLanguage) {
  if (isMine) {
    return (
      "The focus message was written by the user. " +
      `"explanation" is written in ${targetLanguage}: how the other people in this conversation will read it, ` +
      "its tone, whether it is clear, and anything that could be misunderstood. Keep it short. " +
      EXPLANATION_RULES +
      `"replies" has 2 or 3 improved rewrites of the user's message, keeping the user's intent, ` +
      `with "translation" giving each one's meaning in ${targetLanguage}. ` +
      GROUNDED_REPLIES +
      REPLY_STYLE
    );
  }
  return (
    `"explanation" is written in ${targetLanguage}: who is talking to whom, what the sender really means in this ` +
    "context, their tone, what they want and from whom, and any jargon, idioms or abbreviations. Keep it short. " +
    EXPLANATION_RULES +
    `"replies" has 2 or 3 messages the user could actually send next, with "translation" giving each one's ` +
    `meaning in ${targetLanguage}. They differ in what the user might genuinely want to say in this situation, ` +
    "not by a fixed template. When the focus message is addressed to the user, they answer it. " +
    "When it is between other people, they are natural ways for the user to chip in, " +
    "and never answer on behalf of the person who was addressed. " +
    GROUNDED_REPLIES +
    REPLY_STYLE
  );
}

function buildInsightPrompt(request, { targetLanguage }) {
  const system =
    `You help an employee whose first language is ${targetLanguage} understand English Microsoft Teams work chats and reply to them. ` +
    'Messages marked "(the user)" were written by that employee; every other message was written by someone else. ' +
    "Read the whole conversation, then focus on the final message. " +
    READING_RULES +
    "Respond with json only, in this shape: " +
    `{"explanation": string, "replies": [{"english": string, "translation": string}]}. ` +
    insightTask(request.message.isMine, targetLanguage);
  return [
    { role: "system", content: system },
    { role: "user", content: conversationBlock(request, "Focus message") },
  ];
}

function buildDraftTranslationPrompt({ draft, context }) {
  const system =
    "You turn a draft Microsoft Teams chat message into the English message the user will send. " +
    "The draft is written by the user, partly or fully in Chinese. Translate every Chinese word and Chinese " +
    "punctuation mark; the output must not contain a single Chinese character, even when the draft is very short " +
    "or looks like a label or a test. Translate faithfully: say exactly what the draft says, never something that " +
    "would fit the conversation better. When the draft is unclear, looks like a typo or makes no sense, translate " +
    "it literally anyway; a later check will point it out. Keep names, product names, code, URLs, @mentions and " +
    "emoji, and keep any parts already in English. Use the earlier messages only to pick between wordings that " +
    "mean the same thing. " +
    REPLY_STYLE +
    "Output only the English message, with no notes or quotes.";
  return [
    { role: "system", content: system },
    { role: "user", content: `${contextBlock(context)}Draft to turn into English:\n${draft}` },
  ];
}

function buildSendCheckPrompt({ message, draft, context }, { targetLanguage }) {
  const system =
    "You check a Microsoft Teams chat message the user is about to send, to catch mistakes before it goes out. " +
    'Messages marked "(the user)" were written by the user; every other message was written by someone else. ' +
    READING_RULES +
    "Look for these problems only: " +
    "1. Wrong chat: the message clearly does not belong in this conversation, for example it answers something " +
    "nobody asked here or names people or topics that appear nowhere in it. With little or no context, never claim this. " +
    "2. Contradiction: names, days, dates, times, numbers or decisions that disagree with the conversation. " +
    "3. Misunderstanding: the message answers something other than what was said, or takes a joke literally. " +
    "4. Tone clearly wrong for the people in this conversation. " +
    "5. Secrets or sensitive data such as passwords, keys, tokens or personal data. " +
    "6. Nothing to respond to: even a short reply such as ok or thanks must answer something in the conversation. " +
    "If the latest messages are the user's own, or nobody said anything the reply could be answering, it does not fit. " +
    (draft
      ? "7. Translation: the message is the user's English translation of their Chinese draft. Flag it when the " +
        "English does not say what the draft says, or when the draft itself looks like a typo or makes no sense. "
      : "") +
    "Only flag real, specific problems. " +
    "Respond with json only, in this shape: " +
    '{"verdict": "ok" | "warn" | "block", "issues": [string], "suggestion": string}. ' +
    '"block" is only for a wrong chat or secrets, "warn" for the other problems, "ok" when there is nothing to flag. ' +
    'Never answer "ok" while listing issues. ' +
    `"issues" lists each problem as one short sentence in ${targetLanguage} naming exactly what is wrong; empty when ok. ` +
    '"suggestion" is a corrected English message that fixes the problems, or an empty string when none is needed. ' +
    REPLY_STYLE;
  return [
    { role: "system", content: system },
    {
      role: "user",
      content:
        contextBlock(context) +
        (draft ? `The user's Chinese draft:\n${draft}\n\n` : "") +
        `Message the user is about to send:\n${message}`,
    },
  ];
}

function postToDeepSeek(settings, requestBody, timeoutMs) {
  return fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.apiKey}`,
    },
    // Current models think before answering unless told not to, which makes every request much slower.
    // Streamed so text arrives as it is generated instead of after one long silent wait.
    body: JSON.stringify({
      model: settings.model,
      stream: true,
      stream_options: { include_usage: true },
      thinking: { type: "disabled" },
      ...requestBody,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
}

const isTimeout = (error) => error.name === "TimeoutError" || error.name === "AbortError";

// Reads DeepSeek's server-sent events, handing each parsed chunk to onChunk until "[DONE]".
// Lines that are not "data:" lines, such as keep-alive comments, are skipped.
async function readEventStream(response, onChunk) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    buffered += decoder.decode(value, { stream: true });
    const lines = buffered.split("\n");
    buffered = lines.pop();
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice("data:".length).trim();
      if (data === "[DONE]") return;
      onChunk(JSON.parse(data));
    }
  }
}

async function callDeepSeek(requestBody, timeoutMs) {
  const settings = await loadSettings();
  if (!settings.apiKey) {
    throw new Error("未设置 DeepSeek API key，请在插件设置页填写");
  }
  let content = "";
  try {
    const response = await postToDeepSeek(settings, requestBody, timeoutMs);
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`DeepSeek HTTP ${response.status}: ${body.slice(0, 200)}`);
    }
    await readEventStream(response, (chunk) => {
      content += chunk.choices?.[0]?.delta?.content ?? "";
    });
  } catch (error) {
    if (!isTimeout(error)) throw error;
    throw new Error(
      `DeepSeek ${timeoutMs / 1000} 秒内没有回应完（模型 ${settings.model}），可以在设置页点“诊断”查看原因`,
      { cause: error }
    );
  }
  if (!content.trim()) {
    throw new Error(`DeepSeek returned no content (model ${settings.model})`);
  }
  return content.trim();
}

async function translate(request) {
  const { targetLanguage } = await loadSettings();
  return callDeepSeek({
    messages: buildTranslationPrompt(request, targetLanguage),
    temperature: TRANSLATION_TEMPERATURE,
  }, TRANSLATION_TIMEOUT_MS);
}

const STILL_CHINESE_FOLLOW_UP =
  "That still contains Chinese. Translate every remaining Chinese character and punctuation mark into English " +
  "and output only the English message.";

// Models sometimes hand short mixed drafts back unchanged, so one follow-up asks again before giving up.
async function translateDraftToEnglish(request) {
  const messages = buildDraftTranslationPrompt(request);
  const ask = () => callDeepSeek({ messages, temperature: TRANSLATION_TEMPERATURE }, TRANSLATION_TIMEOUT_MS);
  let english = await ask();
  if (containsChinese(english)) {
    messages.push({ role: "assistant", content: english }, { role: "user", content: STILL_CHINESE_FOLLOW_UP });
    english = await ask();
  }
  return withoutClosingFullStop(english);
}

function parseSendCheck(content) {
  const check = JSON.parse(content);
  const isValid =
    CHECK_VERDICTS.includes(check.verdict) &&
    Array.isArray(check.issues) &&
    check.issues.every((issue) => typeof issue === "string") &&
    typeof check.suggestion === "string";
  if (!isValid) {
    throw new Error(`DeepSeek returned an unexpected check shape: ${content.slice(0, 200)}`);
  }
  const suggestion = withoutClosingFullStop(check.suggestion);
  return {
    verdict: check.verdict,
    issues: check.issues,
    suggestion: containsChinese(suggestion) ? "" : suggestion,
  };
}

async function checkBeforeSending(request) {
  if (!request.message?.trim()) throw new Error("没有可以检查的内容");
  const settings = await loadSettings();
  const content = await callDeepSeek({
    messages: buildSendCheckPrompt(request, settings),
    temperature: CHECK_TEMPERATURE,
    response_format: { type: "json_object" },
  }, TRANSLATION_TIMEOUT_MS);
  return parseSendCheck(content);
}

function parseInsight(content) {
  const insight = JSON.parse(content);
  const repliesAreValid =
    Array.isArray(insight.replies) &&
    insight.replies.every((r) => typeof r.english === "string" && typeof r.translation === "string");
  if (typeof insight.explanation !== "string" || !repliesAreValid) {
    throw new Error(`DeepSeek returned an unexpected insight shape: ${content.slice(0, 200)}`);
  }
  return {
    explanation: insight.explanation,
    replies: insight.replies.map((r) => ({ ...r, english: withoutClosingFullStop(r.english) })),
  };
}

async function explainInContext(request) {
  const settings = await loadSettings();
  const content = await callDeepSeek({
    messages: buildInsightPrompt(request, settings),
    response_format: { type: "json_object" },
  }, INSIGHT_TIMEOUT_MS);
  return parseInsight(content);
}

const DIAGNOSE_SAMPLE = { message: { author: "Alice", text: "Can you push the fix to staging before EOD?" }, context: [] };

// Reports each step as it happens, so a hang shows exactly where it stopped.
async function diagnose(report) {
  const settings = await loadSettings();
  const elapsed = (start) => `${Math.round(performance.now() - start)} 毫秒`;
  report(`插件版本 ${browser.runtime.getManifest().version}，模型 ${settings.model}，API key ${settings.apiKey ? "已填" : "未填"}`);
  if (!settings.apiKey) return;

  let start = performance.now();
  report("1/2 获取可用模型列表...");
  try {
    const response = await fetch(`${DEEPSEEK_BASE_URL}/models`, {
      headers: { Authorization: `Bearer ${settings.apiKey}` },
      signal: AbortSignal.timeout(DIAGNOSE_MODELS_TIMEOUT_MS),
    });
    report(`模型列表: HTTP ${response.status}，用时 ${elapsed(start)}`);
    if (response.ok) {
      const modelIds = (await response.json()).data.map((model) => model.id);
      report(`你的账号可用的模型: ${modelIds.join(", ")}`);
      if (!modelIds.includes(settings.model)) report(`注意: 当前设置的模型 ${settings.model} 不在这个列表里`);
    } else {
      report(`返回内容: ${(await response.text()).slice(0, 300)}`);
    }
  } catch (error) {
    report(`模型列表失败: ${error.name}: ${error.message}，用时 ${elapsed(start)}`);
  }

  start = performance.now();
  report(`2/2 发送一次翻译请求（最多等 ${DIAGNOSE_CHAT_TIMEOUT_MS / 1000} 秒）...`);
  const progress = { chunks: 0, reasoning: "", content: "", finishReason: "", model: "", usage: null };
  const progressTimer = setInterval(() => {
    report(`  已等待 ${elapsed(start)}：收到 ${progress.chunks} 段，思考 ${progress.reasoning.length} 字，正文 ${progress.content.length} 字`);
  }, DIAGNOSE_PROGRESS_MS);
  try {
    const response = await postToDeepSeek(settings, {
      messages: buildTranslationPrompt(DIAGNOSE_SAMPLE, settings.targetLanguage),
      temperature: TRANSLATION_TEMPERATURE,
    }, DIAGNOSE_CHAT_TIMEOUT_MS);
    report(`翻译请求: HTTP ${response.status}，收到响应头用时 ${elapsed(start)}`);
    if (!response.ok) {
      report(`返回内容: ${(await response.text()).slice(0, 300)}`);
      return;
    }
    await readEventStream(response, (chunk) => {
      const delta = chunk.choices?.[0]?.delta ?? {};
      if (progress.chunks === 0) report(`收到第一段内容用时 ${elapsed(start)}`);
      if (delta.reasoning_content && !progress.reasoning) report(`开始思考，用时 ${elapsed(start)}（说明思考模式没有关掉）`);
      if (delta.content && !progress.content) report(`开始输出正文，用时 ${elapsed(start)}`);
      progress.chunks++;
      progress.reasoning += delta.reasoning_content ?? "";
      progress.content += delta.content ?? "";
      progress.model = chunk.model ?? progress.model;
      progress.finishReason = chunk.choices?.[0]?.finish_reason ?? progress.finishReason;
      progress.usage = chunk.usage ?? progress.usage;
    });
    report(`完成，总用时 ${elapsed(start)}；实际模型 ${progress.model}，结束原因 ${progress.finishReason}`);
    report(`思考 ${progress.reasoning.length} 字，用量 ${JSON.stringify(progress.usage)}`);
    report(`译文: ${progress.content}`);
  } catch (error) {
    report(`翻译请求失败: ${error.name}: ${error.message}，用时 ${elapsed(start)}；已收到 ${progress.chunks} 段，正文 ${progress.content.length} 字`);
  } finally {
    clearInterval(progressTimer);
  }
}

browser.runtime.onConnect.addListener((port) => {
  if (port.name !== "diagnose") return;
  diagnose((line) => port.postMessage(line)).finally(() => port.disconnect());
});

const MESSAGE_HANDLERS = {
  translate,
  explain: explainInContext,
  draftToEnglish: translateDraftToEnglish,
  checkMessage: checkBeforeSending,
};

// Returning true keeps sendResponse open until the handler settles; see askBackground in settings.js.
browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handler = MESSAGE_HANDLERS[msg.type];
  if (!handler) return false;
  handler(msg).then(
    (result) => sendResponse({ ok: true, result }),
    (error) => sendResponse({ ok: false, error: error.message })
  );
  return true;
});

async function showEnabledBadge() {
  const { enabled } = await loadSettings();
  await browser.action.setBadgeText({ text: enabled ? "" : "OFF" });
}

browser.runtime.onInstalled.addListener(async () => {
  const { apiKey } = await loadSettings();
  if (!apiKey) await browser.runtime.openOptionsPage();
});

browser.storage.onChanged.addListener((changes) => {
  if (changes.enabled) showEnabledBadge();
});

showEnabledBadge();
