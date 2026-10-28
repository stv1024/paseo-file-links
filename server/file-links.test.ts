import assert from "node:assert/strict";
import { homedir } from "node:os";
import { win32 } from "node:path";
import { test } from "node:test";
import { getRouteContext, parseLocalHref, stripSourcePosition } from "../shared/file-links";
import { buildCommand, hrefToAbsolutePath } from "./file-links";

const noBase = async () => null;
const base = async () => "D:\\work\\demo-app";

test("parseLocalHref keeps local paths and skips web links", () => {
  assert.deepEqual(parseLocalHref("D:\\a\\b.mp3"), { kind: "path", path: "D:\\a\\b.mp3" });
  assert.deepEqual(parseLocalHref("D:%5Ca%5C%E6%99%A8.mp3"), { kind: "path", path: "D:\\a\\晨.mp3" });
  assert.deepEqual(parseLocalHref("src/app.ts:42"), { kind: "path", path: "src/app.ts" });
  assert.deepEqual(parseLocalHref("/Users/me/a.md#L3-L9"), { kind: "path", path: "/Users/me/a.md" });
  assert.equal(parseLocalHref("file:///C:/x.png")?.kind, "file-url");
  for (const href of ["https://paseo.sh", "mailto:a@b.c", "vscode://file/x", "#top", " "]) {
    assert.equal(parseLocalHref(href), null, href);
  }
});

test("stripSourcePosition removes line targets only", () => {
  assert.equal(stripSourcePosition("a.ts:12:3"), "a.ts");
  assert.equal(stripSourcePosition("a.ts(12,3)"), "a.ts");
  assert.equal(stripSourcePosition("D:\\a.ts"), "D:\\a.ts");
});

test("hrefToAbsolutePath resolves Windows links", async () => {
  assert.equal(
    await hrefToAbsolutePath("D:\\work\\reports\\2026", noBase, "win32"),
    "D:\\work\\reports\\2026",
  );
  assert.equal(
    await hrefToAbsolutePath("file:///C:/Users/me/a%20b.png", noBase, "win32"),
    "C:\\Users\\me\\a b.png",
  );
  assert.equal(
    await hrefToAbsolutePath("docs/guide.md:150", base, "win32"),
    "D:\\work\\demo-app\\docs\\guide.md",
  );
  assert.equal(await hrefToAbsolutePath("~/notes.md", noBase, "win32"), win32.resolve(homedir(), "notes.md"));
  await assert.rejects(hrefToAbsolutePath("README.md", noBase, "win32"), { reason: "no-base" });
});

test("buildCommand selects files and opens folders", () => {
  assert.deepEqual(buildCommand("reveal", "C:\\a b\\c.mp3", false, "win32"), {
    executable: "explorer.exe",
    args: ['/select,"C:\\a b\\c.mp3"'],
    verbatim: true,
  });
  assert.deepEqual(buildCommand("reveal", "C:\\a b", true, "win32").args, ['"C:\\a b"']);
  assert.deepEqual(buildCommand("open", "C:\\c.mp3", false, "win32").args, ['"C:\\c.mp3"']);
  assert.deepEqual(buildCommand("reveal", "/a/b.md", false, "darwin").args, ["-R", "/a/b.md"]);
  assert.deepEqual(buildCommand("reveal", "/a/b.md", false, "linux").args, ["/a"]);
});

test("getRouteContext reads agent and workspace routes", () => {
  assert.deepEqual(getRouteContext("/h/srv/agent/abc"), { agentId: "abc" });
  assert.deepEqual(getRouteContext("/h/srv/workspace/wks_1/x"), { workspaceId: "wks_1" });
  assert.deepEqual(getRouteContext("/settings"), {});
});
