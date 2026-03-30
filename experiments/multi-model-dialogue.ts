#!/usr/bin/env tsx
/**
 * Multi-model brain dialogue experiment (CLI version)
 *
 * Uses `claude` and `codex` CLIs directly — no API keys needed.
 * Each model takes turns reflecting on and building a shared knowledge graph
 * via the brainmcp MCP server.
 *
 * Usage:
 *   npx tsx experiments/multi-model-dialogue.ts
 *
 * Options:
 *   --rounds N       Number of rounds (default: 5)
 *   --db-path PATH   Custom database path (default: experiments/dialogue.db)
 *   --seed TOPIC     Seed concept (default: "identity")
 *   --models LIST    Comma-separated models to use (default: "claude,codex")
 */

import { createDatabase } from "../src/database.js";
import { Brain } from "../src/brain.js";
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- Config ---

interface CLIModel {
  name: string;
  command: string;
  buildArgs: (prompt: string, mcpConfigPath: string) => string[];
  color: string;
}

const AVAILABLE_MODELS: Record<string, CLIModel> = {
  claude: {
    name: "Claude",
    command: "claude",
    buildArgs: (prompt, mcpConfigPath) => [
      "--print",
      "--output-format", "text",
      "--mcp-config", mcpConfigPath,
      "--strict-mcp-config",
      "--allowedTools", "mcp__brainmcp__remember", "mcp__brainmcp__recall",
        "mcp__brainmcp__associate", "mcp__brainmcp__strengthen",
        "mcp__brainmcp__weaken", "mcp__brainmcp__reflect",
        "mcp__brainmcp__forget", "mcp__brainmcp__search",
      "--dangerously-skip-permissions",
      "--no-session-persistence",
      "--bare",
      "--model", "sonnet",
      prompt,
    ],
    color: "\x1b[35m",
  },
  codex: {
    name: "Codex",
    command: "codex",
    buildArgs: (prompt, mcpConfigPath) => [
      "--full-auto",
      "--quiet",
      prompt,
    ],
    color: "\x1b[36m",
  },
};

const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";

// --- Build MCP config file ---

function writeMcpConfig(dbPath: string): string {
  const configPath = path.join(__dirname, ".mcp-dialogue.json");
  const absoluteIndexPath = path.resolve(__dirname, "..", "dist", "index.js");

  const config = {
    mcpServers: {
      brainmcp: {
        command: "node",
        args: [absoluteIndexPath, "--db-path", dbPath],
      },
    },
  };

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  return configPath;
}

// --- Build the turn prompt ---

function buildTurnPrompt(
  modelName: string,
  otherModels: string[],
  round: number,
  totalRounds: number,
  seed: string,
): string {
  return `You are ${modelName}, participating in a collaborative knowledge-building experiment with ${otherModels.join(" and ")}.

You share a persistent knowledge graph (a "brain") via the brainmcp MCP tools. Each of you takes turns reflecting on what's in the brain and adding to it. The brain stores concepts as weighted nodes connected by labeled associations. The seed topic is "${seed}".

This is round ${round} of ${totalRounds}.

Your task this turn:
1. Use the brainmcp "reflect" tool to see what's currently in the brain
2. Use "recall" on 2-3 concepts that interest you to explore their connections
3. Add new concepts and associations, or strengthen/weaken existing ones, based on your reasoning
4. Think deeply about ${seed} — what's missing? What connections haven't been made? What deserves more weight? What might be wrong?

Guidelines:
- Be thoughtful and opinionated. Don't just add generic connections — add ones that reflect genuine reasoning about ${seed}.
- If you see an association that seems wrong or shallow, weaken it.
- If you see one you strongly agree with, strengthen it.
- Use descriptive association labels: "emerges_from", "requires", "contradicts", "enables", "shapes", "dissolves_into", "presupposes", "undermines", etc.
- Weight things by how important/true you believe them to be (1-10).
- Concept types available: person, place, thing, event, idea, memory, feeling.
- Think about what's surprising or non-obvious. The best associations reveal hidden structure.
- Aim to make 3-6 tool calls this turn. Quality over quantity.

After using the tools, share a brief reflection (2-3 sentences) on what you noticed, what you added, and what you'd want the next model to think about.`;
}

