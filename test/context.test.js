const assert = require("node:assert/strict");
const test = require("node:test");
const { collectEditorContext } = require("../dist/context");
const position = (line, character) => ({ line, character });
const range = (start, end) => ({ start: position(...start), end: position(...end) });

test("does not invent selection context for an empty selection", () => {
  const context = collectEditorContext({ activeFile: { path: "src/app.ts", languageId: "typescript", text: "const answer = 42;", isDirty: false, cursor: position(0, 5), selection: { range: range([0, 0], [0, 0]), text: "" } }, openFiles: ["src/app.ts"], diagnostics: [] });
  assert.equal(context.selection, undefined); assert.equal(context.items[0].kind, "cursor");
});
test("preserves unsaved state and keeps absolute paths out of the model", () => {
  const context = collectEditorContext({ activeFile: { path: "src/app.ts", languageId: "typescript", text: "draft", isDirty: true, cursor: position(0, 0) }, openFiles: ["src/app.ts", "README.md"], diagnostics: [] });
  assert.equal(context.activeFile.isDirty, true); assert.equal(JSON.stringify(context).includes("/Users/"), false);
});
test("includes diagnostics after stronger editor signals", () => {
  const context = collectEditorContext({ activeFile: { path: "src/app.ts", languageId: "typescript", text: "const answer = ;", isDirty: false, cursor: position(0, 14), selection: { range: range([0, 0], [0, 5]), text: "const" }, surroundingSymbol: "answer" }, openFiles: [], diagnostics: [{ message: "Expression expected", severity: "error", range: range([0, 14], [0, 15]) }] });
  assert.deepEqual(context.items.map((item) => item.kind), ["selection", "cursor", "symbol", "active-file", "diagnostics"]);
});
test("bounds context size and marks omitted lower-priority data", () => {
  const context = collectEditorContext({ activeFile: { path: "src/app.ts", languageId: "typescript", text: "x".repeat(500), isDirty: false, cursor: position(0, 0), selection: { range: range([0, 0], [0, 500]), text: "x".repeat(500) } }, openFiles: ["README.md", "package.json"], diagnostics: [] }, { maxChars: 220 });
  assert.equal(JSON.stringify(context).length <= 220, true); assert.equal(context.truncated, true);
});
