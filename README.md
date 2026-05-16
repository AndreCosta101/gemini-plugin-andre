# gemini-plugin-andre

Wrap [Gemini CLI](https://github.com/google-gemini/gemini-cli) from inside Claude Code as a second-opinion delegate. Lean fork of [`openai/codex-plugin-cc`](https://github.com/openai/codex-plugin-cc) — same task / status / result / cancel ergonomics, with the Codex app-server protocol replaced by direct Gemini CLI invocation.

This fork drops `/codex:review` and `/codex:adversarial-review` because Gemini CLI has no structured-output review protocol. The `task` / `rescue` delegation path is preserved.

## Requirements

- **Gemini CLI** installed (`brew install gemini-cli` or follow [the official install guide](https://github.com/google-gemini/gemini-cli)) and authenticated via Google OAuth.
  - Run `gemini` once interactively to complete OAuth. `~/.gemini/settings.json` should then contain `"selectedType": "oauth-personal"`. No API key required.
- **Node.js 18.18 or later**

## Install

```
/plugin marketplace add AndreCosta101/gemini-plugin-andre
/plugin install gemini@gemini-plugin-andre
/reload-plugins
```

## Commands

- `/gemini:rescue [prompt]` — Forward a delegated task to Gemini. Add `--background` for long jobs.
- `/gemini:status [job-id]` — List running and recent Gemini jobs in this repo.
- `/gemini:result <job-id>` — Fetch the final output of a finished job.
- `/gemini:cancel [job-id]` — Terminate an active background job.
- `/gemini:setup` — Check Gemini CLI availability and OAuth status.

## How it differs from the Codex upstream

| | `codex-plugin-cc` | `gemini-plugin-andre` |
|---|---|---|
| Transport | Codex app-server (WebSocket) | `spawn('gemini', ['-p', ...])` |
| Auth | ChatGPT subscription or OpenAI API key | Google OAuth via `~/.gemini/settings.json` |
| Review commands | `/codex:review`, `/codex:adversarial-review` | Not ported (no Gemini equivalent) |
| Structured output | JSON schema validation | Plain stdout |
| Subagent prompt | Forwarding-only | Forwarding-only, with strict anti-hallucination rules |

## Attribution

This is a derivative work of [`openai/codex-plugin-cc`](https://github.com/openai/codex-plugin-cc), licensed under Apache-2.0. Upstream `LICENSE` and `NOTICE` files are preserved. Modifications by AndreCosta101 to adapt the plugin for Gemini CLI.

## License

Apache-2.0. See `LICENSE` and `NOTICE`.
