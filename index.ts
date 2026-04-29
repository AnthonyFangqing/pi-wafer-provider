/**
 * Wafer Provider Extension
 *
 * Registers Wafer Pass (pass.wafer.ai) as a custom provider using the
 * OpenAI completions API.
 *
 * Model resolution strategy: Stale-While-Revalidate
 *   1. Serve stale immediately: disk cache → embedded models.json (zero-latency)
 *   2. Revalidate in background: live API /models → merge with embedded → cache → hot-swap
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
import fs from "fs";
import os from "os";
import path from "path";

// ─── Types ────────────────────────────────────────────────────────────────────

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

// ─── Model Transformation ─────────────────────────────────────────────────────

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

// ─── Stale-While-Revalidate Model Sync ────────────────────────────────────────

const PROVIDER_ID = "wafer";
const BASE_URL = "https://pass.wafer.ai/v1";
const MODELS_URL = `${BASE_URL}/models`;
const CACHE_DIR = path.join(os.homedir(), ".pi", "agent", "cache");
const CACHE_PATH = path.join(CACHE_DIR, `${PROVIDER_ID}-models.json`);
const LIVE_FETCH_TIMEOUT_MS = 8000;

/** Transform a model from the Wafer /v1/models API. Returns minimal data (id, max_model_len). */
function transformApiModel(apiModel: any): JsonModel | null {
  return {
    id: apiModel.id,
    name: apiModel.id,
    reasoning: false,
    modalities: { input: ["text"] },
    cost: { input: 0, output: 0, cache_read: 0, cache_write: 0 },
    limit: {
      context: apiModel.max_model_len || null,
      output: null,
    },
  };
}

async function fetchLiveModels(apiKey: string): Promise<JsonModel[] | null> {
  try {
    const response = await fetch(MODELS_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(LIVE_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const data = await response.json();
    const apiModels = Array.isArray(data) ? data : (data.data || []);
    if (!Array.isArray(apiModels) || apiModels.length === 0) return null;
    return apiModels.map(transformApiModel).filter((m): m is JsonModel => m !== null);
  } catch {
    return null;
  }
}

function loadCachedModels(): JsonModel[] | null {
  try {
    const data = JSON.parse(fs.readFileSync(CACHE_PATH, "utf8"));
    return Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

function cacheModels(models: JsonModel[]): void {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(CACHE_PATH, JSON.stringify(models, null, 2) + "\n");
  } catch {
    // Cache write failure is non-fatal
  }
}

function mergeWithEmbedded(liveModels: JsonModel[], embeddedModels: JsonModel[]): JsonModel[] {
  const embeddedIds = new Set(embeddedModels.map(m => m.id));
  const result = [...embeddedModels];
  for (const model of liveModels) {
    if (!embeddedIds.has(model.id)) {
      result.push(model);
    }
  }
  return result;
}

function loadStaleModels(embeddedModels: JsonModel[]): JsonModel[] {
  const cached = loadCachedModels();
  if (cached && cached.length > 0) return cached;
  return embeddedModels;
}

async function revalidateModels(apiKey: string | undefined, embeddedModels: JsonModel[]): Promise<JsonModel[] | null> {
  if (!apiKey) return null;
  const liveModels = await fetchLiveModels(apiKey);
  if (!liveModels || liveModels.length === 0) return null;
  const merged = mergeWithEmbedded(liveModels, embeddedModels);
  cacheModels(merged);
  return merged;
}

// ─── API Key Resolution (via ModelRegistry) ────────────────────────────────────

let cachedApiKey: string | undefined;

async function resolveApiKey(modelRegistry: ModelRegistry): Promise<void> {
  cachedApiKey = await modelRegistry.getApiKeyForProvider("wafer") ?? undefined;
}

// ─── Extension Entry Point ────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  const embeddedModels = modelData as JsonModel[];
  const staleBase = loadStaleModels(embeddedModels);
  const staleModels = staleBase.map(transformModel);

  pi.registerProvider("wafer", {
    baseUrl: BASE_URL,
    apiKey: "WAFER_API_KEY",
    api: "openai-completions",
    models: staleModels,
  });

  pi.on("session_start", async (_event, ctx) => {
    await resolveApiKey(ctx.modelRegistry);
    revalidateModels(cachedApiKey, embeddedModels).then((freshBase) => {
      if (freshBase) {
        pi.registerProvider("wafer", {
          baseUrl: BASE_URL,
          apiKey: "WAFER_API_KEY",
          api: "openai-completions",
          models: freshBase.map(transformModel),
        });
      }
    });
  });
}
