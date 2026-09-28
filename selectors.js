// Every Teams DOM assumption lives here; when Teams changes its markup, only this file changes.
const TEAMS_SELECTORS = {
  messageBody: [
    '[data-tid="chat-pane-message"]',
    '[data-tid="channel-pane-message"]',
  ].join(","),
  authorName: '[data-tid="message-author-name"]',
  // Teams renders the signed-in user's messages with Fluent UI's ChatMyMessage component and no author name.
  ownMessage: '[class*="ChatMyMessage"]',
  // The message editor and its send button, in chats, channel replies and new posts.
  composeBox: '[data-tid^="ckeditor"], [contenteditable="true"][role="textbox"]',
  sendButton: [
    '[data-tid="newMessageCommands-send"]',
    '[data-tid*="send-button"]',
    'button[name="send"]',
    'button[aria-label^="Send"]',
  ].join(","),
  // Reactions, emoji and controls inside a message body that are not part of what the sender wrote.
  notMessageText: [
    "button",
    '[role="button"]',
    '[data-tid*="reaction"]',
    '[data-tid*="emoji"]',
    '[data-tid*="emoticon"]',
    'img',
    '[itemtype*="Emoji"]',
  ].join(","),
};
