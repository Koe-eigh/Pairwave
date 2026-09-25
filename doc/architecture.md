# Pairwave Architecture

This document describes the technical architecture and key engineering decisions behind Pairwave.

The architecture will evolve as the product is built and tested.

## Design Principles

### Local First

Pairwave should run locally whenever possible.

For the initial MVP, Pairwave does not require its own backend server. The VS Code extension handles orchestration locally and communicates directly with external AI services.

This keeps the architecture simple, minimizes infrastructure costs, and keeps repository context on the user's machine except when context must be sent to an AI provider.

### Voice Is an Interface Layer

Voice interaction is important to the user experience, but the voice model should remain a relatively thin layer.

Its primary responsibilities are:

- communicating naturally with the user
- understanding spoken intent
- providing short, useful responses
- passing user intent into the rest of the system

Complex code reasoning should be delegated to a dedicated reasoning or coding agent.

## Initial Platform

The first version of Pairwave will be implemented as a **VS Code extension**.

This gives Pairwave direct access to useful editor context, including:

- active file
- cursor position
- selected code
- open files
- diagnostics
- workspace information

The initial goal is to validate the core interaction before supporting additional editors.

## Core Interaction

The initial interaction loop is:

1. The user is working in the editor.
2. The user speaks naturally to Pairwave.
3. Pairwave captures the user's intent.
4. Pairwave collects relevant editor and repository context.
5. The context and intent are passed to a reasoning/coding agent.
6. The agent reasons about the task and optionally modifies the code.
7. Pairwave communicates the result back to the user.
8. The user continues coding.

## Context

Pairwave builds working context from multiple sources.

### Voice Context

What the user is currently saying and relevant conversation history.

### Editor Context

Examples include:

- active file
- cursor position
- selected code
- surrounding code
- open files
- diagnostics

### Repository Context

Examples may include:

- relevant files
- symbols and references
- project structure
- dependencies
- Git state and diffs

The context manager should select relevant information rather than blindly sending the entire repository to the reasoning model.

## Two-Cursor Model

Pairwave is designed around two independent cursors:

- **User cursor** — where the developer is currently working
- **Agent cursor** — where the AI agent is currently inspecting or modifying code

The user should be able to continue working while the agent investigates another part of the repository.

The agent cursor also provides a visual representation of the agent's current attention.

The two-cursor experience is not required for the earliest MVP and can be introduced after validating the basic voice-to-code interaction.

## High-Level Architecture

```text
Voice
  |
  v
Voice / Realtime Model
  |
  v
Context Manager
  |-- Conversation Context
  |-- Editor Context
  |-- Repository Context
  |-- Git Context
  |
  v
Reasoning / Coding Agent
  |
  +--> Read / Search Repository
  +--> Modify Code
  +--> Execute Tools
  |
  v
VS Code Extension
  |
  +--> User Cursor
  +--> Agent Cursor
```

## MVP

The first MVP should validate one core loop:

> **Work on code, talk naturally to Pairwave, and receive context-aware guidance without leaving your coding flow.**

The MVP focuses primarily on **Navigator Mode**.

In Navigator Mode, Pairwave acts as an AI pair programmer that understands what the user is currently working on through voice, editor state, and repository context.

Pairwave may:

- answer questions about the code
- explain unfamiliar code or behavior
- navigate to relevant code
- investigate problems across the repository
- suggest possible approaches
- guide the user through an implementation
- modify code when appropriate

Code modification is therefore **an available capability, not the primary interaction**.

A future **Driver Mode** can allow the agent to take a more active role in implementing changes, while Navigator Mode keeps the developer primarily in control of the coding process.

The primary MVP success criterion is whether developers naturally want to keep Pairwave running and repeatedly talk to it during real coding sessions.

### Context Prioritization

Not all context signals have the same relevance.

Pairwave should treat context selection as a **ranking problem** rather than sending all available context to the reasoning agent.

For the initial implementation, context should roughly be prioritized as follows:

