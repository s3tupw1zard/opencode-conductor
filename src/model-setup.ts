import { join } from "node:path"
import {
  getModelRoutingConfig,
  readJson,
  stateDir,
  writeJsonAtomic,
  type JsonObject,
} from "./state.js"
import type { AvailableModel, ModelTier, RoutingModelRef } from "./model-routing.js"

const REQUIRED_HEADERS: Record<ModelTier, string> = {
  economy: "economy",
  balanced: "balanced",
  strong: "strong",
}

type QuestionLike = {
  header?: unknown
  question?: unknown
}

function questionsFromInput(input: unknown): QuestionLike[] {
  if (!input || typeof input !== "object") return []
  const questions = (input as Record<string, unknown>).questions
  if (!Array.isArray(questions)) return []
  return questions.filter((question): question is QuestionLike => !!question && typeof question === "object")
}

function answersFromResult(result: unknown): string[][] {
  if (!result || typeof result !== "object") return []
  const record = result as Record<string, unknown>
  const output = record.output
  const answers =
    output && typeof output === "object"
      ? (output as Record<string, unknown>).answers
      : record.answers
  if (!Array.isArray(answers)) return []
  return answers.map((answer) =>
    Array.isArray(answer) ? answer.filter((item): item is string => typeof item === "string") : [],
  )
}

function tierForHeader(header: unknown): ModelTier | null {
  if (typeof header !== "string") return null
  const normalized = header.trim().toLowerCase()
  for (const [tier, expected] of Object.entries(REQUIRED_HEADERS) as [ModelTier, string][]) {
    if (normalized === expected) return tier
  }
  return null
}

export function isModelSetupQuestion(input: unknown): boolean {
  const tiers = new Set(questionsFromInput(input).map((question) => tierForHeader(question.header)).filter(Boolean))
  return tiers.has("economy") && tiers.has("balanced") && tiers.has("strong")
}

function refFromAnswer(answer: string, models: AvailableModel[]): RoutingModelRef | null {
  const trimmed = answer.trim()

  // Native setup options are rendered as "Display Name (provider/model)".
  // Custom answers may also use a plain provider/model reference.
  const parenthesized = [...trimmed.matchAll(/\(([^/()\s]+)\/([^()\s]+)\)/g)].at(-1)
  const direct = trimmed.match(/^([^/\s]+)\/(.+)$/)
  const providerID = parenthesized?.[1] ?? direct?.[1]
  const id = parenthesized?.[2] ?? direct?.[2]

  if (providerID && id) {
    const exact = models.find((model) => model.providerID === providerID && model.id === id)
    if (exact) return { providerID: exact.providerID, id: exact.id }
  }

  const byName = models.filter((model) => model.name.toLowerCase() === trimmed.toLowerCase())
  if (byName.length === 1 && byName[0]) return { providerID: byName[0].providerID, id: byName[0].id }
  return null
}

export type ModelSetupSelection = Record<ModelTier, RoutingModelRef>

export function extractModelSetupSelection(
  input: unknown,
  result: unknown,
  models: AvailableModel[],
): ModelSetupSelection | null {
  const questions = questionsFromInput(input)
  const answers = answersFromResult(result)
  if (!isModelSetupQuestion(input)) return null

  const selections = {} as Partial<ModelSetupSelection>
  questions.forEach((question, index) => {
    const tier = tierForHeader(question.header)
    if (!tier) return
    const answer = answers[index]?.[0]
    if (!answer) return
    const model = refFromAnswer(answer, models)
    if (model) selections[tier] = model
  })

  if (!selections.economy || !selections.balanced || !selections.strong) return null
  return selections as ModelSetupSelection
}

export async function persistModelSetup(
  root: string,
  input: unknown,
  result: unknown,
  models: AvailableModel[],
): Promise<ModelSetupSelection | null> {
  const routing = await getModelRoutingConfig(root)
  if (!routing.enabled || routing.setup_state !== "pending") return null

  const selections = extractModelSetupSelection(input, result, models)
  if (!selections) return null

  const path = join(stateDir(root), "config.json")
  const config = await readJson<JsonObject>(path, {})
  const currentRouting = await getModelRoutingConfig(root)
  currentRouting.profiles = {
    economy: { model: selections.economy, source: "user" },
    balanced: { model: selections.balanced, source: "user" },
    strong: { model: selections.strong, source: "user" },
  }
  currentRouting.setup_state = "configured"
  config.schema_version = Math.max(Number(config.schema_version ?? 1), 2)
  config.model_routing = currentRouting
  await writeJsonAtomic(path, config)
  return selections
}
