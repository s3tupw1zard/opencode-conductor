import { describe, expect, test } from "bun:test"
import {
  defaultModelRouting,
  modelRefKey,
  modelSelectionInstructions,
  nextTier,
  normalizeAvailableModels,
  recommendTier,
} from "../src/model-routing.js"

describe("model routing", () => {
  test("bootstraps all tiers from the current model", () => {
    const routing = defaultModelRouting({ providerID: "openai", id: "gpt-current" })
    expect(routing.setup_state).toBe("pending")
    expect(routing.root_tier).toBe("economy")
    expect(modelRefKey(routing.profiles.economy.model!)).toBe("openai/gpt-current")
    expect(routing.profiles.balanced.model).toEqual(routing.profiles.economy.model)
    expect(routing.profiles.strong.model).toEqual(routing.profiles.economy.model)
  })

  test("uses lowest sufficient tier from complexity and risk", () => {
    expect(recommendTier({ task_class: "documentation", complexity: "low", risk: "low" }).tier).toBe("economy")
    expect(recommendTier({ task_class: "implementation", complexity: "medium", risk: "low" }).tier).toBe("balanced")
    expect(recommendTier({ task_class: "debugging", complexity: "low", risk: "medium" }).tier).toBe("balanced")
    expect(recommendTier({ task_class: "implementation", complexity: "high", risk: "low" }).tier).toBe("strong")
    expect(recommendTier({ task_class: "documentation", complexity: "low", risk: "critical" }).tier).toBe("strong")
  })

  test("explicit routing overrides automatic classification", () => {
    expect(
      recommendTier({
        task_class: "documentation",
        complexity: "low",
        risk: "low",
        execution: { model_tier: "strong" },
      }).tier,
    ).toBe("strong")
  })

  test("escalates one tier at a time", () => {
    expect(nextTier("economy")).toBe("balanced")
    expect(nextTier("balanced")).toBe("strong")
    expect(nextTier("strong")).toBe("strong")
  })

  test("filters unavailable or tool-less models from setup", () => {
    const models = normalizeAvailableModels([
      {
        providerID: "openai",
        id: "small",
        name: "Small",
        enabled: true,
        capabilities: { tools: true },
        cost: [{ input: 0.1, output: 0.5, cache: { read: 0, write: 0 } }],
      },
      {
        providerID: "demo",
        id: "disabled",
        name: "Disabled",
        enabled: false,
        capabilities: { tools: true },
      },
      {
        providerID: "demo",
        id: "no-tools",
        name: "No Tools",
        enabled: true,
        capabilities: { tools: false },
      },
    ])

    expect(models).toHaveLength(1)
    expect(models[0]?.id).toBe("small")
    expect(modelSelectionInstructions(models, { providerID: "openai", id: "small" })).toContain("[current]")
  })
})
