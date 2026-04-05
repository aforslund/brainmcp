#!/usr/bin/env node

/**
 * BrainMCP Explorer — Ask mode
 *
 * Opens an interactive Claude session with an explore brain loaded,
 * so you can ask questions against the knowledge graph.
 *
 * Usage:
 *   npm run explore-ask -- "slug"                     (interactive)
 *   npm run explore-ask -- "slug" "your question"     (one-shot)
 */

import { execFileSync, execFile } from "child_process";
import { writeFileSync, unlinkSync, existsSync, readdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, "..");

// --- CLI ---
const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h") || args.length === 0) {
  // List available explore databases
  const dbs = readdirSync(projectRoot)
    .filter((f) => f.startsWith("explore-") && f.endsWith(".db"))
    .map((f) => f.replace(/^explore-/, "").replace(/\.db$/, ""));

  console.log(`Usage: npm run explore-ask -- "<slug>" ["question"]`);
  console.log(`\n  slug:     Name of the explore database (see below)`);
  console.log(`  question: Optional one-shot question (omit for interactive session)\n`);

  if (dbs.length > 0) {
    console.log(`Available brains:`);
    for (const db of dbs) {
      console.log(`  ${db}`);
    }
  } else {
    console.log(`No explore databases found. Run explore or explore-cc first.`);
  }
  process.exit(0);
}

const slug = args[0];
const question = args.slice(1).join(" ") || null;
const dbPath = path.join(projectRoot, `explore-${slug}.db`);

if (!existsSync(dbPath)) {
  console.error(`Error: database not found: ${dbPath}`);
  console.error(`\nRun with --help to see available brains.`);
  process.exit(1);
}

const mcpConfigPath = path.join(projectRoot, `.explore-mcp-config.json`);

const mcpConfig = {
  mcpServers: {
    brainmcp: {
      command: "node",
      args: [path.join(__dirname, "index.js"), "--db", dbPath],
    },
  },
};
writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2));

const allowedTools = [
  "mcp__brainmcp__remember",
  "mcp__brainmcp__recall",
  "mcp__brainmcp__associate",
  "mcp__brainmcp__strengthen",
  "mcp__brainmcp__weaken",
  "mcp__brainmcp__reflect",
  "mcp__brainmcp__forget",
  "mcp__brainmcp__search",
].join(",");

const systemPrompt = `You have access to a knowledge graph about a specific topic via the brainmcp tools. Use these tools to answer the user's questions:

- Use 'reflect' to see the highest-weighted concepts and associations
- Use 'recall' to retrieve a specific concept and all its connections (including 2-hop related concepts)
- Use 'search' to find concepts by name
- Use 'associate' or 'strengthen' if the user wants to add or update knowledge

When answering questions:
1. First use the brain tools to look up relevant concepts and their connections
2. Base your answers on what's actually in the knowledge graph
3. Trace paths through the graph to support your reasoning
4. Be clear about what the graph contains vs. your own knowledge
5. Reference specific nodes and associations when making claims`;

const claudeArgs = [
  "--mcp-config", mcpConfigPath,
  "--strict-mcp-config",
  "--model", "sonnet",
  "--allowedTools", allowedTools,
  "--system-prompt", systemPrompt,
];

if (question) {
  // One-shot mode
  claudeArgs.push("-p", question);
  try {
    const result = execFileSync("claude", claudeArgs, {
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
      timeout: 300000,
    });
    console.log(result);
  } finally {
    try { unlinkSync(mcpConfigPath); } catch {}
  }
} else {
  // Interactive mode — spawn claude as a child with inherited stdio
  console.log(`Opening interactive session with brain: ${slug}`);
  console.log(`(type your questions, Ctrl+C to exit)\n`);

  const child = execFile("claude", claudeArgs, {
    maxBuffer: 20 * 1024 * 1024,
  });

  // Inherit stdio for interactive use
  process.stdin.pipe(child.stdin!);
  child.stdout?.pipe(process.stdout);
  child.stderr?.pipe(process.stderr);

  child.on("exit", (code) => {
    try { unlinkSync(mcpConfigPath); } catch {}
    process.exit(code ?? 0);
  });
}
