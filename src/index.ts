#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createDatabase } from "./database.js";
import { Brain } from "./brain.js";

function parseArgs(): { dbPath?: string } {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === "--db-path" || args[i] === "--db") && args[i + 1]) {
      return { dbPath: args[i + 1] };
    }
  }
  return {};
}

const { dbPath } = parseArgs();
const db = createDatabase(dbPath);
const brain = new Brain(db);

const server = new McpServer({
  name: "brainmcp",
  version: "1.1.0",
});

const NodeTypeEnum = z.enum([
  "person",
  "place",
  "thing",
  "event",
  "idea",
  "memory",
  "feeling",
]);

// --- Tools ---

server.registerTool(
  "remember",
  {
    title: "Remember",
    description:
      "Store a concept in the brain. Creates a new node or updates an existing one. Use this to record people, places, things, events, ideas, memories, or feelings.",
    inputSchema: {
      name: z.string().describe("Name of the concept"),
      type: NodeTypeEnum.describe("Category of concept"),
      content: z
        .string()
        .optional()
        .describe("Additional details or description"),
      weight: z
        .number()
        .min(0)
        .max(10)
        .optional()
        .describe("Importance weight (0-10, default 1.0)"),
    },
  },
  async ({ name, type, content, weight }) => {
    const node = brain.remember(name, type, content, weight);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(node, null, 2),
        },
      ],
    };
  }
);

server.registerTool(
  "recall",
  {
    title: "Recall",
    description:
      "Retrieve a concept and its associations from the brain. Returns the node, its direct associations, and the strongest related concepts up to 2 hops away.",
    inputSchema: {
      query: z.string().describe("Name or partial name to search for"),
      type: NodeTypeEnum.optional().describe("Filter by concept type"),
    },
  },
  async ({ query, type }) => {
    const result = brain.recall(query, type);
    if (!result) {
      return {
        content: [
          {
            type: "text",
            text: `Nothing found in brain for "${query}"`,
          },
        ],
      };
    }
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }
);

server.registerTool(
  "associate",
  {
    title: "Associate",
    description:
      "Create a weighted, labeled link between two concepts. Both concepts are auto-created if they don't exist. Use descriptive labels like 'works_at', 'loves', 'caused_by', 'reminds_me_of'. Re-associating an existing link never lowers its accumulated weight — use weaken for that.",
    inputSchema: {
      source_name: z.string().describe("Name of the source concept"),
      source_type: NodeTypeEnum.describe("Type of the source concept"),
      target_name: z.string().describe("Name of the target concept"),
      target_type: NodeTypeEnum.describe("Type of the target concept"),
      label: z
        .string()
        .default("related_to")
        .describe("Relationship label (e.g. 'works_at', 'loves', 'part_of')"),
      weight: z
        .number()
        .min(0)
        .max(10)
        .optional()
        .describe(
          "Strength of association (0-10, default 1.0 for new links). On existing links this only raises the weight, never lowers it."
        ),
    },
  },
  async ({ source_name, source_type, target_name, target_type, label, weight }) => {
    const result = brain.associate(
      source_name,
      source_type,
      target_name,
      target_type,
      label,
      weight
    );
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }
);

server.registerTool(
  "strengthen",
  {
    title: "Strengthen",
    description:
      "Increase the weight of associations between two concepts (direction doesn't matter). Use this when a connection is reinforced or validated. Returns every association that was updated.",
    inputSchema: {
      source_name: z.string().describe("Name of one concept"),
      target_name: z.string().describe("Name of the other concept"),
      label: z
        .string()
        .optional()
        .describe("Specific relationship label to strengthen (omit to strengthen all)"),
      amount: z
        .number()
        .default(0.2)
        .describe("How much to increase the weight"),
    },
  },
  async ({ source_name, target_name, label, amount }) => {
    const results = brain.strengthen(source_name, target_name, label, amount);
    if (results.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: `No association found between "${source_name}" and "${target_name}"`,
          },
        ],
      };
    }
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(results, null, 2),
        },
      ],
    };
  }
);

server.registerTool(
  "weaken",
  {
    title: "Weaken",
    description:
      "Decrease the weight of associations between two concepts (direction doesn't matter). Use this when a connection becomes less relevant or is contradicted. Returns every association that was updated.",
    inputSchema: {
      source_name: z.string().describe("Name of one concept"),
      target_name: z.string().describe("Name of the other concept"),
      label: z
        .string()
        .optional()
        .describe("Specific relationship label to weaken (omit to weaken all)"),
      amount: z
        .number()
        .default(0.2)
        .describe("How much to decrease the weight"),
    },
  },
  async ({ source_name, target_name, label, amount }) => {
    const results = brain.weaken(source_name, target_name, label, amount);
    if (results.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: `No association found between "${source_name}" and "${target_name}"`,
          },
        ],
      };
    }
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(results, null, 2),
        },
      ],
    };
  }
);

server.registerTool(
  "reflect",
  {
    title: "Reflect",
    description:
      "See what's top of mind — returns the strongest concepts and associations in the brain, ranked by weight.",
    inputSchema: {
      limit: z
        .number()
        .default(20)
        .describe("Max number of items to return"),
    },
  },
  async ({ limit }) => {
    const result = brain.reflect(limit);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }
);

server.registerTool(
  "forget",
  {
    title: "Forget",
    description:
      "Prune weak associations and orphaned concepts below a weight threshold. Simulates memory decay.",
    inputSchema: {
      threshold: z
        .number()
        .default(0.1)
        .describe("Remove associations and orphaned nodes at or below this weight"),
    },
  },
  async ({ threshold }) => {
    const result = brain.forget(threshold);
    return {
      content: [
        {
          type: "text",
          text: `Forgot ${result.removedAssociations} associations and ${result.removedNodes} orphaned concepts.`,
        },
      ],
    };
  }
);

server.registerTool(
  "search",
  {
    title: "Search",
    description: "Search for concepts by name pattern and optional type filter.",
    inputSchema: {
      query: z.string().describe("Search term (partial match)"),
      type: NodeTypeEnum.optional().describe("Filter by concept type"),
      limit: z.number().default(10).describe("Max results"),
    },
  },
  async ({ query, type, limit }) => {
    const results = brain.search(query, type, limit);
    if (results.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: `No concepts found matching "${query}"`,
          },
        ],
      };
    }
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(results, null, 2),
        },
      ],
    };
  }
);

// --- Start ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("BrainMCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
