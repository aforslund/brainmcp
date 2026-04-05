#!/usr/bin/env node

import Anthropic from "@anthropic-ai/sdk";
import { createDatabase } from "./database.js";
import { Brain } from "./brain.js";
import type { NodeType } from "./types.js";
import { writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- CLI ---
const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log(`Usage: npm run explore -- --key <ANTHROPIC_API_KEY> "<concept>" [iterations] [model]`);
  console.log(`\n  --key:      Anthropic API key (required)`);
  console.log(`  concept:    Topic to explore (default: "How global monetary policy actually works")`);
  console.log(`  iterations: Number of research passes (default: 10)`);
  console.log(`  model:      Claude model ID (default: claude-sonnet-4-6)`);
  process.exit(0);
}

// Extract --key flag
const keyIdx = args.indexOf("--key");
let apiKey: string | undefined;
if (keyIdx !== -1 && keyIdx + 1 < args.length) {
  apiKey = args[keyIdx + 1];
  args.splice(keyIdx, 2);
}

if (!apiKey) {
  console.error("Error: --key <ANTHROPIC_API_KEY> is required.\n");
  console.error(`Usage: npm run explore -- --key <YOUR_KEY> "topic" [iterations] [model]`);
  process.exit(1);
}

const concept = args[0] || "How global monetary policy actually works";
const iterations = parseInt(args[1] || "10", 10);
const model = args[2] || "claude-sonnet-4-6";

const slug = concept
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "")
  .slice(0, 50);
const dbPath = path.join(__dirname, "..", `explore-${slug}.db`);
const outPath = path.join(__dirname, "..", `explore-${slug}.html`);

console.log(`\nBrainMCP Explorer`);
console.log(`  Concept:    ${concept}`);
console.log(`  Iterations: ${iterations}`);
console.log(`  Model:      ${model}`);
console.log(`  Database:   ${dbPath}`);
console.log(`  Output:     ${outPath}\n`);

const db = createDatabase(dbPath);
const brain = new Brain(db);
const client = new Anthropic({ apiKey: apiKey });

// --- Tool definitions ---
const brainTools: Anthropic.Messages.Tool[] = [
  {
    name: "remember",
    description:
      "Store a concept in the knowledge graph. Creates or updates a node.",
    input_schema: {
      type: "object" as const,
      properties: {
        name: {
          type: "string",
          description: "Concept name (concise but specific)",
        },
        type: {
          type: "string",
          enum: [
            "person",
            "place",
            "thing",
            "event",
            "idea",
            "memory",
            "feeling",
          ],
        },
        content: { type: "string", description: "Description or details" },
        weight: { type: "number", description: "Importance 0-10" },
      },
      required: ["name", "type"],
    },
  },
  {
    name: "associate",
    description:
      "Create a labeled, weighted link between two concepts. Auto-creates nodes if they don't exist.",
    input_schema: {
      type: "object" as const,
      properties: {
        source_name: { type: "string" },
        source_type: {
          type: "string",
          enum: [
            "person",
            "place",
            "thing",
            "event",
            "idea",
            "memory",
            "feeling",
          ],
        },
        target_name: { type: "string" },
        target_type: {
          type: "string",
          enum: [
            "person",
            "place",
            "thing",
            "event",
            "idea",
            "memory",
            "feeling",
          ],
        },
        label: {
          type: "string",
          description:
            "Relationship label (e.g. 'controls', 'funds', 'amplifies', 'constrains')",
        },
        weight: { type: "number", description: "Strength 0-10" },
      },
      required: [
        "source_name",
        "source_type",
        "target_name",
        "target_type",
        "label",
      ],
    },
  },
  {
    name: "recall",
    description:
      "Retrieve a concept and all its associations, plus 2-hop related concepts.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string" },
      },
      required: ["query"],
    },
  },
  {
    name: "reflect",
    description:
      "See the highest-weighted concepts and associations currently in the brain.",
    input_schema: {
      type: "object" as const,
      properties: {
        limit: { type: "number" },
      },
    },
  },
  {
    name: "search_brain",
    description: "Search for concepts by name pattern.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string" },
      },
      required: ["query"],
    },
  },
  {
    name: "strengthen",
    description: "Increase weight of an association that has been validated.",
    input_schema: {
      type: "object" as const,
      properties: {
        source_name: { type: "string" },
        target_name: { type: "string" },
        label: { type: "string" },
        amount: { type: "number" },
      },
      required: ["source_name", "target_name"],
    },
  },
];

