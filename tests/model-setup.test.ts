import { describe, expect, test } from "bun:test"
import { extractModelSetupSelection, isModelSetupQuestion } from "../src/model-setup.js"
import { modelChoiceLabel, type AvailableModel } from "../src/model-routing.js"

const models: AvailableModel[] = [
  {
    providerID: "openai",
    id: "small",
    name: "Small",
    enabled: true,
    toolCapable: true,
  },
  {
    providerID: "openai",
    id: "balanced",
    name: "Balanced",
    enabled: true,
    toolCapable: true,
  },
  {
    providerID: "openai",
    id: "strong",
    name: "Strong",
    enabled: true,
    toolCapable: true,
  },
]

const setupInput = {
  questions: [
    { header: "Economy", question: "Economy model?", options: [] },
    { header: "Balanced", question: "Balanced model?", options: [] },
    { header: "Strong", question: "Strong model?", options: [] },
  ],
}

describe("model setup", () => {
  test("recognizes the dedicated three-tab setup form", () => {
    expect(isModelSetupQuestion(setupInput)).toBe(true)
    expect(
      isModelSetupQuestion({ questions: [{ header: "Economy" }, { header: "Balanced" }] }),
    ).toBe(false)
  })

  test("extracts selected local model references from native question output", () => {
    const result = {
      output: {
        answers: [
          [modelChoiceLabel(models[0]!)],
          [modelChoiceLabel(models[1]!)],
          [modelChoiceLabel(models[2]!)],
        ],
      },
    }

    expect(extractModelSetupSelection(setupInput, result, models)).toEqual({
      economy: { providerID: "openai", id: "small" },
      balanced: { providerID: "openai", id: "balanced" },
      strong: { providerID: "openai", id: "strong" },
    })
  })

  test("accepts custom provider/model answers when they identify an available model", () => {
    const result = {
      output: {
        answers: [["openai/small"], ["openai/balanced"], ["openai/strong"]],
      },
    }

    expect(extractModelSetupSelection(setupInput, result, models)?.balanced).toEqual({
      providerID: "openai",
      id: "balanced",
    })
  })

  test("does not configure when an answer cannot be mapped to an available model", () => {
    const result = {
      output: {
        answers: [["openai/small"], ["unknown/model"], ["openai/strong"]],
      },
    }
    expect(extractModelSetupSelection(setupInput, result, models)).toBeNull()
  })
})
