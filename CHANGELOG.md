# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
