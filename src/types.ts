export type NodeType = "person" | "place" | "thing" | "event" | "idea" | "memory" | "feeling";

export interface BrainNode {
  id: number;
  name: string;
  type: NodeType;
  content: string | null;
  weight: number;
  created_at: string;
  updated_at: string;
}

export interface Association {
  id: number;
  source_id: number;
  target_id: number;
  label: string;
  weight: number;
  created_at: string;
  updated_at: string;
}

export interface NodeWithAssociations extends BrainNode {
  associations: {
    node: BrainNode;
    label: string;
    weight: number;
    direction: "outgoing" | "incoming";
  }[];
}

export interface RecallResult {
  node: BrainNode;
  associations: {
    node: BrainNode;
    label: string;
    weight: number;
    direction: "outgoing" | "incoming";
  }[];
  related: {
    node: BrainNode;
    path: string;
    distance: number;
  }[];
}
