# Repository Guidelines

## Project Structure & Module Organization

Pairwave is currently a documentation-first project describing a voice-based AI pair-programming experience. The repository is organized as follows:

- `README.md` — product overview, goals, and interaction model.
- `doc/architecture.md` — technical architecture, MVP scope, provider abstractions, and context priorities.
- Future VS Code extension source should be grouped by responsibility (for example, `src/voice/`, `src/context/`, `src/agents/`, and `src/extension/`). Tests should live in a clearly mirrored `test/` or `src/**/*.test.*` layout, and static assets should be kept under `assets/`.

## Build, Test, and Development Commands

No build system, package manifest, or automated test suite has been added yet. Before introducing commands, document them here and in `README.md`. Once implementation begins, provide consistent scripts for local development, such as:

- `npm run build` — compile/package the VS Code extension.
- `npm test` — run the complete automated test suite.
- `npm run lint` — check style and static analysis.

## Coding Style & Naming Conventions

Follow the formatter and linter selected for the extension (expected to be TypeScript-oriented), and keep formatting automated rather than manual. Use two-space indentation unless the selected tool enforces another standard. Prefer `camelCase` for variables/functions, `PascalCase` for classes and provider implementations, and descriptive kebab-case for documentation filenames. Keep provider integrations behind common interfaces so voice and coding-agent implementations remain replaceable.

## Testing Guidelines

Add tests alongside each new subsystem, especially context ranking, provider adapters, credential handling, and extension commands. Use descriptive names such as `context-manager.test.ts` and test behavior rather than implementation details. Include unit tests for pure logic and integration tests for VS Code/provider boundaries when practical.

## Commit & Pull Request Guidelines

Keep commits small and focused. Existing history uses concise subjects such as `Add: MVP architecture` and `fix: typo`; continue using short imperative subjects, optionally with a consistent prefix (`Add:`, `Fix:`, `Docs:`). Pull requests should explain the user-facing or architectural impact, link the relevant issue or discussion, list validation commands run, and include screenshots or recordings for editor/voice UX changes.

## Security & Configuration

Never commit API keys or place them in `.env`, settings, or extension configuration. Store user-provided credentials through VS Code `SecretStorage`; Pairwave uses a BYOK model and should avoid introducing a backend or plaintext secret storage without an explicit architecture update.
