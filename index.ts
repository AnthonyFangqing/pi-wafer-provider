/**
 * Wafer Provider Extension
 *
 * Registers Wafer Pass (pass.wafer.ai) as a custom provider using the
 * OpenAI completions API.
 *
 * Usage:
 *   # Option 1: Store in auth.json (recommended)
 *   # Add to ~/.pi/agent/auth.json:
 *   #   "wafer": { "type": "api_key", "key": "your-api-key" }
 *
 *   # Option 2: Set as environment variable
 *   export WAFER_API_KEY=your-api-key
 *
 *   # Run pi with the extension
 *   pi -e /path/to/pi-wafer-provider
 *
 * Then use /model to select available models:
 *   - Qwen3.5-397B-A17B (262K context)
 *   - GLM-5.1 (202K context)
 */

import type { ExtensionAPI, Model, Api, ModelCompat, ModelRegistry } from "@mariozechner/pi-coding-agent";
import modelData from "./models.json" with { type: "json" };

// JSON model structure
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
  compat?: ModelCompat;
}

// Transform JSON model to Pi's expected format
function transformModel(model: JsonModel): Model<Api> {
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
    api: "openai-completions",
    provider: "wafer",
    compat: model.compat,
  } as Model<Api>;
}

const models = (modelData as JsonModel[]).map(transformModel);

// ─── API Key Resolution (via ModelRegistry) ────────────────────────────────────

/**
 * Cached API key resolved from ModelRegistry.
 *
 * Pi's core resolves the key via ModelRegistry before making requests,
 * but we also cache it here so we can resolve it in contexts where the resolved
 * key isn't directly available (e.g. future features like quota fetching) and
 * to make the dependency explicit.
 *
 * Resolution order (via ModelRegistry.getApiKeyForProvider):
 *   1. Runtime override (CLI --api-key)
 *   2. auth.json stored credentials (manual entry in ~/.pi/agent/auth.json)
 *   3. OAuth tokens (auto-refreshed)
 *   4. Environment variable (from auth.json or provider config)
 */
let cachedApiKey: string | undefined;

/**
 * Resolve the Wafer API key via ModelRegistry and cache the result.
 * Called on session_start and whenever ctx.modelRegistry is available.
 */
async function resolveApiKey(modelRegistry: ModelRegistry): Promise<void> {
  cachedApiKey = await modelRegistry.getApiKeyForProvider("wafer") ?? undefined;
}

export default function (pi: ExtensionAPI) {
  // Resolve API key via ModelRegistry on session start
  pi.on("session_start", async (_event, ctx) => {
    await resolveApiKey(ctx.modelRegistry);
  });

  pi.registerProvider("wafer", {
    baseUrl: "https://pass.wafer.ai/v1",
    apiKey: "WAFER_API_KEY",
    api: "openai-completions",
    models,
  });
}
