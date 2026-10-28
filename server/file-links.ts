import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { posix, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { fileLinkRpc, parseLocalHref, type FileLinkAction } from "../shared/file-links";

type FileLinkInput = RpcInput<typeof fileLinkRpc>;
type FileLinkOutput = RpcOutput<typeof fileLinkRpc>;
type PaseoApi = PluginHandlerContext["paseo"];

export interface Command {
  executable: string;
  args: string[];
  verbatim?: boolean;
}

class FileLinkError extends Error {
  constructor(
    readonly reason: "invalid" | "no-base",
    message: string,
  ) {
    super(message);
  }
}

function pathApi(platform: NodeJS.Platform) {
  return platform === "win32" ? win32 : posix;
}

/** Turns an href into an absolute path. `base` is only read for relative paths. */
export async function hrefToAbsolutePath(
  href: string,
  base: () => Promise<string | null>,
  platform: NodeJS.Platform = process.platform,
): Promise<string> {
  const local = parseLocalHref(href);
  if (!local) {
    throw new FileLinkError("invalid", "The link has no local path.");
  }
  const path = pathApi(platform);
  if (local.kind === "file-url") {
    try {
      return path.resolve(fileURLToPath(local.url, { windows: platform === "win32" }));
    } catch {
      throw new FileLinkError("invalid", "The file URL is not valid.");
    }
  }

  const raw = local.path;
  if (raw === "~" || /^~[\\/]/.test(raw)) {
    return path.resolve(homedir(), raw.slice(2));
  }
  if (path.isAbsolute(raw)) {
    return path.resolve(raw);
  }
  const root = await base();
  if (!root) {
    throw new FileLinkError("no-base", "The workspace folder is unknown.");
  }
  return path.resolve(root, raw);
}

export function buildCommand(
  action: Exclude<FileLinkAction, "resolve">,
  filePath: string,
  isDirectory: boolean,
  platform: NodeJS.Platform = process.platform,
): Command {
  if (platform === "win32") {
    // explorer.exe needs the quotes inside the `/select,` argument, so pass it verbatim.
    const quoted = `"${filePath}"`;
    const reveal = action === "reveal" && !isDirectory;
    return {
      executable: "explorer.exe",
      args: [reveal ? `/select,${quoted}` : quoted],
      verbatim: true,
    };
  }
  if (platform === "darwin") {
    const reveal = action === "reveal" && !isDirectory;
    return { executable: "/usr/bin/open", args: reveal ? ["-R", filePath] : [filePath] };
  }
  const target = action === "reveal" && !isDirectory ? posix.dirname(filePath) : filePath;
  return { executable: "xdg-open", args: [target] };
}

function launch(command: Command): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command.executable, command.args, {
      detached: true,
      stdio: "ignore",
      shell: false,
      windowsVerbatimArguments: command.verbatim === true,
    });
    child.once("error", reject);
    // explorer.exe exits with code 1 even on success, so only a spawn failure counts.
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

async function workspaceRoot(input: FileLinkInput, paseo: PaseoApi): Promise<string | null> {
  if (input.agentId) {
    const agent = paseo.agents.ref(input.agentId);
    await agent.refresh();
    if (agent.cwd) {
      return agent.cwd;
    }
  }
  if (input.workspaceId) {
    const workspace = await paseo.workspaces.ref(input.workspaceId).refresh();
    return workspace?.workspaceDirectory ?? null;
  }
  return null;
}

export async function actOnFileLink(input: FileLinkInput, paseo: PaseoApi): Promise<FileLinkOutput> {
  let filePath: string;
  try {
    filePath = await hrefToAbsolutePath(input.href, () => workspaceRoot(input, paseo));
  } catch (error) {
    return { ok: false, reason: error instanceof FileLinkError ? error.reason : "failed" };
  }

  let isDirectory: boolean;
  try {
    isDirectory = (await stat(filePath)).isDirectory();
  } catch {
    return { ok: false, reason: "not-found", path: filePath };
  }

  if (input.action !== "resolve") {
    try {
      await launch(buildCommand(input.action, filePath, isDirectory));
    } catch {
      return { ok: false, reason: "failed", path: filePath };
    }
  }
  return { ok: true, path: filePath, isDirectory };
}
