// Chinese detection shared by the background script and the Teams page.
const CJK_CHARACTERS = /[\u3400-\u9fff\uf900-\ufaff]/g;
// Messages already mostly in Chinese are not translated.
const CJK_RATIO_TO_SKIP = 0.3;
// CJK symbols and full-width forms such as the Chinese comma only come from a Chinese input method.
// Curly quotes and the ellipsis are left out because English text uses them too.
const CHINESE_TEXT = /[\u3400-\u9fff\uf900-\ufaff\u3000-\u303f\uff00-\uffef]/;

function isMostlyChinese(text) {
  const visible = text.replace(/\s/g, "");
  const cjk = visible.match(CJK_CHARACTERS)?.length ?? 0;
  return visible.length > 0 && cjk / visible.length > CJK_RATIO_TO_SKIP;
}

function containsChinese(text) {
  return CHINESE_TEXT.test(text);
}
