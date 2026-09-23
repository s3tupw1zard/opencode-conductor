/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginModule } from "@opencode/plugin/tui"
import { For, Show, createMemo, createSignal } from "solid-js"
import {
  isConductorTasksPath,
  loadConductorTasks,
  resolveProjectRoot,
  sidebarTasks,
  type SidebarTask,
} from "./task-view.js"

function taskColor(theme: ReturnType<() => any>, task: SidebarTask) {
  if (task.tone === "success") return theme.success
  if (task.tone === "active") return theme.accent
  if (task.tone === "ready") return theme.text
  if (task.tone === "warning") return theme.warning
  if (task.tone === "error") return theme.error
  return theme.textMuted
}

const tui: TuiPlugin = async (api) => {
  const root = resolveProjectRoot(api.state.path)
  const [tasks, setTasks] = createSignal(await loadConductorTasks(root))
  let refreshGeneration = 0

  const refresh = async () => {
    const generation = ++refreshGeneration
    const next = await loadConductorTasks(root)
    if (generation === refreshGeneration) setTasks(next)
  }

  const stopWatcher = api.event.on("file.watcher.updated", (event) => {
    if (isConductorTasksPath(event.properties.file)) void refresh()
  })
  const stopEdited = api.event.on("file.edited", (event) => {
    if (isConductorTasksPath(event.properties.file)) void refresh()
  })

  api.lifecycle.onDispose(stopWatcher)
  api.lifecycle.onDispose(stopEdited)

  api.slots.register({
    order: 400,
    slots: {
      sidebar_content() {
        const theme = () => api.theme.current
        const projected = createMemo(() => sidebarTasks(tasks()))
        const completed = createMemo(() => tasks().filter((task) => task.status === "done" || task.status === "completed").length)

        return (
          <Show when={tasks().length > 0}>
            <box>
              <box flexDirection="row" gap={1}>
                <text fg={theme().text}>
                  <b>Conductor</b>
                </text>
                <text fg={theme().textMuted}>
                  {completed()}/{tasks().length} done
                </text>
              </box>

              <For each={projected().visible}>
                {(task) => (
                  <box>
                    <text fg={taskColor(theme(), task)}>
                      {task.symbol} {task.id} {task.title}
                    </text>
                    <Show when={task.status === "waiting_for_user" || task.status === "waiting_for_user_external"}>
                      <text fg={theme().textMuted}>  ↳ wartet auf Benutzerentscheidung</text>
                    </Show>
                    <Show when={task.dependencies.length > 0 && (task.status === "blocked" || task.status === "waiting_for_user" || task.status === "waiting_for_user_external")}>
                      <text fg={theme().textMuted}>  ↳ {task.dependencies.join(", ")}</text>
                    </Show>
                  </box>
                )}
              </For>

              <Show when={projected().omitted > 0}>
                <text fg={theme().textMuted}>+{projected().omitted} weitere Tasks</text>
              </Show>
            </box>
          </Show>
        )
      },
    },
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id: "opencode-conductor",
  tui,
}

export default plugin
