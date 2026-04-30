#!/usr/bin/env node
/**
 * Update Wafer models from API
 *
 * Fetches models from https://pass.wafer.ai/v1/models and updates:
 * - models.json: Provider model definitions (enriched with pricing & compat)
 * - README.md: Model table in the Available Models section
 *
 * The Wafer /v1/models API returns basic model info (id, max_model_len)
 * but does NOT include pricing, context length, or max output tokens.
 * Pricing and model specs are maintained in the existing models.json and
 * carried forward for known models. New models get default pricing that
 * must be manually updated in models.json.
 *
 * patch.json is applied at runtime by the provider — not baked into models.json.
 *
 * Requires WAFER_API_KEY environment variable.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MODELS_API_URL = 'https://pass.wafer.ai/v1/models';
const MODELS_JSON_PATH = path.join(__dirname, '..', 'models.json');
const README_PATH = path.join(__dirname, '..', 'README.md');

// ─── Pricing from Wafer Pass official docs ───────────────────────────────────
// Prices are per 1M tokens
const PRICING = {
  'Qwen3.5-397B-A17B': {
    input: 0.6,
    output: 3.6,
    cacheRead: 0.06,
  },
  'GLM-5.1': {
    input: 1.5,
    output: 4.5,
    cacheRead: 0.15,
  },
  'DeepSeek-V4-Pro': {
    input: 1.74,
    output: 3.48,
    cacheRead: 0.0145,
  },
};

// Default pricing for unknown models
const DEFAULT_PRICING = { input: 0.5, output: 2.0, cacheRead: 0 };

// ─── Model metadata ─────────────────────────────────────────────────────────

const MODEL_SPECS = {
  'Qwen3.5-397B-A17B': {
    name: 'Qwen 3.5 397B (A17B)',
    reasoning: false,
    input: ['text', 'image'],
    contextWindow: 262144,
    maxTokens: 32768,
    thinkingFormat: 'qwen',
  },
  'GLM-5.1': {
    name: 'GLM 5.1',
    reasoning: false,
    input: ['text'],
    contextWindow: 202752,
    maxTokens: 32768,
    thinkingFormat: 'zai',
  },
  'DeepSeek-V4-Pro': {
    name: 'DeepSeek V4 Pro',
    reasoning: false,
    input: ['text'],
    contextWindow: 262144,
    maxTokens: 32768,
    thinkingFormat: 'deepseek',
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function loadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return {};
  }
}

function saveJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
  console.log(`✓ Saved ${path.basename(filePath)}`);
}

// ─── API fetch ───────────────────────────────────────────────────────────────

async function fetchModels() {
  const apiKey = process.env.WAFER_API_KEY;
  if (!apiKey) {
    throw new Error('WAFER_API_KEY environment variable is required');
  }

  console.log(`Fetching models from ${MODELS_API_URL}...`);
  const response = await fetch(MODELS_API_URL, {
    headers: { 'Authorization': `Bearer ${apiKey}` },
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const models = Array.isArray(data) ? data : (data.data || []);
  console.log(`✓ Fetched ${models.length} models from API`);
  return models;
}

// ─── Transform API model → models.json entry ────────────────────────────────

function transformApiModel(apiModel, existingModelsMap) {
  const id = apiModel.id;

  // Start from existing model data if we have it (preserves pricing, compat, etc.)
  if (existingModelsMap[id]) {
    const existing = { ...existingModelsMap[id] };
    // Update context window from API if changed
    if (apiModel.max_model_len) {
      existing.contextWindow = apiModel.max_model_len;
    }
    return existing;
  }

  // New model — build from known specs + defaults
  const specs = MODEL_SPECS[id] || {};
  const pricing = PRICING[id] || DEFAULT_PRICING;
  const input = specs.input || ['text'];

  const model = {
    id,
    name: specs.name || generateDisplayName(id),
    reasoning: specs.reasoning || false,
    input,
    cost: {
      input: pricing.input,
      output: pricing.output,
      cacheRead: pricing.cacheRead || 0,
      cacheWrite: 0,
    },
    contextWindow: specs.contextWindow || apiModel.max_model_len || 131072,
    maxTokens: specs.maxTokens || 32768,
  };

  // Add compat settings
  model.compat = {
    maxTokensField: 'max_completion_tokens',
    supportsDeveloperRole: false,
    supportsStore: false,
  };

  if (model.reasoning && specs.thinkingFormat) {
    model.compat.thinkingFormat = specs.thinkingFormat;
  }

  return model;
}

function generateDisplayName(id) {
  // Fallback: prettify the ID
  return id
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

// ─── README generation ──────────────────────────────────────────────────────

function formatContext(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(0)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return n.toString();
}

function formatCost(cost) {
  if (cost === 0) return 'Free';
  if (cost === null || cost === undefined) return '-';
  return `$${cost.toFixed(2)}`;
}

function generateReadmeTable(models) {
  const lines = [
    '| Model | Type | Context | Max Output | Input Cost | Output Cost | Cached Input |',
    '|-------|------|---------|------------|------------|-------------|--------------|',
  ];

  for (const model of models) {
    const type = model.input.includes('image') ? 'Text + Image' : 'Text';
    const context = formatContext(model.contextWindow);
    const maxOutput = formatContext(model.maxTokens);
    const inputCost = formatCost(model.cost.input);
    const outputCost = formatCost(model.cost.output);
    const cacheCost = formatCost(model.cost.cacheRead);

    lines.push(`| ${model.name} | ${type} | ${context} | ${maxOutput} | ${inputCost} | ${outputCost} | ${cacheCost} |`);
  }

  return lines.join('\n');
}

function updateReadme(models) {
  let readme = fs.readFileSync(README_PATH, 'utf8');
  const newTable = generateReadmeTable(models);

  const tableRegex = /(## Available Models\n\n)\| Model \| Type \| Context[^\n]+\|\n\|[-| ]+\|(\n\|[^\n]+\|)*\n*/;

  if (tableRegex.test(readme)) {
    readme = readme.replace(tableRegex, (match, header) => `${header}${newTable}\n\n`);
    fs.writeFileSync(README_PATH, readme);
    console.log('✓ Updated README.md');
  } else {
    console.warn('⚠ Could not find model table in "## Available Models" section');
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  try {
    const apiModels = await fetchModels();

    // Load existing models.json for pricing/compat preservation
    const existingModels = loadJson(MODELS_JSON_PATH);
    const existingModelsMap = {};
    for (const m of (Array.isArray(existingModels) ? existingModels : [])) {
      existingModelsMap[m.id] = m;
    }

    // Transform API models, preserving existing data where available
    let models = apiModels.map(m =>
      transformApiModel(m, existingModelsMap)
    );

    // Keep models from models.json that are NOT in the API response
    // (e.g. models still available but not yet listed)
    const apiIds = new Set(apiModels.map(m => m.id));
    for (const existing of Object.values(existingModelsMap)) {
      if (!apiIds.has(existing.id)) {
        models.push(existing);
      }
    }

    // Sort by model name
    models.sort((a, b) => a.name.localeCompare(b.name));

    // Save models.json
    saveJson(MODELS_JSON_PATH, models);

    // Update README
    updateReadme(models);

    // Summary
    const newIds = new Set(models.map(m => m.id));
    const oldIds = new Set(Object.keys(existingModelsMap));
    const added = [...newIds].filter(id => !oldIds.has(id));
    const removed = [...oldIds].filter(id => !newIds.has(id));

    console.log('\n--- Summary ---');
    console.log(`Total models: ${models.length}`);
    console.log(`Vision models: ${models.filter(m => m.input.includes('image')).length}`);
    if (added.length > 0) console.log(`New models: ${added.join(', ')}`);
    if (removed.length > 0) console.log(`Removed models: ${removed.join(', ')}`);

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
