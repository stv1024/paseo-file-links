import type { PluginClientContext } from "@getpaseo/plugin/client";
import { Platform } from "react-native";
import {
  fileLinkRpc,
  getRouteContext,
  parseLocalHref,
  type FileLinkAction,
  type FileLinkFailure,
} from "../shared/file-links";
import { messages } from "./messages";

// This plugin typechecks without the DOM library. Declare only what this module uses.
interface Style {
  [property: string]: string;
}

interface Element {
  readonly style: Style;
  readonly parentElement: Element | null;
  readonly offsetWidth: number;
  readonly offsetHeight: number;
  textContent: string | null;
  closest(selector: string): Element | null;
  contains(other: unknown): boolean;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  appendChild(child: Element): void;
  replaceChildren(...children: Element[]): void;
  remove(): void;
  addEventListener(type: string, listener: (event: DomEvent) => void): void;
}

interface DomEvent {
  readonly target: unknown;
  readonly key?: string;
  readonly clientX: number;
  readonly clientY: number;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  preventDefault(): void;
  stopPropagation(): void;
}

interface ComputedStyle {
  readonly color: string;
  readonly backgroundColor: string;
  readonly fontFamily: string;
}

interface ImageElement extends Element {
  readonly naturalWidth: number;
  readonly naturalHeight: number;
}

interface Canvas {
  width: number;
  height: number;
  getContext(type: "2d"): { drawImage(image: ImageElement, x: number, y: number): void } | null;
  toBlob(callback: (blob: Blob | null) => void, type: string): void;
}

interface Blob {
  readonly type: string;
}

declare class ClipboardItem {
  constructor(items: Record<string, Promise<Blob>>);
}

declare const document: {
  readonly body: Element;
  createElement(tag: "canvas"): Canvas;
  createElement(tag: string): Element;
  addEventListener(type: string, listener: (event: DomEvent) => void, capture: boolean): void;
  removeEventListener(type: string, listener: (event: DomEvent) => void, capture: boolean): void;
};
declare const window: {
  readonly innerWidth: number;
  readonly innerHeight: number;
  getComputedStyle(element: Element): ComputedStyle;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
};
declare const location: { readonly pathname: string };
declare const navigator: {
  readonly clipboard: {
    writeText(text: string): Promise<void>;
    write(items: ClipboardItem[]): Promise<void>;
  };
};
declare function setTimeout(callback: () => void, ms: number): unknown;

type Resolution =
  | { ok: true; path: string; isDirectory: boolean }
  | { ok: false; reason: FileLinkFailure; path?: string };

const EDGE = 8;
const ERROR_MS = 2000;

function asElement(value: unknown): Element | null {
  return value && typeof value === "object" && "closest" in value ? (value as Element) : null;
}

interface MenuTarget {
  element: Element;
  /** Local file source, or null when the target has no file on disk. */
  href: string | null;
  image: ImageElement | null;
}

// Paseo shows markdown images from preview URLs and keeps the original sources here.
const IMAGE_SOURCES_ATTRIBUTE = "data-paseo-markdown-image-sources";

function findImage(target: Element): MenuTarget | null {
  const image = target.closest("img") as ImageElement | null;
  const sources = image?.closest(`[${IMAGE_SOURCES_ATTRIBUTE}]`)?.getAttribute(IMAGE_SOURCES_ATTRIBUTE);
  if (!image || !sources) {
    return null;
  }
  const src = image.getAttribute("src") ?? "";
  let source = src;
  try {
    source = (JSON.parse(sources) as Record<string, string>)[src] ?? src;
  } catch {
    // Keep the displayed URL.
  }
  return { element: image, href: parseLocalHref(source) ? source : null, image };
}

/** Assistant markdown links open in a new target; app navigation links do not. */
function findLink(target: Element): MenuTarget | null {
  const anchor = target.closest('a[href][target="_blank"]');
  const href = anchor?.getAttribute("href") ?? "";
  if (!anchor || !parseLocalHref(href)) {
    return null;
  }
  return { element: anchor, href, image: null };
}

function findTarget(event: DomEvent): MenuTarget | null {
  const target = asElement(event.target);
  return target ? (findImage(target) ?? findLink(target)) : null;
}

function imageToPng(image: ImageElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      reject(new Error("No 2D canvas"));
      return;
    }
    context.drawImage(image, 0, 0);
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("No PNG"))), "image/png");
  });
}

function isTransparent(color: string): boolean {
  return color === "transparent" || /rgba\(.*,\s*0\)$/.test(color);
}

