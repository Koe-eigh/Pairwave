const assert = require("node:assert/strict");
const test = require("node:test");
const { CodingAgentError } = require("../dist/agents");
const { CodexAgent } = require("../dist/agents/codex");

function createAgent({ key = "test-key", send = async () => ({ text: "done" }) } = {}) {
  const calls = [];
  const agent = new CodexAgent({
    configuration: { model: "test-codex", endpoint: "https://example.test/codex", credentialKey: "codex-key" },
    secrets: { get: async (name) => { calls.push(["secret", name]); return key; } },
    transport: { send: async (request, options) => { calls.push(["send", request, options]); return send(request, options); } },
  });
  return { agent, calls };
}

test("invokes Codex through the provider-neutral request and result contract", async () => {
  const { agent, calls } = createAgent({ send: async (request) => ({ text: `${request.action}: ${request.input}`, edits: [{ path: "src/app.ts", newText: "updated" }] }) });
  const result = await agent.run({ action: "explain", prompt: "What does this do?", context: [{ source: "editor", path: "src/app.ts", content: "const answer = 42;" }] });

  assert.deepEqual(result, { text: "explain: What does this do?", edits: [{ path: "src/app.ts", newText: "updated" }], provider: "codex" });
  assert.equal(calls[0][0], "secret");
  assert.equal(calls[1][1].apiKey, "test-key");
  assert.equal(calls[1][1].context[0].path, "src/app.ts");
});

test("reports queued and completed progress and forwards cancellation", async () => {
  const controller = new AbortController();
  const progress = [];
  const { agent, calls } = createAgent();
  await agent.run({ action: "search", prompt: "Find usages" }, { signal: controller.signal, onProgress: (event) => progress.push(event) });

  assert.deepEqual(progress.map((event) => event.phase), ["queued", "completed"]);
  assert.equal(calls[1][2].signal, controller.signal);
  controller.abort();
  await assert.rejects(agent.run({ action: "read", prompt: "Read the file" }, { signal: controller.signal }), (error) => error.code === "cancelled");
});

test("does not call the transport without a securely stored credential", async () => {
  const { agent, calls } = createAgent({ key: "" });
  await assert.rejects(agent.run({ action: "suggest", prompt: "Suggest an approach" }), (error) => {
    assert.equal(error instanceof CodingAgentError, true);
    assert.equal(error.code, "authentication");
    return true;
  });
  assert.deepEqual(calls, [["secret", "codex-key"]]);
});

test("maps provider failures to actionable retry metadata", async () => {
  const { agent } = createAgent({ send: async () => { const error = new Error("busy"); error.status = 503; throw error; } });
  await assert.rejects(agent.run({ action: "modify", prompt: "Update the function" }), (error) => {
    assert.equal(error.code, "unavailable");
    assert.equal(error.retryable, true);
    assert.match(error.message, /temporarily unavailable/);
    return true;
  });
});

test("rejects empty modification instructions", async () => {
  const { agent } = createAgent();
  await assert.rejects(agent.run({ action: "modify", prompt: "   " }), (error) => error.code === "request");
});
