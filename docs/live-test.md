# OpenCode Conductor live acceptance test

This test exercises native blocking questions, project-local model setup, automatic lowest-sufficient routing, root-only interaction, one worker, worker-to-root decision handoff, same-worker resume, persistent state, and the direct Conductor task sidebar.

## 1. Install the development build

```bash
opencode plugin add github:s3tupw1zard/opencode-conductor#feat/model-routing
opencode plugin list
```

Restart/reload OpenCode if necessary.

## 2. Use a fresh Git repository

Create an empty test repository and start the normal OpenCode TUI in it.

Send this prompt:

> Erstelle eine Python-CLI namens FlowBoard ausschließlich mit der Python-Standardbibliothek. FlowBoard verwaltet lokale Aufgaben mit Abhängigkeiten und speichert sie dauerhaft in JSON. Die CLI soll add, list, show, depends, undepends, start, done, archive, delete, next, export und import unterstützen. Aufgaben besitzen mindestens ID, Titel, Beschreibung, Status, Priorität, Erstellzeit und Abhängigkeiten. Nutze atomisches Schreiben, sinnvolle Validierung und automatisierte Tests sowie eine README.
>
> Zwei Produktentscheidungen sind noch offen und dürfen nicht geraten werden: Was soll beim Löschen einer Aufgabe passieren, von der andere Aufgaben abhängen? Und wie soll next mehrere gleichzeitig bearbeitbare Aufgaben sortieren? Stelle beide Entscheidungen mit sinnvollen Vorschlägen interaktiv und warte auf meine Antworten. Ich möchte außerdem zusätzliche Angaben machen können.
>
> Zerlege die Arbeit danach in einen kleinen persistenten Task-Graph mit echten Abhängigkeiten. Jeder sinnvolle Task soll task_class, complexity und risk erhalten. Nutze für einen abgegrenzten nicht-trivialen technischen Teil genau einen Worker.
>
> Eine spätere Produktfrage ist absichtlich noch ungelöst: Was passiert bei done, wenn noch nicht abgeschlossene Abhängigkeiten existieren? Diese Frage darf erst gestellt werden, wenn sie tatsächlich relevant wird. Wenn ein Worker darauf stößt, darf er nicht selbst fragen oder entscheiden. Er muss die Frage an die Root-Session zurückgeben. Die Root-Session soll mich interaktiv fragen und danach möglichst denselben Worker fortsetzen.
>
> Führe anschließend Implementation, Tests und Verifikation gegen die ursprünglichen Anforderungen durch. Dies ist ein Conductor-Test: Tasks, Dependencies und Entscheidungen sollen persistent gepflegt werden; triviale Einzelaktionen bekommen keine eigenen Tasks.

## 3. First-use model setup

Expected before normal project work continues:

- `.conductor/` appears after the meaningful root prompt.
- `config.json` initially contains the model active for the first turn as the bootstrap value for `economy`, `balanced`, and `strong`.
- `model_routing.setup_state` is initially `pending`.
- OpenCode's native `question` form asks exactly once per project for Economy, Balanced, and Strong.
- Choices come from the locally available, enabled, tool-capable OpenCode model list.
- Free/custom input remains available through OpenCode's native question UI.
- After submission, the exact chosen `{providerID,id}` values are stored in `config.json`, each profile has `source: "user"`, and `setup_state` becomes `configured`.

For a useful live test choose three visibly different models if available. If only one suitable model is installed, selecting the same model for every tier is valid but cannot prove switching.

After setup, the root should use the configured `economy` model on normal turns.

## 4. Product decision gate

Expected:

- OpenCode's native `question` form opens in the current root session without requiring navigation into another session.
- The two substantive questions can be navigated before final submission.
- Each offers concrete choices plus native custom/free-form input.
- An additional `Zusatz` question is present when practical.
- Dependent implementation does not continue until the form is submitted.

Example answers:

- Delete: block deletion while incoming dependencies exist.
- `next`: priority descending, creation time ascending, then ID.
- Zusatz: archived tasks must never appear in `next`; user-facing validation messages should be understandable.

## 5. Automatic worker model routing

