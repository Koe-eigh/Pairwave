const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { createRepositoryContextProvider } = require("../dist/context/repository");
const { collectEditorContext } = require("../dist/context");

function createProvider({ files = {}, ignored = [], changed = [], diff = "", references = [], unreadable = [], failure } = {}) {
  const calls = [];
  const provider = createRepositoryContextProvider({
    workspaceRoot: "/workspace",
    git: {
      listChangedFiles: async () => {
        calls.push("listChangedFiles");
        if (failure) throw failure;
        return changed;
      },
      readDiff: async () => {
        calls.push("readDiff");
        if (failure) throw failure;
        return diff;
      },
      readFileDiff: async () => {
        calls.push("readFileDiff");
        if (failure) throw failure;
        return diff;
      },
      isIgnored: async (filePath) => ignored.includes(filePath),
      readReferences: async (filePath) => {
        calls.push(`readReferences:${filePath}`);
        if (failure) throw failure;
        return references;
      },
      listFiles: async () => {
        calls.push("listFiles");
        if (failure) throw failure;
        return Object.keys(files).filter((path) => !ignored.includes(path));
      },
    },
    fileSystem: {
      readFile: async (path) => {
        calls.push(`readFile:${path}`);
        if (unreadable.includes(path)) throw new Error(`unreadable file: ${path}`);
        if (!(path in files)) throw new Error(`missing file: ${path}`);
        return files[path];
      },
    },
  });
  return { calls, provider };
}

test("returns a compact clean-workspace bundle without broad repository contents", async () => {
  const { calls, provider } = createProvider({
    files: { "src/app.ts": "export const app = true;", "docs/design.md": "unrequested" },
  });

  const context = await provider.collectInitial({ maxChars: 500 });

  assert.deepEqual(context.changedFiles, []);
  assert.equal(context.diff, "");
  assert.equal(context.files.some((file) => file.path === "docs/design.md"), false);
  assert.equal(calls.includes("listFiles"), false);
  assert.equal(JSON.stringify(context).length <= 500, true);
});

test("reports staged and unstaged changes with bounded diff content", async () => {
  const { provider } = createProvider({
    changed: ["src/app.ts", "README.md"],
    diff: "diff --git a/src/app.ts b/src/app.ts\n" + "+x".repeat(300),
  });

  const context = await provider.collectInitial({ maxChars: 180 });

  assert.deepEqual(context.changedFiles, ["src/app.ts", "README.md"]);
  assert.equal(JSON.stringify(context).length <= 180, true);
  assert.equal(context.degraded, false);
});

test("rejects an initial budget smaller than the repository context envelope", async () => {
  const { provider } = createProvider();

  await assert.rejects(
    provider.collectInitial({ maxChars: 10 }),
    /maxChars must be at least/,
  );
});

test("excludes ignored files while allowing explicit retrieval of permitted files", async () => {
  const { provider } = createProvider({
    files: { "src/app.ts": "app", "local.secret": "do not expose" },
    ignored: ["local.secret"],
  });

  const files = await provider.retrieve({ kind: "files" });
  const requested = await provider.retrieve({ kind: "file", path: "src/app.ts" });

  assert.deepEqual(files.map((file) => file.path), ["src/app.ts"]);
  assert.equal(JSON.stringify(files).includes("local.secret"), false);
  assert.deepEqual(requested, { path: "src/app.ts", content: "app" });
});

test("degrades to editor context when Git is unavailable", async () => {
  const { provider } = createProvider({ failure: new Error("not a git repository") });

  const repository = await provider.collectInitial({ maxChars: 500 });
  const editor = collectEditorContext({
    activeFile: { path: "src/app.ts", languageId: "typescript", text: "answer", isDirty: false, cursor: { line: 0, character: 0 } },
    openFiles: ["src/app.ts"],
    diagnostics: [],
  });

  assert.equal(repository.degraded, true);
  assert.deepEqual(repository.changedFiles, []);
  assert.equal(editor.activeFile.path, "src/app.ts");
});

test("retrieves one requested dependency or reference without broad expansion", async () => {
  const { calls, provider } = createProvider({
    files: { "src/app.ts": "import { util } from './util';", "src/util.ts": "export const util = true;", "docs/design.md": "unrequested" },
  });

  const result = await provider.retrieve({ kind: "file", path: "src/util.ts" });

  assert.deepEqual(result, { path: "src/util.ts", content: "export const util = true;" });
  assert.deepEqual(calls, ["readFile:src/util.ts"]);
  assert.equal(JSON.stringify(result).includes("docs/design.md"), false);
});

test("retrieves modified files and diffs only when explicitly requested", async () => {
  const { calls, provider } = createProvider({ changed: ["src/app.ts"], diff: "+changed" });

  const modified = await provider.retrieve({ kind: "modified-files" });
  const changes = await provider.retrieve({ kind: "diff", path: "src/app.ts" });

  assert.deepEqual(modified, ["src/app.ts"]);
  assert.equal(changes, "+changed");
  assert.deepEqual(calls, ["listChangedFiles", "readFileDiff"]);
});

