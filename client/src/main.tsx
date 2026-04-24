import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

if (import.meta.env.DEV && typeof window !== "undefined") {
  const origOpen = window.open.bind(window);
  let openCount = 0;
  (window as any).__popupDebug = { count: () => openCount, restore: () => { window.open = origOpen; } };
  window.open = function (...args: Parameters<typeof window.open>) {
    openCount += 1;
    const stack = new Error("window.open intercepted").stack;
    console.error(`[POPUP-DEBUG] window.open call #${openCount}`, { args, stack });
    return null;
  } as typeof window.open;

  const origClick = HTMLElement.prototype.click;
  HTMLElement.prototype.click = function (this: HTMLElement) {
    if (this.tagName === "A") {
      const a = this as HTMLAnchorElement;
      if (a.target === "_blank" || a.hasAttribute("download")) {
        console.error("[POPUP-DEBUG] anchor.click() target=_blank or download", {
          href: a.href,
          target: a.target,
          download: a.getAttribute("download"),
          stack: new Error("anchor.click intercepted").stack,
        });
        return;
      }
    }
    return origClick.call(this);
  };
}

createRoot(document.getElementById("root")!).render(<App />);
