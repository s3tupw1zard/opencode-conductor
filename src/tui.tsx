/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui"
import { For, Show, createMemo, createSignal } from "solid-js"
import {
  isConductorTasksPath,
  loadConductorTasks,
  resolveProjectRoot,
  sidebarTasks,
  type ConductorTask,
} from "./task-view.js"

function eventFile(details: unknown): string | undefined {
  if (!details || typeof details !== "object") return undefined
  const record = details as Record<string, unknown>
  const data = record.data
  if (data && typeof data === "object") {
    const file = (data as Record<string, unknown>).file
    if (typeof file === "string") return file
  }
  const properties = record.properties
  if (properties && typeof properties === "object") {
    const file = (properties as Record<string, unknown>).file
    if (typeof file === "string") return file
  }
  return undefined
}

function TaskPanel(props: { tasks: () => ConductorTask[] }) {
  const projected = createMemo(() => sidebarTasks(props.tasks()))
  const completed = createMemo(
    () => props.tasks().filter((task) => task.status === "done" || task.status === "completed").length,
  )

  return (
    <Show when={props.tasks().length > 0}>
      <box>
        <box flexDirection="row" gap={1}>
          <text>
            <b>Conductor</b>
          </text>
          <text>
            {completed()}/{props.tasks().length} done
          </text>
        </box>

        <For each={projected().visible}>
          {(task) => (
            <box>
              <text>
                {task.symbol} {task.id} {task.title}
              </text>
              <Show when={task.status === "waiting_for_user" || task.status === "waiting_for_user_external"}>
                <text>  ↳ wartet auf Benutzerentscheidung</text>
              </Show>
              <Show
                when={
                  task.dependencies.length > 0 &&
                  (task.status === "blocked" ||
                    task.status === "waiting_for_user" ||
                    task.status === "waiting_for_user_external")
                }
              >
                <text>  ↳ {task.dependencies.join(", ")}</text>
              </Show>
            </box>
          )}
        </For>

        <Show when={projected().omitted > 0}>
          <text>+{projected().omitted} weitere Tasks</text>
        </Show>
      </box>
    </Show>
  )
}

export default Plugin.define({
  id: "opencode-conductor",

  async setup(context) {
    const location = context.location ?? context.data.location.default()
    const root = resolveProjectRoot({
      worktree: location?.project?.directory,
      directory: location?.directory ?? process.cwd(),
    })

    const [tasks, setTasks] = createSignal(await loadConductorTasks(root))
    let refreshGeneration = 0

    const refresh = async () => {
      const generation = ++refreshGeneration
      const next = await loadConductorTasks(root)
      if (generation === refreshGeneration) setTasks(next)
    }

    const stopEvents = context.data.listen(({ details }) => {
      if (details.type !== "file.watcher.updated" && details.type !== "file.edited") return
      const file = eventFile(details)
      if (file && isConductorTasksPath(file)) void refresh()
    })

    const stopSlot = context.ui.slot({
      append: "sidebar.content",
      render: () => <TaskPanel tasks={tasks} />,
    })

    return () => {
      stopEvents()
      stopSlot()
    }
  },
})