const allTools = [
  {
    type: "web_search_20250305" as const,
    name: "web_search" as const,
    max_uses: 5,
  },
  ...brainTools,
];

// --- Tool executor ---
const customToolNames = new Set(brainTools.map((t) => t.name));

function executeTool(name: string, input: Record<string, unknown>): string {
  try {
    switch (name) {
      case "remember":
        return JSON.stringify(
          brain.remember(
            input.name as string,
            input.type as NodeType,
            input.content as string | undefined,
            input.weight as number | undefined
          )
        );
      case "associate":
        return JSON.stringify(
          brain.associate(
            input.source_name as string,
            input.source_type as NodeType,
            input.target_name as string,
            input.target_type as NodeType,
            input.label as string,
            input.weight as number | undefined
          )
        );
      case "recall": {
        const r = brain.recall(input.query as string, input.type as NodeType | undefined);
        return JSON.stringify(r ?? { message: "Nothing found" });
      }
      case "reflect":
        return JSON.stringify(brain.reflect((input.limit as number) ?? 30));
      case "search_brain":
        return JSON.stringify(
          brain.search(input.query as string, input.type as NodeType | undefined)
        );
      case "strengthen": {
        const s = brain.strengthen(
          input.source_name as string,
          input.target_name as string,
          input.label as string | undefined,
          input.amount as number | undefined
        );
        return JSON.stringify(s ?? { message: "Association not found" });
      }
      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
  } catch (err: unknown) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

// --- System prompt ---
const SYSTEM = `You are a researcher building a comprehensive knowledge graph about a specific topic.

Tools available:
- remember: store concepts (nodes) in the graph
- associate: create labeled, weighted edges between concepts
- recall: retrieve a concept with its connections
- reflect: see the current highest-weighted concepts and associations
- search_brain: find concepts by name
- strengthen: increase weight of validated associations
- web_search: search the web for real information

Your goal: build an accurate, richly interconnected graph that reveals HOW things actually work — real mechanisms, causal chains, feedback loops, and non-obvious relationships.

Rules:
- ALWAYS search the web before adding concepts — get real facts, mechanisms, and data
- Use specific association labels: 'sets', 'controls', 'amplifies', 'constrains', 'funds', 'denominates', 'backs', 'influences', 'triggers', 'enables', 'undermines', 'measures', 'targets', 'depends_on', 'inversely_correlates', 'hedges_against', 'regulates', 'issues', 'trades_in'
- Weight concepts by centrality (1-10): core mechanisms 7-9, supporting 4-6, peripheral 1-3
- Weight associations by strength/directness (1-10)
- Keep names concise: "Federal Funds Rate" not "The federal funds rate set by the Fed"
- Node types: 'idea' for concepts/mechanisms, 'thing' for institutions/instruments/currencies, 'person' for key figures, 'event' for historical events, 'place' for countries/regions
- Focus on HOW and WHY — the graph should explain mechanisms, not just catalog terms
- Look for feedback loops and circular dependencies — these are the most valuable discoveries
- Each iteration: build on what's already there, don't repeat, go deeper and wider`;

// --- Iteration runner ---
async function runIteration(i: number): Promise<number> {
  const phaseFrac = i / iterations;
  const phase =
    phaseFrac <= 0.25
      ? "PHASE: Foundation — establish the core building blocks. What are the fundamental concepts, institutions, and mechanisms?"
      : phaseFrac <= 0.6
        ? "PHASE: Deepening — explore how mechanisms interact. Find cause-and-effect chains, feedback loops, and dependencies between existing concepts."
        : phaseFrac <= 0.85
          ? "PHASE: Connections — find non-obvious cross-cutting relationships. How do seemingly distant concepts affect each other through indirect paths?"
          : "PHASE: Synthesis — strengthen the most important connections. Fill remaining gaps. Look for emergent patterns and feedback loops in the graph.";

  const prompt = `Iteration ${i}/${iterations} — Topic: "${concept}"

${phase}

Steps:
1. Use 'reflect' to see what's currently in the brain
2. Identify the biggest gap or most interesting unexplored area
3. Search the web for real mechanisms and accurate information about it
4. Add 4-8 new concepts with 'remember' (with descriptive content)
5. Create 6-12 associations with 'associate' — link new concepts to EXISTING ones, not just to each other
6. Use 'recall' on 1-2 existing hub concepts to discover new cross-connections

Be thorough. Research deeply. Find the real mechanisms.`;

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: prompt },
  ];

  let toolCalls = 0;

  for (let round = 0; round < 25; round++) {
    const response = await client.messages.create({
      model,
      max_tokens: 16000,
      system: SYSTEM,
      tools: allTools as Anthropic.MessageCreateParams["tools"],
      messages,
    });

    messages.push({ role: "assistant", content: response.content });

    // Print any text output (truncated)
    for (const block of response.content) {
      if ("type" in block && block.type === "text" && "text" in block) {
        const text = (block.text as string).trim();
        if (text) {
          const lines = text.split("\n").slice(0, 3);
          for (const line of lines) {
            console.log(
              `  ${line.slice(0, 120)}${line.length > 120 ? "..." : ""}`
            );
          }
        }
      }
    }

    // Find custom tool calls (not server-handled web_search)
    const customCalls = response.content.filter(
      (b): b is Anthropic.ContentBlock & { type: "tool_use"; id: string; name: string; input: Record<string, unknown> } =>
        "type" in b && b.type === "tool_use" && "name" in b && customToolNames.has((b as any).name)
    );

    if (customCalls.length === 0) {
      if (response.stop_reason === "end_turn") break;
      if (response.stop_reason !== "tool_use") break;
      // Only server tools were called — API handled them, but we might need another round
      // If stop_reason is still tool_use with no custom calls, something unexpected happened
      break;
    }

    const results: Anthropic.MessageParam = {
      role: "user",
      content: customCalls.map((call) => {
        toolCalls++;
        const result = executeTool(call.name, call.input);
        return {
          type: "tool_result" as const,
          tool_use_id: call.id,
          content: result,
        };
      }),
    };

    messages.push(results);
  }

  return toolCalls;
}

