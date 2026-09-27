const assert = require("node:assert/strict");
const test = require("node:test");
const Module = require("node:module");

test("registers commands, forwards requests, refreshes the provider per workspace, and cleans up", async () => {
  const commands = new Map();
  const registrations = [];
  const providers = [];
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
    window: { showInformationMessage: async () => undefined, showWarningMessage: async () => undefined },
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
    registerCommands(context);

    assert.deepEqual([...commands.keys()], ["pairwave.start", "pairwave.retrieveRepositoryContext"]);
    assert.equal(context.subscriptions.length, 2);

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
    assert.equal(await commands.get("pairwave.retrieveRepositoryContext")(), undefined);
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
