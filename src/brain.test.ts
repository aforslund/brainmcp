import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { Brain } from "./brain.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE nodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('person','place','thing','event','idea','memory','feeling')),
      content TEXT,
      weight REAL NOT NULL DEFAULT 1.0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX idx_nodes_name_type ON nodes(name, type);

    CREATE TABLE associations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
      target_id INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
      label TEXT NOT NULL DEFAULT 'related_to',
      weight REAL NOT NULL DEFAULT 1.0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(source_id, target_id, label)
    );
    CREATE INDEX idx_assoc_source ON associations(source_id);
    CREATE INDEX idx_assoc_target ON associations(target_id);
  `);
  return db;
}

describe("Brain", () => {
  let db: Database.Database;
  let brain: Brain;

  beforeEach(() => {
    db = createTestDb();
    brain = new Brain(db);
  });

  afterEach(() => {
    db.close();
  });

  describe("remember", () => {
    it("should create a new node", () => {
      const node = brain.remember("Alice", "person", "A friend");
      assert.equal(node.name, "Alice");
      assert.equal(node.type, "person");
      assert.equal(node.content, "A friend");
      assert.equal(node.weight, 1.0);
      assert.ok(node.id > 0);
    });

    it("should update an existing node", () => {
      brain.remember("Alice", "person", "A friend");
      const updated = brain.remember("Alice", "person", "Best friend", 5.0);
      assert.equal(updated.content, "Best friend");
      assert.equal(updated.weight, 5.0);
    });

    it("should use default weight of 1.0", () => {
      const node = brain.remember("Bob", "person");
      assert.equal(node.weight, 1.0);
    });

    it("should allow different types with the same name", () => {
      const person = brain.remember("Spring", "event");
      const thing = brain.remember("Spring", "thing");
      assert.notEqual(person.id, thing.id);
    });
  });

  describe("recall", () => {
    it("should recall a node by exact name", () => {
      brain.remember("Alice", "person", "A friend");
      const result = brain.recall("Alice");
      assert.ok(result);
      assert.equal(result.node.name, "Alice");
    });

    it("should recall with type filter", () => {
      brain.remember("Alice", "person", "A friend");
      brain.remember("Alice", "idea", "An idea called Alice");
      const result = brain.recall("Alice", "idea");
      assert.ok(result);
      assert.equal(result.node.type, "idea");
    });

    it("should fuzzy match when exact match fails", () => {
      brain.remember("Alice Wonderland", "person");
      const result = brain.recall("Alice");
      assert.ok(result);
      assert.equal(result.node.name, "Alice Wonderland");
    });

    it("should return null for unknown concepts", () => {
      const result = brain.recall("NonExistent");
      assert.equal(result, null);
    });

    it("should include associations in recall", () => {
      brain.associate("Alice", "person", "Wonderland", "place", "lives_in");
      const result = brain.recall("Alice");
      assert.ok(result);
      assert.equal(result.associations.length, 1);
      assert.equal(result.associations[0].label, "lives_in");
      assert.equal(result.associations[0].node.name, "Wonderland");
    });
  });

  describe("associate", () => {
    it("should create an association between two nodes", () => {
      const result = brain.associate("Alice", "person", "Bob", "person", "knows");
      assert.equal(result.source.name, "Alice");
      assert.equal(result.target.name, "Bob");
      assert.equal(result.association.label, "knows");
    });

    it("should auto-create nodes that don't exist", () => {
      brain.associate("NewPerson", "person", "NewPlace", "place", "visits");
      const person = brain.recall("NewPerson");
      const place = brain.recall("NewPlace");
      assert.ok(person);
      assert.ok(place);
    });

    it("should update weight on duplicate association", () => {
      brain.associate("Alice", "person", "Bob", "person", "knows", 1.0);
      brain.associate("Alice", "person", "Bob", "person", "knows", 5.0);
      const result = brain.recall("Alice");
      assert.ok(result);
      const assoc = result.associations.find((a) => a.label === "knows");
      assert.ok(assoc);
      assert.equal(assoc.weight, 5.0);
    });

    it("should allow multiple labels between same nodes", () => {
      brain.associate("Alice", "person", "Bob", "person", "knows");
      brain.associate("Alice", "person", "Bob", "person", "works_with");
      const result = brain.recall("Alice");
      assert.ok(result);
      assert.equal(result.associations.length, 2);
    });
  });

  describe("strengthen", () => {
    it("should increase association weight", () => {
      brain.associate("Alice", "person", "Bob", "person", "knows", 1.0);
      const result = brain.strengthen("Alice", "Bob", "knows", 0.5);
      assert.ok(result);
      assert.equal(result.weight, 1.5);
    });

    it("should cap weight at 10.0", () => {
      brain.associate("Alice", "person", "Bob", "person", "knows", 9.5);
      const result = brain.strengthen("Alice", "Bob", "knows", 1.0);
      assert.ok(result);
      assert.equal(result.weight, 10.0);
    });

    it("should return null for non-existent association", () => {
      const result = brain.strengthen("X", "Y", "z");
      assert.equal(result, null);
    });
  });

  describe("weaken", () => {
    it("should decrease association weight", () => {
      brain.associate("Alice", "person", "Bob", "person", "knows", 1.0);
      const result = brain.weaken("Alice", "Bob", "knows", 0.3);
      assert.ok(result);
      assert.ok(Math.abs(result.weight - 0.7) < 0.001);
    });

    it("should floor weight at 0.0", () => {
      brain.associate("Alice", "person", "Bob", "person", "knows", 0.1);
      const result = brain.weaken("Alice", "Bob", "knows", 1.0);
      assert.ok(result);
      assert.equal(result.weight, 0.0);
    });
  });

  describe("reflect", () => {
    it("should return top nodes and associations by weight", () => {
      brain.remember("A", "thing", undefined, 5.0);
      brain.remember("B", "thing", undefined, 3.0);
      brain.remember("C", "thing", undefined, 1.0);
      const result = brain.reflect(2);
      assert.equal(result.nodes.length, 2);
      assert.equal(result.nodes[0].name, "A");
      assert.equal(result.nodes[1].name, "B");
    });

    it("should return empty when brain is empty", () => {
      const result = brain.reflect();
      assert.equal(result.nodes.length, 0);
      assert.equal(result.associations.length, 0);
    });
  });

  describe("forget", () => {
    it("should remove weak associations", () => {
      brain.associate("Alice", "person", "Bob", "person", "knows", 0.05);
      const result = brain.forget(0.1);
      assert.equal(result.removedAssociations, 1);
    });

    it("should remove orphaned nodes below threshold", () => {
      brain.remember("Weak", "thing", undefined, 0.05);
      const result = brain.forget(0.1);
      assert.equal(result.removedNodes, 1);
    });

    it("should keep nodes that still have associations", () => {
      brain.associate("Alice", "person", "Bob", "person", "knows", 5.0);
      // Set Alice's node weight low, but she still has an association
      brain.remember("Alice", "person", undefined, 0.05);
      const result = brain.forget(0.1);
      assert.equal(result.removedNodes, 0);
    });
  });

  describe("search", () => {
    it("should find nodes by partial name match", () => {
      brain.remember("Alice Wonderland", "person");
      brain.remember("Alice Cooper", "person");
      brain.remember("Bob", "person");
      const results = brain.search("Alice");
      assert.equal(results.length, 2);
    });

    it("should filter by type", () => {
      brain.remember("Spring", "event");
      brain.remember("Spring", "thing");
      const results = brain.search("Spring", "event");
      assert.equal(results.length, 1);
      assert.equal(results[0].type, "event");
    });

    it("should respect limit", () => {
      for (let i = 0; i < 20; i++) {
        brain.remember(`Item${i}`, "thing");
      }
      const results = brain.search("Item", undefined, 5);
      assert.equal(results.length, 5);
    });

    it("should return empty for no matches", () => {
      const results = brain.search("NonExistent");
      assert.equal(results.length, 0);
    });
  });

  describe("graph traversal", () => {
    it("should find 2-hop related concepts", () => {
      brain.associate("Alice", "person", "Bob", "person", "knows");
      brain.associate("Bob", "person", "Carol", "person", "knows");
      const result = brain.recall("Alice");
      assert.ok(result);
      // Bob is 1 hop, Carol is 2 hops
      assert.ok(result.related.length >= 2);
      const carol = result.related.find((r) => r.node.name === "Carol");
      assert.ok(carol);
      assert.equal(carol.distance, 2);
    });

    it("should not revisit nodes in traversal", () => {
      brain.associate("A", "thing", "B", "thing", "links");
      brain.associate("B", "thing", "A", "thing", "links");
      const result = brain.recall("A");
      assert.ok(result);
      // B should appear only once in related
      const bNodes = result.related.filter((r) => r.node.name === "B");
      assert.equal(bNodes.length, 1);
    });
  });
});
