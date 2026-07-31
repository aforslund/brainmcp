# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-07-31

### Added

- Hebbian co-activation: nodes recalled within a 5-minute window get automatic `co_activated` edges that strengthen on repeated co-recall
- Explore pipeline (`explore`, `explore-cc`, `explore-ask` scripts): autonomous graph-building exploration of a question with analysis + ELI5 markdown output
- Graph visualization script (`npm run viz`) generating a standalone HTML force graph, with `--db` flag for custom database paths
- `--db-path`/`--db` CLI flag for the MCP server

### Changed

- `associate` no longer resets an existing edge's accumulated weight: weight is optional and only ever raises the stored value (use `weaken` to lower)
- `strengthen`/`weaken` are now direction-agnostic, update every matching edge when `label` is omitted, and return all updated associations
- `recall`'s related-node traversal is capped at 25 results, expanding strongest edges first
- Migrated tool registration to the MCP SDK's `registerTool` API
- CI matrix now tests Node 20/22/24 (dropped EOL Node 18)
- Updated dependencies: MCP SDK 1.30, better-sqlite3 13, Anthropic SDK 0.115

### Fixed

- `recall`'s fuzzy fallback now respects the `type` filter
- LIKE wildcards (`%`, `_`) in `recall`/`search` queries are escaped and matched literally

## [1.0.0] - 2026-03-26

### Added

- Core knowledge graph with weighted nodes and labeled associations
- 8 MCP tools: `remember`, `recall`, `associate`, `strengthen`, `weaken`, `reflect`, `forget`, `search`
- SQLite persistence with WAL mode for concurrent reads
- 2-hop graph traversal for related concept discovery
- Fuzzy name matching for recall and search
- Memory decay via configurable weight thresholds
- Zod-validated tool inputs
- Support for 7 concept types: person, place, thing, event, idea, memory, feeling