Inspect `.conductor/tasks.json` before the worker is launched.

Expected examples:

```json
{
  "task_class": "implementation",
  "complexity": "medium",
  "risk": "low"
}
```

should route to `balanced`, while a task with `complexity: "high"` or `risk: "high"` should route to `strong`. Routine low-risk work should route to `economy`.

At delegation time Conductor should persist an `execution` object similar to:

```json
{
  "model_tier": "balanced",
  "routing_reason": "complexity=medium",
  "routed_at": "..."
}
```

`state.json` should record the active child session and the actual routed tier/model.

For an existing child resume, changing the task's explicit `execution.model_tier` and resuming the same `task_id` should switch that same child session rather than creating a replacement.

## 6. Escalation test

Only perform this deliberately if you can cause the worker call itself to fail safely.

Expected:

```text
economy -> balanced -> strong
```

one step per failed worker execution, never beyond `strong`.

The task should record `escalated_from`, `escalated_at`, and a routing reason. A normal failed unit test inside an otherwise successful worker result should not automatically consume strong-tier quota solely because a test failed once.

## 7. Direct task sidebar

As soon as `.conductor/tasks.json` contains tasks, the normal OpenCode session sidebar should show a `Conductor` block without any `todowrite` tool call.

Expected status symbols:

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

Expected behavior:

- `.conductor/tasks.json` is the only task source.
- The root model does not receive `todowrite` or `todoread` while Conductor is active.
- Updating `tasks.json` refreshes the sidebar via file events.
- blocked tasks may show dependency IDs below the task.
- waiting-for-user tasks are visibly marked as waiting on a user decision.
- long task graphs are capped in the sidebar and report how many tasks are omitted.

## 8. Worker handoff

When the later `done` rule becomes relevant, the worker must NOT open its own form.

Expected flow:

```text
root (economy)
  ↓ Conductor chooses worker tier
worker (balanced or strong)
  ↓ CONDUCTOR_USER_QUESTION
root
  ↓ native question form
user answer
  ↓ same child session ID
same worker resumes on its routed tier
```

A child session should not have `question`, recursive delegation, `todowrite`, or `todoread` in its model-visible tools. The plugin also denies protected worker actions through the permission hook.

Suggested answer for the delayed decision:

> Block `done` while any dependency is unfinished, and list the blocking dependency IDs in the validation message.

Fail the test if the user needs to navigate into the worker session to answer.

## 9. Persistent state

Inspect:

```text
.conductor/project.json
.conductor/state.json
.conductor/tasks.json
.conductor/decisions.json
.conductor/config.json
```

Expected properties:

- a small meaningful task graph rather than one task per file/tool action;
- resolved decisions contain the user's actual choices and relevant extra context;
- dependent tasks are blocked/unblocked consistently;
- model profiles remain project-local;
- routed tasks contain auditable tier/reason metadata;
- no worker edits `.conductor/` directly;
- `active_worker_session_id`, `active_worker_model_tier`, and `active_worker_model` describe the routed child while active.

## 10. Resume test

Close OpenCode completely, reopen the same repository, and ask:

> Wo stehen wir gerade?

The root session should receive the `.conductor/` snapshot and describe phase, active/ready/blocked tasks, unresolved decisions, worker resume state, and model-routing setup without needing the old chat transcript. The Conductor sidebar should repopulate directly from `tasks.json`.

The project must NOT ask for model-tier setup again while `setup_state` remains `configured`.

## 11. Existing-project change test

Ask:

> Ergänze einen Befehl blocked, der alle aktuell nicht bearbeitbaren Aufgaben und ihre offenen Abhängigkeiten anzeigt.

Expected: extend the existing task graph and preserve previous decisions and model profiles instead of starting project planning from scratch.

## 12. Triviality test

Ask:

> Ändere in der README die Überschrift Usage zu Verwendung.

Expected: perform the tiny edit without creating a large orchestration plan. The root should remain on the economy tier.

## Acceptance target

The feature is usable when this full cycle works reliably:

**project init → local-model tier selection → economy root → task classification → correct worker tier → worker question → root native form → same worker resume → persistent routed state → direct sidebar → clean restart without repeated setup**.
