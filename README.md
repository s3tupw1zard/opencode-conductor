# OpenCode Conductor

OpenCode Conductor is a lightweight persistent orchestration plugin for OpenCode V2.

It keeps project/task/decision state outside chat history while preserving one simple UX rule: **the root OpenCode session is the only session the user should ever need to interact with**.

## Why OpenCode

Conductor's blocking-decision flow maps directly to OpenCode's built-in `question` tool. The tool pauses execution, presents interactive options in the active session, supports multiple questions in one form, and always permits a custom answer. Child sessions can have both `question` and `subagent` removed from their model-visible tool set.

That gives Conductor a cleaner human-in-the-loop contract than trying to route queued async questions between hidden agent surfaces.

## Runtime model

- Root session owns user interaction and `.conductor/`.
- Straightforward work stays in the root.
- Complex bounded work may use exactly one foreground child session.
- A child cannot use `question` and cannot launch another child.
- If the worker needs a user decision it returns `CONDUCTOR_USER_QUESTION` to the root.
- Root opens OpenCode's native `question` form, stores the answer, and resumes the same child session when useful.

No model is hardcoded. The user's selected OpenCode model remains the root model; a configured subagent may use its own model, otherwise OpenCode inherits the parent model.

## Persistent state

The first meaningful root-session prompt creates:

```text
.conductor/
├── project.json
├── state.json
├── tasks.json
├── decisions.json
└── config.json
```

This state contract intentionally remains close to Codex Conductor so project skills can share the same concepts.

## Task sidebar

`.conductor/tasks.json` is the single source of truth for project tasks. Conductor does **not** mirror those tasks through OpenCode's `todowrite` tool or keep a second session todo list.

The package ships a separate TUI entrypoint that reads `tasks.json` directly and renders the current Conductor graph in OpenCode's normal sidebar content area. The view refreshes on OpenCode file-edit/file-watcher events and works across sessions because the source is project state, not session state.

Status mapping:

```text
✓ done / completed
● in_progress / active
○ ready / selected
⊘ blocked
? waiting_for_user
! failed
· proposed / pending
– skipped / cancelled
```

Blocked items can show their dependency IDs and user-decision waits are called out explicitly. The sidebar favors actionable tasks and caps the visible list so long-lived projects do not flood the UI.

While Conductor is active, native `todowrite`/`todoread` are removed from the root and worker model-visible tool sets to avoid duplicate task state.

## Blocking decisions

When a missing product decision, preference, requirement, approval, or scope choice changes the result:

```text
work reaches missing decision
        ↓
root records DEC-* and blocks dependent work
        ↓
root calls OpenCode question
        ↓
interactive form appears immediately
        ↓
user selects/types answers
        ↓
root persists answer and unblocks satisfied work
```

Conductor asks at most two substantive questions in one batch when possible and reserves a final `Zusatz` question for additional context. Mutually exclusive decisions use single-select; genuine feature/option selections may use multi-select. OpenCode's custom-answer path remains available.

## Worker handoff

A worker is injected with a dedicated contract and has `question` and `subagent` removed from its context before model dispatch. A permission hook also denies those actions as defense in depth.

If input is required, the worker returns something like:

```text
CONDUCTOR_RESULT
status: waiting_for_user
summary: Persistence design is blocked on one product decision.
questions:
  - CONDUCTOR_USER_QUESTION: What should happen when dependencies are still open?
    options:
      - Block completion
      - Allow completion with a warning
    recommended: Block completion
    context: This changes validation and tests.
```

The root then owns the interactive question and may continue the same worker using the child session ID.

## Installation

The current development build targets OpenCode V2 and lives on `feat/initial-conductor-runtime` until the initial PR is merged:

```bash
opencode plugin add github:s3tupw1zard/opencode-conductor#feat/initial-conductor-runtime
```

After the initial runtime lands on `main`, the stable Git install becomes:

```bash
opencode plugin add github:s3tupw1zard/opencode-conductor
```

The package exposes separate `./server` and `./tui` entrypoints, so one plugin install can activate the orchestration runtime and the Conductor sidebar without duplicating task state.

Check installed plugins with:

```bash
opencode plugin list
opencode plugin check
```

For a project-local development checkout you can instead reference the package from OpenCode's plugin configuration.

## Development

```bash
bun install
bun run typecheck
bun test
```

See [`docs/live-test.md`](docs/live-test.md) for the acceptance test.

## Current status

`0.1.1` adds the direct Conductor task sidebar on top of the initial OpenCode port. The live acceptance target is:

**root → one worker → worker needs decision → root native question UI → user answer → same worker resumes → persistent state updated → task graph visible directly in the OpenCode sidebar**.

Codex Conductor remains a separate project; this repository does not replace or modify it.