1. **User selection** — the strongest indication of what the user is referring to
2. **Cursor position and surrounding symbol** — the function, class, or expression the user is currently working with
3. **Active file** — the immediate code surrounding the user's work
4. **Git workspace changes** — modified files and diffs that indicate the user's current work
5. **Open and recently viewed files** — weaker signals that may provide additional context
6. **Repository-wide context** — additional symbols, references, files, and dependencies retrieved when necessary

Higher-ranked context should be included or considered before lower-ranked context.

Pairwave should begin with a small, high-confidence context bundle and allow the reasoning agent to progressively retrieve broader repository context when necessary.

The goal is to provide the reasoning agent with **the most relevant context, not the most context**.

### Reasoning / Coding Agent

Pairwave should not be tightly coupled to a specific reasoning or coding agent.

The coding agent is **user-configurable**, allowing Pairwave to work with different agents depending on the user's development environment and preferences.

Pairwave should define a common abstraction between its context/orchestration layer and the underlying coding agent.

For the MVP, **Codex will be the first supported coding agent**.

This is an implementation choice for the MVP, not a permanent architectural dependency. The integration should be designed so that additional coding agents can be supported later without changing Pairwave's core architecture.

```text
Pairwave
    |
    v
Coding Agent Interface
    |
    +-- Codex        <- MVP
    +-- Other Agent  <- Future
```

### Realtime Voice Model

Pairwave should not be tightly coupled to a specific realtime voice provider.

The realtime voice model acts as a **thin conversational layer**. Its primary responsibilities are:

- receiving the user's speech
- maintaining a natural low-latency conversation
- handling interruptions and turn-taking
- understanding the user's immediate intent
- invoking Pairwave tools when necessary
- communicating results from the reasoning/coding agent back to the user

Complex code reasoning should remain the responsibility of the reasoning/coding agent rather than the realtime voice model.

For the MVP, **Gemini 3.8 Live** will be the first supported realtime voice model.

Gemini 3.8 Live is selected for the MVP because its realtime interaction and non-blocking function-calling model fit Pairwave's architecture, particularly the ability to delegate longer-running work to the coding agent while maintaining the conversational interaction.

As with the coding agent, this is an MVP implementation choice rather than a permanent architectural dependency.

Pairwave should define a common voice-provider abstraction so that additional realtime voice models can be supported later.

```text
Pairwave
    |
    v
Voice Provider Interface
    |
    +-- Gemini 3.8 Live     <- MVP
    +-- OpenAI Realtime     <- Future
    +-- Other Provider      <- Future
```

The voice provider and coding agent should remain independent choices:

```text
Realtime Voice Model
Gemini 3.8 Live
        |
        v
     Pairwave
 Context / Orchestration
        |
        v
 Coding Agent Interface
        |
        v
      Codex
```

For the MVP:

- **Realtime voice model:** Gemini 3.8 Live
- **Reasoning/coding agent:** Codex
- **Credentials:** user-provided API keys stored through VS Code SecretStorage
- **Pairwave backend:** none required
- **Architecture:** both voice and coding-agent providers remain replaceable

### API Credentials

For the MVP, Pairwave uses a **Bring Your Own Key (BYOK)** model.

Users provide their own API credentials for external AI services. Pairwave does not require its own backend for storing or distributing API credentials.

Credentials must be stored locally using **VS Code SecretStorage**.

Pairwave must not store API keys in:

- repository files
- `.env` files
- VS Code settings
- extension configuration
- other plaintext storage

VS Code SecretStorage provides the abstraction for securely storing secrets and relies on the platform's underlying credential-storage mechanisms where available. Pairwave should use this API rather than directly integrating with platform-specific facilities such as macOS Keychain.

```text
User API Key
     |
     v
VS Code SecretStorage
     |
     v
OS Credential Storage
     |
     v
Pairwave
     |
     v
AI Provider
```

This allows the MVP to remain **local-first and backend-free** while avoiding plaintext credential storage.

If Pairwave later manages credentials on behalf of users, the architecture should move toward a backend-managed credential model with short-lived client credentials rather than distributing long-lived service credentials to clients.

