import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Detect low-end hardware BEFORE React renders so the kiosk drops scale
// animations and hover effects that punish cheap Adreno/Mali GPUs and
// slow ARM CPUs. Triggers when the user prefers reduced motion, or when
// the device reports <=2 GB RAM, or <=4 cores. CSS keys off the
// `data-low-end` attribute on <html>; modern devices are unaffected.
try {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const lowMemory = typeof nav.deviceMemory === "number" && nav.deviceMemory > 0 && nav.deviceMemory <= 2;
  const lowCores = typeof nav.hardwareConcurrency === "number" && nav.hardwareConcurrency > 0 && nav.hardwareConcurrency <= 4;
  if (reduceMotion || lowMemory || lowCores) {
    document.documentElement.setAttribute("data-low-end", "true");
  }
} catch {
  /* defensive: never let detection break boot */
}

createRoot(document.getElementById("root")!).render(<App />);
