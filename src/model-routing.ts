export const MODEL_TIERS = ["economy", "balanced", "strong"] as const
export type ModelTier = (typeof MODEL_TIERS)[number]

export type RoutingModelRef = {
  providerID: string
  id: string
  variant?: string
}

export type RoutingProfile = {
  model: RoutingModelRef | null
  source: "bootstrap_current" | "user" | "migration" | "fallback"
}

export type ModelRoutingConfig = {
  enabled: boolean
  strategy: "lowest_sufficient"
  setup_state: "pending" | "configured"
  root_tier: ModelTier
  profiles: Record<ModelTier, RoutingProfile>
  escalation: {
    enabled: boolean
    require_evidence: boolean
    order: ModelTier[]
  }
}

export type TaskLike = Record<string, unknown>

export function isModelTier(value: unknown): value is ModelTier {
  return typeof value === "string" && (MODEL_TIERS as readonly string[]).includes(value)
}

export function normalizeModelRef(value: unknown): RoutingModelRef | null {
  if (!value || typeof value !== "object") return null
  const record = value as Record<string, unknown>
  const providerID = typeof record.providerID === "string" ? record.providerID : undefined
  const id =
    typeof record.id === "string"
      ? record.id
      : typeof record.modelID === "string"
        ? record.modelID
        : undefined
  const variant = typeof record.variant === "string" ? record.variant : undefined
  if (!providerID || !id) return null
  return { providerID, id, ...(variant ? { variant } : {}) }
}

export function modelRefKey(model: RoutingModelRef): string {
  return `${model.providerID}/${model.id}${model.variant ? `#${model.variant}` : ""}`
}

export function defaultModelRouting(currentModel?: unknown): ModelRoutingConfig {
  const current = normalizeModelRef(currentModel)
  const profile = (source: RoutingProfile["source"]): RoutingProfile => ({ model: current, source })
  return {
    enabled: true,
    strategy: "lowest_sufficient",
    setup_state: "pending",
    root_tier: "economy",
    profiles: {
      economy: profile("bootstrap_current"),
      balanced: profile("bootstrap_current"),
      strong: profile("bootstrap_current"),
    },
    escalation: {
      enabled: true,
      require_evidence: true,
      order: ["economy", "balanced", "strong"],
    },
  }
}

function rank(value: unknown, values: readonly string[]): number {
  if (typeof value !== "string") return -1
  return values.indexOf(value.toLowerCase())
}

export function recommendTier(task: TaskLike | undefined): { tier: ModelTier; reason: string } {
  if (!task) return { tier: "balanced", reason: "no current task metadata; safe balanced fallback" }

  const execution = task.execution && typeof task.execution === "object" ? (task.execution as Record<string, unknown>) : undefined
  const explicit = execution?.model_tier ?? task.model_tier
  if (isModelTier(explicit)) return { tier: explicit, reason: "explicit task routing" }

  const complexity = String(task.complexity ?? "").toLowerCase()
  const risk = String(task.risk ?? "").toLowerCase()
  const taskClass = String(task.task_class ?? task.class ?? "").toLowerCase()

  if (["high", "critical"].includes(risk)) {
    return { tier: "strong", reason: `risk=${risk}` }
  }
  if (["high", "very_high", "very-high", "extreme"].includes(complexity)) {
    return { tier: "strong", reason: `complexity=${complexity}` }
  }
  if (taskClass === "architecture" && rank(complexity, ["trivial", "low", "medium", "high"]) >= 2) {
    return { tier: "strong", reason: "architecture task with medium-or-higher complexity" }
  }

  if (risk === "medium" || complexity === "medium") {
    return { tier: "balanced", reason: risk === "medium" ? "risk=medium" : "complexity=medium" }
  }
  if (["implementation", "debugging", "research", "verification", "design", "specification"].includes(taskClass)) {
    return { tier: "balanced", reason: `task_class=${taskClass}` }
  }

  return { tier: "economy", reason: "low-risk routine task" }
}

export function nextTier(tier: ModelTier): ModelTier {
  if (tier === "economy") return "balanced"
  if (tier === "balanced") return "strong"
  return "strong"
}

export type AvailableModel = {
  providerID: string
  id: string
  name: string
  enabled: boolean
  toolCapable: boolean
  inputCost?: number
  outputCost?: number
}

export function normalizeAvailableModels(values: readonly unknown[]): AvailableModel[] {
  const result: AvailableModel[] = []
  for (const value of values) {
    if (!value || typeof value !== "object") continue
    const item = value as Record<string, any>
    const providerID = typeof item.providerID === "string" ? item.providerID : undefined
    const id = typeof item.id === "string" ? item.id : typeof item.modelID === "string" ? item.modelID : undefined
    if (!providerID || !id) continue

    const baseCost = Array.isArray(item.cost)
      ? item.cost.find((entry: any) => entry && entry.tier == null) ?? item.cost[0]
      : undefined
    result.push({
      providerID,
      id,
      name: typeof item.name === "string" ? item.name : id,
      enabled: item.enabled !== false,
      toolCapable: item.capabilities?.tools !== false,
      inputCost: typeof baseCost?.input === "number" ? baseCost.input : undefined,
      outputCost: typeof baseCost?.output === "number" ? baseCost.output : undefined,
    })
  }
  return result
    .filter((model) => model.enabled && model.toolCapable)
    .sort((a, b) => `${a.providerID}/${a.name}`.localeCompare(`${b.providerID}/${b.name}`))
}

export function modelSelectionInstructions(models: AvailableModel[], currentModel?: unknown): string {
  const current = normalizeModelRef(currentModel)
  const options = models.length
    ? models
        .map((model) => {
          const costs =
            model.inputCost !== undefined && model.outputCost !== undefined
              ? ` — $${model.inputCost}/$${model.outputCost} input/output per 1M`
              : ""
          const currentMarker = current && current.providerID === model.providerID && current.id === model.id ? " [current]" : ""
          return `- ${model.name} (${model.providerID}/${model.id})${currentMarker}${costs}`
        })
        .join("\n")
    : "- No enabled tool-capable models could be enumerated; keep the bootstrap model for all tiers."

  return `CONDUCTOR MODEL ROUTING SETUP IS PENDING.
Before continuing normal project planning or implementation, configure the three project-local model tiers with OpenCode's native question tool.

Available enabled tool-capable models from this OpenCode installation:
${options}

Ask exactly three single-select questions in one native question form:
1. Economy — routine orchestration, status, tiny edits and low-risk work. Prefer the cheapest model that is still reliable for tool use.
2. Balanced — normal implementation, analysis, debugging, research and verification. Prefer a capable model without spending strong-tier quota unnecessarily.
3. Strong — architecture, high-complexity work, high-risk changes and evidence-based escalation.

Use the complete locally available model list above as the selectable choices. The current model is only a safe bootstrap default, not a recommendation that all three tiers remain identical.
After the user submits the form, update .conductor/config.json model_routing.profiles with the exact selected {providerID,id} values, set each profile source to "user", and set model_routing.setup_state to "configured". Do not continue dependent project work until that write is complete.
The same model may be selected for multiple tiers if the user wants that.`
}