// --- Main ---
async function main() {
  const startTotal = Date.now();

  for (let i = 1; i <= iterations; i++) {
    const startIter = Date.now();
    console.log(`\n--- Iteration ${i}/${iterations} ---`);

    try {
      const calls = await runIteration(i);
      const elapsed = ((Date.now() - startIter) / 1000).toFixed(1);

      const nodeCount = (
        db.prepare("SELECT COUNT(*) as c FROM nodes").get() as { c: number }
      ).c;
      const edgeCount = (
        db.prepare("SELECT COUNT(*) as c FROM associations").get() as {
          c: number;
        }
      ).c;
      console.log(
        `  => ${calls} brain tool calls | ${nodeCount} nodes, ${edgeCount} edges | ${elapsed}s`
      );
    } catch (err: unknown) {
      const error = err as Error & { status?: number };
      console.error(`  Error: ${error.message}`);
      if (error.status === 429) {
        console.log("  Rate limited — waiting 60s...");
        await new Promise((r) => setTimeout(r, 60000));
        i--; // retry
      }
    }
  }

  const totalElapsed = ((Date.now() - startTotal) / 1000).toFixed(0);
  const finalNodes = (
    db.prepare("SELECT COUNT(*) as c FROM nodes").get() as { c: number }
  ).c;
  const finalEdges = (
    db.prepare("SELECT COUNT(*) as c FROM associations").get() as {
      c: number;
    }
  ).c;

  console.log(`\n========================================`);
  console.log(`  Final: ${finalNodes} nodes, ${finalEdges} edges (${totalElapsed}s total)`);
  console.log(`========================================`);

  // --- Analysis phase ---
  console.log(`\n--- Analyzing graph for insights ---`);
  const analysis = await analyzeGraph();
  console.log(`\n${analysis}`);

  // Write analysis to markdown file
  const analysisPath = path.join(__dirname, "..", `explore-${slug}-analysis.md`);
  writeFileSync(analysisPath, `# Analysis: ${concept}\n\n${analysis}\n`);
  console.log(`\nAnalysis written to ${analysisPath}`);

  generateViz(analysis);
  console.log(`Visualization written to ${outPath}`);
  console.log(`Open it in your browser to explore the graph.`);
}

