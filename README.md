# Recipe Lanes

A visual recipe editor that transforms text into clear, lane-based process graphs with AI-generated icons.

## Overview

**Recipe Lanes** aims to revolutionize how we view cooking instructions. Instead of a linear wall of text, it parses recipes into a structured graph where:
*   **Nodes** are actions or ingredients (e.g., "Grate Carrots", "Sear Steak").
*   **Lanes** represent physical locations or containers (e.g., "Chopping Board", "Fry Pan", "Oven").
*   **Edges** represent the flow of ingredients between steps.

## Core Philosophy: The State-Flow Pattern

To make recipes intuitive, we visualize them as a sequence of **States** and **Transitions**:

1.  **Ingredient Nodes (The "Input"):**
    *   Represent the *new* items being added.
    *   **Visual Rule:** Atomic and singular (e.g., "Salt Shaker", "Egg", "Pile of Sugar"). **NO quantities** in the visual (quantities belong in text).
    *   **Strict Connectivity:** Every ingredient node has exactly **one output** (the step it feeds into).
    *   **Splitting:** If an ingredient is used in multiple places (e.g. "half the sugar"), it appears as **two separate nodes**.

2.  **Action Nodes (The "State" & "Prep"):**
    *   Represent the *result* of a process.
    *   **Visual:** Shows the *combined state* (e.g., "Onions frying in pan", "Whisked Eggs").
    *   **Prep Rules:**
        *   Significant prep (e.g. "Grate Cheese") is an **Action Node** that takes the raw ingredient ("Cheese") as input.
        *   The flow is `[Cheese] -> [Grate] -> [Add to Pan]`.
    *   **Merge Logic:** If an action combines inputs from different lanes (e.g. pouring bowl into pan), it sits in the *receiving* lane and accepts arrows from the source lanes.

3.  **Lanes (Containers):**
    *   Represent the physical vessel.
    *   Vertical flow represents time/progress.

## Layout Concept (Vision)

We aim for a "Mise en Place" flow:
1.  **Top Row:** All raw ingredients start here, aligned with the lane they first enter.
2.  **Vertical Flow:** Ingredients drop down into Action nodes (Prep/Cook).
3.  **Merge:** Lanes merge via diagonal arrows (e.g. Whisked Eggs in Lane 1 flow into Pan in Lane 2).
4.  **Grid Alignment:** Steps align horizontally by "Rank" (Time step), minimizing line crossings.

## Architecture

*   **Frontend:** React (Vite/Next.js TBD - migrating from experimental `ui` folder).
*   **Backend:** Firebase (Firestore for data, Storage for icons, Auth for user management).
*   **AI:** Google Cloud Vertex AI (Server-Side integration for security and robustness).
    *   Text Model: `gemini-2.5-flash`
    *   Image Model: `imagen-3.0-generate-001`

## Examples

### Example 1: Simple Carrot Stir Fry

**Input Text:**
> "Grate 2 large carrots. Heat a skillet over medium heat. Add the grated carrots to the pan and sauté for 5 minutes."

**Structured Output:**
```json
{
  "lanes": [
    { "id": "lane-1", "label": "Cutting Board", "type": "prep" },
    { "id": "lane-2", "label": "Skillet", "type": "cook" }
  ],
  "nodes": [
    { "id": "node-1", "laneId": "lane-1", "text": "2 Carrots", "visualDescription": "Carrot", "type": "ingredient" },
    { "id": "node-2", "laneId": "lane-1", "text": "Grate", "visualDescription": "A carrot going into a grater", "type": "action", "inputs": ["node-1"] },
    { "id": "node-3", "laneId": "lane-2", "text": "Sauté", "visualDescription": "Grated carrots sizzling in a pan", "type": "action", "inputs": ["node-2"], "temperature": "Medium", "duration": "5 min" }
  ]
}
```

### Example 2: Scrambled Eggs (Merge Flow)

**Input Text:**
> "Crack 3 eggs into a bowl. Whisk them with a pinch of salt. Melt butter in a non-stick pan. Pour the eggs into the pan and stir gently until set. Top with grated cheese."

**Structured Output:**
```json
{
  "lanes": [
    { "id": "lane-1", "label": "Bowl", "type": "prep" },
    { "id": "lane-2", "label": "Pan", "type": "cook" },
    { "id": "lane-3", "label": "Board", "type": "prep" }
  ],
  "nodes": [
    // Row 1 (Ingredients)
    { "id": "n1", "laneId": "lane-1", "text": "3 Eggs", "visualDescription": "Egg", "type": "ingredient" },
    { "id": "n2", "laneId": "lane-1", "text": "Salt", "visualDescription": "Salt Shaker", "type": "ingredient" },
    { "id": "n3", "laneId": "lane-2", "text": "Butter", "visualDescription": "Stick of butter", "type": "ingredient" },
    { "id": "n4", "laneId": "lane-3", "text": "Cheese", "visualDescription": "Block of cheese", "type": "ingredient" },

    // Row 2 (Prep/Actions)
    { "id": "n5", "laneId": "lane-1", "text": "Whisk", "visualDescription": "Whisk beating eggs", "type": "action", "inputs": ["n1", "n2"] },
    { "id": "n6", "laneId": "lane-2", "text": "Melt", "visualDescription": "Butter melting in pan", "type": "action", "inputs": ["n3"] },
    { "id": "n7", "laneId": "lane-3", "text": "Grate", "visualDescription": "Cheese grating", "type": "action", "inputs": ["n4"] },

    // Row 3 (Merge)
    { "id": "n8", "laneId": "lane-2", "text": "Scramble", "visualDescription": "Eggs cooking in pan", "type": "action", "inputs": ["n5", "n6"] },

    // Row 4 (Finish)
    { "id": "n9", "laneId": "lane-2", "text": "Add Cheese", "visualDescription": "Cheese melting on eggs", "type": "action", "inputs": ["n8", "n7"] }
  ]
}
```

## Development Workflow

We adhere to a strict **Test Driven Development (TDD)** workflow.
...