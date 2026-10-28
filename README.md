# Teams Context Translator

Firefox extension that translates Microsoft Teams web chat messages with the DeepSeek API,
sending the previous messages of the conversation as context.

Privacy: message text from the open Teams conversation is sent to the DeepSeek API with your own key.
Passwords, keys and tokens in a message you are about to send are detected locally and never sent.

## Install in Edge or Chrome

Open `edge://extensions` (or `chrome://extensions`), turn on developer mode, click "Load unpacked" and pick
this folder. No signing is needed, and the extension stays installed across restarts.

## Install in Firefox (temporary)

1. Open `about:debugging#/runtime/this-firefox` in Firefox.
2. Click "Load Temporary Add-on..." and pick `manifest.json` in this folder.
3. Open the extension's preferences (about:addons), paste your DeepSeek API key, click "测试翻译".
4. If the preferences page shows a yellow permissions banner, click "授予权限".
5. Reload the Teams tab.

Temporary add-ons are removed when Firefox restarts; repeat step 2.

## Use

- Each English message gets a small "译" button; clicking it shows the Chinese translation (click again to
  hide it, or to retry after an error).
- Every message with text also gets a "复制" button that copies its original text (without reactions).
- Click the toolbar button for switches: the translate buttons (badge shows OFF when hidden),
  confirmation before sending, and the content check; "更多设置" opens the full preferences.
- The floating "译" button (bottom right; drag it anywhere) opens a floating window, also draggable by its
  title bar and resizable, where you write a message in Chinese or English. It is
  translated to English and checked against the open conversation (wrong chat, contradictions,
  misunderstanding, tone, secrets); copy the English and paste it into Teams yourself. Secrets are detected
  locally and never sent to DeepSeek.
- Sending from Teams works as usual, except that a message still containing Chinese is not sent; the panel
  opens with it instead. Turn that off with "发送时挡住中文"; turn the content check off with "检查内容".
  Turn it off with "发送前确认" in the preferences.
- Click the round "i" after a translation for a context-aware explanation of the message and
  2 to 3 suggested replies in English with Chinese meaning; "复制" copies the English reply.
  Set "你在 Teams 里显示的名字" in the preferences so replies are written from your side.

## When Teams changes its markup

All DOM selectors are in `selectors.js`. If no translations appear, inspect a chat message
in Teams (right click, Inspect) and update `messageBody`, `authorName` and `ownMessage`.

## Test

Run `python3 test/serve.py` and open the URL it prints (keep the tab visible: the window-size tests rely on
the browser rendering it); `test/fake-teams.html`,
`test/writer.html` and `test/popup.html` list PASS/FAIL for each behaviour. It stubs the extension API and DeepSeek, so no key is needed.

`icons/icon.svg` is the source of the PNG icons; Chrome and Edge do not accept SVG icons.
