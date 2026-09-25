/** A zero-based position in a text document. */
export interface TextPosition { readonly line: number; readonly character: number; }
export interface TextRange { readonly start: TextPosition; readonly end: TextPosition; }
export interface EditorDiagnostic {
  readonly message: string;
  readonly severity: "error" | "warning" | "information" | "hint";
  readonly range: TextRange;
}
export interface EditorSnapshot {
  readonly activeFile?: {
    readonly path: string; readonly languageId: string; readonly text: string; readonly isDirty: boolean;
    readonly cursor: TextPosition;
    readonly selection?: { readonly range: TextRange; readonly text: string };
    readonly surroundingSymbol?: string;
  };
  readonly openFiles: readonly string[];
  readonly diagnostics: readonly EditorDiagnostic[];
}
export interface ContextItem {
  readonly kind: "selection" | "cursor" | "symbol" | "active-file" | "diagnostics" | "open-files";
  readonly priority: number; readonly path?: string; readonly content?: string;
}
export interface EditorContext {
  readonly activeFile?: { readonly path: string; readonly languageId: string; readonly isDirty: boolean };
  readonly cursor?: { readonly path: string; readonly position: TextPosition };
  readonly selection?: { readonly path: string; readonly range: TextRange; readonly text: string };
  readonly surroundingSymbol?: { readonly path: string; readonly name: string };
  readonly surroundingCode?: { readonly path: string; readonly range: TextRange; readonly text: string };
  readonly openFiles: readonly string[]; readonly diagnostics: readonly EditorDiagnostic[];
  readonly items: readonly ContextItem[]; readonly truncated: boolean;
}
export interface ContextOptions { readonly maxChars?: number; readonly surroundingLines?: number; }

const DEFAULT_MAX_CHARS = 12_000;
const DEFAULT_SURROUNDING_LINES = 20;

/** Collect and rank editor context without depending on a particular editor API. */
export function collectEditorContext(snapshot: EditorSnapshot, options: ContextOptions = {}): EditorContext {
  const maxChars = Math.max(1, options.maxChars ?? DEFAULT_MAX_CHARS);
  const surroundingLines = Math.max(0, options.surroundingLines ?? DEFAULT_SURROUNDING_LINES);
  const active = snapshot.activeFile;
  const items: ContextItem[] = [];
  if (active?.selection && active.selection.text.length > 0) {
    items.push({ kind: "selection", priority: 1, path: active.path, content: active.selection.text });
  }
  if (active) {
    items.push({ kind: "cursor", priority: 2, path: active.path, content: `${active.cursor.line}:${active.cursor.character}` });
    if (active.surroundingSymbol) items.push({ kind: "symbol", priority: 2, path: active.path, content: active.surroundingSymbol });
  }
  const surroundingCode = active ? getSurroundingCode(active, surroundingLines) : undefined;
  if (active && surroundingCode) items.push({ kind: "active-file", priority: 3, path: active.path, content: surroundingCode.text });
  if (snapshot.diagnostics.length > 0) items.push({ kind: "diagnostics", priority: 4, content: snapshot.diagnostics.map((d) => d.message).join("\n") });
  if (snapshot.openFiles.length > 0) items.push({ kind: "open-files", priority: 5, content: snapshot.openFiles.join("\n") });

  const bounded = boundItems(items, maxChars);
  const included = new Set(bounded.items.map((item) => item.kind));
  return {
    activeFile: active && included.has("active-file") ? { path: active.path, languageId: active.languageId, isDirty: active.isDirty } : undefined,
    cursor: active && included.has("cursor") ? { path: active.path, position: active.cursor } : undefined,
    selection: active?.selection && included.has("selection") ? { path: active.path, range: active.selection.range, text: active.selection.text } : undefined,
    surroundingSymbol: active?.surroundingSymbol && included.has("symbol") ? { path: active.path, name: active.surroundingSymbol } : undefined,
    surroundingCode: active && surroundingCode && included.has("active-file") ? { path: active.path, range: surroundingCode.range, text: surroundingCode.text } : undefined,
    openFiles: included.has("open-files") ? [...snapshot.openFiles] : [], diagnostics: included.has("diagnostics") ? [...snapshot.diagnostics] : [],
    items: bounded.items, truncated: bounded.truncated,
  };
}

function getSurroundingCode(active: NonNullable<EditorSnapshot["activeFile"]>, linesAround: number): { range: TextRange; text: string } {
  const lines = active.text.split(/\r?\n/);
  const startLine = Math.max(0, active.cursor.line - linesAround);
  const endLine = Math.min(lines.length - 1, active.cursor.line + linesAround);
  return { range: { start: { line: startLine, character: 0 }, end: { line: endLine, character: lines[endLine].length } }, text: lines.slice(startLine, endLine + 1).join("\n") };
}

function boundItems(items: readonly ContextItem[], maxChars: number): { items: readonly ContextItem[]; truncated: boolean } {
  const result: ContextItem[] = [];
  let size = 2; let truncated = false;
  for (const item of items) {
    const remaining = maxChars - size;
    if (remaining <= 0) { truncated = true; break; }
    const serialized = JSON.stringify(item);
    if (serialized.length <= remaining) { result.push(item); size += serialized.length + 1; continue; }
    const fixed = JSON.stringify({ ...item, content: "" }).length;
    const available = Math.max(0, remaining - fixed - 2);
    if (item.content && available > 0) result.push({ ...item, content: item.content.slice(0, available) });
    truncated = true; break;
  }
  return { items: result, truncated };
}
