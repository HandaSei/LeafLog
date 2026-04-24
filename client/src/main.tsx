import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Detect low-end hardware BEFORE React renders so the kiosk drops scale
// animations and hover effects that punish cheap Adreno/Mali GPUs and
// slow ARM CPUs. CSS keys off the `data-low-end` attribute on <html>.
//
// Detection strategy — what we DO NOT use, and why:
//  - hardwareConcurrency: misleading. A 2-vCPU cloud VM on a Xeon is
//    very fast; a 2-core Pentium at 4GHz is fast; an 8-core 2018
//    Snapdragon 425 is slow. Core count is not perf.
//  - User-Agent sniffing: brittle, easy to get wrong, breaks on new
//    devices we haven't enumerated.
//
// What we DO use:
//  1. prefers-reduced-motion (explicit user preference — always honored)
//  2. Save-Data hint (explicit user opt-in to reduced work/bandwidth)
//  3. deviceMemory <= 1 (only the genuinely-1GB-RAM tier — conservative)
//  4. A tiny synthetic JS benchmark, cached in localStorage so it runs
//     once per browser. ~0.5–2ms on any modern CPU/cloud VM, 30–100ms
//     on truly slow hardware (cheap Android tablets, ARM Cortex-A53/A7).
//
// URL overrides (testing on any device):
//   ?lowend=1  → force-enable
//   ?lowend=0  → force-disable (also clears the cached benchmark result)
const PERF_CACHE_KEY = "leaflog_perf_class_v1";
const BENCH_THRESHOLD_MS = 25; // Empirically separates slow ARM cores from anything modern
function runPerfBenchmark(): number {
  // Tiny warmup so we measure steady-state JIT, not cold start.
  let warm = 0;
  for (let i = 0; i < 5_000; i++) warm += Math.sqrt(i + 0.5);
  if (warm < 0) return 0; // Anti-DCE read; never executes.
  const start = performance.now();
  let n = 0;
  for (let i = 0; i < 200_000; i++) n += Math.sqrt(i + 0.5);
  const elapsed = performance.now() - start;
  if (n < 0) return 0; // Anti-DCE read.
  return elapsed;
}
try {
  const params = new URLSearchParams(window.location.search);
  const override = params.get("lowend");
  let isLowEnd = false;
  let reason = "";

  if (override === "1") {
    isLowEnd = true;
    reason = "url override";
  } else if (override === "0") {
    isLowEnd = false;
    // Honor explicit opt-out by clearing the cached classification too.
    try { localStorage.removeItem(PERF_CACHE_KEY); } catch {}
  } else {
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (reduceMotion) {
      isLowEnd = true;
      reason = "prefers-reduced-motion";
    } else {
      const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
      if (conn?.saveData === true) {
        isLowEnd = true;
        reason = "save-data";
      } else {
        const nav = navigator as Navigator & { deviceMemory?: number };
        const veryLowMem = typeof nav.deviceMemory === "number" && nav.deviceMemory > 0 && nav.deviceMemory <= 1;
        if (veryLowMem) {
          isLowEnd = true;
          reason = "deviceMemory<=1GB";
        } else {
          // Synthetic benchmark — the only signal that actually measures
          // real JS execution speed. Cached so it only runs once.
          let cached: string | null = null;
          try { cached = localStorage.getItem(PERF_CACHE_KEY); } catch {}
          if (cached === "low") {
            isLowEnd = true;
            reason = "benchmark (cached)";
          } else if (cached === "high") {
            isLowEnd = false;
          } else {
            const elapsed = runPerfBenchmark();
            isLowEnd = elapsed > BENCH_THRESHOLD_MS;
            reason = `benchmark ${elapsed.toFixed(1)}ms`;
            try { localStorage.setItem(PERF_CACHE_KEY, isLowEnd ? "low" : "high"); } catch {}
          }
        }
      }
    }
  }

  if (isLowEnd) {
    document.documentElement.setAttribute("data-low-end", "true");
    if (import.meta.env.DEV) {
      // Make accidental triggers obvious during local development.
      // eslint-disable-next-line no-console
      console.info(`[leaflog] low-end mode active (${reason}). Override with ?lowend=0`);
    }
  }
} catch {
  /* defensive: never let detection break boot */
}

createRoot(document.getElementById("root")!).render(<App />);
