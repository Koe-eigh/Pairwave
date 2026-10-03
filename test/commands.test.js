const assert = require("node:assert/strict");
const test = require("node:test");
const Module = require("node:module");

test("registers commands, forwards requests, refreshes the provider per workspace, and cleans up", async () => {
  const commands = new Map();
  const registrations = [];
  const providers = [];
  const errors = [];
  const outputLines = [];
  let workspaceRoot = "/workspace-a";
  const vscodeMock = {
    commands: {
      registerCommand: (id, handler) => {
        commands.set(id, handler);
        const disposable = { disposed: false, dispose() { this.disposed = true; } };
        registrations.push(disposable);
        return disposable;
      },
    },
    window: {
      createOutputChannel: () => ({ appendLine: (line) => outputLines.push(line), show: () => {}, dispose: () => {} }),
      showInformationMessage: async () => undefined,
      showWarningMessage: async (_message, _options, action) => action,
      showErrorMessage: async (message) => { errors.push(message); },
      showQuickPick: async () => "explain",
      showInputBox: async () => "Explain this",
    },
  };
  const repositoryModule = require("../dist/context/repository");
  const originalCreateProvider = repositoryModule.createRepositoryContextProvider;
  repositoryModule.createRepositoryContextProvider = ({ workspaceRoot: root }) => {
    const provider = {
      collectInitial: async () => ({
        items: [{ kind: "git-changes", priority: 4, content: root }],
      }),
      retrieve: async (request) => ({ root, request }),
    };
    providers.push({ root, provider });
    return provider;
  };

  const originalLoad = Module._load;
  const vscodeAdapterPath = require.resolve("../dist/context/vscode");
  Module._load = function(request, parent, isMain) {
    if (request === "vscode") return vscodeMock;
    if (parent && parent.filename === require.resolve("../dist/extension/commands") && request === "../context/vscode") {
      return {
        readVscodeWorkspaceRoot: (requestedPath) => requestedPath?.startsWith("folder-b/") ? "/workspace-b" : workspaceRoot,
        readVscodeWorkspacePath: (requestedPath) => requestedPath.startsWith("folder-b/") ? requestedPath.slice("folder-b/".length) : requestedPath,
        readVscodeEditorSnapshot: async () => ({ openFiles: [], diagnostics: [] }),
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    delete require.cache[require.resolve("../dist/extension/commands")];
    delete require.cache[vscodeAdapterPath];
    const { registerCommands } = require("../dist/extension/commands");
    const context = { subscriptions: [] };
    const agentCalls = [];
    const agent = { run: async (request, options) => { agentCalls.push(request); options.onProgress({ phase: "working", message: "working" }); return { text: "ok", edits: [], provider: "test" }; } };
    registerCommands(context, agent);

    assert.deepEqual([...commands.keys()], ["pairwave.start", "pairwave.retrieveRepositoryContext", "pairwave.configureApiKey", "pairwave.runAgent"]);
    assert.equal(context.subscriptions.length, 5);

    const firstStart = await commands.get("pairwave.start")();
    const firstRequest = { kind: "file", path: "src/app.ts" };
    assert.equal(firstStart.items[0].kind, "git-changes");
    assert.deepEqual(await commands.get("pairwave.retrieveRepositoryContext")(firstRequest), {
      root: "/workspace-a",
      request: firstRequest,
    });

    workspaceRoot = "/workspace-b";
    await commands.get("pairwave.start")();
    assert.deepEqual(await commands.get("pairwave.retrieveRepositoryContext")(firstRequest), {
      root: "/workspace-b",
      request: firstRequest,
    });
    const folderRequest = { kind: "file", path: "folder-b/src/app.ts" };
    assert.deepEqual(await commands.get("pairwave.retrieveRepositoryContext")(folderRequest), {
      root: "/workspace-b",
      request: { kind: "file", path: "src/app.ts" },
    });
    assert.equal(await commands.get("pairwave.retrieveRepositoryContext")(), undefined);
    assert.deepEqual(await commands.get("pairwave.runAgent")({ action: "explain", prompt: "Explain this" }), { text: "ok", edits: [], provider: "test" });
    assert.deepEqual(agentCalls, [{ action: "explain", prompt: "Explain this", context: [{ source: "repository:git-changes", content: "/workspace-b" }] }]);
    assert.deepEqual(await commands.get("pairwave.runAgent")(), { text: "ok", edits: [], provider: "test" });
    assert.deepEqual(agentCalls, [
      { action: "explain", prompt: "Explain this", context: [{ source: "repository:git-changes", content: "/workspace-b" }] },
      { action: "explain", prompt: "Explain this", context: [{ source: "repository:git-changes", content: "/workspace-b" }] },
    ]);
    assert.equal(await commands.get("pairwave.runAgent")({
      action: "explain",
      prompt: "Explain this",
      context: [{ source: "editor", content: 42 }],
    }), undefined);
    assert.deepEqual(agentCalls, [
      { action: "explain", prompt: "Explain this", context: [{ source: "repository:git-changes", content: "/workspace-b" }] },
      { action: "explain", prompt: "Explain this", context: [{ source: "repository:git-changes", content: "/workspace-b" }] },
    ]);
    assert.equal(outputLines.some((line) => line.includes("ok")), true);
    assert.deepEqual(providers.map(({ root }) => root), ["/workspace-a", "/workspace-b"]);

    for (const subscription of context.subscriptions) subscription.dispose();
    assert.equal(registrations.every((subscription) => subscription.disposed), true);
  } finally {
    repositoryModule.createRepositoryContextProvider = originalCreateProvider;
    Module._load = originalLoad;
    delete require.cache[require.resolve("../dist/extension/commands")];
    delete require.cache[vscodeAdapterPath];
  }
});

test("displays a coding-agent error and returns no result", async () => {
  const commands = new Map();
  const errors = [];
  const vscodeMock = {
    commands: { registerCommand: (id, handler) => { commands.set(id, handler); return { dispose() {} }; } },
    workspace: { textDocuments: [], workspaceFolders: [] },
    window: {
      createOutputChannel: () => ({ appendLine: () => {}, show: () => {}, dispose: () => {} }),
      showWarningMessage: async (_message, _options, action) => action,
      showErrorMessage: async (message) => { errors.push(message); },
    },
  };
  const originalLoad = Module._load;
  Module._load = function(request, parent, isMain) {
    if (request === "vscode") return vscodeMock;
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    delete require.cache[require.resolve("../dist/extension/commands")];
    const { registerCommands } = require("../dist/extension/commands");
    const { CodingAgentError } = require("../dist/agents");
    registerCommands({ subscriptions: [] }, { run: async () => { throw new CodingAgentError("Credential rejected.", "authentication"); } });
    assert.equal(await commands.get("pairwave.runAgent")({ action: "read", prompt: "Read this" }), undefined);
    assert.deepEqual(errors, ["Credential rejected."]);
  } finally {
    Module._load = originalLoad;
    delete require.cache[require.resolve("../dist/extension/commands")];
  }
});

test("stores a configured Codex API key in SecretStorage", async () => {
  const commands = new Map();
  const stored = [];
  const messages = [];
  const vscodeMock = {
    commands: { registerCommand: (id, handler) => { commands.set(id, handler); return { dispose() {} }; } },
    window: {
      createOutputChannel: () => ({ appendLine() {}, show() {}, dispose() {} }),
      showInputBox: async () => "  sk-test  ",
      showInformationMessage: async (message) => { messages.push(message); },
      showWarningMessage: async () => undefined,
    },
  };
  const originalLoad = Module._load;
  Module._load = function(request, parent, isMain) {
    if (request === "vscode") return vscodeMock;
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    delete require.cache[require.resolve("../dist/extension/commands")];
    const { registerCommands } = require("../dist/extension/commands");
    registerCommands({
      subscriptions: [],
      secrets: { store: async (key, value) => { stored.push([key, value]); } },
    }, { run: async () => ({ text: "ok", edits: [], provider: "test" }) });
    assert.equal(await commands.get("pairwave.configureApiKey")(), true);
    assert.deepEqual(stored, [["pairwave.codex.apiKey", "sk-test"]]);
    assert.deepEqual(messages, ["Pairwave Codex API key saved securely."]);
  } finally {
    Module._load = originalLoad;
    delete require.cache[require.resolve("../dist/extension/commands")];
  }
});

test("resolves a multi-root workspace from the requested folder or active editor", () => {
  const folders = [
    { name: "folder-a", uri: { fsPath: "/workspace-a" } },
    { name: "folder-b", uri: { fsPath: "/workspace-b" } },
  ];
  const vscodeMock = {
    workspace: {
      workspaceFolders: folders,
      getWorkspaceFolder: (uri) => uri.fsPath.startsWith("/workspace-b/") ? folders[1] : folders[0],
    },
    window: { activeTextEditor: { document: { uri: { fsPath: "/workspace-b/src/app.ts" } } } },
  };
  const originalLoad = Module._load;
  const vscodeAdapterPath = require.resolve("../dist/context/vscode");
  Module._load = function(request, parent, isMain) {
    if (request === "vscode") return vscodeMock;
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    delete require.cache[vscodeAdapterPath];
    const { readVscodeWorkspaceRoot } = require("../dist/context/vscode");
    assert.equal(readVscodeWorkspaceRoot(), "/workspace-b");
    assert.equal(readVscodeWorkspaceRoot("folder-a/src/app.ts"), "/workspace-a");
    assert.equal(readVscodeWorkspaceRoot("folder-b/src/app.ts"), "/workspace-b");
  } finally {
    Module._load = originalLoad;
    delete require.cache[vscodeAdapterPath];
  }
});
