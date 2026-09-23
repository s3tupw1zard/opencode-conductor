import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  ensureMinimalState,
  ensureModelRoutingConfig,
  escalateCurrentTaskRouting,
  isTrivialPrompt,
  projectSnapshot,
  resolveCurrentTaskRouting,
  shouldAutoInitialize,
  stateDir,
  touchesConductor,
  writeJsonAtomic,
} from "../src/state.js"

const roots: string[] = []

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "opencode-conductor-"))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("state", () => {
  test("trivial prompts do not initialize a project", async () => {
    const root = await tempRoot()
    expect(isTrivialPrompt("Danke")).toBe(true)
    expect(isTrivialPrompt("Implementiere eine CLI")).toBe(false)
    expect(await shouldAutoInitialize(root, "Danke")).toBe(false)
    expect(await shouldAutoInitialize(root, "Implementiere eine CLI")).toBe(true)
  })

  test("creates the minimal durable state exactly once with current model defaults", async () => {
    const root = await tempRoot()
    const current = { providerID: "openai", id: "gpt-current" }
    expect(await ensureMinimalState(root, current)).toBe(true)
    expect(await ensureMinimalState(root, current)).toBe(false)

    const project = JSON.parse(await readFile(join(stateDir(root), "project.json"), "utf8"))
    const config = JSON.parse(await readFile(join(stateDir(root), "config.json"), "utf8"))
    const state = JSON.parse(await readFile(join(stateDir(root), "state.json"), "utf8"))

    expect(project.initialized_by).toBe("opencode-conductor-auto")
    expect(config.orchestration.max_active_workers).toBe(1)
    expect(config.orchestration.max_worker_depth).toBe(1)
    expect(config.decisions.input_tool).toBe("question")
    expect(config.model_routing.setup_state).toBe("pending")
    expect(config.model_routing.profiles.economy.model).toEqual(current)
    expect(config.model_routing.profiles.balanced.model).toEqual(current)
    expect(config.model_routing.profiles.strong.model).toEqual(current)
    expect(state.active_worker_session_id).toBe(null)
  })

  test("migrates an older config without overwriting orchestration", async () => {
    const root = await tempRoot()
    await ensureMinimalState(root)
    const path = join(stateDir(root), "config.json")
    await writeJsonAtomic(path, {
      schema_version: 1,
      orchestration: { max_active_workers: 1, custom: true },
      decisions: { input_tool: "question" },
    })

    const routing = await ensureModelRoutingConfig(root, { providerID: "demo", id: "current" })
    const config = JSON.parse(await readFile(path, "utf8"))
    expect(config.orchestration.custom).toBe(true)
    expect(routing.profiles.economy.model).toEqual({ providerID: "demo", id: "current" })
  })

  test("persists automatic route and escalates one tier after worker failure", async () => {
    const root = await tempRoot()
    await ensureMinimalState(root, { providerID: "demo", id: "current" })
    const directory = stateDir(root)

    await writeJsonAtomic(join(directory, "state.json"), {
      schema_version: 2,
      current_task_id: "IMPL-1",
      active_worker_session_id: null,
    })
    await writeJsonAtomic(join(directory, "tasks.json"), {
      schema_version: 2,
      tasks: [
        {
          id: "IMPL-1",
          title: "Implement storage",
          status: "in_progress",
          task_class: "implementation",
          complexity: "medium",
          risk: "low",
        },
      ],
    })

    const first = await resolveCurrentTaskRouting(root)
    expect(first.tier).toBe("balanced")

    const tasksAfterRoute = JSON.parse(await readFile(join(directory, "tasks.json"), "utf8"))
    expect(tasksAfterRoute.tasks[0].execution.model_tier).toBe("balanced")

    expect(await escalateCurrentTaskRouting(root, "worker execution failed")).toBe("strong")
    const tasksAfterEscalation = JSON.parse(await readFile(join(directory, "tasks.json"), "utf8"))
    expect(tasksAfterEscalation.tasks[0].execution.model_tier).toBe("strong")
    expect(tasksAfterEscalation.tasks[0].execution.escalated_from).toBe("balanced")
  })

  test("snapshot summarizes task, decision and model-routing state", async () => {
    const root = await tempRoot()
    await ensureMinimalState(root, { providerID: "demo", id: "current" })
    const directory = stateDir(root)

    await writeJsonAtomic(join(directory, "tasks.json"), {
      schema_version: 2,
      tasks: [
        { id: "SPEC-1", title: "Define behavior", status: "waiting_for_user" },
        { id: "IMPL-1", title: "Implement CLI", status: "blocked" },
      ],
    })
    await writeJsonAtomic(join(directory, "decisions.json"), {
      schema_version: 1,
      decisions: [
        { id: "DEC-1", question: "What happens on delete?", status: "open", blocking: true },
      ],
    })

    const snapshot = await projectSnapshot(root)
    expect(snapshot).toContain("SPEC-1: Define behavior")
    expect(snapshot).toContain("IMPL-1: Implement CLI")
    expect(snapshot).toContain("DEC-1: What happens on delete?")
    expect(snapshot).toContain("BLOCKING user decisions")
    expect(snapshot).toContain("Model routing: enabled, setup=pending")
    expect(snapshot).toContain("economy=demo/current")
  })

  test("atomic writer leaves valid JSON", async () => {
    const root = await tempRoot()
    const path = join(root, "nested", "value.json")
    await writeJsonAtomic(path, { answer: 42 })
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ answer: 42 })
  })

  test("worker state guard recognizes conductor paths on Windows and Unix", () => {
    expect(touchesConductor([".conductor/tasks.json"])).toBe(true)
    expect(touchesConductor(["C:\\work\\repo\\.conductor\\state.json"])).toBe(true)
    expect(touchesConductor(["src/index.ts"])).toBe(false)
  })
})