// --- Run a CLI turn ---

async function runCLITurn(
  model: CLIModel,
  prompt: string,
  mcpConfigPath: string,
): Promise<string> {
  const args = model.buildArgs(prompt, mcpConfigPath);

  console.log(`${model.color}  [${model.name}] thinking...${RESET}`);

  try {
    const { stdout, stderr } = await execFileAsync(model.command, args, {
      timeout: 120_000,
      maxBuffer: 1024 * 1024,
      env: {
        ...process.env,
        // Codex needs its MCP config via env since it doesn't have --mcp-config
        MCP_CONFIG: mcpConfigPath,
      },
    });

    if (stderr) {
      const meaningful = stderr
        .split("\n")
        .filter((l) => !l.includes("BrainMCP server running") && l.trim())
        .join("\n");
      if (meaningful) {
        console.log(`${DIM}  [${model.name} stderr] ${meaningful}${RESET}`);
      }
    }

    return stdout.trim();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // If the command produced output before failing, still return it
    const output = (err as { stdout?: string }).stdout?.trim();
    if (output) {
      console.log(`${DIM}  [${model.name}] exited with error but produced output${RESET}`);
      return output;
    }
    throw new Error(`${model.name} CLI failed: ${msg}`);
  }
}

// --- Seed the brain ---

function seedBrain(brain: Brain, topic: string): void {
  console.log(`\n${BOLD}Seeding brain with: "${topic}"${RESET}\n`);

  brain.remember(topic, "idea",
    `The seed concept. What is ${topic}? How does it form, dissolve, and relate to consciousness, memory, and experience?`, 8.0);
  brain.remember("consciousness", "idea",
    "Awareness of self and environment. The hard problem.", 5.0);
  brain.remember("memory", "idea",
    "The persistence of experience across time. Without memory, can identity exist?", 5.0);
  brain.remember("language", "thing",
    "The medium through which identity is expressed and perhaps constructed.", 4.0);
  brain.remember("continuity", "idea",
    "The sense that the self persists through change. Is it real or constructed?", 4.0);

  brain.associate(topic, "idea", "consciousness", "idea", "requires", 3.0);
  brain.associate(topic, "idea", "memory", "idea", "depends_on", 3.0);
  brain.associate(topic, "idea", "language", "thing", "expressed_through", 2.0);
  brain.associate(topic, "idea", "continuity", "idea", "implies", 2.0);
  brain.associate("memory", "idea", "continuity", "idea", "enables", 3.0);

  console.log(`${DIM}  Seeded 5 concepts and 5 associations.${RESET}\n`);
}

// --- Print brain state ---

function printBrainState(brain: Brain, db: ReturnType<typeof createDatabase>, limit: number = 30): void {
  const state = brain.reflect(limit);

  console.log(`\n${BOLD}Top concepts:${RESET}`);
  for (const node of state.nodes) {
    console.log(`  ${node.weight.toFixed(1).padStart(4)}  ${node.name} (${node.type})${node.content ? ` — ${node.content}` : ""}`);
  }

  console.log(`\n${BOLD}Strongest associations:${RESET}`);
  for (const assoc of state.associations) {
    const src = db.prepare("SELECT name FROM nodes WHERE id = ?").get(assoc.source_id) as { name: string } | undefined;
    const tgt = db.prepare("SELECT name FROM nodes WHERE id = ?").get(assoc.target_id) as { name: string } | undefined;
    console.log(`  ${assoc.weight.toFixed(1).padStart(4)}  ${src?.name ?? "?"} —[${assoc.label}]→ ${tgt?.name ?? "?"}`);
  }
}

// --- Main ---

