# PairWave

Pair programming with AI agents through natural voice.

## The Idea

Coding with AI is still largely text-based. You write a prompt, wait for the agent, read its response, and repeat.

Pairwave explores a different way of working: **pair programming with an AI agent through natural voice conversation**.

Instead of constantly switching between coding and prompting, you can talk to the agent while you work—discuss ideas, give instructions, ask questions, and hear what the agent is doing.

The goal is to make working with a coding agent feel less like operating a tool and more like working alongside another developer.

## How It Works

Pairwave is designed around a simple idea: **you and the AI agent work in the codebase at the same time.**

While you code, Pairwave continuously builds context from multiple sources:

- **Voice** — what you're saying and asking the agent to do
- **Editor state** — your current file, cursor position, and selection
- **Repository context** — relevant files, symbols, dependencies, Git state, and project structure
- **Conversation context** — what you and the agent have been discussing

This context is passed to a reasoning agent, allowing it to understand not only what you say, but also **what you're looking at and what you're working on**.

### Two Cursors

Pairwave introduces two independent cursors: **yours and the agent's**.

Your cursor represents where you're working. The agent has its own cursor, allowing it to navigate, inspect, and modify other parts of the codebase without interrupting your workflow.

You can continue coding while the agent investigates a problem elsewhere, then have it explain what it found, suggest options, or make changes.

Voice is the communication layer. Context connects your work to the agent's reasoning. The two cursors let you work side-by-side.
