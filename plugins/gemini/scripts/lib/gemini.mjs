// Thin wrapper around the Antigravity CLI (`agy`) for the gemini-companion runtime.
// Originally wrapped the upstream Gemini CLI (`gemini -p ...`). Swapped to the
// Antigravity CLI on 2026-06-28, after Google retired the Gemini CLI free/paid
// tiers (2026-06-18) and replaced it with the Go-based Antigravity CLI.
// The binary is overridable via GEMINI_COMPANION_BINARY (rollback/testing).

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { terminateProcessTree } from "./process.mjs";

// Default to the Antigravity CLI binary (`agy`); allow override for rollback
// (e.g. GEMINI_COMPANION_BINARY=/full/path/to/agy or back to `gemini`).
const GEMINI_BINARY = process.env.GEMINI_COMPANION_BINARY || "agy";

// Candidate locations where the Antigravity CLI may keep its OAuth credentials.
// Best-effort: the real execution gate is binary availability (below); this only
// powers the advisory "are you logged in?" message in /gemini:setup.
const AGY_AUTH_CANDIDATES = [
  path.join(os.homedir(), ".antigravity", "oauth_creds.json"),
  path.join(os.homedir(), ".antigravity", "creds.json"),
  path.join(os.homedir(), ".config", "antigravity", "oauth_creds.json"),
  path.join(os.homedir(), ".gemini", "antigravity", "oauth_creds.json"),
  path.join(os.homedir(), ".gemini", "oauth_creds.json")
];

export const DEFAULT_CONTINUE_PROMPT = "Continue.";
export const TASK_THREAD_PREFIX = "task-";

const SESSION_ID_ENV = "GEMINI_COMPANION_SESSION_ID";

// The Gemini CLI had graduated approval modes; the Antigravity CLI exposes a
// single boolean switch (`--dangerously-skip-permissions`). Map the
// write-capable modes onto it.
const SKIP_PERMISSION_MODES = new Set(["yolo", "auto_edit"]);

function pathContainsBinary(binary) {
  // Absolute/relative path override: check the file directly.
  if (binary.includes(path.sep)) {
    try {
      const stat = fs.statSync(binary);
      if (stat.isFile() || stat.isSymbolicLink()) return binary;
    } catch {
      // Ignore.
    }
    return null;
  }
  const pathDirs = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  // The Antigravity installer drops `agy` in ~/.local/bin and appends it to the
  // shell profile; ensure it is searched even if this process inherited a PATH
  // captured before the install.
  pathDirs.push(path.join(os.homedir(), ".local", "bin"));
  for (const dir of pathDirs) {
    try {
      const stat = fs.statSync(path.join(dir, binary));
      if (stat.isFile() || stat.isSymbolicLink()) {
        return path.join(dir, binary);
      }
    } catch {
      // Ignore missing/inaccessible PATH entries.
    }
  }
  return null;
}

function runBinaryVersion(binary) {
  const result = spawnSync(binary, ["--version"], { encoding: "utf8" });
  if (result.status !== 0) {
    return null;
  }
  const stdout = (result.stdout || "").trim();
  return stdout || null;
}

export function getGeminiAvailability(_cwd) {
  const binary = pathContainsBinary(GEMINI_BINARY);
  if (!binary) {
    return {
      available: false,
      binary: null,
      version: null,
      error: `Antigravity CLI (\`${GEMINI_BINARY}\`) not found on PATH. Install it with \`curl -fsSL https://antigravity.google/cli/install.sh | bash\` (binary lands at ~/.local/bin/agy), or set GEMINI_COMPANION_BINARY to its full path.`
    };
  }
  const version = runBinaryVersion(binary);
  if (!version) {
    return {
      available: false,
      binary,
      version: null,
      error: `\`${GEMINI_BINARY} --version\` did not return cleanly. The CLI is on PATH but may be broken.`
    };
  }
  return { available: true, binary, version, error: null };
}

export async function getGeminiAuthStatus(_cwd, _options = {}) {
  const found = AGY_AUTH_CANDIDATES.find((candidate) => {
    try {
      return fs.statSync(candidate).size > 0;
    } catch {
      return false;
    }
  });
  if (!found) {
    return {
      loggedIn: false,
      authType: null,
      requiresGoogleOauth: true,
      error: `No Antigravity CLI credentials found. Run \`${GEMINI_BINARY}\` once interactively to complete Google sign-in before using /gemini:rescue.`
    };
  }
  return {
    loggedIn: true,
    authType: "antigravity-oauth",
    requiresGoogleOauth: false,
    error: null
  };
}

export function getSessionRuntimeStatus(env = process.env, _cwd = process.cwd()) {
  return {
    sessionId: env[SESSION_ID_ENV] ?? null
  };
}

