const assert = require("node:assert/strict");
const test = require("node:test");
const Module = require("node:module");

test("activation forwards current user settings and SecretStorage credentials to transport", async () => {
  const commands = new Map();
  const requests = [];
  const errors = [];
  const secretKeys = [];
  const settings = { model: "selected-model", endpoint: "https://provider.test/responses" };
  const vscode = {
    ProgressLocation: { Notification: 15 },
    commands: { registerCommand(id, callback) { commands.set(id, callback); return { dispose() {} }; } },
    workspace: {
      textDocuments: [], workspaceFolders: [],
      getConfiguration(section) {
        assert.equal(section, "pairwave.codex");
        return { get: (key, fallback) => settings[key] ?? fallback };
      },
    },
    window: {
      createOutputChannel: () => ({ appendLine() {}, show() {}, dispose() {} }),
      showWarningMessage: async () => "Run agent",
      showErrorMessage: async (message) => errors.push(message),
      withProgress: async (_options, task) => task({ report() {} }, {
        isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }),
      }),
    },
  };
  const originalLoad = Module._load;
  const originalFetch = globalThis.fetch;
  const paths = ["../dist/extension", "../dist/extension/commands", "../dist/context/vscode"];
  Module._load = function(request, parent, isMain) {
    if (request === "vscode") return vscode;
    return originalLoad.call(this, request, parent, isMain);
  };
  globalThis.fetch = async (url, init) => {
    requests.push({ url, ...init, body: JSON.parse(init.body) });
    return { ok: true, json: async () => ({ output_text: "done" }) };
  };
  try {
    for (const path of paths) delete require.cache[require.resolve(path)];
    require("../dist/extension").activate({
      subscriptions: [], secrets: { get: async (key) => { secretKeys.push(key); return "test-key"; } },
    });
    const run = () => commands.get("pairwave.runAgent")({ action: "read", prompt: "Read this" });
    assert.equal((await run()).text, "done");
    assert.equal(requests[0].url, settings.endpoint);
    assert.equal(requests[0].body.model, settings.model);
    assert.equal(requests[0].headers.Authorization, "Bearer test-key");
    settings.model = "another-model";
    settings.endpoint = "https://another.test/responses";
    await run();
    assert.equal(requests[1].body.model, settings.model);
    assert.equal(requests[1].url, settings.endpoint);
    assert.deepEqual(secretKeys, ["pairwave.codex.apiKey", "pairwave.codex.apiKey"]);
    for (const invalid of ["", "not-a-url", "http://provider.test", "https://user:password@provider.test", "https://provider.test/#fragment", 42]) {
      settings.endpoint = invalid;
      assert.equal(await run(), undefined);
      assert.match(errors.at(-1), /pairwave.codex.endpoint/);
    }
    settings.endpoint = "https://provider.test/responses";
    for (const invalid of ["", "   ", 42]) {
      settings.model = invalid;
      assert.equal(await run(), undefined);
      assert.match(errors.at(-1), /pairwave.codex.model/);
    }
    assert.equal(requests.length, 2);
    assert.equal(secretKeys.length, 2);
  } finally {
    Module._load = originalLoad;
    globalThis.fetch = originalFetch;
    for (const path of paths) delete require.cache[require.resolve(path)];
  }
});
