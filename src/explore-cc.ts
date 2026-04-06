#!/usr/bin/env node

/**
 * BrainMCP Explorer — Claude Code edition
 *
 * Runs the explore pipeline using your Claude Code subscription (no API key needed).
 * Each iteration spawns `claude -p` with a dedicated brainmcp MCP server pointing
 * at an explore-specific database.
 *
 * Usage: npm run explore-cc -- "topic" [iterations]
 */

import { execFileSync } from "child_process";
import { writeFileSync, unlinkSync } from "fs";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- CLI ---
const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log(`Usage: npm run explore-cc -- "<concept>" [iterations]`);
  console.log(`\n  concept:    Topic to explore`);
  console.log(`  iterations: Number of research passes (default: 10)`);
  console.log(`\nUses your Claude Code subscription — no API key needed.`);
  process.exit(0);
}

const concept = args[0];
if (!concept) {
  console.error(`Error: concept is required.\n`);
  console.error(`Usage: npm run explore-cc -- "topic" [iterations]`);
  process.exit(1);
}

const iterations = parseInt(args[1] || "10", 10);

const slug = concept
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "")
  .slice(0, 50);
const dbPath = path.join(__dirname, "..", `explore-${slug}.db`);
const outPath = path.join(__dirname, "..", `explore-${slug}.html`);
const analysisPath = path.join(__dirname, "..", `explore-${slug}-analysis.md`);
const mcpConfigPath = path.join(__dirname, "..", `.explore-mcp-config.json`);

console.log(`\nBrainMCP Explorer (Claude Code)`);
console.log(`  Concept:    ${concept}`);
console.log(`  Iterations: ${iterations}`);
console.log(`  Database:   ${dbPath}`);
console.log(`  Output:     ${outPath}\n`);

// --- Write temp MCP config pointing brainmcp at the explore DB ---
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
  "WebSearch",
  "WebFetch",
].join(",");

// --- System prompt for each iteration ---
const systemPrompt = `You are a researcher building a comprehensive knowledge graph about a specific topic using the brainmcp tools.

Tools available:
- mcp__brainmcp__remember: store concepts (nodes) in the graph
- mcp__brainmcp__associate: create labeled, weighted edges between concepts
- mcp__brainmcp__recall: retrieve a concept with its connections
- mcp__brainmcp__reflect: see current highest-weighted concepts and associations
- mcp__brainmcp__search: find concepts by name
- mcp__brainmcp__strengthen: increase weight of validated associations
- WebSearch: search the web for real information

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

// --- Run iterations ---
function getPhase(i: number): string {
  const frac = i / iterations;
  if (frac <= 0.25) return "PHASE: Foundation — establish core concepts and mechanisms. What are the fundamental building blocks?";
  if (frac <= 0.6) return "PHASE: Deepening — explore how mechanisms interact. Find cause-and-effect chains and feedback loops.";
  if (frac <= 0.85) return "PHASE: Connections — find non-obvious cross-cutting relationships. How do distant concepts affect each other?";
  return "PHASE: Synthesis — strengthen important connections, fill gaps, identify emergent patterns.";
}

function getDbStats(): { nodes: number; edges: number } {
  try {
    const db = new Database(dbPath, { readonly: true });
    const nodes = (db.prepare("SELECT COUNT(*) as c FROM nodes").get() as { c: number }).c;
    const edges = (db.prepare("SELECT COUNT(*) as c FROM associations").get() as { c: number }).c;
    db.close();
    return { nodes, edges };
  } catch {
    return { nodes: 0, edges: 0 };
  }
}

function runIteration(i: number): void {
  const phase = getPhase(i);

  const prompt = `Iteration ${i}/${iterations} — Topic: "${concept}"

${phase}

Steps:
1. Use reflect to see what's currently in the brain
2. Identify the biggest gap or most interesting unexplored area
3. Search the web for real mechanisms and accurate information about it
4. Add 4-8 new concepts with remember (with descriptive content)
5. Create 6-12 associations with associate — link new concepts to EXISTING ones, not just to each other
6. Use recall on 1-2 existing hub concepts to discover new cross-connections

