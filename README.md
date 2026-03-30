# BrainMCP

**Give your LLM a persistent, associative memory.**

A lightweight MCP server that provides a weighted knowledge graph as long-term memory for Claude and other LLMs. Everything your AI learns persists across sessions in a single SQLite file — no external services, no API keys, no Docker.

---

## What is this?

BrainMCP is a [Model Context Protocol](https://modelcontextprotocol.io/) server that gives LLMs a persistent brain — a weighted knowledge graph where everything is a **node** (a person, place, thing, event, idea, memory, or feeling) connected by **weighted, labeled associations**.

The LLM decides *what* to remember. The brain handles *how* it's stored and connected.

When Claude learns that you work at Acme Corp, it stores that as an association. When it later learns that Acme Corp is building a new product, it connects those nodes. When you ask "what do you know about my work?" — it traverses the graph and pulls together everything relevant, even things connected indirectly.

All of this persists in a single `brain.db` file. Every session picks up where the last one left off.

## Why not just use [X]?

| Approach | Limitation |
|---|---|
| **Claude's built-in memory** | Flat text files. No relationships, no weights, no traversal. |
| **Official MCP memory server** | No weights, no decay, no graph traversal. Stores entities but can't reason about connections. |
| **Vector/embedding memory (Mem0, etc.)** | Requires external database + embedding API. Semantic search is powerful but heavyweight for personal memory. |
| **Heavy solutions (Vestige, etc.)** | Tens of thousands of lines of Rust, ML model dependencies. Overkill for most use cases. |

BrainMCP is the **simplest thing that works**. Zero dependencies beyond SQLite. ~500 lines of TypeScript. One file database. Install in 30 seconds.

## Features

BrainMCP exposes 8 tools via MCP:

| Tool | Description |
|---|---|
| **remember** | Store a concept in the brain with a name, type, optional content, and importance weight (0-10). Creates or updates. |
| **recall** | Retrieve a concept with all its direct associations and 2-hop related concepts. Fuzzy matches if exact name not found. |
| **associate** | Link two concepts with a labeled, weighted edge (e.g. `works_on`, `built_with`, `part_of`). Auto-creates nodes if needed. |
| **strengthen** | Increase the weight of an association when a connection is reinforced or validated. |
| **weaken** | Decrease the weight of an association when something becomes less relevant or is contradicted. |
| **reflect** | See what's "top of mind" — returns the highest-weighted concepts and associations in the brain. |
| **forget** | Prune weak associations and orphaned nodes below a weight threshold. Simulates memory decay. |
| **search** | Fuzzy search across all concepts by name, with optional type filter. |

## Installation

### Quick install (recommended)

No cloning needed — just configure your MCP client to use `npx`:

**Claude Code** — add to `~/.mcp.json`:

```json
{
  "mcpServers": {
    "brainmcp": {
      "command": "npx",
      "args": ["-y", "brainmcp"]
    }
  }
}
```

**Claude Desktop** — add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):

```json
{
  "mcpServers": {
    "brainmcp": {
      "command": "npx",
      "args": ["-y", "brainmcp"]
    }
  }
}
```

That's it. No cloning, no building, no external database, no API keys, no Docker.

Your brain is stored at `~/.brainmcp/brain.db` by default. All MCP clients share the same brain automatically.

To use a custom database path:

```json
{
  "mcpServers": {
    "brainmcp": {
      "command": "npx",
      "args": ["-y", "brainmcp", "--db-path", "/path/to/my/brain.db"]
    }
  }
}
```

### Install from source

```bash
git clone https://github.com/aforslund/brainmcp.git
cd brainmcp
npm install
npm run build
```

Then point your MCP client at the built file:

```json
{
  "mcpServers": {
    "brainmcp": {
      "command": "node",
      "args": ["/absolute/path/to/brainmcp/dist/index.js"]
    }
  }
}
```

## Configuration

To auto-allow brain tools without confirmation prompts in Claude Code, add to your `settings.json`:

```json
{
  "permissions": {
    "allow": [
      "mcp__brainmcp__remember",
      "mcp__brainmcp__recall",
      "mcp__brainmcp__associate",
      "mcp__brainmcp__strengthen",
      "mcp__brainmcp__weaken",
      "mcp__brainmcp__reflect",
      "mcp__brainmcp__forget",
      "mcp__brainmcp__search"
    ]
  }
}
```

