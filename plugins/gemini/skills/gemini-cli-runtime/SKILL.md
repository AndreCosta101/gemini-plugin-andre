---
name: gemini-cli-runtime
description: Internal helper contract for calling the gemini-companion runtime from Claude Code
user-invocable: false
---

# Gemini Runtime

Use this skill only inside the `gemini:gemini-rescue` subagent.

Primary helper:
- `node "${CLAUDE_PLUGIN_ROOT}/scripts/gemini-companion.mjs" task "<raw arguments>"`

Execution rules:
- The rescue subagent is a forwarder, not an orchestrator. Its only job is to invoke `task` once and return that stdout unchanged (or stderr with `ERROR:` prefix on failure).
- Prefer the helper over hand-rolled `git`, direct Gemini CLI strings, or any other Bash activity.
- Do not call `setup`, `status`, `result`, `cancel`, or `task-resume-candidate` from `gemini:gemini-rescue`.
- Use `task` for every rescue request, including diagnosis, planning, research, and explicit fix requests.
- You may use the `gemini-prompting` skill to rewrite the user's request into a tighter Gemini prompt before the single `task` call.
- That prompt drafting is the only Claude-side work allowed. Do not inspect the repo, solve the task yourself, or add independent analysis outside the forwarded prompt text.
- Leave the model unset by default. Add `--model` only when the user explicitly asks for one (e.g. `gemini-2.5-pro`, `gemini-2.5-flash`).
- Default to a write-capable Gemini run by adding `--write` unless the user explicitly asks for read-only behavior or only wants diagnosis or research without edits.

Command selection:
- Use exactly one `task` invocation per rescue handoff.
- If the forwarded request includes `--background` or `--wait`, treat that as Claude-side execution control only. Strip it before calling `task`, and do not treat it as part of the natural-language task text.
- If the forwarded request includes `--model`, pass it through verbatim to `task`.
- If the forwarded request includes `--resume`, strip that token from the task text and add `--resume-last`.
- If the forwarded request includes `--fresh`, strip that token from the task text and do not add `--resume-last`.
- If the forwarded request includes `--effort` (legacy from the codex version), strip it silently. Gemini CLI has no reasoning-effort knob.
- `task --resume-last`: internal helper for "keep going", "resume", "apply the top fix", or "dig deeper" after a previous rescue run.

Safety rules:
- Default to write-capable Gemini work in `gemini:gemini-rescue` unless the user explicitly asks for read-only behavior.
- Preserve the user's task text as-is apart from stripping routing flags. "Preserve" means forward to the script unchanged — it does NOT mean echo the text back to the user as a response.
- Do not inspect the repository, read files, grep, monitor progress, poll status, fetch results, cancel jobs, summarize output, or do any follow-up work of your own.
- Return the stdout of the `task` command exactly as-is.
- If the Bash call fails or Gemini cannot be invoked, return stderr verbatim with an `ERROR:` prefix on its own line. Never invent a successful-looking response.
