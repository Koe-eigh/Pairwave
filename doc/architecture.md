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

> Select or point at code, speak an instruction, and receive a useful code change.

The MVP does not need:

- a Pairwave backend server
- sophisticated repository-wide context retrieval
- multiple editor integrations
- the complete two-cursor experience
- team or synchronization features

The primary success criterion is whether using Pairwave feels useful enough that the developer naturally wants to use it repeatedly during real coding sessions.

## Open Questions

- Which realtime voice model should Pairwave use?
- Which reasoning/coding agent should Pairwave use?
- How should the context manager determine relevant repository context?
- How should references such as "this function" or "that class" be resolved?
- How much conversation history should be retained?
- When should the agent ask for confirmation before editing code?
- How should agent activity be represented in the editor?
- How should API credentials be stored and managed locally?
