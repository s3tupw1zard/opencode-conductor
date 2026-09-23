import { readFile } from "node:fs/promises"
import { join } from "node:path"

export type ConductorTask = {
  id: string
  title: string
  status: string
  dependencies: string[]
}

export type SidebarTask = ConductorTask & {
  symbol: string
  tone: "success" | "active" | "ready" | "warning" | "error" | "muted"
  terminal: boolean
}

const STATUS = {
  done: { symbol: "✓", tone: "success", terminal: true },
  completed: { symbol: "✓", tone: "success", terminal: true },
  in_progress: { symbol: "●", tone: "active", terminal: false },
  active: { symbol: "●", tone: "active", terminal: false },
  ready: { symbol: "○", tone: "ready", terminal: false },
  selected: { symbol: "○", tone: "ready", terminal: false },
  proposed: { symbol: "·", tone: "muted", terminal: false },
  pending: { symbol: "·", tone: "muted", terminal: false },
  blocked: { symbol: "⊘", tone: "error", terminal: false },
  waiting_for_user: { symbol: "?", tone: "warning", terminal: false },
  waiting_for_user_external: { symbol: "?", tone: "warning", terminal: false },
  failed: { symbol: "!", tone: "error", terminal: false },
  skipped: { symbol: "–", tone: "muted", terminal: true },
  cancelled: { symbol: "–", tone: "muted", terminal: true },
} as const

const STATUS_RANK = new Map<string, number>([
  ["waiting_for_user", 0],
  ["waiting_for_user_external", 0],
  ["in_progress", 1],
  ["active", 1],
  ["ready", 2],
  ["selected", 2],
  ["blocked", 3],
  ["failed", 4],
  ["proposed", 5],
  ["pending", 5],
  ["done", 6],
  ["completed", 6],
  ["skipped", 7],
  ["cancelled", 7],
])

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(String).map((item) => item.trim()).filter(Boolean)
}

function taskCollection(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
  if (!value || typeof value !== "object") return []
  const tasks = (value as Record<string, unknown>).tasks
  return Array.isArray(tasks)
    ? tasks.filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    : []
}

export function parseConductorTasks(value: unknown): ConductorTask[] {
  return taskCollection(value).map((task, index) => {
    const id = String(task.id ?? `TASK-${index + 1}`)
    const title = String(task.title ?? task.name ?? "(untitled)")
    const status = String(task.status ?? "proposed").toLowerCase()
    const dependencies = [
      ...stringArray(task.depends_on),
      ...stringArray(task.dependencies),
      ...stringArray(task.blocked_by),
    ].filter((item, position, list) => list.indexOf(item) === position)

    return { id, title, status, dependencies }
  })
}

export function toSidebarTask(task: ConductorTask): SidebarTask {
  const style = STATUS[task.status as keyof typeof STATUS] ?? {
    symbol: "·",
    tone: "muted" as const,
    terminal: false,
  }
  return { ...task, ...style }
}

export function sidebarTasks(tasks: ConductorTask[], limit = 12): { visible: SidebarTask[]; omitted: number } {
  const projected = tasks.map(toSidebarTask)
  const ordered = projected
    .map((task, index) => ({ task, index }))
    .sort((a, b) => {
      const ar = STATUS_RANK.get(a.task.status) ?? 5
      const br = STATUS_RANK.get(b.task.status) ?? 5
      return ar - br || a.index - b.index
    })
    .map(({ task }) => task)

  const visible = ordered.slice(0, Math.max(0, limit))
  return { visible, omitted: Math.max(0, ordered.length - visible.length) }
}

export async function loadConductorTasks(root: string): Promise<ConductorTask[]> {
  try {
    const raw = await readFile(join(root, ".conductor", "tasks.json"), "utf8")
    return parseConductorTasks(JSON.parse(raw))
  } catch {
    return []
  }
}

export function isConductorTasksPath(file: string): boolean {
  const normalized = file.replaceAll("\\", "/").toLowerCase()
  return normalized === ".conductor/tasks.json" || normalized.endsWith("/.conductor/tasks.json")
}

export function resolveProjectRoot(path: { worktree?: string; directory: string }): string {
  const worktree = path.worktree?.trim()
  if (worktree && worktree !== "/") return worktree
  return path.directory
}