// --- Analysis ---
async function analyzeGraph(): Promise<string> {
  const nodes = db
    .prepare("SELECT id, name, type, content, weight FROM nodes ORDER BY weight DESC")
    .all() as { id: number; name: string; type: string; content: string | null; weight: number }[];
  const edges = db
    .prepare(`
      SELECT a.source_id, a.target_id, a.label, a.weight,
             s.name as source_name, t.name as target_name
      FROM associations a
      JOIN nodes s ON s.id = a.source_id
      JOIN nodes t ON t.id = a.target_id
      ORDER BY a.weight DESC
    `)
    .all() as { source_id: number; target_id: number; label: string; weight: number; source_name: string; target_name: string }[];

  // Compute graph metrics
  const degreeMap = new Map<number, number>();
  for (const e of edges) {
    degreeMap.set(e.source_id, (degreeMap.get(e.source_id) || 0) + 1);
    degreeMap.set(e.target_id, (degreeMap.get(e.target_id) || 0) + 1);
  }

  const hubNodes = nodes
    .map((n) => ({ ...n, degree: degreeMap.get(n.id) || 0 }))
    .sort((a, b) => b.degree - a.degree)
    .slice(0, 10);

  // Find potential feedback loops (nodes that appear as both source and target to the same cluster)
  const edgeList = edges.map((e) => `  ${e.source_name} --[${e.label}, w=${e.weight}]--> ${e.target_name}`).join("\n");
  const nodeList = nodes.map((n) => `  ${n.name} (${n.type}, w=${n.weight})${n.content ? `: ${n.content.slice(0, 100)}` : ""}`).join("\n");
  const hubList = hubNodes.map((n) => `  ${n.name}: ${n.degree} connections, weight ${n.weight}`).join("\n");

  const analysisPrompt = `You have built a knowledge graph about: "${concept}"

Here is the complete graph:

NODES (${nodes.length} total):
${nodeList}

ASSOCIATIONS (${edges.length} total):
${edgeList}

HUB NODES (most connected):
${hubList}

Analyze this graph and produce a structured report with these sections:

## Key Findings
The 3-5 most important things this graph reveals about the topic. Not summaries — insights that emerge from seeing the connections.

## Feedback Loops
Identify circular chains where A affects B affects C affects A. These are the most important structural features. Trace each loop step by step.

## Surprising Connections
What non-obvious relationships exist? What concepts are connected that you wouldn't expect? What does this tell us?

## Central Mechanisms
Based on hub analysis, what are the most important mechanisms? Why do they have so many connections? What would happen if they changed?

## Contradictions & Tensions
Are there associations that pull in opposite directions? Competing mechanisms? Unresolved tensions in the data?

## Hypotheses
Based on the graph structure, what predictions or hypotheses can you generate? What would you investigate next?

Be specific. Reference actual nodes and edges. Draw real conclusions from the structure.`;

  const response = await client.messages.create({
    model,
    max_tokens: 8000,
    messages: [{ role: "user", content: analysisPrompt }],
  });

  const textBlocks = response.content.filter(
    (b): b is Anthropic.TextBlock => b.type === "text"
  );
  return textBlocks.map((b) => b.text).join("\n");
}

