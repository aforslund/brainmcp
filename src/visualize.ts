#!/usr/bin/env node

import { createDatabase } from "./database.js";
import { writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = createDatabase();

interface Node {
  id: number;
  name: string;
  type: string;
  content: string | null;
  weight: number;
}

interface Edge {
  source_id: number;
  target_id: number;
  label: string;
  weight: number;
}

const nodes = db.prepare("SELECT id, name, type, content, weight FROM nodes").all() as Node[];
const edges = db.prepare("SELECT source_id, target_id, label, weight FROM associations").all() as Edge[];

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

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>BrainMCP Graph</title>
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
  #stats {
    position: absolute; bottom: 16px; left: 16px; background: #1a1a2e; border: 1px solid #333;
    border-radius: 6px; padding: 10px 14px; font-size: 11px; color: #888;
  }
</style>
</head>
<body>
<div class="tooltip" id="tooltip"></div>
<div id="legend"></div>
<div id="stats"></div>
<svg id="graph"></svg>
<script src="https://d3js.org/d3.v7.min.js"></script>
<script>
const data = ${graphData};

const typeColors = {
  person: "#f472b6", place: "#60a5fa", thing: "#34d399",
  event: "#fbbf24", idea: "#a78bfa", memory: "#fb923c", feeling: "#f87171"
};

// Legend
const legend = document.getElementById("legend");
legend.innerHTML = "<h3>Node Types</h3>" +
  Object.entries(typeColors).map(([t, c]) =>
    '<div class="legend-item"><div class="legend-dot" style="background:' + c + '"></div>' + t + '</div>'
  ).join("");

// Stats
document.getElementById("stats").textContent =
  data.nodes.length + " concepts, " + data.links.length + " associations";

const width = window.innerWidth;
const height = window.innerHeight;

const svg = d3.select("#graph").attr("viewBox", [0, 0, width, height]);
const g = svg.append("g");

// Zoom
svg.call(d3.zoom().scaleExtent([0.1, 8]).on("zoom", (e) => g.attr("transform", e.transform)));

const simulation = d3.forceSimulation(data.nodes)
  .force("link", d3.forceLink(data.links).id(d => d.id).distance(d => 140 - d.weight * 8))
  .force("charge", d3.forceManyBody().strength(-400))
  .force("center", d3.forceCenter(width / 2, height / 2))
  .force("collision", d3.forceCollide().radius(d => 12 + d.weight * 2));

// Arrow markers
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

// Links
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

// Link labels
const linkLabel = g.append("g").selectAll("text")
  .data(data.links).join("text")
  .attr("class", "link-label")
  .text(d => d.label);

// Nodes
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

// Node labels
const nodeLabel = g.append("g").selectAll("text")
  .data(data.nodes).join("text")
  .attr("class", "node-label")
  .attr("dx", d => 8 + d.weight)
  .attr("dy", "0.35em")
  .text(d => d.name);

// Tooltip
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

// Tick
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

const outPath = path.join(__dirname, "..", "brain-viz.html");
writeFileSync(outPath, html);
console.log(`Wrote ${outPath}`);
console.log(`${nodes.length} nodes, ${edges.length} associations`);
