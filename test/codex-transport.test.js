const assert = require("node:assert/strict");
const test = require("node:test");
const { FetchCodexTransport } = require("../dist/agents");

test("maps Responses stream events and forwards working progress", async () => {
  let fetchArgs;
  const encoder = new TextEncoder();
  const chunks = [
    "data: {\"type\":\"response.output_text.delta\",\"delta\":\"Hello\"}\n\n",
    "data: {\"type\":\"response.completed\",\"response\":{\"output_text\":\"Hello\"}}\n\n",
  ];
  const transport = new FetchCodexTransport(async (url, init) => {
    fetchArgs = { url, init };
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      body: new ReadableStream({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
          controller.close();
        },
      }),
      json: async () => ({}),
    };
  });
  const progress = [];
  const signal = new AbortController().signal;
  const result = await transport.send({
    endpoint: "https://example.test/v1/responses",
    model: "codex",
    input: "Explain this",
    action: "explain",
    context: [],
    apiKey: "secret",
  }, { signal, onProgress: (event) => progress.push(event) });

  assert.equal(result.text, "Hello");
  assert.equal(progress[0].phase, "working");
  assert.equal(fetchArgs.url, "https://example.test/v1/responses");
  assert.equal(fetchArgs.init.signal, signal);
  assert.equal(fetchArgs.init.headers.Authorization, "Bearer secret");
  assert.equal(JSON.parse(fetchArgs.init.body).stream, true);
});
