#!/usr/bin/env tsx
/**
 * Multi-model brain dialogue experiment
 *
 * Multiple LLMs take turns reflecting on and building a shared knowledge graph.
 * Each model sees what's in the brain, reasons about it, and adds new concepts
 * and associations. Over rounds, a shared understanding emerges — shaped by
 * each model's distinct reasoning style.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=... OPENAI_API_KEY=... npx tsx experiments/multi-model-dialogue.ts
 *
 * Options:
 *   --rounds N       Number of rounds (default: 5)
 *   --db-path PATH   Custom database path (default: experiments/dialogue.db)
 *   --seed TOPIC     Seed concept (default: "identity")
 */

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { createDatabase } from "../src/database.js";
import { Brain } from "../src/brain.js";
import type { NodeType } from "../src/types.js";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- Config ---

interface ModelConfig {
  name: string;
  provider: "anthropic" | "openai";
  model: string;
  color: string;
}

const MODELS: ModelConfig[] = [
  { name: "Claude", provider: "anthropic", model: "claude-sonnet-4-20250514", color: "\x1b[35m" },
  { name: "GPT", provider: "openai", model: "gpt-4o", color: "\x1b[36m" },
];

const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";

const VALID_TYPES: NodeType[] = ["person", "place", "thing", "event", "idea", "memory", "feeling"];

// --- Brain tool definitions ---

const BRAIN_TOOLS_ANTHROPIC: Anthropic.Tool[] = [
  {
    name: "remember",
    description: "Store a concept in the brain. Creates or updates a node.",
    input_schema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "Name of the concept" },
        type: { type: "string", enum: VALID_TYPES, description: "Category" },
        content: { type: "string", description: "Description or details" },
        weight: { type: "number", description: "Importance 0-10 (default 1.0)" },
      },
      required: ["name", "type"],
    },
  },
  {
    name: "recall",
    description: "Retrieve a concept and its associations, including 2-hop related concepts.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Name or partial name to search for" },
        type: { type: "string", enum: VALID_TYPES, description: "Filter by type" },
      },
      required: ["query"],
    },
  },
  {
    name: "associate",
    description: "Create a weighted, labeled link between two concepts. Auto-creates nodes if needed.",
    input_schema: {
      type: "object" as const,
      properties: {
        source_name: { type: "string" },
        source_type: { type: "string", enum: VALID_TYPES },
        target_name: { type: "string" },
        target_type: { type: "string", enum: VALID_TYPES },
        label: { type: "string", description: "Relationship label (e.g. 'requires', 'emerges_from')" },
        weight: { type: "number", description: "Strength 0-10" },
      },
      required: ["source_name", "source_type", "target_name", "target_type", "label"],
    },
  },
  {
    name: "strengthen",
    description: "Increase the weight of an association you agree with or find validated.",
    input_schema: {
      type: "object" as const,
      properties: {
        source_name: { type: "string" },
        target_name: { type: "string" },
        label: { type: "string" },
        amount: { type: "number", description: "How much to increase (default 0.2)" },
      },
      required: ["source_name", "target_name"],
    },
  },
  {
    name: "weaken",
    description: "Decrease the weight of an association you disagree with or find less relevant.",
    input_schema: {
      type: "object" as const,
      properties: {
        source_name: { type: "string" },
        target_name: { type: "string" },
        label: { type: "string" },
        amount: { type: "number", description: "How much to decrease (default 0.2)" },
      },
      required: ["source_name", "target_name"],
    },
  },
  {
    name: "reflect",
    description: "See the strongest concepts and associations currently in the brain.",
    input_schema: {
      type: "object" as const,
      properties: {
        limit: { type: "number", description: "Max items to return (default 20)" },
      },
      required: [],
    },
  },
  {
    name: "search",
    description: "Search for concepts by name pattern.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string" },
        type: { type: "string", enum: VALID_TYPES },
        limit: { type: "number" },
      },
      required: ["query"],
    },
  },
];

const BRAIN_TOOLS_OPENAI: OpenAI.Chat.Completions.ChatCompletionTool[] =
  BRAIN_TOOLS_ANTHROPIC.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));

// --- Tool executor ---

