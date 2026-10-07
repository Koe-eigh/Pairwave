import {
  CodingAgentError,
  type AgentAction,
  type AgentEdit,
  type AgentProgress,
  type AgentRequest,
  type AgentResult,
  type CodingAgent,
  type CodingAgentRunOptions,
} from "./index";

export interface SecretStorage {
  get(key: string): PromiseLike<string | undefined>;
}

export interface CodexConfiguration {
  readonly model: string;
  readonly endpoint: string;
  readonly credentialKey: string;
}

export interface CodexRequest {
  readonly endpoint: string;
  readonly model: string;
  readonly input: string;
  readonly action: AgentAction;
  readonly context: readonly { readonly source: string; readonly path?: string; readonly content: string }[];
  readonly apiKey: string;
}

export interface CodexResponse {
  readonly text: string;
  readonly edits?: readonly AgentEdit[];
}

export interface CodexTransportOptions {
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: AgentProgress) => void;
}

export interface CodexTransport {
  send(request: CodexRequest, options: CodexTransportOptions): Promise<CodexResponse>;
}

export interface CodexAgentOptions {
  readonly configuration: Partial<CodexConfiguration>;
  readonly secrets: SecretStorage;
  readonly transport: CodexTransport;
}

export const CODEX_CREDENTIAL_KEY = "pairwave.codex.apiKey";

const DEFAULT_CONFIGURATION: CodexConfiguration = {
  model: "gpt-4.1",
  endpoint: "https://api.openai.com/v1/responses",
  credentialKey: CODEX_CREDENTIAL_KEY,
};

export class CodexAgent implements CodingAgent {
  public readonly name = "codex";
  private readonly configuration: CodexConfiguration;
  private readonly secrets: SecretStorage;
  private readonly transport: CodexTransport;

  public constructor(options: CodexAgentOptions) {
    this.configuration = { ...DEFAULT_CONFIGURATION, ...options.configuration };
    this.secrets = options.secrets;
    this.transport = options.transport;
    if (!this.configuration.endpoint) throw new CodingAgentError("Codex endpoint is not configured.", "configuration");
    if (!this.configuration.model) throw new CodingAgentError("Codex model is not configured.", "configuration");
  }

  public async run(request: AgentRequest, options: CodingAgentRunOptions = {}): Promise<AgentResult> {
    if (request.action === "modify" && request.prompt.trim().length === 0) {
      throw new CodingAgentError("A modification request must include instructions.", "request");
    }
    if (options.signal?.aborted) throw new CodingAgentError("The coding-agent request was cancelled.", "cancelled");

    const apiKey = await this.secrets.get(this.configuration.credentialKey);
    if (options.signal?.aborted) throw new CodingAgentError("The coding-agent request was cancelled.", "cancelled");
    if (!apiKey) throw new CodingAgentError("Configure a Codex API key in Pairwave to continue.", "authentication");

    if (options.signal?.aborted) throw new CodingAgentError("The coding-agent request was cancelled.", "cancelled");
    options.onProgress?.({ phase: "queued", message: "Queued Codex request." });
    try {
      const response = await this.transport.send({
        endpoint: this.configuration.endpoint,
        model: this.configuration.model,
        input: request.prompt,
        action: request.action,
        context: request.context ?? [],
        apiKey,
      }, options);
      options.onProgress?.({ phase: "completed", message: "Codex request completed." });
      return { text: response.text, edits: response.edits ?? [], provider: this.name };
    } catch (error) {
      throw toCodingAgentError(error);
    }
  }
}

export function toCodingAgentError(error: unknown): CodingAgentError {
  if (error instanceof CodingAgentError) return error;
  if (error instanceof Error && error.name === "AbortError") {
    return new CodingAgentError("The coding-agent request was cancelled.", "cancelled");
  }
  const message = error instanceof Error ? error.message : "The coding-agent request failed.";
  const status = typeof error === "object" && error !== null && "status" in error ? error.status : undefined;
  const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
  if (status === 401 || status === 403) return new CodingAgentError("Codex rejected the stored credential. Update it and try again.", "authentication");
  if (status === 429) return new CodingAgentError("Codex is rate-limiting requests. Try again shortly.", "rate-limit", true);
  if (typeof status === "number" && status >= 500) return new CodingAgentError("Codex is temporarily unavailable. Try again shortly.", "unavailable", true);
  if (status === undefined) {
    if (code === "server_error") return new CodingAgentError("Codex is temporarily unavailable. Try again shortly.", "unavailable", true);
    if (code === "rate_limit_exceeded" || code === "rate_limit") return new CodingAgentError("Codex is rate-limiting requests. Try again shortly.", "rate-limit", true);
  }
  if (/abort|cancel/i.test(message)) return new CodingAgentError("The coding-agent request was cancelled.", "cancelled");
  return new CodingAgentError(`Codex request failed: ${message}`, "request");
}
