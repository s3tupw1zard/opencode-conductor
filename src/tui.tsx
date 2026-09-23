/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui"
import { For, Show, createMemo, createSignal } from "solid-js"
import { loadConductorTasks, sidebarTasks, type ConductorTask } from "./task-view.js"

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
    const root = location?.directory ?? process.cwd()

    const [tasks, setTasks] = createSignal(await loadConductorTasks(root))
    let refreshGeneration = 0

    const refresh = async () => {
      const generation = ++refreshGeneration
      const next = await loadConductorTasks(root)
      if (generation === refreshGeneration) setTasks(next)
    }

    const stopEvents = context.data.listen(({ details }) => {
      if (details.type === "filesystem.changed") void refresh()
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
