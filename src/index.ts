import { Plugin } from "@opencode/plugin"
import {
  ensureMinimalState,
  ensureModelRoutingConfig,
  escalateCurrentTaskRouting,
  getModelRoutingConfig,
  hasConductorState,
  modelForTier,
  projectSnapshot,
  resolveCurrentTaskRouting,
  setActiveWorkerRouting,
  shouldAutoInitialize,
  stateDir,
  touchesConductor,
} from "./state.js"
import {
  modelSelectionInstructions,
  normalizeAvailableModels,
  type ModelTier,
  type RoutingModelRef,
} from "./model-routing.js"

const ROOT_POLICY = `OpenCode Conductor is active.

Root-session contract:
- This root session is the user's only conversational interface. Never require the user to enter a child session.
- Treat .conductor/ as durable project state. Keep meaningful tasks, dependencies, decisions, current phase, and worker resume information synchronized.
- .conductor/tasks.json is the single source of truth for project tasks. OpenCode's native todowrite/todoread tools are intentionally unavailable while Conductor is active; the TUI projects tasks.json directly into the normal sidebar area instead of maintaining a second todo list.
- Do not create task records for trivial conversation or tiny edits that do not benefit from tracking.
- Every meaningful tracked task SHOULD carry task_class, complexity, and risk. Use complexity=trivial|low|medium|high|very_high and risk=low|medium|high|critical.
- Perform straightforward low-risk work in the root session.
- Use at most ONE worker child session at a time and only when bounded complex work benefits from isolated focus.
- Use the built-in general subagent for the Conductor worker unless the user explicitly chose another suitable subagent.
- Launch Conductor workers in FOREGROUND, not background. Do not run workers in parallel.
- Prefer resuming the same child session when a task is still active instead of spawning a replacement.
- Before delegating, set .conductor/state.json current_task_id to the task being delegated. Conductor uses that task's complexity/risk/class metadata to select the worker model tier automatically.
- Do not hardcode model names into tasks. Store execution.model_tier only when an explicit tier override or escalation is needed.
- The root owns all normal .conductor/ task/decision writes and integrates worker results. The Conductor runtime itself may maintain routing/audit fields.

Model routing:
- Conductor uses project-local tiers economy, balanced, and strong with strategy lowest_sufficient.
- economy is for orchestration, status, tiny edits, routine documentation and other low-risk work.
- balanced is the default for normal implementation, analysis, debugging, research and verification.
- strong is reserved for high/very-high complexity, high/critical risk, significant architecture, or evidence-based escalation.
- Do not spend strong-tier quota merely because it exists. Prefer the smallest tier sufficient for the task.
- A worker may request one-step escalation only by returning CONDUCTOR_ESCALATION_REQUEST with concrete evidence that its assigned tier is insufficient. Conductor does not escalate merely because the worker tool errored, a syntax error occurred, or one test failed.
- Resume the same worker when practical after a tier change rather than discarding its context.

Blocking decisions:
- Never guess a product decision, preference, requirement, approval, or scope choice that can materially change the result.
- When such a decision becomes relevant, stop dependent work at a safe boundary and persist it in .conductor/decisions.json. Mark the relevant task waiting_for_user and dependent tasks blocked.
- For blocking user interaction, MUST use OpenCode's built-in question tool whenever it is available. Do not replace it with a numbered prose list.
- question is synchronous: wait for the submitted answers before dependent work continues.
- Prefer one batch with at most TWO substantive questions plus one final Zusatz question for additional context.
- Each substantive question should have a short header, a user-facing question, and useful options. Put the recommended default first and explain consequences briefly.
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
- Never edit .conductor/. The root session owns normal persistent orchestration state.
- Do not make product, preference, scope, approval, or requirement decisions for the user.
- Technical implementation choices inside already-approved scope are allowed; report important ones to the root.
- If user input is required, stop at a safe boundary. Do not continue dependent work. Return a structured CONDUCTOR_USER_QUESTION to the root.
- If the assigned model tier is genuinely insufficient for the task, return exactly one line beginning CONDUCTOR_ESCALATION_REQUEST: followed by concrete evidence. Use this only for a demonstrated capability/complexity mismatch, not for ordinary syntax errors, a single failed test, temporary tool/network failure, or merely tedious work.

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

type PendingWorkerRoute = {
  tier: ModelTier
  model: RoutingModelRef
  reason: string
  taskID: string | null
}

async function sessionInfo(ctx: any, sessionID: string): Promise<SessionInfoLike> {
  return (await ctx.session.get({ sessionID })) as SessionInfoLike
}

function removeNativeTodoTools(tools: Record<string, unknown>): void {
  delete tools.todowrite
  delete tools.todoread
}

function isWorkerTool(tool: string): boolean {
  return tool === "subagent" || tool === "task"
}

function taskIDFromInput(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined
  const taskID = (input as Record<string, unknown>).task_id
  return typeof taskID === "string" && taskID ? taskID : undefined
}

function resultText(result: unknown): string {
  if (!result || typeof result !== "object") return ""
  const record = result as Record<string, unknown>
  if (typeof record.content === "string") return record.content
  if (Array.isArray(record.content)) {
    return record.content
      .filter((item): item is { type: string; text?: string } => !!item && typeof item === "object" && "type" in item)
      .filter((item) => item.type === "text" && typeof item.text === "string")
      .map((item) => item.text)
      .join("\n")
  }
  return typeof record.output === "string" ? record.output : ""
}

function escalationEvidence(result: unknown): string | null {
  const text = resultText(result)
  const match = text.match(/^CONDUCTOR_ESCALATION_REQUEST:\s*(.+)$/im)
  return match?.[1]?.trim() || null
}

export default Plugin.define({
  id: "opencode-conductor",

  async setup(ctx) {
    const root = ctx.location.project?.directory ?? ctx.location.directory
    const pendingProjectInit = new Set<string>()
    const pendingWorkerRoute = new Map<string, PendingWorkerRoute>()

    await ctx.session.hook("prompt", async (event) => {
      const session = await sessionInfo(ctx, event.sessionID)

      if (session.parentID) {
        const route = pendingWorkerRoute.get(session.parentID)
        if (!route) return
        await ctx.session.switchModel({ sessionID: event.sessionID, model: route.model as any })
        await setActiveWorkerRouting(root, event.sessionID, route.tier, route.model)
        pendingWorkerRoute.delete(session.parentID)
        return
      }

      if (await shouldAutoInitialize(root, event.prompt.text)) {
        // The prompt hook does not expose the selected model. Defer actual state creation
        // until the immediately following context hook, where event.model is authoritative.
        pendingProjectInit.add(event.sessionID)
        return
      }

      if (!(await hasConductorState(root))) return
      const routing = await getModelRoutingConfig(root)
      if (routing.enabled && routing.setup_state === "configured") {
        const rootModel = await modelForTier(root, routing.root_tier ?? "economy")
        if (rootModel) await ctx.session.switchModel({ sessionID: event.sessionID, model: rootModel as any })
      }
    })

    await ctx.session.hook("context", async (event) => {
      const session = await sessionInfo(ctx, event.sessionID)
      removeNativeTodoTools(event.tools)

      if (session.parentID) {
        delete event.tools.question
        delete event.tools.subagent
        delete event.tools.task
        const routing = await getModelRoutingConfig(root)
        const activeTier = routing.enabled ? (await resolveCurrentTaskRouting(root)).tier : "balanced"
        event.system.push({
          type: "text",
          text: `${WORKER_POLICY}\nAssigned Conductor model tier: ${activeTier}`,
        })
        return
      }

      if (pendingProjectInit.has(event.sessionID)) {
        await ensureMinimalState(root, event.model)
        pendingProjectInit.delete(event.sessionID)
      } else if (await hasConductorState(root)) {
        await ensureModelRoutingConfig(root, event.model)
      }

      const snapshot = await projectSnapshot(root)
      let setup = ""

      if (await hasConductorState(root)) {
        const routing = await getModelRoutingConfig(root)
        if (routing.enabled && routing.setup_state === "pending") {
          const available = normalizeAvailableModels(await ctx.model.list())
          setup = `\n\n${modelSelectionInstructions(available, event.model)}`
        }
      }

      event.system.push({
        type: "text",
        text: `${ROOT_POLICY}\nPersistent project snapshot:\n${snapshot}${setup}`,
      })
    })

    await ctx.tool.hook("execute.before", async (event) => {
      if (!isWorkerTool(event.tool)) return
      const session = await sessionInfo(ctx, event.sessionID)
      if (session.parentID || !(await hasConductorState(root))) return

      const routing = await getModelRoutingConfig(root)
      if (!routing.enabled || routing.setup_state !== "configured") return

      const route = await resolveCurrentTaskRouting(root)
      const model = await modelForTier(root, route.tier)
      if (!model) return

      const pending: PendingWorkerRoute = {
        tier: route.tier,
        model,
        reason: route.reason,
        taskID: route.taskID,
      }
      pendingWorkerRoute.set(event.sessionID, pending)

      const existingTaskID = taskIDFromInput(event.input)
      if (existingTaskID) {
        await ctx.session.switchModel({ sessionID: existingTaskID, model: model as any })
        await setActiveWorkerRouting(root, existingTaskID, route.tier, model)
        pendingWorkerRoute.delete(event.sessionID)
      }
    })

    await ctx.tool.hook("execute.after", async (event) => {
      if (!isWorkerTool(event.tool)) return
      const session = await sessionInfo(ctx, event.sessionID)
      if (session.parentID || !(await hasConductorState(root))) return

      pendingWorkerRoute.delete(event.sessionID)
      if (event.status !== "completed") return

      const evidence = escalationEvidence(event.result)
      if (evidence) await escalateCurrentTaskRouting(root, evidence)
    })

    await ctx.permission.hook("evaluate", async (event) => {
      const session = await sessionInfo(ctx, event.sessionID)
      if (!session.parentID) return

      if (
        event.action === "question" ||
        event.action === "subagent" ||
        event.action === "task" ||
        event.action === "todowrite"
      ) {
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
