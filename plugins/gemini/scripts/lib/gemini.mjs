// Thin wrapper around the Gemini CLI for the gemini-companion runtime.
// Replaces the upstream Codex app-server WebSocket protocol with direct
// `spawn('gemini', ['-p', ...])` invocation.

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { terminateProcessTree } from "./process.mjs";

const GEMINI_BINARY = "gemini";
const GEMINI_SETTINGS_PATH = path.join(os.homedir(), ".gemini", "settings.json");

export const DEFAULT_CONTINUE_PROMPT = "Continue.";
export const TASK_THREAD_PREFIX = "task-";

const SESSION_ID_ENV = "GEMINI_COMPANION_SESSION_ID";

const APPROVAL_MODES = new Set(["default", "auto_edit", "yolo", "plan"]);

function pathContainsBinary(binary) {
  const pathDirs = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
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

function runGeminiVersion() {
  const result = spawnSync(GEMINI_BINARY, ["--version"], { encoding: "utf8" });
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
      error: "gemini CLI not found on PATH. Install it via `brew install gemini-cli` or https://github.com/google-gemini/gemini-cli."
    };
  }
  const version = runGeminiVersion();
  if (!version) {
    return {
      available: false,
      binary,
      version: null,
      error: "`gemini --version` did not return cleanly. The CLI is on PATH but may be broken."
    };
  }
  return { available: true, binary, version, error: null };
}

export async function getGeminiAuthStatus(_cwd, _options = {}) {
  if (!fs.existsSync(GEMINI_SETTINGS_PATH)) {
    return {
      loggedIn: false,
      authType: null,
      requiresGoogleOauth: true,
      error: `${GEMINI_SETTINGS_PATH} does not exist. Run \`gemini\` once interactively to complete Google OAuth.`
    };
  }
  let settings;
  try {
    settings = JSON.parse(fs.readFileSync(GEMINI_SETTINGS_PATH, "utf8"));
  } catch (error) {
    return {
      loggedIn: false,
      authType: null,
      requiresGoogleOauth: true,
      error: `Failed to parse ${GEMINI_SETTINGS_PATH}: ${error.message}`
    };
  }
  const selectedType = settings?.security?.auth?.selectedType ?? settings?.selectedType ?? null;
  if (!selectedType) {
    return {
      loggedIn: false,
      authType: null,
      requiresGoogleOauth: true,
      error: "Gemini settings file is present but no `selectedType` is set. Run `gemini` once interactively to complete OAuth."
    };
  }
  return { loggedIn: true, authType: selectedType, requiresGoogleOauth: false, error: null };
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
  // Gemini CLI manages its own resume state via `-r latest`. We don't
  // separately track persistent thread names — the rescue subagent forwards
  // `-r latest` directly when `--resume-last` is requested.
  return null;
}

function approvalModeFor(request) {
  if (request.approvalMode && APPROVAL_MODES.has(request.approvalMode)) {
    return request.approvalMode;
  }
  if (request.yolo) {
    return "yolo";
  }
  if (request.write) {
    return "auto_edit";
  }
  return "default";
}

function buildGeminiArgs(request) {
  const prompt = (request.prompt && request.prompt.trim()) || request.defaultPrompt || DEFAULT_CONTINUE_PROMPT;
  const args = ["-p", prompt];
  // The user has explicitly invoked the rescue command on the current
  // workspace, so consent to Gemini reading that workspace is implicit.
  // Without this, Gemini refuses to run in non-interactive mode.
  args.push("--skip-trust");
  args.push("--approval-mode", approvalModeFor(request));
  if (request.model) {
    args.push("-m", request.model);
  }
  if (request.sandbox) {
    args.push("-s");
  }
  if (request.resumeLast) {
    args.push("-r", "latest");
  } else if (request.resumeThreadId) {
    args.push("--session-id", request.resumeThreadId);
  }
  if (request.includeDirectories?.length) {
    // Gemini CLI accepts the flag repeated for each directory; that form
    // is unambiguous across Yargs versions vs comma-joined.
    for (const dir of request.includeDirectories) {
      args.push("--include-directories", dir);
    }
  }
  return args;
}

export async function runGeminiTask(workspaceRoot, request) {
  const args = buildGeminiArgs(request);
  const onProgress = typeof request.onProgress === "function" ? request.onProgress : () => {};
  onProgress({
    phase: "starting",
    message: `Spawning gemini ${args.slice(0, 4).join(" ")}...`
  });

  return await new Promise((resolve, reject) => {
    const child = spawn(GEMINI_BINARY, args, {
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
      reject(new Error(`Failed to spawn gemini: ${error.message}`));
    });
    child.on("exit", (code, signal) => {
      const durationMs = Date.now() - startedAt;
      if (signal) {
        reject(new Error(`gemini terminated by signal ${signal} after ${durationMs}ms.`));
        return;
      }
      if (code !== 0) {
        const message = (stderr || stdout || "").trim() || `gemini exited with code ${code}.`;
        reject(new Error(`ERROR: ${message}`));
        return;
      }
      const trimmed = stdout.trim();
      if (trimmed.length === 0) {
        // Guard against silent-pass-through hallucination class:
        // gemini exited 0 but produced no output. Could be a future
        // CLI version that swallows auth failures, or a no-op prompt.
        // Surface the empty result as an explicit error rather than a
        // success with empty finalMessage.
        const stderrTrim = stderr.trim();
        const detail = stderrTrim ? ` stderr: ${stderrTrim}` : "";
        reject(new Error(`ERROR: gemini exited 0 with empty stdout.${detail}`));
        return;
      }
      onProgress({ phase: "completed", message: "gemini finished." });
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
