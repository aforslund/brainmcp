import type Database from "better-sqlite3";
import type { BrainNode, Association, NodeType, RecallResult } from "./types.js";

export class Brain {
  private db: Database.Database;

  // Co-activation tracking (Hebbian: "fire together, wire together")
  private recentRecalls: { nodeId: number; timestamp: number }[] = [];
  private static CO_ACTIVATION_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
  private static CO_ACTIVATION_INITIAL_WEIGHT = 0.5;
  private static CO_ACTIVATION_INCREMENT = 0.1;
  private static CO_ACTIVATION_LABEL = "co_activated";

  // Cap on related nodes returned by recall, so dense graphs don't flood context
  private static RELATED_LIMIT = 25;

  constructor(db: Database.Database) {
    this.db = db;
  }

  private static escapeLike(term: string): string {
    return term.replace(/[\\%_]/g, (c) => `\\${c}`);
  }

  remember(
    name: string,
    type: NodeType,
    content?: string,
    weight?: number
  ): BrainNode {
    const existing = this.db
      .prepare("SELECT * FROM nodes WHERE name = ? AND type = ?")
      .get(name, type) as BrainNode | undefined;

    if (existing) {
      this.db
        .prepare(
          `UPDATE nodes SET content = COALESCE(?, content), weight = ?, updated_at = datetime('now') WHERE id = ?`
        )
        .run(content ?? existing.content, weight ?? existing.weight, existing.id);
      return this.db
        .prepare("SELECT * FROM nodes WHERE id = ?")
        .get(existing.id) as BrainNode;
    }

    const result = this.db
      .prepare(
        "INSERT INTO nodes (name, type, content, weight) VALUES (?, ?, ?, ?)"
      )
      .run(name, type, content ?? null, weight ?? 1.0);

    return this.db
      .prepare("SELECT * FROM nodes WHERE id = ?")
      .get(result.lastInsertRowid) as BrainNode;
  }

  recall(query: string, type?: NodeType): RecallResult | null {
    let node: BrainNode | undefined;

    if (type) {
      node = this.db
        .prepare("SELECT * FROM nodes WHERE name = ? AND type = ?")
        .get(query, type) as BrainNode | undefined;
    } else {
      node = this.db
        .prepare("SELECT * FROM nodes WHERE name = ? ORDER BY weight DESC LIMIT 1")
        .get(query) as BrainNode | undefined;
    }

    if (!node) {
      // fuzzy search
      const pattern = `%${Brain.escapeLike(query)}%`;
      const fuzzy = (type
        ? this.db
            .prepare(
              "SELECT * FROM nodes WHERE name LIKE ? ESCAPE '\\' AND type = ? ORDER BY weight DESC LIMIT 1"
            )
            .get(pattern, type)
        : this.db
            .prepare(
              "SELECT * FROM nodes WHERE name LIKE ? ESCAPE '\\' ORDER BY weight DESC LIMIT 1"
            )
            .get(pattern)) as BrainNode | undefined;

      if (!fuzzy) return null;
      node = fuzzy;
    }

    // Hebbian co-activation: wire together nodes recalled in the same session window
    this.trackCoActivation(node);

    const associations = this.getAssociations(node.id);

    // 2-hop related nodes
    const related = this.getRelated(node.id, 2);

    return { node, associations, related };
  }

  associate(
    sourceName: string,
    sourceType: NodeType,
    targetName: string,
    targetType: NodeType,
    label: string = "related_to",
    weight?: number
  ): { source: BrainNode; target: BrainNode; association: Association } {
    const source = this.remember(sourceName, sourceType);
    const target = this.remember(targetName, targetType);

    const existing = this.db
      .prepare(
        "SELECT * FROM associations WHERE source_id = ? AND target_id = ? AND label = ?"
      )
      .get(source.id, target.id, label) as Association | undefined;

    if (existing) {
      // Never lower an accumulated weight on re-association — use weaken for that
      const newWeight =
        weight === undefined
          ? existing.weight
          : Math.max(existing.weight, weight);
      this.db
        .prepare(
          `UPDATE associations SET weight = ?, updated_at = datetime('now') WHERE id = ?`
        )
        .run(newWeight, existing.id);
    } else {
      this.db
        .prepare(
          "INSERT INTO associations (source_id, target_id, label, weight) VALUES (?, ?, ?, ?)"
        )
        .run(source.id, target.id, label, weight ?? 1.0);
    }

    const association = this.db
      .prepare(
        "SELECT * FROM associations WHERE source_id = ? AND target_id = ? AND label = ?"
      )
      .get(source.id, target.id, label) as Association;

    return { source, target, association };
  }

