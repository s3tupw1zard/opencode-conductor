import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises"
import { basename, join } from "node:path"

export const STATE_DIR_NAME = ".conductor"

export type JsonObject = Record<string, unknown>

const BLOCKING_DECISION_STATUSES = new Set([
  "open",
  "pending",
  "waiting_for_user",
  "waiting_for_user_external",
])

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z")
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

export function stateDir(root: string): string {
  return join(root, STATE_DIR_NAME)
}

export function isTrivialPrompt(prompt: string): boolean {
  const text = prompt.trim().toLowerCase().replace(/\s+/g, " ")
  if (!text) return true
  return new Set([
    "hi",
    "hallo",
    "hello",
    "hey",
    "danke",
    "thanks",
    "thank you",
    "ok",
    "okay",
    "passt",
    "alles klar",
    "weiter",
    "continue",
  ]).has(text)
}

export async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T
  } catch {
    return fallback
  }
}

export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const directory = path.slice(0, Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")))
  if (directory) await mkdir(directory, { recursive: true })
  const temp = `${path}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8")
  await rename(temp, path)
}

export async function shouldAutoInitialize(root: string, prompt: string): Promise<boolean> {
  return !(await exists(stateDir(root))) && !isTrivialPrompt(prompt)
}

export async function ensureMinimalState(root: string): Promise<boolean> {
  const directory = stateDir(root)
  if (await exists(directory)) return false

  await mkdir(directory, { recursive: true })
  const timestamp = nowIso()

  await writeJsonAtomic(join(directory, "project.json"), {
    schema_version: 1,
    name: basename(root) || "project",
    kind: "generic",
    profile_state: "incomplete",
    technologies: [],
    frameworks: [],
    constraints: [],
    initialized_by: "opencode-conductor-auto",
    created_at: timestamp,
    updated_at: timestamp,
  })

  await writeJsonAtomic(join(directory, "state.json"), {
    schema_version: 1,
    phase: "discovery",
    current_task_id: null,
    last_completed_task_id: null,
    selection_gate: null,
    active_worker_session_id: null,
    updated_at: timestamp,
  })

  await writeJsonAtomic(join(directory, "tasks.json"), {
    schema_version: 1,
    tasks: [],
  })

  await writeJsonAtomic(join(directory, "decisions.json"), {
    schema_version: 1,
    decisions: [],
  })

  await writeJsonAtomic(join(directory, "config.json"), {
    schema_version: 1,
    orchestration: {
      max_active_workers: 1,
      max_worker_depth: 1,
      worker_mode: "foreground",
      resume_same_worker: true,
    },
    decisions: {
      input_tool: "question",
      max_substantive_questions_per_batch: 2,
      include_additional_context_question: true,
    },
  })

  return true
}

function collection(value: unknown, key: string): JsonObject[] {
  if (Array.isArray(value)) return value.filter((item): item is JsonObject => !!item && typeof item === "object")
  if (value && typeof value === "object") {
    const nested = (value as JsonObject)[key]
    if (Array.isArray(nested)) return nested.filter((item): item is JsonObject => !!item && typeof item === "object")
  }
  return []
}

export async function projectSnapshot(root: string): Promise<string> {
  const directory = stateDir(root)
  if (!(await exists(directory))) {
    return [
      `Project root: ${root}`,
      "Conductor state: not initialized (.conductor/ is absent).",
      "A minimal state will be created automatically on the first meaningful root-session prompt.",
    ].join("\n")
  }

  const project = await readJson<JsonObject>(join(directory, "project.json"), {})
  const state = await readJson<JsonObject>(join(directory, "state.json"), {})
  const taskDoc = await readJson<unknown>(join(directory, "tasks.json"), { tasks: [] })
  const decisionDoc = await readJson<unknown>(join(directory, "decisions.json"), { decisions: [] })
  const tasks = collection(taskDoc, "tasks")
  const decisions = collection(decisionDoc, "decisions")

  const counts = new Map<string, number>()
  const active: string[] = []
  const ready: string[] = []
  const blocked: string[] = []

  for (const task of tasks) {
    const status = String(task.status ?? "unknown")
    counts.set(status, (counts.get(status) ?? 0) + 1)
    const label = `${String(task.id ?? "?")}: ${String(task.title ?? "(untitled)")}`
    if (status === "in_progress" || status === "waiting_for_user") active.push(label)
    if (status === "ready") ready.push(label)
    if (status === "blocked") blocked.push(label)
  }

  const openDecisions = decisions
    .filter((decision) => decision.blocking !== false && BLOCKING_DECISION_STATUSES.has(String(decision.status ?? "open")))
    .map((decision) => `${String(decision.id ?? "?")}: ${String(decision.question ?? decision.title ?? "(untitled)")}`)

  const lines = [
    `Project root: ${root}`,
    `Project: ${String(project.name ?? "(unnamed)")}${project.kind ? ` [${String(project.kind)}]` : ""}`,
    `Project profile: ${String(project.profile_state ?? "(unset)")}`,
    `Phase: ${String(state.phase ?? "(unset)")}`,
    `Current task: ${String(state.current_task_id ?? "(none)")}`,
    `Active worker session: ${String(state.active_worker_session_id ?? "(none)")}`,
  ]

  if (counts.size) lines.push(`Task counts: ${[...counts.entries()].sort().map(([key, value]) => `${key}=${value}`).join(", ")}`)
  if (active.length) lines.push(`Active tasks: ${active.slice(0, 5).join("; ")}`)
  if (ready.length) lines.push(`Ready tasks: ${ready.slice(0, 5).join("; ")}`)
  if (blocked.length) lines.push(`Blocked tasks: ${blocked.slice(0, 5).join("; ")}`)
  if (openDecisions.length) lines.push(`BLOCKING user decisions: ${openDecisions.slice(0, 5).join("; ")}`)
  if (state.selection_gate) lines.push(`Selection gate: ${JSON.stringify(state.selection_gate)}`)

  return lines.join("\n")
}

export function touchesConductor(resources: readonly string[]): boolean {
  return resources.some((resource) => {
    const normalized = resource.replaceAll("\\", "/")
    return normalized === ".conductor" || normalized.includes("/.conductor/") || normalized.endsWith("/.conductor") || normalized.startsWith(".conductor/")
  })
}
