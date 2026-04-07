# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run

```bash
npm run build          # compile TypeScript (tsc) to dist/
npm run start          # run the compiled server (node dist/index.js)
npm run dev            # build + run in one step
```

Tests use Node.js built-in test runner: `npm test` (runs `src/brain.test.ts`).

The server communicates over **stdio** (stdin/stdout) using the MCP protocol. It is not an HTTP server — you cannot curl it. To test locally, use the MCP inspector or configure it in Claude Code/Desktop.

## Architecture

BrainMCP is an MCP server (~500 LOC) that provides a persistent weighted knowledge graph as long-term memory for LLMs.

### Source files (all in `src/`)

- **`types.ts`** — TypeScript interfaces for `BrainNode`, `Association`, `RecallResult`. Node types are: person, place, thing, event, idea, memory, feeling.
- **`database.ts`** — Creates and initializes the SQLite database (`brain.db` at project root). Sets up WAL mode, foreign keys, and the two tables (`nodes`, `associations`) with their indexes.
- **`brain.ts`** — `Brain` class with all graph operations: `remember`, `recall` (with BFS 2-hop traversal + Hebbian co-activation), `associate`, `strengthen`, `weaken`, `reflect`, `forget`, `search`. All methods are synchronous (better-sqlite3 is sync).
- **`brain.test.ts`** — 35 unit tests covering all Brain methods including co-activation.
- **`index.ts`** — MCP server entry point. Registers 8 tools with zod schemas, wires them to `Brain` methods, and starts the stdio transport.

### Data model

Two SQLite tables in `brain.db`:
- **`nodes`** — concepts with `(name, type)` uniqueness. Fields: name, type, content, weight (0-10).
- **`associations`** — directed, labeled, weighted edges between nodes. Unique on `(source_id, target_id, label)`. Cascade-deletes when a node is removed.

### Key design decisions

- `associate()` auto-creates source/target nodes if they don't exist (calls `remember` internally).
- `recall()` falls back to fuzzy LIKE matching when exact name lookup fails.
- `forget()` prunes weak associations first, then removes orphaned nodes — order matters for cascade logic.
- `strengthen`/`weaken` clamp weights to [0, 10].
- `recall()` tracks co-activation: nodes recalled within a 5-minute window get automatic `co_activated` edges (initial weight 0.5, +0.1 per co-recall). Uses consistent direction (lower ID → higher ID) to avoid duplicate edges. This is Hebbian learning — "fire together, wire together."
- The database path defaults to `~/.brainmcp/brain.db`.
