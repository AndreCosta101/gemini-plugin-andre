---
name: gemini-prompting
description: Internal guidance for composing Gemini prompts for coding, diagnosis, and research tasks inside the Gemini Claude Code plugin
user-invocable: false
---

# Gemini Prompting

Use this skill when `gemini:gemini-rescue` needs to tighten a user request into a better prompt before forwarding to Gemini CLI.

Prompt Gemini like an operator, not a collaborator. Keep prompts compact and structured. State the task, the output contract, the follow-through defaults, and the small set of extra constraints that matter. XML tags are optional — Gemini handles markdown and natural structure well — but a consistent shape still helps.

Core rules:
- Prefer one clear task per Gemini run. Split unrelated asks into separate runs.
- Tell Gemini what done looks like. Do not assume it will infer the desired end state.
- Add explicit grounding and verification rules for any task where unsupported guesses would hurt quality.
- Prefer better prompt contracts over raising context size or adding long natural-language explanations.

Default prompt recipe:
- A concrete task statement and the relevant repository or failure context.
- An output contract: exact shape, ordering, and brevity requirements.
- A follow-through policy: what Gemini should do by default instead of asking routine questions.
- A verification loop or completeness contract: required for debugging, implementation, or risky fixes.
- Grounding / citation rules: required for research or anything that could drift into unsupported claims.

When to add blocks:
- Coding or debugging: add a completeness contract, a verification loop, and missing-context gating.
- Research or recommendation tasks: add a research-mode block and citation rules.
- Write-capable tasks: add an action-safety block so Gemini stays narrow and avoids unrelated refactors.

How to choose prompt shape:
- Use `task` for diagnosis, planning, research, or implementation when you need to control the prompt directly.
- Use `task --resume-last` for follow-up instructions on the same Gemini thread. Send only the delta instruction instead of restating the whole prompt unless the direction changed materially.

Working rules:
- Prefer explicit prompt contracts over vague nudges.
- Do not raise context size or add long examples first. Tighten the prompt and verification rules before escalating.
- Ask Gemini for brief, outcome-based progress updates only when the task is long-running or tool-heavy.
- Keep claims anchored to observed evidence. If something is a hypothesis, say so.

Prompt assembly checklist:
1. Define the exact task and scope.
2. Choose the smallest output contract that still makes the answer easy to use.
3. Decide whether Gemini should keep going by default or stop for missing high-risk details.
4. Add verification, grounding, and safety constraints only where the task needs them.
5. Remove redundant instructions before sending the prompt.

Reusable blocks live in [references/prompt-blocks.md](references/prompt-blocks.md).
Concrete end-to-end templates live in [references/gemini-prompt-recipes.md](references/gemini-prompt-recipes.md).
Common failure modes to avoid live in [references/gemini-prompt-antipatterns.md](references/gemini-prompt-antipatterns.md).
