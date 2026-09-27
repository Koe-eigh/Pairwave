import { execFile as execFileCallback } from "node:child_process";
import { readFile as readFileCallback, realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const DEFAULT_CONTENT_LIMIT = 4_000;
const MIN_INITIAL_CONTEXT_CHARS = JSON.stringify({ changedFiles: [], diff: "", files: [], items: [], degraded: false }).length;

export interface RepositoryGitPort {
  readonly listChangedFiles: () => Promise<readonly string[]>;
  readonly readDiff: () => Promise<string>;
  readonly readFileDiff?: (path: string) => Promise<string>;
  readonly isIgnored?: (path: string) => Promise<boolean>;
  readonly listFiles: () => Promise<readonly string[]>;
  readonly readSymbols?: (path: string) => Promise<readonly string[]>;
  readonly readReferences?: (path: string) => Promise<readonly string[]>;
  readonly readDependencies?: (path: string) => Promise<readonly string[]>;
}

export interface RepositoryFileSystemPort {
  readonly readFile: (path: string) => Promise<string>;
}

export interface RepositoryContextItem {
  readonly kind: "git-changes" | "git-diff" | "repository-file" | "repository-symbol" | "repository-reference" | "repository-dependency";
  readonly priority: number;
  readonly path?: string;
  readonly content?: string;
}

export interface RepositoryContext {
  readonly changedFiles: readonly string[];
  readonly diff: string;
  readonly files: readonly { readonly path: string; readonly content: string }[];
  readonly items: readonly RepositoryContextItem[];
  readonly degraded: boolean;
}

export type RepositoryRequest =
  | { readonly kind: "files" }
  | { readonly kind: "file"; readonly path: string }
  | { readonly kind: "modified-files" }
  | { readonly kind: "diff"; readonly path?: string }
  | { readonly kind: "symbols" | "references" | "dependencies"; readonly path: string };

export interface RepositoryProvider {
  readonly collectInitial: (options: { readonly maxChars: number }) => Promise<RepositoryContext>;
  readonly retrieve: (request: RepositoryRequest) => Promise<unknown>;
}

export interface RepositoryProviderOptions {
  readonly workspaceRoot: string;
  readonly git?: RepositoryGitPort;
  readonly fileSystem?: RepositoryFileSystemPort;
  readonly contentLimit?: number;
}

export function createRepositoryContextProvider(options: RepositoryProviderOptions): RepositoryProvider {
  const contentLimit = options.contentLimit ?? DEFAULT_CONTENT_LIMIT;
  const git = options.git ?? createGitPort(options.workspaceRoot);
  const fileSystem = options.fileSystem ?? createFileSystemPort(options.workspaceRoot);

  return {
    collectInitial: (request) => collectInitial(git, options.workspaceRoot, request),
    retrieve: (request) => retrieveRepositoryContext(git, fileSystem, options.workspaceRoot, request, contentLimit),
  };
}

async function collectInitial(git: RepositoryGitPort, workspaceRoot: string, options: { readonly maxChars: number }): Promise<RepositoryContext> {
  if (options.maxChars < MIN_INITIAL_CONTEXT_CHARS) {
    throw new RangeError(`maxChars must be at least ${MIN_INITIAL_CONTEXT_CHARS}`);
  }
  let changedFiles: readonly string[] = [];
  let diff = "";
  let degraded = false;
  try {
    changedFiles = await git.listChangedFiles();
  } catch {
    return emptyRepositoryContext(true);
  }
  try {
    diff = await git.readDiff();
  } catch {
    degraded = true;
  }
  const normalizedChangedFiles = changedFiles.filter((filePath) => isSafeRepositoryPath(workspaceRoot, filePath));
  const items: RepositoryContextItem[] = [];
  if (normalizedChangedFiles.length > 0) {
    items.push({ kind: "git-changes", priority: 4, content: normalizedChangedFiles.join("\n") });
  }
  if (diff.length > 0) items.push({ kind: "git-diff", priority: 4, content: diff });
  return fitInitialContext({
    changedFiles: normalizedChangedFiles,
    diff,
    files: [],
    items,
    degraded,
  }, options.maxChars);
}

async function retrieveRepositoryContext(
  git: RepositoryGitPort,
  fileSystem: RepositoryFileSystemPort,
  workspaceRoot: string,
  request: RepositoryRequest,
  contentLimit: number,
): Promise<unknown> {
  if (request.kind === "modified-files") {
    try {
      return (await git.listChangedFiles()).filter((filePath) => isSafeRepositoryPath(workspaceRoot, filePath));
    } catch {
      return [];
    }
  }
  if (request.kind === "diff") {
    try {
      if (request.path && !isSafeRepositoryPath(workspaceRoot, request.path)) return "";
      const diff = request.path && git.readFileDiff
        ? await git.readFileDiff(request.path)
        : await git.readDiff();
      return diff.slice(0, contentLimit);
    } catch {
      return "";
    }
  }
  if (request.kind === "files") {
    try {
      const paths = (await git.listFiles()).filter((filePath) => isSafeRepositoryPath(workspaceRoot, filePath));
      const files: Array<{ path: string; content: string }> = [];
      for (const path of paths) {
        const content = await readBoundedFile(fileSystem, path, contentLimit);
        if (content !== undefined) files.push({ path, content });
      }
      return files;
    } catch {
      return [];
    }
  }
  if (request.kind === "file") {
    if (!isSafeRepositoryPath(workspaceRoot, request.path)) return undefined;
    if (git.isIgnored && await git.isIgnored(request.path)) return undefined;
    const content = await readBoundedFile(fileSystem, request.path, contentLimit);
    return content === undefined ? undefined : { path: request.path, content };
  }
  if (!isSafeRepositoryPath(workspaceRoot, request.path)) return [];
  const readIndex = request.kind === "symbols" ? git.readSymbols
    : request.kind === "references" ? git.readReferences
      : git.readDependencies;
  if (!readIndex && request.kind !== "references") {
    const content = await readBoundedFile(fileSystem, request.path, contentLimit);
    if (content === undefined) return [];
    return request.kind === "symbols" ? extractSymbols(content) : extractDependencies(content);
  }
  if (!readIndex) return [];
  try {
    return await readIndex(request.path);
  } catch {
    return [];
  }
}

async function readBoundedFile(fileSystem: RepositoryFileSystemPort, path: string, contentLimit: number): Promise<string | undefined> {
  try {
    return (await fileSystem.readFile(path)).slice(0, contentLimit);
  } catch {
    return undefined;
  }
}

function fitInitialContext(context: RepositoryContext, maxChars: number): RepositoryContext {
  if (JSON.stringify(context).length <= maxChars) return context;
  let diff = context.diff;
  let changedFiles = [...context.changedFiles];
  while (JSON.stringify(buildInitialContext(context, changedFiles, diff)).length > maxChars && diff.length > 0) {
    diff = diff.slice(0, Math.max(0, diff.length - Math.max(1, Math.ceil(diff.length / 10))));
  }
  while (JSON.stringify(buildInitialContext(context, changedFiles, diff)).length > maxChars && changedFiles.length > 0) {
    changedFiles = changedFiles.slice(0, -1);
  }
  return buildInitialContext(context, changedFiles, diff);
}

function buildInitialContext(context: RepositoryContext, changedFiles: readonly string[], diff: string): RepositoryContext {
  const items: RepositoryContextItem[] = [];
  if (changedFiles.length > 0) items.push({ kind: "git-changes", priority: 4, content: changedFiles.join("\n") });
  if (diff.length > 0) items.push({ kind: "git-diff", priority: 4, content: diff });
  return { ...context, changedFiles, diff, items };
}

function emptyRepositoryContext(degraded: boolean): RepositoryContext {
  return { changedFiles: [], diff: "", files: [], items: [], degraded };
}

function isSafeRepositoryPath(workspaceRoot: string, candidate: string): boolean {
  if (!candidate || candidate === "." || candidate.includes("\0")) return false;
  if (path.isAbsolute(candidate) || path.win32.isAbsolute(candidate) || candidate.startsWith("\\")) return false;
  const normalizedCandidate = candidate.replaceAll("\\", "/");
  if (normalizedCandidate.split("/").includes("..")) return false;
  const root = path.resolve(workspaceRoot);
  const resolved = path.resolve(root, candidate);
  const relative = path.relative(root, resolved);
  return relative.length > 0 && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function createGitPort(workspaceRoot: string): RepositoryGitPort {
  const runGit = async (...args: string[]): Promise<string> => (await execFile("git", ["-C", workspaceRoot, ...args], { maxBuffer: 2_000_000 })).stdout;
  return {
    listChangedFiles: async () => {
      const [tracked, untracked] = await Promise.all([
        runGit("diff", "--name-only", "HEAD"),
        runGit("ls-files", "--others", "--exclude-standard"),
      ]);
      return uniqueLines(`${tracked}\n${untracked}`);
    },
    readDiff: () => runGit("diff", "HEAD", "--no-ext-diff", "--unified=20"),
    readFileDiff: (path) => runGit("diff", "HEAD", "--no-ext-diff", "--unified=20", "--", path),
    isIgnored: async (path) => {
      try {
        await execFile("git", ["-C", workspaceRoot, "check-ignore", "--quiet", "--", path]);
        return true;
      } catch {
        return false;
      }
    },
    listFiles: () => runGit("ls-files", "--cached", "--others", "--exclude-standard").then(uniqueLines),
    readReferences: async (requestedPath) => {
      try {
        const output = await runGit("grep", "-n", "-E", "(from|import|require)", "--", ".");
        const requested = path.posix.normalize(requestedPath);
        return uniqueLines(output.split(/\r?\n/).filter((line) => {
          const match = line.match(/^(.+?):\d+:(.*)$/);
          if (!match) return false;
          const specifier = match[2].match(/(?:from\s+|import\s+|import\s*\(\s*|require\s*\(\s*)["']([^"']+)["']/)?.[1];
          if (!specifier?.startsWith(".")) return false;
          const sourcePath = path.posix.dirname(match[1]);
          const resolved = path.posix.normalize(path.posix.join(sourcePath, specifier));
          return [resolved, `${resolved}.ts`, `${resolved}.tsx`, `${resolved}.js`, `${resolved}.jsx`].includes(requested);
        }).join("\n"));
      } catch {
        return [];
      }
    },
  };
}

function createFileSystemPort(workspaceRoot: string): RepositoryFileSystemPort {
  const canonicalRoot = realpath(workspaceRoot);
  return {
    readFile: async (filePath) => {
      const root = await canonicalRoot;
      const candidate = await realpath(path.resolve(root, filePath));
      const relative = path.relative(root, candidate);
      if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new Error("repository path escapes workspace");
      }
      return readFileCallback(candidate, "utf8");
    },
  };
}

function uniqueLines(value: string): string[] {
  return [...new Set(value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))];
}

function extractSymbols(content: string): string[] {
  const symbols = [...content.matchAll(/\b(?:class|function|interface|type|enum|const|let|var)\s+([A-Za-z_$][\w$]*)/g)];
  return [...new Set(symbols.map((match) => match[1]))];
}

function extractDependencies(content: string): string[] {
  const dependencies = [...content.matchAll(/(?:from\s+|import\s+|import\s*\(\s*|require\s*\(\s*)["']([^"']+)["']/g)];
  return [...new Set(dependencies.map((match) => match[1]))];
}