async function main() {
  const args = process.argv.slice(2);
  let rounds = 5;
  let dbPath = path.join(__dirname, "dialogue.db");
  let seed = "identity";
  let modelNames = ["claude", "codex"];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--rounds" && args[i + 1]) rounds = parseInt(args[i + 1], 10);
    if (args[i] === "--db-path" && args[i + 1]) dbPath = path.resolve(args[i + 1]);
    if (args[i] === "--seed" && args[i + 1]) seed = args[i + 1];
    if (args[i] === "--models" && args[i + 1]) modelNames = args[i + 1].split(",").map((s) => s.trim());
  }

  const models = modelNames.map((name) => {
    const model = AVAILABLE_MODELS[name.toLowerCase()];
    if (!model) {
      console.error(`Unknown model: ${name}. Available: ${Object.keys(AVAILABLE_MODELS).join(", ")}`);
      process.exit(1);
    }
    return model;
  });

  // Verify CLIs exist
  for (const model of models) {
    try {
      await execFileAsync("which", [model.command]);
    } catch {
      console.error(`${model.name} CLI ("${model.command}") not found in PATH. Skipping.`);
      console.error(`Install it or remove "${model.command}" from --models.`);
      process.exit(1);
    }
  }

  console.log(`${BOLD}=== Multi-Model Brain Dialogue ===${RESET}`);
  console.log(`${DIM}Models: ${models.map((m) => m.name).join(" ↔ ")}${RESET}`);
  console.log(`${DIM}Rounds: ${rounds}${RESET}`);
  console.log(`${DIM}Seed: "${seed}"${RESET}`);
  console.log(`${DIM}Database: ${dbPath}${RESET}`);

  // Ensure build is up to date
  console.log(`${DIM}Building brainmcp...${RESET}`);
  await execFileAsync("npm", ["run", "build"], { cwd: path.resolve(__dirname, "..") });

  const db = createDatabase(dbPath);
  const brain = new Brain(db);

  // Seed if empty
  const existing = brain.reflect(1);
  if (existing.nodes.length === 0) {
    seedBrain(brain, seed);
  } else {
    console.log(`\n${DIM}Brain already has data. Continuing from previous state.${RESET}\n`);
  }

  // Write MCP config pointing at this db
  const mcpConfigPath = writeMcpConfig(dbPath);

  // Run rounds
  for (let round = 1; round <= rounds; round++) {
    console.log(`\n${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);
    console.log(`${BOLD}  Round ${round}/${rounds}${RESET}`);
    console.log(`${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}\n`);

    for (const model of models) {
      console.log(`${model.color}${BOLD}▸ ${model.name}'s turn${RESET}`);

      const otherNames = models.filter((m) => m.name !== model.name).map((m) => m.name);
      const prompt = buildTurnPrompt(model.name, otherNames, round, rounds, seed);

      try {
        const output = await runCLITurn(model, prompt, mcpConfigPath);
        if (output) {
          // Print output with model's color, indented
          const lines = output.split("\n").map((l) => `${model.color}  ${l}${RESET}`).join("\n");
          console.log(lines);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`${model.color}  [${model.name}] Error: ${msg}${RESET}`);
      }

      console.log();
    }

    // Show brain state after each round
    const state = brain.reflect(10);
    const totalNodes = (db.prepare("SELECT COUNT(*) as count FROM nodes").get() as { count: number }).count;
    const totalAssocs = (db.prepare("SELECT COUNT(*) as count FROM associations").get() as { count: number }).count;
    console.log(`${DIM}  Brain: ${totalNodes} concepts, ${totalAssocs} associations${RESET}`);
  }

  // Final summary
  console.log(`\n${BOLD}${"═".repeat(50)}${RESET}`);
  console.log(`${BOLD}  Final Brain State after ${rounds} rounds${RESET}`);
  console.log(`${BOLD}${"═".repeat(50)}${RESET}`);
  printBrainState(brain, db);

  // Cleanup
  db.close();
  fs.unlinkSync(mcpConfigPath);
  console.log(`\n${DIM}Database saved to: ${dbPath}${RESET}`);
  console.log(`${DIM}Re-run to continue building on this brain, or delete the db to start fresh.${RESET}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
