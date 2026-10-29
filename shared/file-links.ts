import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const fileLinkActionSchema = z.enum(["resolve", "reveal", "open"]);
export type FileLinkAction = z.infer<typeof fileLinkActionSchema>;

export const fileLinkFailureSchema = z.enum(["invalid", "no-base", "not-found", "failed"]);
export type FileLinkFailure = z.infer<typeof fileLinkFailureSchema>;

export const fileLinkRpc = defineRpc({
  name: "file-links.act",
  input: z.object({
    href: z.string().min(1).max(16_384),
    action: fileLinkActionSchema,
    agentId: z.string().min(1).max(512).optional(),
    workspaceId: z.string().min(1).max(512).optional(),
  }),
  output: z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), path: z.string(), isDirectory: z.boolean() }),
    z.object({ ok: z.literal(false), reason: fileLinkFailureSchema, path: z.string().optional() }),
  ]),
});

export type LocalHref =
  | { kind: "file-url"; url: string }
  | { kind: "path"; path: string };

const LINE_FRAGMENT = /#L[0-9]+(?:C[0-9]+)?(?:-L?[0-9]+(?:C[0-9]+)?)?$/i;
const COLON_LINE_SUFFIX = /:[0-9]+(?::[0-9]+)?(?:-[0-9]+(?::[0-9]+)?)?$/;
const PAREN_LINE_SUFFIX = /\([0-9]+(?:,[0-9]+)?(?:-[0-9]+(?:,[0-9]+)?)?\)$/;
const WINDOWS_DRIVE = /^[A-Za-z]:[\\/]/;
const URL_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Removes `:12`, `:12:3`, `#L12-L20` and `(12,3)` so the link points at the file itself. */
export function stripSourcePosition(value: string): string {
  return value
    .replace(LINE_FRAGMENT, "")
    .replace(COLON_LINE_SUFFIX, "")
    .replace(PAREN_LINE_SUFFIX, "");
}

/** Returns the local file target of an assistant link, or null for web and app links. */
export function parseLocalHref(href: string): LocalHref | null {
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return null;
  }
  if (/^file:/i.test(trimmed)) {
    return { kind: "file-url", url: trimmed.replace(LINE_FRAGMENT, "") };
  }

  const path = stripSourcePosition(safeDecode(trimmed)).trim();
  if (!path) {
    return null;
  }
  if (WINDOWS_DRIVE.test(path) || path.startsWith("\\\\")) {
    return { kind: "path", path };
  }
  if (URL_SCHEME.test(path)) {
    return null;
  }
  return { kind: "path", path };
}

export interface RouteContext {
  serverId?: string;
  agentId?: string;
  workspaceId?: string;
}

export function getRouteContext(pathname: string): RouteContext {
  const pathOnly = pathname.split(/[?#]/, 1)[0] ?? "";
  const host = pathOnly.match(/^\/h\/([^/]+)(?:\/|$)/);
  if (!host?.[1]) {
    return {};
  }
  const serverId = safeDecode(host[1]);
  const agent = pathOnly.match(/^\/h\/[^/]+\/agent\/([^/]+)(?:\/|$)/);
  if (agent?.[1]) {
    return { serverId, agentId: safeDecode(agent[1]) };
  }
  const workspace = pathOnly.match(/^\/h\/[^/]+\/workspace\/([^/]+)(?:\/|$)/);
  if (workspace?.[1]) {
    return { serverId, workspaceId: safeDecode(workspace[1]) };
  }
  return { serverId };
}
