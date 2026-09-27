const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { createRepositoryContextProvider } = require("../dist/context/repository");
const { collectEditorContext } = require("../dist/context");

function createProvider({ files = {}, ignored = [], changed = [], diff = "", references = [], unreadable = [], failure, listFailure, diffFailure, referencesAdapter = true, contentLimit } = {}) {
  const calls = [];
  const git = {
    listChangedFiles: async () => {
      calls.push("listChangedFiles");
      if (listFailure || failure) throw listFailure || failure;
      return changed;
    },
    readDiff: async () => {
      calls.push("readDiff");
      if (diffFailure || failure) throw diffFailure || failure;
      return diff;
    },
    readFileDiff: async () => {
      calls.push("readFileDiff");
      if (failure) throw failure;
      return diff;
    },
    isIgnored: async (filePath) => ignored.includes(filePath),
    listFiles: async () => {
      calls.push("listFiles");
      if (failure) throw failure;
      return Object.keys(files).filter((path) => !ignored.includes(path));
    },
  };
  if (referencesAdapter) {
    git.readReferences = async (filePath) => {
      calls.push(`readReferences:${filePath}`);
      if (failure) throw failure;
      return references;
    };
  }
  const provider = createRepositoryContextProvider({
    workspaceRoot: "/workspace",
    git,
    contentLimit,
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

test("retains changed files when only diff retrieval fails", async () => {
  const { provider } = createProvider({ changed: ["src/app.ts"], diffFailure: new Error("diff unavailable") });

  const context = await provider.collectInitial({ maxChars: 500 });

  assert.deepEqual(context.changedFiles, ["src/app.ts"]);
  assert.equal(context.diff, "");
  assert.equal(context.degraded, true);
});

test("retains a successful diff when changed-file discovery fails", async () => {
  const { provider } = createProvider({ listFailure: new Error("changed files unavailable"), diff: "+usable diff" });

  const context = await provider.collectInitial({ maxChars: 500 });

  assert.deepEqual(context.changedFiles, []);
  assert.equal(context.diff, "+usable diff");
  assert.equal(context.degraded, true);
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

test("excludes ignored files from symbol and dependency fallback retrieval", async () => {
  const { calls, provider } = createProvider({
    files: { "local.secret": "export const secret = true;" },
    ignored: ["local.secret"],
    referencesAdapter: false,
  });

  assert.deepEqual(await provider.retrieve({ kind: "symbols", path: "local.secret" }), []);
  assert.deepEqual(await provider.retrieve({ kind: "dependencies", path: "local.secret" }), []);
  assert.deepEqual(calls.filter((call) => call.startsWith("readFile:")), []);
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

test("bounds file and diff retrieval to the configured content limit", async () => {
  const { provider } = createProvider({
    files: { "src/app.ts": "x".repeat(100) },
    diff: "d".repeat(100),
    contentLimit: 32,
  });

  const file = await provider.retrieve({ kind: "file", path: "src/app.ts" });
  const diff = await provider.retrieve({ kind: "diff" });

  assert.equal(file.content.length, 32);
  assert.equal(diff.length, 32);
});

test("stops file retrieval after the aggregate limit is reached", async () => {
  const { calls, provider } = createProvider({
    files: { "a.ts": "a".repeat(20), "b.ts": "b".repeat(20), "c.ts": "c".repeat(20) },
    contentLimit: 70,
  });

  const files = await provider.retrieve({ kind: "files" });

  assert.equal(files.length, 1);
  assert.deepEqual(calls.filter((call) => call.startsWith("readFile:")), ["readFile:a.ts", "readFile:b.ts"]);
});

test("passes the content limit to the filesystem read boundary", async () => {
  const reads = [];
  const provider = createRepositoryContextProvider({
    workspaceRoot: "/workspace",
    git: {
      listChangedFiles: async () => [],
      readDiff: async () => "",
      listFiles: async () => [],
    },
    contentLimit: 32,
    fileSystem: {
      readFile: async (filePath, maxBytes) => {
        reads.push({ filePath, maxBytes });
        return "x".repeat(100);
      },
    },
  });

  const result = await provider.retrieve({ kind: "file", path: "src/app.ts" });

  assert.deepEqual(result, { path: "src/app.ts", content: "x".repeat(32) });
  assert.deepEqual(reads, [{ filePath: "src/app.ts", maxBytes: 32 }]);
});

test("bounds native filesystem reads before returning repository content", async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pairwave-bounded-read-"));

  try {
    fs.writeFileSync(path.join(workspaceRoot, "large.txt"), Buffer.alloc(8 * 1024 * 1024, 97));
    const provider = createRepositoryContextProvider({
      workspaceRoot,
      contentLimit: 32,
      git: {
        listChangedFiles: async () => [],
        readDiff: async () => "",
        listFiles: async () => ["large.txt"],
      },
    });

    const file = await provider.retrieve({ kind: "file", path: "large.txt" });

    assert.deepEqual(file, { path: "large.txt", content: "a".repeat(32) });
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test("bounds aggregate progressive retrieval results", async () => {
  const { provider } = createProvider({
    files: { "a.ts": "a", "b.ts": "b", "c.ts": "c" },
    changed: ["a.ts", "b.ts", "c.ts"],
    references: ["a.ts:1:reference", "b.ts:2:reference", "c.ts:3:reference"],
    contentLimit: 32,
  });

  for (const request of [
    { kind: "files" },
    { kind: "modified-files" },
    { kind: "references", path: "src/app.ts" },
  ]) {
    const result = await provider.retrieve(request);
    assert.equal(JSON.stringify(result).length <= 32, true, request.kind);
  }
});

test("rejects traversal and absolute paths before reading repository files", async () => {
  const { calls, provider } = createProvider({ files: { "src/app.ts": "app" } });

  assert.equal(await provider.retrieve({ kind: "file", path: "../outside.ts" }), undefined);
  assert.equal(await provider.retrieve({ kind: "file", path: "/outside.ts" }), undefined);
  assert.equal(await provider.retrieve({ kind: "diff", path: "../outside.ts" }), "");
  assert.deepEqual(calls, []);
});

test("rejects native file reads through symlinks that escape the workspace", async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pairwave-symlink-"));
  const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pairwave-outside-"));

  try {
    fs.writeFileSync(path.join(outsideRoot, "secret.txt"), "secret");
    fs.symlinkSync(outsideRoot, path.join(workspaceRoot, "link"), "dir");
    const provider = createRepositoryContextProvider({
      workspaceRoot,
      git: {
        listChangedFiles: async () => [],
        readDiff: async () => "",
        listFiles: async () => ["link/secret.txt"],
      },
    });

    assert.equal(await provider.retrieve({ kind: "file", path: "link/secret.txt" }), undefined);
    assert.deepEqual(await provider.retrieve({ kind: "files" }), []);
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
    fs.rmSync(outsideRoot, { recursive: true, force: true });
  }
});

test("derives symbols and dependencies from a requested file when indexes are unavailable", async () => {
  const { provider } = createProvider({
    files: { "src/app.ts": "import './register';\nexport { util } from './util';\nexport const answer = util;\nfunction render() {}" },
  });

  const symbols = await provider.retrieve({ kind: "symbols", path: "src/app.ts" });
  const dependencies = await provider.retrieve({ kind: "dependencies", path: "src/app.ts" });

  assert.deepEqual(symbols, ["answer", "render"]);
  assert.deepEqual(dependencies, ["./register", "./util"]);
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
    referencesAdapter: false,
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

test("keeps changed-file context eligible when diagnostics exceed the budget", () => {
  const context = collectEditorContext({
    openFiles: [],
    diagnostics: [{ message: "diagnostic ".repeat(100), severity: "error", range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } }],
  }, {
    maxChars: 220,
    repositoryItems: [{ kind: "git-changes", priority: 4, content: "src/app.ts" }],
  });

  assert.equal(context.items.some((item) => item.kind === "git-changes"), true);
  assert.equal(context.items.some((item) => item.kind === "diagnostics"), false);
  assert.equal(JSON.stringify(context).length <= 220, true);
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

test("retains untracked files in an unborn repository", async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pairwave-unborn-"));
  const runGit = (...args) => execFileSync("git", args, { cwd: workspaceRoot, encoding: "utf8" });

  try {
    runGit("init", "--quiet");
    fs.mkdirSync(path.join(workspaceRoot, "src"));
    fs.writeFileSync(path.join(workspaceRoot, "src/app.ts"), "export const app = true;\n");

    const provider = createRepositoryContextProvider({ workspaceRoot });
    const initial = await provider.collectInitial({ maxChars: 2_000 });

    assert.equal(initial.changedFiles.includes("src/app.ts"), true);
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
    write("src/app.ts", "import './register';\nexport { util } from './util';\nexport const app = util;\n");
    write("src/register.ts", "export const registered = true;\n");
    write("src/util.ts", "export const util = true;\n");
    runGit("add", ".");
    runGit("commit", "--quiet", "-m", "initial");

    const provider = createRepositoryContextProvider({ workspaceRoot });
    const registerReferences = await provider.retrieve({ kind: "references", path: "src/register.ts" });
    const utilReferences = await provider.retrieve({ kind: "references", path: "src/util.ts" });

    assert.deepEqual(registerReferences, ["src/app.ts:1:import './register';"]);
    assert.deepEqual(utilReferences, ["src/app.ts:2:export { util } from './util';"]);
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});
