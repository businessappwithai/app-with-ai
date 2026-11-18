#!/usr/bin/env bun
/**
 * Hold the protocol documents to one copy each.
 *
 * `llms.txt` and its five chunks live once, in the product's `website/llmtext/` at the root of this tree. This repository used to carry a byte
 * copy of each and compare it to upstream's; the copies are gone, so there is
 * nothing left to drift. What stays here is what is genuinely this repository's:
 * `llms-reporting.txt`, a separate document about the reporting platform, and
 * `checker-rules.txt`, which carries this repository's own diagnostics note.
 *
 * This script checks that upstream's controller and chunks are present, and that
 * this directory holds those two files and nothing else — a returning copy of a
 * chunk is the mistake it exists to catch.
 */

import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

const COMMON = path.resolve(import.meta.dir, "..");
const MONOREPO = path.resolve(COMMON, "..", "..");
const ours = path.join(COMMON, "website", "llmtext");
const upstreamDir = path.join(MONOREPO, "website", "llmtext");
const CHUNKS = [
  "llms.txt",
  "working-session.txt",
  "eml-syntax.txt",
  "eml-dictionary.txt",
  "eml-reporting.txt",
  "checker-rules.txt",
  "enhancement-examples.txt",
];
const OWN = ["checker-rules.txt", "llms-reporting.txt"];

let failed = 0;
const ok = (label: string) => console.log(`  ok    ${label}`);
const fail = (label: string, why: string) => {
  failed++;
  console.log(`  FAIL  ${label}\n        ${why}`);
};

for (const name of CHUNKS) {
  existsSync(path.join(upstreamDir, name))
    ? ok(`upstream's ${name} is present`)
    : fail(
        `upstream's ${name} is present`,
        `${path.join(upstreamDir, name)} is missing — run ./deps.sh --install first, or move the pin in deps.json to a commit that carries it`
      );
}

const files = readdirSync(ours).sort();
JSON.stringify(files) === JSON.stringify([...OWN].sort())
  ? ok("website/llmtext holds checker-rules.txt and llms-reporting.txt, and no copy of upstream's chunks")
  : fail("website/llmtext holds checker-rules.txt and llms-reporting.txt, and no copy of upstream's chunks", `found: ${files.join(", ")}`);

console.log(failed === 0 ? "\nThe protocol documents are held once." : `\n${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
