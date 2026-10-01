const assert = require("node:assert/strict");
const test = require("node:test");
const { FetchCodexTransport } = require("../dist/agents/codex-transport");

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

test("rejects a failed Responses stream with provider details", async () => {
  const encoder = new TextEncoder();
  const transport = new FetchCodexTransport(async () => ({
    ok: true,
    status: 200,
    statusText: "OK",
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode("data: {\"type\":\"response.failed\",\"response\":{\"status\":500,\"error\":{\"code\":\"server_error\",\"message\":\"Upstream failed\"}}}\n\n"));
        controller.close();
      },
    }),
    json: async () => ({}),
  }));

  await assert.rejects(transport.send({
    endpoint: "https://example.test/v1/responses",
    model: "codex",
    input: "Modify this",
    action: "modify",
    context: [],
    apiKey: "secret",
  }, {}), (error) => {
    assert.match(error.message, /Upstream failed/);
    assert.match(error.message, /server_error/);
    assert.equal(error.status, 500);
    return true;
  });
});

test("requests and maps structured edits for modification responses", async () => {
  let requestBody;
  const transport = new FetchCodexTransport(async (_url, init) => {
    requestBody = JSON.parse(init.body);
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      body: null,
      json: async () => ({ output_text: JSON.stringify({
        text: "Updated the function.",
        edits: [{ path: "src/app.ts", oldText: "old", newText: "new" }],
      }) }),
    };
  });

  const result = await transport.send({
    endpoint: "https://example.test/v1/responses",
    model: "codex",
    input: "Update the function",
    action: "modify",
    context: [],
    apiKey: "secret",
  }, {});

  assert.equal(requestBody.text.format.name, "pairwave_edits");
  assert.deepEqual(result, {
    text: "Updated the function.",
    edits: [{ path: "src/app.ts", oldText: "old", newText: "new" }],
  });
});