export function buildPersistentTaskThreadName(prompt) {
  const trimmed = (prompt || "").trim();
  const slug = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "task";
  const stamp = Date.now().toString(36);
  return `${TASK_THREAD_PREFIX}${slug}-${stamp}`;
}

export async function findLatestTaskThread(_cwd) {
  // The Antigravity CLI manages its own resume state via `--continue`. We don't
  // separately track persistent thread names — the rescue subagent forwards
  // `--continue` directly when `--resume-last` is requested.
  return null;
}

function shouldSkipPermissions(request) {
  if (request.approvalMode && SKIP_PERMISSION_MODES.has(request.approvalMode)) {
    return true;
  }
  if (request.yolo) {
    return true;
  }
  if (request.write) {
    return true;
  }
  return false;
}

function buildGeminiArgs(request) {
  const prompt = (request.prompt && request.prompt.trim()) || request.defaultPrompt || DEFAULT_CONTINUE_PROMPT;
  const args = [];
  if (request.model) {
    // e.g. gemini-3.1-pro / gemini-3-flash — run `agy models` to list ids.
    args.push("--model", request.model);
  }
  if (request.sandbox) {
    args.push("--sandbox");
  }
  if (shouldSkipPermissions(request)) {
    // Antigravity print mode blocks on tool-permission prompts that never
    // render in a non-interactive shell; this is the CLI's only auto-approve
    // switch (no graduated mode like the old Gemini --approval-mode).
    args.push("--dangerously-skip-permissions");
  }
  if (request.resumeLast) {
    args.push("--continue");
  } else if (request.resumeThreadId) {
    args.push("--conversation", request.resumeThreadId);
  }
  if (request.includeDirectories?.length) {
    // Antigravity accepts --add-dir repeated for each directory.
    for (const dir of request.includeDirectories) {
      args.push("--add-dir", dir);
    }
  }
  // Print mode + the prompt LAST. Putting the prompt as the trailing argument is
  // robust whether `--print` is a boolean toggle (the prompt is then the trailing
  // positional) or a value-taking flag (the prompt is its value).
  args.push("--print", prompt);
  return args;
}

export async function runGeminiTask(workspaceRoot, request) {
  const args = buildGeminiArgs(request);
  // Resolve to the absolute binary path so the spawn works even if the running
  // process inherited a PATH captured before the installer appended ~/.local/bin
  // to the shell profile. Falls back to the bare name (lets ENOENT surface).
  const binary = pathContainsBinary(GEMINI_BINARY) || GEMINI_BINARY;
  const onProgress = typeof request.onProgress === "function" ? request.onProgress : () => {};
  onProgress({
    phase: "starting",
    message: `Spawning ${GEMINI_BINARY} ${args.slice(0, 4).join(" ")}...`
  });

  return await new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      cwd: workspaceRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    const startedAt = Date.now();

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      stdout += text;
      onProgress({ phase: "running", message: text });
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      stderr += text;
      onProgress({ phase: "running", stderrMessage: text });
    });
    child.on("error", (error) => {
      reject(new Error(`Failed to spawn ${GEMINI_BINARY}: ${error.message}`));
    });
    child.on("exit", (code, signal) => {
      const durationMs = Date.now() - startedAt;
      if (signal) {
        reject(new Error(`${GEMINI_BINARY} terminated by signal ${signal} after ${durationMs}ms.`));
        return;
      }
      if (code !== 0) {
        const message = (stderr || stdout || "").trim() || `${GEMINI_BINARY} exited with code ${code}.`;
        reject(new Error(`ERROR: ${message}`));
        return;
      }
      const trimmed = stdout.trim();
      if (trimmed.length === 0) {
        // Guard against the silent-pass-through hallucination class:
        // the CLI exited 0 but produced no output. Could be a future CLI
        // version that swallows auth failures, or a no-op prompt. Surface the
        // empty result as an explicit error rather than a success with an
        // empty finalMessage.
        const stderrTrim = stderr.trim();
        const detail = stderrTrim ? ` stderr: ${stderrTrim}` : "";
        reject(new Error(`ERROR: ${GEMINI_BINARY} exited 0 with empty stdout.${detail}`));
        return;
      }
      onProgress({ phase: "completed", message: `${GEMINI_BINARY} finished.` });
      resolve({
        ok: true,
        threadId: request.resumeThreadId || null,
        turnId: null,
        finalMessage: trimmed,
        structured: null,
        durationMs,
        pid: child.pid ?? null
      });
    });

    if (request.attachChild) {
      request.attachChild(child);
    }
  });
}

export async function interruptGeminiTurn(_cwd, { pid }) {
  if (!pid || Number.isNaN(pid)) {
    return { ok: false, reason: "no pid provided" };
  }
  try {
    terminateProcessTree(pid);
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error.message };
  }
}
