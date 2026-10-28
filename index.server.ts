import type { PluginServerContext } from "@getpaseo/plugin/server";
import { actOnFileLink } from "./server/file-links";
import { fileLinkRpc } from "./shared/file-links";

export default function contribute(server: PluginServerContext) {
  server.handle(fileLinkRpc, (input, context) => actOnFileLink(input, context.paseo));
  return () => {};
}
