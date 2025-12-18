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
    *   **Guideline:** Descriptions should focus on the *object* and the *action* without showing human body parts (hands). They should capture the state transition or the tool interaction clearly.
    *   **Examples:**
        *   *Result:* "Grated Carrot" -> *Prompt:* "A carrot going into a box grater."
        *   *Result:* "Whisked Eggs" -> *Prompt:* "A wire whisk beating eggs in a glass bowl."
        *   *Result:* "Seared Steak" -> *Prompt:* "A steak sizzling in a hot cast iron skillet."
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

## Data Structure (Draft)

The AI is prompted to return a JSON structure roughly following this schema:

```json
{
  "lanes": [
    { "id": "lane-1", "label": "Cutting Board", "type": "prep" },
    { "id": "lane-2", "label": "Large Skillet", "type": "cook" }
  ],
  "nodes": [
    {
      "id": "node-1",
      "laneId": "lane-1",
      "text": "Grate 2 carrots",
      "visualDescription": "A carrot going into a box grater",
      "type": "ingredient" 
    },
    {
      "id": "node-2",
      "laneId": "lane-2",
      "text": "Add carrots to pan",
      "visualDescription": "Carrots falling into a skillet",
      "type": "action",
      "inputs": ["node-1"]
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