// --- Visualization (inline) ---
function generateViz(analysis?: string) {
  const nodes = db
    .prepare("SELECT id, name, type, content, weight FROM nodes")
    .all() as { id: number; name: string; type: string; content: string | null; weight: number }[];
  const edges = db
    .prepare("SELECT source_id, target_id, label, weight FROM associations")
    .all() as { source_id: number; target_id: number; label: string; weight: number }[];

  const graphData = JSON.stringify({
    nodes: nodes.map((n) => ({
      id: n.id,
      name: n.name,
      type: n.type,
      content: n.content,
      weight: n.weight,
    })),
    links: edges.map((e) => ({
      source: e.source_id,
      target: e.target_id,
      label: e.label,
      weight: e.weight,
    })),
  });

  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  // Convert markdown-ish analysis to simple HTML
  const analysisHtml = analysis
    ? analysis
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/^## (.+)$/gm, '<h2>$1</h2>')
        .replace(/^### (.+)$/gm, '<h3>$1</h3>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\n\n/g, '</p><p>')
        .replace(/\n/g, '<br>')
    : "";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>BrainMCP: ${esc(concept)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #0a0a0f; color: #e0e0e0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace; overflow: hidden; }
  svg { display: block; width: 100vw; height: 100vh; }
  .link-line { stroke-opacity: 0.5; }
  .link-label { font-size: 9px; fill: #888; pointer-events: none; }
  .node-label { font-size: 11px; fill: #e0e0e0; pointer-events: none; font-weight: 600; }
  .tooltip {
    position: absolute; background: #1a1a2e; border: 1px solid #333;
    border-radius: 6px; padding: 10px 14px; font-size: 12px;
    max-width: 320px; pointer-events: none; display: none;
    box-shadow: 0 4px 20px rgba(0,0,0,0.5); line-height: 1.5;
  }
  .tooltip .tt-name { font-weight: 700; font-size: 14px; margin-bottom: 4px; }
  .tooltip .tt-type { color: #888; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
  .tooltip .tt-weight { color: #aaa; font-size: 11px; margin-top: 2px; }
  .tooltip .tt-content { margin-top: 6px; color: #ccc; border-top: 1px solid #333; padding-top: 6px; }
  #legend {
    position: absolute; top: 16px; left: 16px; background: #1a1a2e; border: 1px solid #333;
    border-radius: 6px; padding: 12px 16px; font-size: 12px;
  }
  #legend h3 { font-size: 13px; margin-bottom: 8px; color: #fff; }
  .legend-item { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
  .legend-dot { width: 10px; height: 10px; border-radius: 50%; }
  #title {
    position: absolute; top: 16px; left: 50%; transform: translateX(-50%);
    background: #1a1a2e; border: 1px solid #333; border-radius: 6px;
    padding: 10px 20px; font-size: 14px; font-weight: 700; color: #fff;
    max-width: 70vw; text-align: center; line-height: 1.4;
  }
  #stats {
    position: absolute; bottom: 16px; left: 16px; background: #1a1a2e; border: 1px solid #333;
    border-radius: 6px; padding: 10px 14px; font-size: 11px; color: #888;
  }
  #analysis-toggle {
    position: absolute; top: 16px; right: 16px; background: #1a1a2e; border: 1px solid #333;
    border-radius: 6px; padding: 8px 16px; font-size: 12px; color: #fff;
    cursor: pointer; z-index: 10; font-family: inherit;
  }
  #analysis-toggle:hover { background: #252545; }
  #analysis-panel {
    position: absolute; top: 56px; right: 16px; bottom: 16px; width: 420px;
    background: #1a1a2e; border: 1px solid #333; border-radius: 6px;
    padding: 20px 24px; font-size: 13px; overflow-y: auto; display: none;
    line-height: 1.6; z-index: 10;
  }
  #analysis-panel.visible { display: block; }
  #analysis-panel h2 { color: #a78bfa; font-size: 16px; margin: 20px 0 8px 0; border-bottom: 1px solid #333; padding-bottom: 4px; }
  #analysis-panel h2:first-child { margin-top: 0; }
  #analysis-panel h3 { color: #60a5fa; font-size: 14px; margin: 14px 0 6px 0; }
  #analysis-panel p { margin: 8px 0; color: #ccc; }
  #analysis-panel strong { color: #e0e0e0; }
</style>
</head>
<body>
<div class="tooltip" id="tooltip"></div>
<div id="legend"></div>
<div id="title">${esc(concept)}</div>
<div id="stats"></div>
${analysisHtml ? `<button id="analysis-toggle" onclick="document.getElementById('analysis-panel').classList.toggle('visible')">Analysis</button>
<div id="analysis-panel"><p>${analysisHtml}</p></div>` : ""}
<svg id="graph"></svg>
<script src="https://d3js.org/d3.v7.min.js"></script>
<script>
const data = ${graphData};

const typeColors = {
  person: "#f472b6", place: "#60a5fa", thing: "#34d399",
  event: "#fbbf24", idea: "#a78bfa", memory: "#fb923c", feeling: "#f87171"
};

const legend = document.getElementById("legend");
const usedTypes = [...new Set(data.nodes.map(n => n.type))];
legend.innerHTML = "<h3>Node Types</h3>" +
  usedTypes.map(t =>
    '<div class="legend-item"><div class="legend-dot" style="background:' + typeColors[t] + '"></div>' + t + '</div>'
  ).join("");

document.getElementById("stats").textContent =
  data.nodes.length + " concepts, " + data.links.length + " associations";

const width = window.innerWidth;
const height = window.innerHeight;

const svg = d3.select("#graph").attr("viewBox", [0, 0, width, height]);
const g = svg.append("g");

svg.call(d3.zoom().scaleExtent([0.1, 8]).on("zoom", (e) => g.attr("transform", e.transform)));

const simulation = d3.forceSimulation(data.nodes)
  .force("link", d3.forceLink(data.links).id(d => d.id).distance(d => 120 - d.weight * 5))
  .force("charge", d3.forceManyBody().strength(-300))
  .force("center", d3.forceCenter(width / 2, height / 2))
  .force("collision", d3.forceCollide().radius(d => 10 + d.weight * 1.5));

svg.append("defs").selectAll("marker")
  .data(Object.entries(typeColors))
  .join("marker")
    .attr("id", d => "arrow-" + d[0])
    .attr("viewBox", "0 -5 10 10")
    .attr("refX", 20).attr("refY", 0)
    .attr("markerWidth", 6).attr("markerHeight", 6)
    .attr("orient", "auto")
  .append("path")
    .attr("fill", d => d[1])
    .attr("fill-opacity", 0.6)
    .attr("d", "M0,-5L10,0L0,5");

const link = g.append("g").selectAll("line")
  .data(data.links).join("line")
  .attr("class", "link-line")
  .attr("stroke", d => {
    const src = data.nodes.find(n => n.id === (d.source.id ?? d.source));
    return typeColors[src?.type] || "#555";
  })
  .attr("stroke-width", d => 0.5 + d.weight * 0.3)
  .attr("marker-end", d => {
    const src = data.nodes.find(n => n.id === (d.source.id ?? d.source));
    return "url(#arrow-" + (src?.type || "thing") + ")";
  });

const linkLabel = g.append("g").selectAll("text")
  .data(data.links).join("text")
  .attr("class", "link-label")
  .text(d => d.label);

const node = g.append("g").selectAll("circle")
  .data(data.nodes).join("circle")
  .attr("r", d => 5 + d.weight * 1.5)
  .attr("fill", d => typeColors[d.type] || "#888")
  .attr("stroke", "#0a0a0f")
  .attr("stroke-width", 1.5)
  .style("cursor", "grab")
  .call(d3.drag()
    .on("start", (e, d) => { if (!e.active) simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
    .on("drag", (e, d) => { d.fx = e.x; d.fy = e.y; })
    .on("end", (e, d) => { if (!e.active) simulation.alphaTarget(0); d.fx = null; d.fy = null; })
  );

const nodeLabel = g.append("g").selectAll("text")
  .data(data.nodes).join("text")
  .attr("class", "node-label")
  .attr("dx", d => 8 + d.weight)
  .attr("dy", "0.35em")
  .text(d => d.name);

const tooltip = document.getElementById("tooltip");

node.on("mouseover", (e, d) => {
  let html = '<div class="tt-name" style="color:' + (typeColors[d.type] || "#fff") + '">' + d.name + '</div>';
  html += '<div class="tt-type">' + d.type + '</div>';
  html += '<div class="tt-weight">weight: ' + d.weight + '</div>';
  if (d.content) html += '<div class="tt-content">' + d.content.replace(/\\n/g, "<br>") + '</div>';
  tooltip.innerHTML = html;
  tooltip.style.display = "block";
})
.on("mousemove", (e) => {
  tooltip.style.left = (e.pageX + 16) + "px";
  tooltip.style.top = (e.pageY - 16) + "px";
})
.on("mouseout", () => { tooltip.style.display = "none"; });

simulation.on("tick", () => {
  link
    .attr("x1", d => d.source.x).attr("y1", d => d.source.y)
    .attr("x2", d => d.target.x).attr("y2", d => d.target.y);
  linkLabel
    .attr("x", d => (d.source.x + d.target.x) / 2)
    .attr("y", d => (d.source.y + d.target.y) / 2);
  node.attr("cx", d => d.x).attr("cy", d => d.y);
  nodeLabel.attr("x", d => d.x).attr("y", d => d.y);
});
</script>
</body>
</html>`;

  writeFileSync(outPath, html);
}

// --- Run ---
main().catch((err) => {
  console.error("\nFatal error:", err.message);
  process.exit(1);
});
