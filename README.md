# pi-wafer-provider

[Wafer Pass](https://wafer.ai) provider extension for [pi](https://github.com/badlogic/pi-mono) — Access fast open-source LLMs through the Wafer Pass API.

## Models

| Model | Context Window | Max Output | Reasoning |
|-------|---------------|------------|-----------|
| Qwen 3.5 397B (A17B) | 262,144 | 32,768 | ✅ |
| GLM 5.1 | 202,752 | 32,768 | ✅ |

## Setup

### 1. Get a Wafer Pass API key

Sign up at [wafer.ai](https://wafer.ai) and obtain your API key.

### 2. Set the environment variable

```bash
export WAFER_API_KEY="your-api-key-here"
```

Add this to your `~/.bashrc`, `~/.zshrc`, or shell profile to persist it.

### 3. Run pi with the extension

```bash
# From this directory
pi -e .

# Or with an absolute path
pi -e /path/to/pi-wafer-provider
```

### 4. Select a model

```
/model
```

Then select either **Qwen 3.5 397B (A17B)** or **GLM 5.1**.

## Usage Examples

```bash
# Interactive mode
pi -e /path/to/pi-wafer-provider

# Print mode with a specific model
pi -e /path/to/pi-wafer-provider --model wafer/Qwen3.5-397B-A17B -p "Hello!"

# With thinking level
pi -e /path/to/pi-wafer-provider --thinking high
```

## Project Structure

```
pi-wafer-provider/
├── index.ts        # Extension entry point
├── models.json     # Model definitions
├── package.json    # Package metadata with pi extension config
└── README.md       # This file
```

## License

MIT
