# OpenCode Conductor

OpenCode Conductor is a lightweight persistent orchestration plugin for OpenCode V2.

It keeps project/task/decision state outside chat history while preserving one simple UX rule: **the root OpenCode session is the only session the user should ever need to interact with**.

## Why OpenCode

Conductor's blocking-decision flow maps directly to OpenCode's built-in `question` tool. The tool pauses execution, presents interactive options in the active session, supports multiple questions in one form, and always permits a custom answer. Child sessions can have both `question` and delegation tools removed from their model-visible tool set.

## Runtime model

- Root session owns user interaction and `.conductor/`.
- Straightforward low-risk work stays in the root.
- Complex bounded work may use exactly one foreground child session.
- A child cannot ask the user questions and cannot launch another child.
- If the worker needs a user decision it returns `CONDUCTOR_USER_QUESTION` to the root.
- Root opens OpenCode's native `question` form, stores the answer, and resumes the same child session when useful.
- Model routing uses project-local `economy`, `balanced`, and `strong` tiers and always prefers the lowest sufficient tier.

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

The selected model that is active when the project is first initialized is written as the safe bootstrap model for all three routing tiers. Conductor then asks once per project which locally available OpenCode model should be used for each tier.

## Model routing

Conductor 0.2 introduces project-local automatic model routing.

The default policy is:

```text
economy
  root orchestration, status, tiny edits, routine docs, low-risk work

balanced
  normal implementation, analysis, debugging, research, verification

strong
  high/very-high complexity, high/critical risk, significant architecture,
  or evidence-based escalation
```

The first project run uses OpenCode's locally available, enabled, tool-capable model list and opens one native question form for:

1. Economy model
2. Balanced model
3. Strong model

The same model may be selected for multiple tiers. Until that setup is submitted, the current model remains the safe fallback for all tiers. The Conductor runtime reads the native `question` result itself and persists all three exact model references; the root model does not have to manually translate the user's choices into configuration.

Selections are stored in `.conductor/config.json`:

```json
{
  "model_routing": {
    "enabled": true,
    "strategy": "lowest_sufficient",
    "setup_state": "configured",
    "root_tier": "economy",
    "profiles": {
      "economy": {
        "model": { "providerID": "provider", "id": "model-a" },
        "source": "user"
      },
      "balanced": {
        "model": { "providerID": "provider", "id": "model-b" },
        "source": "user"
      },
      "strong": {
        "model": { "providerID": "provider", "id": "model-c" },
        "source": "user"
      }
    }
  }
}
```

Tracked tasks should include `task_class`, `complexity`, and `risk`. Conductor derives the worker tier at delegation time and persists the selected tier and routing reason in the task's `execution` object. Explicit `execution.model_tier` remains available as an override.

The root is switched to the configured `economy` model on normal project turns after setup. Before a worker starts, Conductor resolves the current task and switches the child session to the configured tier model. Resuming an existing child can switch that same worker to a newly selected tier without discarding its context.

Escalation is deliberately conservative. A generic worker-tool error does **not** spend a stronger tier automatically. A worker must return a `CONDUCTOR_ESCALATION_REQUEST:` line with concrete evidence that its assigned tier is insufficient. Only then does Conductor record a one-step escalation (`economy → balanced → strong`) for the next retry. Ordinary syntax errors, one failed test, temporary tool/network failures, or tedious work are not escalation evidence.

## Task sidebar

`.conductor/tasks.json` is the single source of truth for project tasks. Conductor does **not** mirror those tasks through OpenCode's `todowrite` tool or keep a second session todo list.

The package ships a separate TUI entrypoint that reads `tasks.json` directly and renders the current Conductor graph in OpenCode's normal sidebar content area.

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

A worker is injected with a dedicated contract and has user-question and recursive-delegation tools removed from its context before model dispatch. A permission hook also denies those actions as defense in depth.

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

Install the current main branch:

```bash
opencode plugin add github:s3tupw1zard/opencode-conductor
```

For this development branch while PR #2 is open:

```bash
opencode plugin add github:s3tupw1zard/opencode-conductor#feat/model-routing
```

The package exposes separate `./server` and `./tui` entrypoints, so one plugin install can activate the orchestration runtime and the Conductor sidebar without duplicating task state.

Check installed plugins with:

```bash
opencode plugin list
opencode plugin check
```

## Development

```bash
bun install
bun run typecheck
bun test
```

See [`docs/live-test.md`](docs/live-test.md) for the acceptance test.

## Current status

`0.2.0` adds project-local model profiles, first-use interactive model setup, task complexity/risk routing, economy-root switching, worker model switching, same-worker tier changes and evidence-based escalation.

The live acceptance target is:

**project init → choose economy/balanced/strong from local models → economy root → task classified → correctly tiered worker → worker question → root native question UI → same worker resumes → persistent state updated → task graph visible directly in the OpenCode sidebar**.

Codex Conductor remains a separate project; this repository does not replace or modify it.
