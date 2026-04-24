import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Detect low-end hardware BEFORE React renders so the kiosk drops scale
// animations and hover effects that punish cheap Adreno/Mali GPUs and
// slow ARM CPUs. CSS keys off the `data-low-end` attribute on <html>.
//
// Threshold notes:
//  - hardwareConcurrency<=2 catches genuinely old budget Android tablets
//    (8th-gen Fire HD, low-end Galaxy Tabs). Higher thresholds (4) start
//    catching mid-range laptops where the snap-instant feel is jarring
//    and reads as "less polished" rather than "faster".
//  - deviceMemory<=2 catches sub-2GB-RAM Android tablets.
//  - prefers-reduced-motion is always honored regardless of hardware.
//
// URL overrides (handy for testing on any device):
//   ?lowend=1  → force-enable low-end mode
//   ?lowend=0  → force-disable low-end mode (overrides hardware detect)
try {
  const params = new URLSearchParams(window.location.search);
  const override = params.get("lowend");
  let isLowEnd = false;
  if (override === "1") {
    isLowEnd = true;
  } else if (override === "0") {
    isLowEnd = false;
  } else {
    const nav = navigator as Navigator & { deviceMemory?: number };
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const lowMemory = typeof nav.deviceMemory === "number" && nav.deviceMemory > 0 && nav.deviceMemory <= 2;
    const lowCores = typeof nav.hardwareConcurrency === "number" && nav.hardwareConcurrency > 0 && nav.hardwareConcurrency <= 2;
    isLowEnd = reduceMotion || lowMemory || lowCores;
  }
  if (isLowEnd) {
    document.documentElement.setAttribute("data-low-end", "true");
    if (import.meta.env.DEV) {
      // Make accidental triggers obvious during local development.
      // eslint-disable-next-line no-console
      console.info("[leaflog] low-end mode active (animations reduced). Override with ?lowend=0");
    }
  }
} catch {
  /* defensive: never let detection break boot */
}

createRoot(document.getElementById("root")!).render(<App />);