  strengthen(
    sourceName: string,
    targetName: string,
    label?: string,
    amount: number = 0.2
  ): Association[] {
    return this.adjustWeight(sourceName, targetName, label, amount);
  }

  weaken(
    sourceName: string,
    targetName: string,
    label?: string,
    amount: number = 0.2
  ): Association[] {
    return this.adjustWeight(sourceName, targetName, label, -amount);
  }

  // Direction-agnostic: matches edges stored either way between the two names,
  // updates every matching edge (all labels unless one is given), returns them all.
  private adjustWeight(
    nameA: string,
    nameB: string,
    label: string | undefined,
    delta: number
  ): Association[] {
    const sql = `
      UPDATE associations
      SET weight = MIN(MAX(weight + ?, 0.0), 10.0), updated_at = datetime('now')
      WHERE id IN (
        SELECT assoc.id FROM associations assoc
        JOIN nodes s ON s.id = assoc.source_id
        JOIN nodes t ON t.id = assoc.target_id
        WHERE ((s.name = ? AND t.name = ?) OR (s.name = ? AND t.name = ?))
        ${label ? "AND assoc.label = ?" : ""}
      )
      RETURNING *
    `;
    const params = label
      ? [delta, nameA, nameB, nameB, nameA, label]
      : [delta, nameA, nameB, nameB, nameA];
    return this.db.prepare(sql).all(...params) as Association[];
  }

  reflect(limit: number = 20): { nodes: BrainNode[]; associations: Association[] } {
    const nodes = this.db
      .prepare("SELECT * FROM nodes ORDER BY weight DESC LIMIT ?")
      .all(limit) as BrainNode[];

    const associations = this.db
      .prepare("SELECT * FROM associations ORDER BY weight DESC LIMIT ?")
      .all(limit) as Association[];

    return { nodes, associations };
  }

  forget(threshold: number = 0.1): { removedNodes: number; removedAssociations: number } {
    const assocResult = this.db
      .prepare("DELETE FROM associations WHERE weight <= ?")
      .run(threshold);

    const nodeResult = this.db
      .prepare(`
        DELETE FROM nodes WHERE weight <= ?
          AND id NOT IN (SELECT source_id FROM associations)
          AND id NOT IN (SELECT target_id FROM associations)
      `)
      .run(threshold);

    return {
      removedNodes: nodeResult.changes,
      removedAssociations: assocResult.changes,
    };
  }

  search(query: string, type?: NodeType, limit: number = 10): BrainNode[] {
    const pattern = `%${Brain.escapeLike(query)}%`;
    if (type) {
      return this.db
        .prepare(
          "SELECT * FROM nodes WHERE name LIKE ? ESCAPE '\\' AND type = ? ORDER BY weight DESC LIMIT ?"
        )
        .all(pattern, type, limit) as BrainNode[];
    }
    return this.db
      .prepare(
        "SELECT * FROM nodes WHERE name LIKE ? ESCAPE '\\' ORDER BY weight DESC LIMIT ?"
      )
      .all(pattern, limit) as BrainNode[];
  }

