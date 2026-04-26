#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SW_PATH = path.join(__dirname, "..", "client", "public", "sw.js");

function bumpSwVersion() {
  try {
    const content = fs.readFileSync(SW_PATH, "utf8");
    const now = new Date();
    const version = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0"),
      String(now.getHours()).padStart(2, "0"),
      String(now.getMinutes()).padStart(2, "0"),
      String(now.getSeconds()).padStart(2, "0"),
    ].join("");
    const pattern = /const CACHE_NAME = 'leaflog-cache-v\d+'/;

    if (!pattern.test(content)) {
      console.log("SW version not updated (pattern not found)");
      return;
    }

    const newContent = content.replace(
      pattern,
      `const CACHE_NAME = 'leaflog-cache-v${version}'`
    );

    if (content === newContent) {
      console.log("SW version already current");
      return;
    }

    fs.writeFileSync(SW_PATH, newContent);
    console.log(`SW cache version bumped to: v${version}`);
  } catch (error) {
    console.error(`Failed to bump SW version: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

bumpSwVersion();
