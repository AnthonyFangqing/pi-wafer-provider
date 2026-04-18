/**
 * Wafer Provider Extension
 *
 * Registers Wafer Pass (pass.wafer.ai) as a custom provider using the
 * OpenAI completions API.
 *
 * Usage:
 *   # Set your API key
 *   export WAFER_API_KEY=your-api-key
 *
 *   # Run pi with the extension
 *   pi -e /path/to/pi-wafer-provider
 *
 * Then use /model to select available models:
 *   - Qwen3.5-397B-A17B (262K context)
 *   - GLM-5.1 (202K context)
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import models from "./models.json" with { type: "json" };

// Model data structure from JSON
interface JsonModel {
  id: string;
  name: string;
  reasoning: boolean;
  modalities: {
    input: string[];
  };
  cost: {
    input: number;
    output: number;
    cache_read: number;
    cache_write: number;
  };
  limit: {
    context: number | null;
    output: number | null;
  };
}

// Pi's expected model structure
interface PiModel {
  id: string;
  name: string;
  reasoning: boolean;
  input: string[];
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
  contextWindow: number;
  maxTokens: number;
}

// Transform JSON model to Pi's expected format
function transformModel(model: JsonModel): PiModel {
  const cost = model.cost ?? {};
  return {
    id: model.id,
    name: model.name,
    reasoning: model.reasoning,
    input: model.modalities.input,
    cost: {
      input: cost.input ?? 0,
      output: cost.output ?? 0,
      cacheRead: cost.cache_read ?? 0,
      cacheWrite: cost.cache_write ?? 0,
    },
    contextWindow: model.limit.context ?? 0,
    maxTokens: model.limit.output ?? 0,
  };
}

const transformedModels = (models as JsonModel[]).map(transformModel);

export default function (pi: ExtensionAPI) {
  pi.registerProvider("wafer", {
    baseUrl: "https://pass.wafer.ai/v1",
    apiKey: "WAFER_API_KEY",
    api: "openai-completions",
    models: transformedModels,
  });
}