## Recommended CLAUDE.md instructions

Add the following to your `CLAUDE.md` (global at `~/.claude/CLAUDE.md` or per-project) to teach Claude when and how to use the brain:

```markdown
## Brain MCP

You have access to a persistent associative memory graph via brainmcp tools (remember, recall, associate, strengthen, weaken, reflect, forget, search). This is a weighted knowledge graph stored in SQLite that persists across all sessions and projects.

### When to use the brain
- At the start of a session, use `reflect` to see what's top of mind — it helps orient you
- When the user mentions a person, project, or concept, `recall` it to see what you already know and its connections
- When you learn something worth persisting across sessions, `remember` it
- When you discover relationships between concepts, `associate` them with descriptive labels (e.g. `built_with`, `works_on`, `part_of`, `related_to`)
- When a connection is validated or reinforced, `strengthen` it
- When something turns out to be wrong or less relevant, `weaken` it

### Brain vs auto-memory
- **Brain** = cross-project knowledge graph. People, projects, ideas, technologies, and how they connect. The "what do I know about Andrew's world" layer. Use for anything you'd want to recall from a different project context.
- **Auto-memory** = project-scoped working notes. How to work with Andrew, behavioral feedback, project-specific operational context. The "how to be helpful in this repo" layer.

### Guidelines
- Use descriptive association labels, not just "related_to" — prefer things like `built_with`, `works_on`, `co_founder_of`, `has_feature`, `depends_on`, `inspired_by`
- Weight things by importance (1-10). A core project might be 7-8, a minor tool might be 2-3
- Don't store things that belong in code or git history — the brain is for cross-cutting knowledge
- Don't ask permission to use brain tools — just use them naturally as part of the conversation
```

## How it works

### Architecture

BrainMCP uses a single SQLite database (`brain.db`) with two tables:

**nodes** — concepts in the knowledge graph
- `name` — the concept name (e.g. "TypeScript", "Andrew", "BrainMCP")
- `type` — one of: person, place, thing, event, idea, memory, feeling
- `content` — optional description or details
- `weight` — importance score (0-10, default 1.0)
- `created_at` / `updated_at` — timestamps
- Unique constraint on `(name, type)` — each concept is stored once per type

**associations** — weighted, labeled edges between nodes
- `source_id` / `target_id` — the two connected nodes
- `label` — the relationship type (e.g. `built_with`, `works_on`)
- `weight` — strength of the connection (0-10, default 1.0)
- `created_at` / `updated_at` — timestamps
- Unique constraint on `(source_id, target_id, label)` — one edge per label per pair

### Recall traversal

When you `recall` a concept, BrainMCP does a BFS traversal up to 2 hops from the target node, returning:
1. The node itself with all its properties
2. Direct associations (1 hop) with their labels, weights, and directions
3. Related concepts (2 hops) with the path taken to reach them

All data lives in a single `brain.db` file. WAL mode is enabled for concurrent read performance.

## Example usage

Here's what a natural conversation with BrainMCP looks like:

> **You:** I'm starting a new project called Nightfall — it's a CLI tool for managing dark mode across all my apps. Built with Rust.
>
> **Claude:** *uses `remember` to store "Nightfall" as a thing with content "CLI tool for managing dark mode across all apps"*
> *uses `associate` to link Nightfall -> built_with -> Rust*
>
> Cool, I've noted Nightfall in my brain. A Rust CLI for unified dark mode management — that's a neat idea.
>
> **You:** It uses the same config format as my other project, Daybreak.
>
> **Claude:** *uses `recall` on "Daybreak" to see what's already known*
> *uses `associate` to link Nightfall -> shares_config_with -> Daybreak*
>
> Got it — I can see Daybreak is your theme engine. Makes sense they'd share a config format. I've linked them in my memory.
>
> **You:** What do you know about my projects?
>
> **Claude:** *uses `reflect` to see top-of-mind concepts*
> *uses `recall` on the highest-weighted projects*
>
> Here's what I know about your projects:
> - **Nightfall** — Rust CLI for dark mode management, shares config with Daybreak
> - **Daybreak** — Theme engine (connected to Nightfall)
> - ...and any other projects previously stored

## Tech stack

- **TypeScript** — source language
- **@modelcontextprotocol/sdk** — MCP server framework
- **better-sqlite3** — synchronous SQLite bindings for Node.js
- **zod** — runtime schema validation for tool inputs

## License

MIT
