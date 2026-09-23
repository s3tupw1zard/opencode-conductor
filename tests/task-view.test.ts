import { describe, expect, test } from "bun:test"
import {
  isConductorTasksPath,
  parseConductorTasks,
  resolveProjectRoot,
  sidebarTasks,
  toSidebarTask,
} from "../src/task-view.js"

describe("task sidebar projection", () => {
  test("parses task documents and dependency aliases", () => {
    const tasks = parseConductorTasks({
      tasks: [
        {
          id: "IMPL-002",
          title: "CLI bauen",
          status: "blocked",
          depends_on: ["IMPL-001"],
          blocked_by: ["DEC-003", "IMPL-001"],
        },
      ],
    })

    expect(tasks).toEqual([
      {
        id: "IMPL-002",
        title: "CLI bauen",
        status: "blocked",
        dependencies: ["IMPL-001", "DEC-003"],
      },
    ])
  })

  test("maps conductor states to sidebar symbols", () => {
    expect(toSidebarTask({ id: "A", title: "Done", status: "done", dependencies: [] }).symbol).toBe("✓")
    expect(toSidebarTask({ id: "B", title: "Running", status: "in_progress", dependencies: [] }).symbol).toBe("●")
    expect(toSidebarTask({ id: "C", title: "Blocked", status: "blocked", dependencies: [] }).symbol).toBe("⊘")
    expect(toSidebarTask({ id: "D", title: "Decision", status: "waiting_for_user", dependencies: [] }).symbol).toBe("?")
  })

  test("shows actionable tasks before terminal tasks and reports omissions", () => {
    const tasks = parseConductorTasks({
      tasks: [
        { id: "DONE-1", title: "Done", status: "done" },
        { id: "BLOCK-1", title: "Blocked", status: "blocked" },
        { id: "RUN-1", title: "Running", status: "in_progress" },
        { id: "READY-1", title: "Ready", status: "ready" },
      ],
    })

    const projected = sidebarTasks(tasks, 3)
    expect(projected.visible.map((task) => task.id)).toEqual(["RUN-1", "READY-1", "BLOCK-1"])
    expect(projected.omitted).toBe(1)
  })

  test("recognizes task file paths on Windows and Unix", () => {
    expect(isConductorTasksPath(".conductor/tasks.json")).toBe(true)
    expect(isConductorTasksPath("C:\\work\\demo\\.conductor\\tasks.json")).toBe(true)
    expect(isConductorTasksPath("/work/demo/.conductor/tasks.json")).toBe(true)
    expect(isConductorTasksPath("/work/demo/.conductor/state.json")).toBe(false)
  })

  test("prefers a real worktree and falls back to directory", () => {
    expect(resolveProjectRoot({ worktree: "/work/repo", directory: "/work/repo/sub" })).toBe("/work/repo")
    expect(resolveProjectRoot({ worktree: "/", directory: "/work/repo" })).toBe("/work/repo")
  })
})