function luminance(color: string): number | null {
  const channels = color.match(/[\d.]+/g)?.slice(0, 3).map(Number);
  if (!channels || channels.length < 3) {
    return null;
  }
  const [r, g, b] = channels.map((value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  if (la === null || lb === null) {
    return 21;
  }
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function themeFrom(anchor: Element) {
  const text = anchor.parentElement?.parentElement ?? anchor;
  const textStyle = window.getComputedStyle(text);
  let background = "rgb(32, 32, 32)";
  for (let node: Element | null = anchor; node; node = node.parentElement) {
    const color = window.getComputedStyle(node).backgroundColor;
    if (!isTransparent(color)) {
      background = color;
      break;
    }
  }
  // An image has no text color of its own, so its inherited color can be unreadable.
  let foreground = textStyle.color;
  if (contrast(foreground, background) < 4.5) {
    foreground = (luminance(background) ?? 0) < 0.5 ? "rgb(236, 236, 236)" : "rgb(28, 28, 28)";
  }
  return { foreground, background, fontFamily: textStyle.fontFamily };
}

export function installFileLinkMenu(client: PluginClientContext): () => void {
  if (Platform.OS !== "web") {
    return () => {};
  }

  let closeMenu: (() => void) | null = null;
  const t = (key: keyof typeof messages.resources.en) => client.i18n.t(messages, key);

  const failureText = (reason: FileLinkFailure) =>
    reason === "not-found" ? t("notFound") : reason === "no-base" ? t("noBase") : t("failed");

  const showMenu = (event: DomEvent, { element, href, image }: MenuTarget) => {
    closeMenu?.();
    const route = getRouteContext(location.pathname);
    const call = (action: FileLinkAction): Promise<Resolution> =>
      href
        ? client
            .rpc(fileLinkRpc, { href, action, ...route })
            .catch((): Resolution => ({ ok: false, reason: "failed" }))
        : Promise.resolve({ ok: false, reason: "invalid" });
    const resolution = call("resolve");

    const theme = themeFrom(element);
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    Object.assign(menu.style, {
      position: "fixed",
      zIndex: "2147483647",
      minWidth: "160px",
      padding: "4px",
      borderRadius: "8px",
      border: `1px solid color-mix(in srgb, ${theme.foreground} 16%, transparent)`,
      background: theme.background,
      color: theme.foreground,
      fontFamily: theme.fontFamily,
      fontSize: "13px",
      lineHeight: "18px",
      boxShadow: "0 8px 24px rgba(0, 0, 0, 0.28)",
      userSelect: "none",
      left: "0px",
      top: "0px",
      visibility: "hidden",
    });

    const row = (label: string) => {
      const item = document.createElement("div");
      item.textContent = label;
      Object.assign(item.style, { padding: "6px 10px", borderRadius: "5px", whiteSpace: "nowrap" });
      return item;
    };

    const showError = (text: string) => {
      const item = row(text);
      item.style.opacity = "0.7";
      menu.replaceChildren(item);
      setTimeout(close, ERROR_MS);
    };

    const button = (label: string, run: () => Promise<void>) => {
      const item = row(label);
      item.setAttribute("role", "menuitem");
      item.style.cursor = "pointer";
      item.addEventListener("mouseenter", () => {
        item.style.background = `color-mix(in srgb, ${theme.foreground} 10%, transparent)`;
      });
      item.addEventListener("mouseleave", () => {
        item.style.background = "transparent";
      });
      item.addEventListener("click", (clickEvent) => {
        clickEvent.stopPropagation();
        void run();
      });
      return item;
    };

    const act = (action: Exclude<FileLinkAction, "resolve">) => async () => {
      const result = await call(action);
      if (result.ok) {
        close();
      } else {
        showError(failureText(result.reason));
      }
    };

    const copy = async (write: () => Promise<void>) => {
      try {
        await write();
        close();
      } catch {
        showError(t("failed"));
      }
    };

    const copyPath = async () => {
      const result = await resolution;
      const local = parseLocalHref(href ?? "");
      const path = result.path ?? (local?.kind === "path" ? local.path : (href ?? ""));
      await copy(() => navigator.clipboard.writeText(path));
    };

    // Pass the PNG as a promise so the write starts inside the click.
    const copyImage = (target: ImageElement) => () =>
      copy(() => navigator.clipboard.write([new ClipboardItem({ "image/png": imageToPng(target) })]));

    const fileItems = href
      ? [
          button(t("reveal"), act("reveal")),
          button(t("open"), act("open")),
          button(t("copyPath"), copyPath),
        ]
      : [];
    const items = image ? [...fileItems, button(t("copyImage"), copyImage(image))] : fileItems;
    for (const item of items) {
      menu.appendChild(item);
    }

    void resolution.then((result) => {
      if (!href || result.ok || closeMenu !== close) {
        return;
      }
      for (const item of fileItems.slice(0, 2)) {
        item.style.opacity = "0.4";
        item.style.pointerEvents = "none";
      }
      const note = row(failureText(result.reason));
      note.style.opacity = "0.7";
      menu.replaceChildren(note, ...items);
    });

    document.body.appendChild(menu);
    const left = Math.min(event.clientX, window.innerWidth - menu.offsetWidth - EDGE);
    const top = Math.min(event.clientY, window.innerHeight - menu.offsetHeight - EDGE);
    menu.style.left = `${Math.max(EDGE, left)}px`;
    menu.style.top = `${Math.max(EDGE, top)}px`;
    menu.style.visibility = "visible";

    const onPointerDown = (downEvent: DomEvent) => {
      if (!menu.contains(downEvent.target)) {
        close();
      }
    };
    const onKeyDown = (keyEvent: DomEvent) => {
      if (keyEvent.key === "Escape") {
        close();
      }
    };
    const onViewportChange = () => close();

    function close() {
      if (closeMenu !== close) {
        return;
      }
      closeMenu = null;
      menu.remove();
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("wheel", onViewportChange, true);
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("blur", onViewportChange);
    }

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("wheel", onViewportChange, true);
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("blur", onViewportChange);
    closeMenu = close;
  };

  const onContextMenu = (event: DomEvent) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
      return;
    }
    const target = findTarget(event);
    if (!target) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    showMenu(event, target);
  };

  document.addEventListener("contextmenu", onContextMenu, true);
  return () => {
    document.removeEventListener("contextmenu", onContextMenu, true);
    closeMenu?.();
  };
}