test("rejects traversal and absolute paths before reading repository files", async () => {
  const { calls, provider } = createProvider({ files: { "src/app.ts": "app" } });

  assert.equal(await provider.retrieve({ kind: "file", path: "../outside.ts" }), undefined);
  assert.equal(await provider.retrieve({ kind: "file", path: "/outside.ts" }), undefined);
  assert.equal(await provider.retrieve({ kind: "diff", path: "../outside.ts" }), "");
  assert.deepEqual(calls, []);
});

test("derives symbols and dependencies from a requested file when indexes are unavailable", async () => {
  const { provider } = createProvider({
    files: { "src/app.ts": "import { util } from './util';\nexport const answer = util;\nfunction render() {}" },
  });

  const symbols = await provider.retrieve({ kind: "symbols", path: "src/app.ts" });
  const dependencies = await provider.retrieve({ kind: "dependencies", path: "src/app.ts" });

  assert.deepEqual(symbols, ["answer", "render"]);
  assert.deepEqual(dependencies, ["./util"]);
});

test("retrieves references through the repository index boundary", async () => {
  const { calls, provider } = createProvider({
    references: ["src/app.ts:1:import util", "src/other.ts:4:util()"],
  });

  const references = await provider.retrieve({ kind: "references", path: "src/util.ts" });

  assert.deepEqual(references, ["src/app.ts:1:import util", "src/other.ts:4:util()"]);
  assert.deepEqual(calls, ["readReferences:src/util.ts"]);
});

test("degrades independently for missing indexes and unreadable discovered files", async () => {
  const { provider } = createProvider({
    files: { "src/app.ts": "app", "src/broken.ts": "broken" },
    unreadable: ["src/broken.ts"],
  });

  const references = await provider.retrieve({ kind: "references", path: "src/app.ts" });
  const files = await provider.retrieve({ kind: "files" });

  assert.deepEqual(references, []);
  assert.deepEqual(files, [{ path: "src/app.ts", content: "app" }]);
});

test("keeps editor signals ahead of Git, open files, and repository items within the budget", () => {
  const context = collectEditorContext({
    activeFile: {
      path: "src/app.ts",
      languageId: "typescript",
      text: "answer",
      isDirty: false,
      cursor: { line: 0, character: 0 },
      selection: { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 6 } }, text: "answer" },
    },
    openFiles: ["src/app.ts"],
    diagnostics: [],
  }, {
    maxChars: 900,
    repositoryItems: [
      { kind: "git-changes", priority: 4, content: "README.md" },
      { kind: "repository-file", priority: 6, path: "unrelated.ts", content: "answer" },
    ],
  });

  assert.equal(context.items[0].kind, "selection");
  assert.equal(context.items.findIndex((item) => item.kind === "active-file") < context.items.findIndex((item) => item.kind === "git-changes"), true);
  assert.equal(context.items.findIndex((item) => item.kind === "git-changes") < context.items.findIndex((item) => item.kind === "open-files"), true);
  assert.equal(JSON.stringify(context).length <= 900, true);
});

test("uses native Git discovery for staged, unstaged, permitted, and ignored files", async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pairwave-repository-"));
  const runGit = (...args) => execFileSync("git", args, { cwd: workspaceRoot, encoding: "utf8" });
  const write = (relativePath, content) => {
    const target = path.join(workspaceRoot, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  };

  try {
    runGit("init", "--quiet");
    runGit("config", "user.email", "pairwave@example.test");
    runGit("config", "user.name", "Pairwave Test");
    write("src/app.ts", "export const app = true;\n");
    write("README.md", "initial\n");
    write(".gitignore", "local.secret\n");
    runGit("add", ".");
    runGit("commit", "--quiet", "-m", "initial");
    write("src/app.ts", "export const app = false;\n");
    write("README.md", "staged\n");
    runGit("add", "README.md");
    write("debug.log", "permitted untracked\n");
    write("local.secret", "ignored\n");

    const provider = createRepositoryContextProvider({ workspaceRoot });
    const initial = await provider.collectInitial({ maxChars: 2_000 });
    const files = await provider.retrieve({ kind: "files" });
    const ignoredFile = await provider.retrieve({ kind: "file", path: "local.secret" });

    assert.equal(initial.changedFiles.includes("src/app.ts"), true);
    assert.equal(initial.changedFiles.includes("README.md"), true);
    assert.equal(initial.changedFiles.includes("debug.log"), true);
    assert.equal(files.some((file) => file.path === "debug.log"), true);
    assert.equal(files.some((file) => file.path === "local.secret"), false);
    assert.equal(ignoredFile, undefined);
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test("resolves native relative imports when retrieving references", async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pairwave-references-"));
  const runGit = (...args) => execFileSync("git", args, { cwd: workspaceRoot, encoding: "utf8" });
  const write = (relativePath, content) => {
    const target = path.join(workspaceRoot, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  };

  try {
    runGit("init", "--quiet");
    runGit("config", "user.email", "pairwave@example.test");
    runGit("config", "user.name", "Pairwave Test");
    write("src/app.ts", "import { util } from './util';\nexport const app = util;\n");
    write("src/util.ts", "export const util = true;\n");
    runGit("add", ".");
    runGit("commit", "--quiet", "-m", "initial");

    const provider = createRepositoryContextProvider({ workspaceRoot });
    const references = await provider.retrieve({ kind: "references", path: "src/util.ts" });

    assert.deepEqual(references, ["src/app.ts:1:import { util } from './util';"]);
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});
