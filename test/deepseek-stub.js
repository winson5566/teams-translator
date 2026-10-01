// Builds a streamed DeepSeek chat response: a keep-alive comment, optional reasoning, the content in two
// pieces, a usage chunk and [DONE]. The bytes are split mid-line (and possibly mid-character) to mimic the network.
function streamed(content, { reasoning = "", model = "deepseek-flash" } = {}) {
  const events = [];
  if (reasoning) events.push({ model, choices: [{ delta: { reasoning_content: reasoning } }] });
  const half = Math.ceil(content.length / 2);
  events.push({ model, choices: [{ delta: { role: "assistant", content: content.slice(0, half) } }] });
  events.push({ model, choices: [{ delta: { content: content.slice(half) }, finish_reason: "stop" }] });
  events.push({ model, choices: [], usage: { prompt_tokens: 10, completion_tokens: 5 } });
  const text = ": keep-alive\n\n" + events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("") + "data: [DONE]\n\n";
  const bytes = new TextEncoder().encode(text);
  const cut = Math.floor(bytes.length / 3) + 1;
  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(bytes.slice(0, cut));
      controller.enqueue(bytes.slice(cut));
      controller.close();
    },
  }));
}
