/*
 * Copyright (C) 2026 Bohemian Miser <https://substack.com/@bohemianmiser>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import type { RecipeGraph, RecipeNode } from './types';

type NodesOnly = { nodes: Pick<RecipeNode, 'id' | 'inputs'>[] };

/**
 * Returns the set of LEAF node ids in a recipe graph.
 *
 * Edges are implicit: `RecipeNode.inputs` holds the ids of nodes that flow INTO
 * a node (an edge `inputId -> node.id`). A node is a leaf when it has **no
 * incoming edge** (in-degree 0) — i.e. its `inputs` is empty/absent. These are
 * the entry-point nodes (raw ingredients that nothing flows into).
 *
 * Powers the "smaller leaf nodes" global setting (issue #155): leaf nodes are
 * rendered smaller when the toggle is on.
 */
export function getLeafNodeIds(graph: RecipeGraph | NodesOnly | null | undefined): Set<string> {
    const nodes = graph?.nodes;
    if (!nodes || nodes.length === 0) return new Set();

    const leaves = new Set<string>();
    for (const node of nodes) {
        if (!node.inputs || node.inputs.length === 0) leaves.add(node.id);
    }
    return leaves;
}