Be thorough. Research deeply. Find the real mechanisms.`;

  try {
    execFileSync("claude", [
      "-p",
      "--mcp-config", mcpConfigPath,
      "--strict-mcp-config",
      "--model", "sonnet",
      "--allowedTools", allowedTools,
      "--system-prompt", systemPrompt,
      "--no-session-persistence",
      prompt,
    ], {
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
      timeout: 600000, // 10 min per iteration
      stdio: ["pipe", "pipe", "inherit"], // show stderr (progress) but capture stdout
    });
  } catch (err: unknown) {
    const error = err as Error & { status?: number };
    // execFileSync throws on non-zero exit, but the work may still have been done
    console.error(`  Warning: ${error.message?.slice(0, 200)}`);
  }
}

function runAnalysis(): string {
  const db = new Database(dbPath, { readonly: true });
  const nodes = db.prepare("SELECT id, name, type, content, weight FROM nodes ORDER BY weight DESC").all() as any[];
  const edges = db.prepare(`
    SELECT a.source_id, a.target_id, a.label, a.weight,
           s.name as source_name, t.name as target_name
    FROM associations a
    JOIN nodes s ON s.id = a.source_id
    JOIN nodes t ON t.id = a.target_id
    ORDER BY a.weight DESC
  `).all() as any[];

  // Compute hub nodes
  const degreeMap = new Map<number, number>();
  for (const e of edges) {
    degreeMap.set(e.source_id, (degreeMap.get(e.source_id) || 0) + 1);
    degreeMap.set(e.target_id, (degreeMap.get(e.target_id) || 0) + 1);
  }
  const hubNodes = nodes
    .map((n) => ({ ...n, degree: degreeMap.get(n.id) || 0 }))
    .sort((a, b) => b.degree - a.degree)
    .slice(0, 10);

  db.close();

  const nodeList = nodes.map((n) => `  ${n.name} (${n.type}, w=${n.weight})${n.content ? `: ${n.content.slice(0, 100)}` : ""}`).join("\n");
  const edgeList = edges.map((e) => `  ${e.source_name} --[${e.label}, w=${e.weight}]--> ${e.target_name}`).join("\n");
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

  try {
    const result = execFileSync("claude", [
      "-p",
      "--model", "sonnet",
      "--no-session-persistence",
      analysisPrompt,
    ], {
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
      timeout: 300000,
    });
    return result.trim();
  } catch (err: unknown) {
    console.error("  Analysis failed, skipping.");
    return "";
  }
}

// --- ELI5 ---
function generateEli5(analysis: string): string {
  const db = new Database(dbPath, { readonly: true });
  const nodeCount = (db.prepare("SELECT COUNT(*) as c FROM nodes").get() as { c: number }).c;
  const edgeCount = (db.prepare("SELECT COUNT(*) as c FROM associations").get() as { c: number }).c;
  db.close();

  const eli5Prompt = `You are a science communicator. Below is a structural analysis of a knowledge graph about: "${concept}"

The graph has ${nodeCount} nodes and ${edgeCount} edges.

ANALYSIS:
${analysis}

Write an ELI5 (Explain Like I'm 5) version of this analysis as a markdown document. Guidelines:
- Start with a # heading that captures the core question in accessible language
- Add an italic subheading: *Based on analysis of a ${nodeCount}-node, ${edgeCount}-edge knowledge graph...*
- Write 1,000-2,000 words in plain, accessible language
- Use analogies and concrete examples to explain complex mechanisms
- Structure with clear ## subheadings
- Highlight the most surprising or counterintuitive findings
- End with a clear "bottom line" section
- No jargon without explanation
- No emojis`;

  try {
    const result = execFileSync("claude", [
      "-p",
      "--model", "sonnet",
      "--no-session-persistence",
      eli5Prompt,
    ], {
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
      timeout: 300000,
    });
    return result.trim();
  } catch (err: unknown) {
    console.error("  ELI5 generation failed, skipping.");
    return "";
  }
}

// --- Visualization ---
function generateViz(analysis: string) {
  const db = new Database(dbPath, { readonly: true });
  const nodes = db.prepare("SELECT id, name, type, content, weight FROM nodes").all() as any[];
  const edges = db.prepare("SELECT source_id, target_id, label, weight FROM associations").all() as any[];
  db.close();

  const graphData = JSON.stringify({
    nodes: nodes.map((n: any) => ({ id: n.id, name: n.name, type: n.type, content: n.content, weight: n.weight })),
    links: edges.map((e: any) => ({ source: e.source_id, target: e.target_id, label: e.label, weight: e.weight })),
  });

  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

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

// --- Main ---
async function main() {
  const startTotal = Date.now();

  for (let i = 1; i <= iterations; i++) {
    const startIter = Date.now();
    console.log(`\n--- Iteration ${i}/${iterations} ---`);

    runIteration(i);

    const elapsed = ((Date.now() - startIter) / 1000).toFixed(1);
    const stats = getDbStats();
    console.log(`  => ${stats.nodes} nodes, ${stats.edges} edges (${elapsed}s)`);
  }

  const totalElapsed = ((Date.now() - startTotal) / 1000).toFixed(0);
  const stats = getDbStats();

  console.log(`\n========================================`);
  console.log(`  Final: ${stats.nodes} nodes, ${stats.edges} edges (${totalElapsed}s total)`);
  console.log(`========================================`);

  console.log(`\n--- Analyzing graph for insights ---`);
  const analysis = runAnalysis();
  if (analysis) {
    console.log(`\n${analysis}`);
    writeFileSync(analysisPath, `# Analysis: ${concept}\n\n${analysis}\n`);
    console.log(`\nAnalysis written to ${analysisPath}`);

    console.log(`\n--- Generating ELI5 summary ---`);
    const eli5 = generateEli5(analysis);
    if (eli5) {
      const eli5Path = path.join(__dirname, "..", `explore-${slug}-eli5.md`);
      writeFileSync(eli5Path, eli5);
      console.log(`ELI5 written to ${eli5Path}`);
    }
  }

  generateViz(analysis);
  console.log(`Visualization written to ${outPath}`);
  console.log(`Open it in your browser to explore the graph.`);

  // Clean up temp config
  try { unlinkSync(mcpConfigPath); } catch {}
}

main().catch((err) => {
  try { unlinkSync(mcpConfigPath); } catch {}
  console.error("\nFatal error:", err.message);
  process.exit(1);
});
