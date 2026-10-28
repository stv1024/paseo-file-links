import type { PluginClientContext } from "@getpaseo/plugin/client";
import { installFileLinkMenu } from "./client/web";

export default function contribute(client: PluginClientContext) {
  return installFileLinkMenu(client);
}