  private trackCoActivation(node: BrainNode): void {
    const now = Date.now();

    // Prune expired entries
    this.recentRecalls = this.recentRecalls.filter(
      (r) => now - r.timestamp < Brain.CO_ACTIVATION_WINDOW_MS
    );

    // Create or strengthen co_activated edges with all other recent recalls
    for (const recent of this.recentRecalls) {
      if (recent.nodeId === node.id) continue;

      // Consistent direction: lower ID -> higher ID to avoid duplicate edges
      const [srcId, tgtId] =
        recent.nodeId < node.id
          ? [recent.nodeId, node.id]
          : [node.id, recent.nodeId];

      const existing = this.db
        .prepare(
          "SELECT * FROM associations WHERE source_id = ? AND target_id = ? AND label = ?"
        )
        .get(srcId, tgtId, Brain.CO_ACTIVATION_LABEL) as Association | undefined;

      if (existing) {
        this.db
          .prepare(
            `UPDATE associations SET weight = MIN(weight + ?, 10.0), updated_at = datetime('now') WHERE id = ?`
          )
          .run(Brain.CO_ACTIVATION_INCREMENT, existing.id);
      } else {
        this.db
          .prepare(
            "INSERT INTO associations (source_id, target_id, label, weight) VALUES (?, ?, ?, ?)"
          )
          .run(srcId, tgtId, Brain.CO_ACTIVATION_LABEL, Brain.CO_ACTIVATION_INITIAL_WEIGHT);
      }
    }

    // Track this recall (update timestamp if already present)
    const existingIdx = this.recentRecalls.findIndex((r) => r.nodeId === node.id);
    if (existingIdx >= 0) {
      this.recentRecalls[existingIdx].timestamp = now;
    } else {
      this.recentRecalls.push({ nodeId: node.id, timestamp: now });
    }
  }

  private getAssociations(nodeId: number) {
    const outgoing = this.db
      .prepare(`
        SELECT a.label, a.weight AS assoc_weight, n.*
        FROM associations a
        JOIN nodes n ON n.id = a.target_id
        WHERE a.source_id = ?
        ORDER BY a.weight DESC
      `)
      .all(nodeId) as (BrainNode & { label: string; assoc_weight: number })[];

    const incoming = this.db
      .prepare(`
        SELECT a.label, a.weight AS assoc_weight, n.*
        FROM associations a
        JOIN nodes n ON n.id = a.source_id
        WHERE a.target_id = ?
        ORDER BY a.weight DESC
      `)
      .all(nodeId) as (BrainNode & { label: string; assoc_weight: number })[];

    return [
      ...outgoing.map((r) => ({
        node: { id: r.id, name: r.name, type: r.type as NodeType, content: r.content, weight: r.weight, created_at: r.created_at, updated_at: r.updated_at },
        label: r.label,
        weight: r.assoc_weight,
        direction: "outgoing" as const,
      })),
      ...incoming.map((r) => ({
        node: { id: r.id, name: r.name, type: r.type as NodeType, content: r.content, weight: r.weight, created_at: r.created_at, updated_at: r.updated_at },
        label: r.label,
        weight: r.assoc_weight,
        direction: "incoming" as const,
      })),
    ];
  }

  private getRelated(
    nodeId: number,
    maxDepth: number,
    limit: number = Brain.RELATED_LIMIT
  ) {
    // BFS up to maxDepth hops, strongest edges first, capped at limit results
    const visited = new Set<number>([nodeId]);
    const results: { node: BrainNode; path: string; distance: number }[] = [];
    let frontier = [{ id: nodeId, path: "", depth: 0 }];

    while (frontier.length > 0 && results.length < limit) {
      const next: typeof frontier = [];

      for (const current of frontier) {
        if (current.depth >= maxDepth) continue;
        if (results.length >= limit) break;

        const neighbors = this.db
          .prepare(`
            SELECT n.*, a.label, a.weight AS assoc_weight, 'out' as dir FROM associations a
            JOIN nodes n ON n.id = a.target_id
            WHERE a.source_id = ?
            UNION
            SELECT n.*, a.label, a.weight AS assoc_weight, 'in' as dir FROM associations a
            JOIN nodes n ON n.id = a.source_id
            WHERE a.target_id = ?
            ORDER BY assoc_weight DESC
          `)
          .all(current.id, current.id) as (BrainNode & { label: string; dir: string })[];

        for (const neighbor of neighbors) {
          if (results.length >= limit) break;
          if (visited.has(neighbor.id)) continue;
          visited.add(neighbor.id);

          const pathStr = current.path
            ? `${current.path} -> ${neighbor.label} -> ${neighbor.name}`
            : `${neighbor.label} -> ${neighbor.name}`;

          results.push({
            node: {
              id: neighbor.id,
              name: neighbor.name,
              type: neighbor.type as NodeType,
              content: neighbor.content,
              weight: neighbor.weight,
              created_at: neighbor.created_at,
              updated_at: neighbor.updated_at,
            },
            path: pathStr,
            distance: current.depth + 1,
          });

          next.push({ id: neighbor.id, path: pathStr, depth: current.depth + 1 });
        }
      }

      frontier = next;
    }

    return results;
  }
}