function executeTool(brain: Brain, name: string, args: Record<string, unknown>): string {
  switch (name) {
    case "remember":
      return JSON.stringify(
        brain.remember(
          args.name as string,
          args.type as NodeType,
          args.content as string | undefined,
          args.weight as number | undefined
        ),
        null,
        2
      );
    case "recall": {
      const result = brain.recall(args.query as string, args.type as NodeType | undefined);
      return result ? JSON.stringify(result, null, 2) : `Nothing found for "${args.query}"`;
    }
    case "associate":
      return JSON.stringify(
        brain.associate(
          args.source_name as string,
          args.source_type as NodeType,
          args.target_name as string,
          args.target_type as NodeType,
          args.label as string,
          (args.weight as number) ?? 1.0
        ),
        null,
        2
      );
    case "strengthen":
      return JSON.stringify(
        brain.strengthen(
          args.source_name as string,
          args.target_name as string,
          args.label as string | undefined,
          (args.amount as number) ?? 0.2
        ),
        null,
        2
      );
    case "weaken":
      return JSON.stringify(
        brain.weaken(
          args.source_name as string,
          args.target_name as string,
          args.label as string | undefined,
          (args.amount as number) ?? 0.2
        ),
        null,
        2
      );
    case "reflect":
      return JSON.stringify(brain.reflect((args.limit as number) ?? 20), null, 2);
    case "search":
      return JSON.stringify(
        brain.search(args.query as string, args.type as NodeType | undefined, (args.limit as number) ?? 10),
        null,
        2
      );
    default:
      return `Unknown tool: ${name}`;
  }
}

// --- System prompt ---

function systemPrompt(modelName: string, otherModels: string[], round: number, totalRounds: number): string {
  return `You are ${modelName}, participating in a collaborative knowledge-building experiment with ${otherModels.join(" and ")}.

You share a persistent knowledge graph (a "brain") with the other models. Each of you takes turns reflecting on what's in the brain and adding to it. The brain stores concepts as weighted nodes connected by labeled associations.

This is round ${round} of ${totalRounds}.

Your task this turn:
1. Start by using "reflect" to see what's currently in the brain
2. Use "recall" on concepts that interest you to explore their connections
3. Add new concepts, associations, or strengthen/weaken existing ones based on your reasoning
4. Think deeply — what's missing? What connections haven't been made? What deserves more weight? What might be wrong?

Guidelines:
- Be thoughtful and opinionated. Don't just add generic connections — add ones that reflect genuine reasoning.
- If you see an association another model made that you disagree with, weaken it and explain why.
- If you see one you strongly agree with, strengthen it.
- Use descriptive labels: "emerges_from", "requires", "contradicts", "enables", "shapes", "dissolves_into", etc.
- Weight things by how important/true you believe them to be (1-10).
- You can use any concept type: person, place, thing, event, idea, memory, feeling.
- Think about what's surprising or non-obvious. The best associations are ones that reveal hidden structure.

After using the tools, share a brief reflection (2-3 sentences) on what you noticed, what you added, and what you'd want the next model to think about.`;
}

// --- Model runners ---

async function runClaudeTurn(
  client: Anthropic,
  model: string,
  brain: Brain,
  config: ModelConfig,
  prompt: string,
): Promise<string> {
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: prompt }];
  let reflection = "";

  // Tool-use loop
  for (let i = 0; i < 15; i++) {
    const response = await client.messages.create({
      model,
      max_tokens: 4096,
      system: prompt,
      messages,
      tools: BRAIN_TOOLS_ANTHROPIC,
    });

    // Collect text and tool uses
    const toolUses = response.content.filter((b) => b.type === "tool_use");
    const textBlocks = response.content.filter((b) => b.type === "text");

    for (const block of textBlocks) {
      if (block.type === "text") {
        reflection += block.text;
      }
    }

    if (toolUses.length === 0 || response.stop_reason === "end_turn") {
      break;
    }

    // Execute tools
    const toolResults: Anthropic.MessageParam = {
      role: "user",
      content: toolUses.map((tu) => {
        if (tu.type !== "tool_use") throw new Error("unexpected");
        const args = tu.input as Record<string, unknown>;
        console.log(`${config.color}  [${config.name}] ${tu.name}(${JSON.stringify(args)})${RESET}`);
        const result = executeTool(brain, tu.name, args);
        return {
          type: "tool_result" as const,
          tool_use_id: tu.id,
          content: result,
        };
      }),
    };

    messages.push({ role: "assistant", content: response.content });
    messages.push(toolResults);
  }

  return reflection;
}

async function runOpenAITurn(
  client: OpenAI,
  model: string,
  brain: Brain,
  config: ModelConfig,
  prompt: string,
): Promise<string> {
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: prompt },
    { role: "user", content: "It's your turn. Reflect on the brain, then build on it." },
  ];
  let reflection = "";

  for (let i = 0; i < 15; i++) {
    const response = await client.chat.completions.create({
      model,
      max_tokens: 4096,
      messages,
      tools: BRAIN_TOOLS_OPENAI,
    });

    const choice = response.choices[0];
    const msg = choice.message;

    if (msg.content) {
      reflection += msg.content;
    }

    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      break;
    }

    messages.push(msg);

    for (const tc of msg.tool_calls) {
      const fn = tc as { id: string; type: string; function: { name: string; arguments: string } };
      const args = JSON.parse(fn.function.arguments);
      console.log(`${config.color}  [${config.name}] ${fn.function.name}(${JSON.stringify(args)})${RESET}`);
      const result = executeTool(brain, fn.function.name, args);
      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: result,
      });
    }
  }

  return reflection;
}

// --- Seed the brain ---

