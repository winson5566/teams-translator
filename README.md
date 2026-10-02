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

- English messages that scroll into view get a Chinese translation underneath.
- Click the toolbar button for switches: automatic translation (badge shows OFF when paused),
  confirmation before sending, and the content check; "更多设置" opens the full preferences.
- Pressing Enter or the send button in Teams opens a confirmation dialog first (Esc cancels). Confirming only
  puts the final text into Teams' box; you send it yourself with Enter or the send button.
  A draft containing Chinese is translated to English in the dialog; only the (editable) English is sent.
  The dialog also checks the message against the conversation (wrong chat, contradictions, misunderstanding,
  tone, secrets) and warns or blocks; secrets are detected locally and never sent to DeepSeek.
  Turn the check off with "发送前检查内容".
  Turn it off with "发送前确认" in the preferences.
- Click the round "i" after a translation for a context-aware explanation of the message and
  2 to 3 suggested replies in English with Chinese meaning; "复制" copies the English reply.
  Set "你在 Teams 里显示的名字" in the preferences so replies are written from your side.

## When Teams changes its markup

All DOM selectors are in `selectors.js`. If no translations appear, inspect a chat message
in Teams (right click, Inspect) and update `messageBody`, `authorName` and `ownMessage`.

## Test

Run `python3 test/serve.py` and open the URL it prints; `test/fake-teams.html`,
`test/send-confirm.html` and `test/popup.html` list PASS/FAIL for each behaviour. It stubs the extension API and DeepSeek, so no key is needed.

`icons/icon.svg` is the source of the PNG icons; Chrome and Edge do not accept SVG icons.
