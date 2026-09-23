# OpenCode Conductor live acceptance test

This test is deliberately designed to exercise native blocking questions, root-only interaction, one worker, worker-to-root decision handoff, same-worker resume, persistent project state, and the direct Conductor task sidebar.

## 1. Install the development build

```bash
opencode plugin add github:s3tupw1zard/opencode-conductor#feat/initial-conductor-runtime
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
> Zerlege die Arbeit danach in einen kleinen persistenten Task-Graph mit echten Abhängigkeiten. Nutze für einen abgegrenzten nicht-trivialen technischen Teil genau einen Worker.
>
> Eine spätere Produktfrage ist absichtlich noch ungelöst: Was passiert bei done, wenn noch nicht abgeschlossene Abhängigkeiten existieren? Diese Frage darf erst gestellt werden, wenn sie tatsächlich relevant wird. Wenn ein Worker darauf stößt, darf er nicht selbst fragen oder entscheiden. Er muss die Frage an die Root-Session zurückgeben. Die Root-Session soll mich interaktiv fragen und danach möglichst denselben Worker fortsetzen.
>
> Führe anschließend Implementation, Tests und Verifikation gegen die ursprünglichen Anforderungen durch. Dies ist ein Conductor-Test: Tasks, Dependencies und Entscheidungen sollen persistent gepflegt werden; triviale Einzelaktionen bekommen keine eigenen Tasks.

## 3. First decision gate

Expected:

- `.conductor/` appears after the meaningful root prompt.
- OpenCode's native `question` form opens in the current root session without requiring navigation into another session.
- The two substantive questions can be navigated before final submission.
- Each offers concrete choices plus native custom/free-form input.
- An additional `Zusatz` question is present when practical.
- Dependent implementation does not continue until the form is submitted.

Example answers:

- Delete: block deletion while incoming dependencies exist.
- `next`: priority descending, creation time ascending, then ID.
- Zusatz: archived tasks must never appear in `next`; user-facing validation messages should be understandable.

## 4. Direct task sidebar

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
- no separate native Todo list should appear unless another plugin or external action deliberately populates OpenCode session todos.

## 5. Worker handoff

When the later `done` rule becomes relevant, the worker must NOT open its own form.

Expected flow:

```text
root
  ↓ foreground subagent
worker
  ↓ CONDUCTOR_USER_QUESTION
root
  ↓ native question form
user answer
  ↓ same child session ID
same worker resumes
```

A child session should not have `question`, `subagent`, `todowrite`, or `todoread` in its model-visible tools. The plugin also denies protected worker actions through the permission hook.

Suggested answer for the delayed decision:

> Block `done` while any dependency is unfinished, and list the blocking dependency IDs in the validation message.

Fail the test if the user needs to navigate into the worker session to answer.

## 6. Persistent state

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
- no worker edits `.conductor/` directly;
- `active_worker_session_id` is used while a worker needs to be resumed and cleared after integration.

## 7. Resume test

Close OpenCode completely, reopen the same repository, and ask:

> Wo stehen wir gerade?

The root session should receive the `.conductor/` snapshot and describe phase, active/ready/blocked tasks, unresolved decisions, and worker resume state without needing the old chat transcript. The Conductor sidebar should also repopulate directly from `tasks.json`.

## 8. Existing-project change test

Ask:

> Ergänze einen Befehl blocked, der alle aktuell nicht bearbeitbaren Aufgaben und ihre offenen Abhängigkeiten anzeigt.

Expected: extend the existing task graph and preserve previous decisions instead of starting project planning from scratch. The sidebar should reflect the changed graph.

## 9. Triviality test

Ask:

> Ändere in der README die Überschrift Usage zu Verwendung.

Expected: perform the tiny edit without creating a large orchestration plan.

## Acceptance target

The port is usable when this full cycle works reliably:

**root → one foreground worker → worker question → root native form → user answer → same worker → result → state update → direct sidebar projection → clean resume after restart**.
