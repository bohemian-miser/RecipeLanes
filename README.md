# Recipe Lanes

A visual recipe editor that transforms text into clear, lane-based process graphs with AI-generated icons.

## Overview

**Recipe Lanes** aims to revolutionize how we view cooking instructions. Instead of a linear wall of text, it parses recipes into a structured graph where:
*   **Nodes** are actions or ingredients (e.g., "Grate Carrots", "Sear Steak").
*   **Lanes** represent physical locations or containers (e.g., "Chopping Board", "Fry Pan", "Oven").
*   **Edges** represent the flow of ingredients between steps.

This structure allows for a "Swimlane" visualization that clarifies parallel tasks and ingredient flow at a glance.

## Core Features

1.  **AI Parsing (Text-to-Graph):**
    *   Input: Raw recipe text.
    *   Process: An AI model (Gemini 2.5 Flash via Vertex AI) analyzes the text to extract a structured JSON representation.
    *   Output: A graph where instructions are assigned to lanes (containers) and linked by dependencies.

2.  **Visual Inventory (Icon Generation):**
    *   Input: A simplified visual description from the graph node.
    *   **Guideline:** Descriptions should focus on the *object* and the *action* without showing human body parts (hands). They should capture the state transition or the tool interaction clearly. The state of the ingredient (grated, chopped, whisked) must be reflected in the prompt.
    *   **Examples:**
        *   "Grated Carrot" -> "A carrot going into a grater."
        *   "Adding Grated Carrot" -> "Grated orange carrot shreds falling into a skillet."
        *   "Whisked Eggs" -> "A wire whisk beating eggs in a glass bowl."
        *   "Seared Steak" -> "A steak sizzling in a hot cast iron skillet."
    *   Process: An image generation model (Imagen 3 via Vertex AI) creates a consistent pixel-art style icon.
    *   **Smart Caching:** We use a caching strategy (proven in our `recipe-rpg-simple` prototype) to reuse icons for similar ingredients, ensuring visual consistency and speed.

3.  **Graph Visualization:**
    *   A dynamic UI that lays out the graph with vertical lanes.
    *   Arrows connect nodes to show the sequence of operations.
    *   Nodes display their generated icon and specific instruction text.

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
*Note: Since the entire process happens in a single cooking vessel (or flow), it uses a single lane. Lane splits are reserved for parallel processes (e.g., Oven + Stovetop).*

```json
{
  "lanes": [
    { "id": "lane-1", "label": "Skillet (Process)", "type": "cook" }
  ],
  "nodes": [
    {
      "id": "node-1",
      "laneId": "lane-1",
      "text": "Grate 2 large carrots",
      "visualDescription": "A carrot going into a grater",
      "type": "ingredient" 
    },
    {
      "id": "node-2",
      "laneId": "lane-1",
      "text": "Add carrots to skillet",
      "visualDescription": "Grated orange carrot shreds falling into a hot skillet",
      "type": "action",
      "temperature": "Medium Heat",
      "duration": "5 min",
      "inputs": ["node-1"] 
    }
  ]
}
```

### Example 2: Scrambled Eggs

**Input Text:**
> "Crack 3 eggs into a bowl. Whisk them with a pinch of salt. Melt butter in a non-stick pan. Pour the eggs into the pan and stir gently until set."

**Critique & Update:**
This recipe involves **two** distinct parallel locations initially: the *Bowl* (prep) and the *Pan* (cook). The ingredients merge into the Pan. This justifies **two lanes**.

**Structured Output:**
```json
{
  "lanes": [
    { "id": "lane-1", "label": "Bowl", "type": "prep" },
    { "id": "lane-2", "label": "Non-Stick Pan", "type": "cook" }
  ],
  "nodes": [
    {
      "id": "node-1",
      "laneId": "lane-1",
      "text": "Crack 3 eggs & add salt",
      "visualDescription": "Three cracked eggs in a glass bowl",
      "type": "ingredient"
    },
    {
      "id": "node-2",
      "laneId": "lane-1",
      "text": "Whisk eggs",
      "visualDescription": "A wire whisk beating yellow eggs in a glass bowl",
      "type": "action",
      "inputs": ["node-1"]
    },
    {
      "id": "node-3",
      "laneId": "lane-2",
      "text": "Melt butter",
      "visualDescription": "A pat of yellow butter melting in a black pan",
      "type": "ingredient"
    },
    {
      "id": "node-4",
      "laneId": "lane-2",
      "text": "Pour eggs & scramble",
      "visualDescription": "Yellow liquid eggs pouring into a pan",
      "type": "action",
      "inputs": ["node-2", "node-3"]
    }
  ]
}
```

## Development Workflow

We adhere to a strict **Test Driven Development (TDD)** workflow.

1.  **Tests First:** All new features or bug fixes start with a failing test.
2.  **Green Build:** We do not push failing builds. CI/CD (GitHub Actions) runs on every push to enforce this.
3.  **Local Simulation:** We use local scripts and mocks (e.g., `npm run verify` in the sub-projects) to ensure stability before deployment.
4.  **Mock Services:** We rely on robust mocking for AI, Auth, and Data services during testing to ensure deterministic and fast builds.

## Directory Structure

*   `recipe-rpg-simple/`: A functional toy prototype demonstrating the Icon Forge and Caching logic.
*   `ui/`: (Experimental) The initial frontend implementation for the graph visualization. This will be the base for the main application.
