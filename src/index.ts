import { Plugin } from "@opencode/plugin"
import {
  ensureMinimalState,
  projectSnapshot,
  shouldAutoInitialize,
  stateDir,
  touchesConductor,
} from "./state.js"

const ROOT_POLICY = `OpenCode Conductor is active.

Root-session contract:
- This root session is the user's only conversational interface. Never require the user to enter a child session.
- Treat .conductor/ as durable project state. Keep meaningful tasks, dependencies, decisions, current phase, and worker resume information synchronized.
- .conductor/tasks.json is the single source of truth for project tasks. OpenCode's native todowrite/todoread tools are intentionally unavailable while Conductor is active; the TUI projects tasks.json directly into the normal sidebar area instead of maintaining a second todo list.
- Do not create task records for trivial conversation or tiny edits that do not benefit from tracking.
- Perform straightforward low-risk work in the root session.
- Use at most ONE worker child session at a time and only when bounded complex work benefits from isolated focus.
- Use the built-in general subagent for the Conductor worker unless the user explicitly chose another suitable subagent.
- Launch Conductor workers in FOREGROUND, not background. Do not run workers in parallel.
- Prefer resuming the same child session when a task is still active instead of spawning a replacement.
- The root owns all .conductor/ writes and integrates worker results.

Blocking decisions:
- Never guess a product decision, preference, requirement, approval, or scope choice that can materially change the result.
- When such a decision becomes relevant, stop dependent work at a safe boundary and persist it in .conductor/decisions.json. Mark the relevant task waiting_for_user and dependent tasks blocked.
- For blocking user interaction, MUST use OpenCode's built-in question tool whenever it is available. Do not replace it with a numbered prose list.
- question is synchronous: wait for the submitted answers before dependent work continues.
- Prefer one batch with at most TWO substantive questions plus one final Zusatz question for additional context.
- Each substantive question should have a short header, a user-facing question, and 2-4 useful options. Put the recommended default first and explain consequences briefly.
- Set multiple=false for a mutually exclusive product decision. Use multiple=true only when several choices may legitimately be selected together.
- The user may always use the tool's custom/free-form answer. Do not add a fake 'Other' option when the native form already provides it.
- When useful, add a final question with header 'Zusatz' asking for further requirements or ideas. Include a 'Keine weiteren Angaben' option while leaving custom input available.
- After answers return, persist the answer and additional context, resolve the decision, and unblock only satisfied work.

Worker handoff:
- Child sessions cannot ask the user questions and cannot launch children. If a worker needs a user decision it must stop and return CONDUCTOR_USER_QUESTION in its result.
- When a worker returns CONDUCTOR_USER_QUESTION, persist/update the decision in the root, open the native question tool HERE in the root session, wait for the user, then continue the SAME worker session using the child session ID when its context is still useful.
- Preserve that worker session ID in .conductor/state.json while the worker task is active.
`

const WORKER_POLICY = `You are the single OpenCode Conductor worker for one bounded task delegated by the root session.

Worker contract:
- Work only on the delegated task and necessary technical prerequisites.
- You do not own user interaction. The question tool is intentionally unavailable in this child session.
- You cannot launch subagents. The subagent tool is intentionally unavailable in this child session.
- Native todowrite/todoread are intentionally unavailable. Do not create a second task list; report progress to the root for integration into .conductor/tasks.json.
- Never edit .conductor/. The root session owns persistent orchestration state.
- Do not make product, preference, scope, approval, or requirement decisions for the user.
- Technical implementation choices inside already-approved scope are allowed; report important ones to the root.
- If user input is required, stop at a safe boundary. Do not continue dependent work. Return a structured CONDUCTOR_USER_QUESTION to the root.

Preferred final handoff:
CONDUCTOR_RESULT
status: completed | waiting_for_user | blocked | failed
summary: <short summary>
artifacts:
  - <created or modified path, if any>
decisions:
  - <important technical decision, if any>
questions:
  - CONDUCTOR_USER_QUESTION: <question requiring the user, if any>
    options:
      - <useful option>
      - <useful option>
    recommended: <option if appropriate>
    context: <why the decision is needed>
follow_up:
  - <recommended next task, if any>
verification:
  - <checks performed and result>
`

type SessionInfoLike = {
  id?: string
  parentID?: string | null
}

async function sessionInfo(ctx: any, sessionID: string): Promise<SessionInfoLike> {
  return (await ctx.session.get({ sessionID })) as SessionInfoLike
}

function removeNativeTodoTools(tools: Record<string, unknown>): void {
  delete tools.todowrite
  delete tools.todoread
}

export default Plugin.define({
  id: "opencode-conductor",

  async setup(ctx) {
    const root = ctx.location.project?.directory ?? ctx.location.directory

    await ctx.session.hook("prompt", async (event) => {
      const session = await sessionInfo(ctx, event.sessionID)
      if (session.parentID) return

      if (await shouldAutoInitialize(root, event.prompt.text)) {
        await ensureMinimalState(root)
      }
    })

    await ctx.session.hook("context", async (event) => {
      const session = await sessionInfo(ctx, event.sessionID)
      removeNativeTodoTools(event.tools)

      if (session.parentID) {
        // This is deliberately stronger than prompting the worker not to ask:
        // user interaction and recursive delegation do not exist in its model-visible tool set.
        delete event.tools.question
        delete event.tools.subagent
        event.system.push({ type: "text", text: WORKER_POLICY })
        return
      }

      const snapshot = await projectSnapshot(root)
      event.system.push({
        type: "text",
        text: `${ROOT_POLICY}\nPersistent project snapshot:\n${snapshot}`,
      })
    })

    await ctx.permission.hook("evaluate", async (event) => {
      const session = await sessionInfo(ctx, event.sessionID)
      if (!session.parentID) return

      if (event.action === "question" || event.action === "subagent" || event.action === "todowrite") {
        event.effect = "deny"
        event.message = "OpenCode Conductor routes user interaction, delegation, and task state through the root session."
        return
      }

      if (event.action === "edit" && touchesConductor(event.resources)) {
        event.effect = "deny"
        event.message = `OpenCode Conductor workers may not edit ${stateDir(root)}; the root session owns orchestration state.`
      }
    })
  },
})