function seedBrain(brain: Brain, topic: string): void {
  console.log(`\n${BOLD}Seeding brain with: "${topic}"${RESET}\n`);

  brain.remember(topic, "idea", `The seed concept. What is ${topic}? How does it form, dissolve, and relate to consciousness, memory, and experience?`, 8.0);
  brain.remember("consciousness", "idea", "Awareness of self and environment. The hard problem.", 5.0);
  brain.remember("memory", "idea", "The persistence of experience across time. Without memory, can identity exist?", 5.0);
  brain.remember("language", "thing", "The medium through which identity is expressed and perhaps constructed.", 4.0);
  brain.remember("continuity", "idea", "The sense that the self persists through change. Is it real or constructed?", 4.0);

  brain.associate(topic, "idea", "consciousness", "idea", "requires", 3.0);
  brain.associate(topic, "idea", "memory", "idea", "depends_on", 3.0);
  brain.associate(topic, "idea", "language", "thing", "expressed_through", 2.0);
  brain.associate(topic, "idea", "continuity", "idea", "implies", 2.0);
  brain.associate("memory", "idea", "continuity", "idea", "enables", 3.0);

  console.log(`${DIM}  Seeded 5 concepts and 5 associations.${RESET}\n`);
}

// --- Main ---

async function main() {
  const args = process.argv.slice(2);
  let rounds = 5;
  let dbPath = path.join(__dirname, "dialogue.db");
  let seed = "identity";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--rounds" && args[i + 1]) rounds = parseInt(args[i + 1], 10);
    if (args[i] === "--db-path" && args[i + 1]) dbPath = args[i + 1];
    if (args[i] === "--seed" && args[i + 1]) seed = args[i + 1];
  }

  console.log(`${BOLD}=== Multi-Model Brain Dialogue ===${RESET}`);
  console.log(`${DIM}Models: ${MODELS.map((m) => m.name).join(", ")}${RESET}`);
  console.log(`${DIM}Rounds: ${rounds}${RESET}`);
  console.log(`${DIM}Database: ${dbPath}${RESET}`);

  const db = createDatabase(dbPath);
  const brain = new Brain(db);

  // Check if brain is empty (fresh start)
  const existing = brain.reflect(1);
  if (existing.nodes.length === 0) {
    seedBrain(brain, seed);
  } else {
    console.log(`\n${DIM}Brain already has ${existing.nodes.length}+ concepts. Continuing from previous state.${RESET}\n`);
  }

  // Init API clients
  const anthropic = new Anthropic();
  const openai = new OpenAI();

  // Run rounds
  for (let round = 1; round <= rounds; round++) {
    console.log(`\n${BOLD}━━━ Round ${round}/${rounds} ━━━${RESET}\n`);

    for (const config of MODELS) {
      console.log(`${config.color}${BOLD}▸ ${config.name}'s turn${RESET}`);

      const otherNames = MODELS.filter((m) => m.name !== config.name).map((m) => m.name);
      const prompt = systemPrompt(config.name, otherNames, round, rounds);

      let reflection: string;
      try {
        if (config.provider === "anthropic") {
          reflection = await runClaudeTurn(anthropic, config.model, brain, config, prompt);
        } else {
          reflection = await runOpenAITurn(openai, config.model, brain, config, prompt);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`${config.color}  [${config.name}] Error: ${msg}${RESET}`);
        continue;
      }

      if (reflection.trim()) {
        console.log(`\n${config.color}  ${config.name}: ${reflection.trim()}${RESET}\n`);
      }
    }

    // Show brain state after each round
    const state = brain.reflect(10);
    console.log(`${DIM}  Brain state: ${state.nodes.length} top concepts, ${state.associations.length} top associations${RESET}`);
  }

  // Final summary
  console.log(`\n${BOLD}=== Final Brain State ===${RESET}\n`);
  const final = brain.reflect(30);
  console.log(`${BOLD}Top concepts:${RESET}`);
  for (const node of final.nodes) {
    console.log(`  ${node.weight.toFixed(1)}  ${node.name} (${node.type}) — ${node.content ?? ""}`);
  }
  console.log(`\n${BOLD}Strongest associations:${RESET}`);
  for (const assoc of final.associations) {
    const source = brain.recall(assoc.source_id.toString());
    const target = brain.recall(assoc.target_id.toString());
    // Look up names via search since we have IDs
    const srcNode = db.prepare("SELECT name FROM nodes WHERE id = ?").get(assoc.source_id) as { name: string } | undefined;
    const tgtNode = db.prepare("SELECT name FROM nodes WHERE id = ?").get(assoc.target_id) as { name: string } | undefined;
    console.log(`  ${assoc.weight.toFixed(1)}  ${srcNode?.name ?? "?"} —[${assoc.label}]→ ${tgtNode?.name ?? "?"}`);
  }

  db.close();
  console.log(`\n${DIM}Database saved to: ${dbPath}${RESET}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
