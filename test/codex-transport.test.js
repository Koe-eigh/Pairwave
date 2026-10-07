const assert = require("node:assert/strict");
const test = require("node:test");
const { FetchCodexTransport } = require("../dist/agents/codex-transport");
const { CodexAgent } = require("../dist/agents/codex");

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
    context: [{ source: "editor", path: "src/app.ts", content: "const answer = 42;" }],
    apiKey: "secret",
  }, { signal, onProgress: (event) => progress.push(event) });

  assert.equal(result.text, "Hello");
  assert.equal(progress[0].phase, "working");
  assert.equal(fetchArgs.url, "https://example.test/v1/responses");
  assert.equal(fetchArgs.init.signal, signal);
  assert.equal(fetchArgs.init.headers.Authorization, "Bearer secret");
  assert.deepEqual(JSON.parse(fetchArgs.init.body), {
    model: "codex",
    input: "explain: Explain this\n\nContext:\n[editor (src/app.ts)]\nconst answer = 42;",
    stream: true,
  });
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

test("rejects malformed modification output", async () => {
  const transport = new FetchCodexTransport(async () => ({
    ok: true, status: 200, statusText: "OK", body: null,
    json: async () => ({ output_text: "not JSON" }),
  }));
  await assert.rejects(transport.send({ endpoint: "https://example.test", model: "codex", input: "Update", action: "modify", context: [], apiKey: "secret" }, {}), /malformed modification output/);
});

test("rejects incomplete streams and parses an unterminated terminal event", async () => {
  const encoder = new TextEncoder();
  const incomplete = new FetchCodexTransport(async () => ({
    ok: true, status: 200, statusText: "OK",
    body: new ReadableStream({ start(controller) { controller.enqueue(encoder.encode("data: {\"type\":\"response.output_text.delta\",\"delta\":\"partial\"}")); controller.close(); } }),
    json: async () => ({}),
  }));
  await assert.rejects(incomplete.send({ endpoint: "https://example.test", model: "codex", input: "x", action: "read", context: [], apiKey: "secret" }, {}), /before response\.completed/);

  const complete = new FetchCodexTransport(async () => ({
    ok: true, status: 200, statusText: "OK",
    body: new ReadableStream({ start(controller) { controller.enqueue(encoder.encode("data: {\"type\":\"response.completed\",\"response\":{\"output_text\":\"done\"}}")); controller.close(); } }),
    json: async () => ({}),
  }));
  const result = await complete.send({ endpoint: "https://example.test", model: "codex", input: "x", action: "read", context: [], apiKey: "secret" }, {});
  assert.equal(result.text, "done");
});

test("propagates non-OK HTTP statuses", async () => {
  for (const status of [401, 429, 503]) {
    const transport = new FetchCodexTransport(async () => ({
      ok: false, status, statusText: "Failure", body: null, json: async () => ({}),
    }));
    await assert.rejects(transport.send({ endpoint: "https://example.test", model: "codex", input: "x", action: "read", context: [], apiKey: "secret" }, {}), (error) => {
      assert.equal(error.status, status);
      return true;
    });
  }
});

test("preserves string streamed failure status for downstream classification", async () => {
  const encoder = new TextEncoder();
  const transport = new FetchCodexTransport(async () => ({
    ok: true, status: 200, statusText: "OK",
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode("data: {\"type\":\"response.failed\",\"response\":{\"status\":\"500\",\"error\":{\"code\":\"server_error\",\"message\":\"Upstream failed\"}}}\n\n"));
        controller.close();
      },
    }),
    json: async () => ({}),
  }));
  await assert.rejects(transport.send({ endpoint: "https://example.test", model: "codex", input: "x", action: "read", context: [], apiKey: "secret" }, {}), (error) => {
    assert.equal(error.status, 500);
    assert.match(error.message, /server_error/);
    return true;
  });
});

test("preserves nested streamed error details", async () => {
  const encoder = new TextEncoder();
  const transport = new FetchCodexTransport(async () => ({
    ok: true, status: 200, statusText: "OK",
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode("data: {\"type\":\"error\",\"error\":{\"status\":\"429\",\"code\":\"rate_limit\",\"message\":\"Too many requests\"}}\n\n"));
        controller.close();
      },
    }),
    json: async () => ({}),
  }));
  await assert.rejects(transport.send({ endpoint: "https://example.test", model: "codex", input: "x", action: "read", context: [], apiKey: "secret" }, {}), (error) => {
    assert.equal(error.status, 429);
    assert.match(error.message, /Too many requests/);
    assert.match(error.message, /rate_limit/);
    return true;
  });
});

test("buffers SSE events split across network chunks", async () => {
  const encoder = new TextEncoder();
  const event = "data: {\"type\":\"response.completed\",\"response\":{\"output_text\":\"split\"}}\n\n";
  const split = Math.floor(event.length / 2);
  const transport = new FetchCodexTransport(async () => ({
    ok: true, status: 200, statusText: "OK",
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(event.slice(0, split)));
        controller.enqueue(encoder.encode(event.slice(split)));
        controller.close();
      },
    }),
    json: async () => ({}),
  }));
  const result = await transport.send({ endpoint: "https://example.test", model: "codex", input: "x", action: "read", context: [], apiKey: "secret" }, {});
  assert.equal(result.text, "split");
});

for (const { name, event, code, retryable } of [
  {
    name: "top-level error fields",
    event: { type: "error", status: 429, code: "rate_limit", message: "Too many requests" },
    code: "rate-limit", retryable: true,
  },
  {
    name: "failed response server error",
    event: { type: "response.failed", response: { status: "failed", error: { code: "server_error", message: "Upstream failed" } } },
    code: "unavailable", retryable: true,
  },
  {
    name: "rate limit without HTTP status",
    event: { type: "error", code: "rate_limit_exceeded", message: "Too many requests" },
    code: "rate-limit", retryable: true,
  },
  {
    name: "unknown provider code",
    event: { type: "response.failed", response: { status: "failed", error: { code: "unknown_error", message: "Unknown failure" } } },
    code: "request", retryable: false,
  },
  {
    name: "explicit HTTP status takes precedence",
    event: { type: "error", status: 401, code: "server_error", message: "Credential rejected" },
    code: "authentication", retryable: false,
  },
]) {
  test(`preserves details and classifies ${name} through the agent`, async () => {
    const transport = new FetchCodexTransport(async () => ({
      ok: true, status: 200, statusText: "OK",
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
          controller.close();
        },
      }),
      json: async () => ({}),
    }));
    const details = event.response?.error ?? event;
    await assert.rejects(transport.send({ endpoint: "https://example.test", model: "test", input: "x", action: "read", context: [], apiKey: "test-key" }, {}), (error) => {
      assert.equal(error.code, details.code);
      assert.ok(error.message.includes(details.message));
      assert.equal(error.status, event.status);
      return true;
    });
    const agent = new CodexAgent({ configuration: {}, secrets: { get: async () => "test-key" }, transport });
    const progress = [];
    await assert.rejects(agent.run({ action: "read", prompt: "Read this" }, { onProgress: (event) => progress.push(event.phase) }), (error) => {
      assert.equal(error.code, code);
      assert.equal(error.retryable, retryable);
      return true;
    });
    assert.deepEqual(progress, ["queued"]);
  });
}
