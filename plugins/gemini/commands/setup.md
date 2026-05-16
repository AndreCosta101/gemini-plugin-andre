---
description: Check whether the local Gemini CLI is ready and authenticated
allowed-tools: Bash(node:*), AskUserQuestion
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/gemini-companion.mjs" setup --json
```

If the result says Gemini is unavailable:
- The CLI is missing. Install via `brew install gemini-cli` or https://github.com/google-gemini/gemini-cli, then rerun this command.

If Gemini is installed but not authenticated:
- Tell the user to run `gemini` once interactively in a terminal to complete Google OAuth.
- `~/.gemini/settings.json` will then contain `"selectedType": "oauth-personal"`.
- No API key is required; the plugin reads OAuth credentials from that settings file.

If Gemini is installed and authenticated:
- Present the setup output to the user as-is.

Output rules:
- Present the final setup output to the user.
- Do not invent install commands or version numbers; rely on the script's report.
