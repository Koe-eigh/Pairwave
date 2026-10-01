/** Provider-neutral boundary for reasoning and coding-agent integrations. */
export type AgentAction = "read" | "search" | "explain" | "suggest" | "modify";

export interface AgentContext {
  readonly source: string;
  readonly content: string;
  readonly path?: string;
}

export interface AgentRequest {
  readonly action: AgentAction;
  readonly prompt: string;
  readonly context?: readonly AgentContext[];
}

export interface AgentProgress {
  readonly phase: "queued" | "working" | "completed";
  readonly message: string;
  readonly completed?: number;
  readonly total?: number;
}

export interface AgentEdit {
  readonly path: string;
  readonly oldText?: string;
  readonly newText: string;
}

export interface AgentResult {
  readonly text: string;
  readonly edits: readonly AgentEdit[];
  readonly provider: string;
}

export interface CodingAgentRunOptions {
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: AgentProgress) => void;
}

export interface CodingAgent {
  readonly name: string;
  run(request: AgentRequest, options?: CodingAgentRunOptions): Promise<AgentResult>;
}

export class CodingAgentError extends Error {
  public readonly code: "authentication" | "configuration" | "cancelled" | "rate-limit" | "unavailable" | "request" | "unknown";
  public readonly retryable: boolean;

  public constructor(message: string, code: CodingAgentError["code"], retryable = false, options?: ErrorOptions) {
    super(message, options);
    this.name = "CodingAgentError";
    this.code = code;
    this.retryable = retryable;
  }
}

export { FetchCodexTransport } from "./codex-transport";
