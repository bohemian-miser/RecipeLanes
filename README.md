# [RecipeLanes.com](http://recipelanes.com/) 🍳🛣️

**Recipe Lanes** is a comprehensive visual recipe platform that transforms text into flowchart-style diagrams with custom AI-generated icons. It aims to revolutionize how we view cooking instructions by providing a structured, intuitive process flow instead of a linear wall of text.

---

## 🔗 Quick Links
- **Live Site:** [recipelanes.com](http://recipelanes.com)
- **Staging:** [staging.recipelanes.com](https://staging.recipelanes.com)
- **Screenshots & Demos:** [Browse all assets in /docs/screenshots](./docs/screenshots)
- **Architecture:** [Detailed System Design](./recipe-lanes/ARCHITECTURE.md)

---

## 🚀 Visual Showcase

Experience recipes as a structured flow, not just a wall of text.

| **The Lanes Editor** | **Visual Themes** | **Smart Layouts** |
| :---: | :---: | :---: |
| [![Lanes Editor](docs/screenshots/lane.png)](docs/screenshots/lane.png) | [![Themes](docs/screenshots/style.png)](docs/screenshots/style.png) | [![Layouts](docs/screenshots/smart.png)](docs/screenshots/smart.png) |
| *Separate prep and cooking steps.* | *Classic, Modern, and Clean themes.* | *Auto-organized for maximum readability.* |

---

## 🖱️ Interactive Experience

Recipe Lanes is fully interactive. Rearrange your recipe flow in real-time.

| **Dynamic Physics** | **Drag & Drop** | **Smart Tooling** | **AI Rerolls** |
| :---: | :---: | :---: | :---: |
| [![Physics](docs/screenshots/physics.gif)](docs/screenshots/physics.gif) | [![Move Nodes](docs/screenshots/move%20nodes.gif)](docs/screenshots/move%20nodes.gif) | [![Graph Tooling](docs/screenshots/graph-tooling.gif)](docs/screenshots/graph-tooling.gif) | [![Reroll Icons](docs/screenshots/reroll-short.gif)](docs/screenshots/reroll-short.gif) |
| *Nodes react as you move them.* | *Seamlessly rearrange your steps.* | *Powerful tools for graph manipulation.* | *Instantly regenerate any icon.* |

---

## ✨ Core Modules

### 1. 🎨 Icon Maker (Recipe RPG)
Forge custom 8-bit pixel art icons for ingredients using AI.
- **AI Forging:** Generate unique art for any ingredient.
- **Community Gallery:** Browse and vote on community-created icons.
- **Social Integration:** Star, reroll, and share your creations.

### 2. 🛣️ Lanes Editor
The heart of the platform where text becomes a process.
- **AI Parsing:** `gemini-2.5-flash` handles the heavy lifting of understanding recipe logic.
- **Interactive Graphs:** Drag-and-drop nodes, edit text, and visualize the entire process at a glance.
- **Custom Icons:** Integrated seamlessly from the Icon Maker library.

### 3. 🖼️ Public Gallery
Discover and share recipes from around the world.
- **Search:** Find recipes by title or ingredient.
- **Fork & Customize:** Clone any recipe to your private library to make it your own.

---

## 🧠 Philosophy: The State-Flow Pattern

To make recipes intuitive, we visualize them as a sequence of **States** and **Transitions**:

1.  **Ingredient Nodes (Input):** High-fidelity icons representing the *new* items being added.
2.  **Action Nodes (Prep & State):** Represent the *result* of a process (e.g., "Whisked Eggs" or "Sautéed Onions").
3.  **Lanes (Physical Vessels):** Represent the containers or locations (e.g., "Bowl", "Pan", "Oven").
4.  **Flow:** Logic flows top-down, with parallel lanes merging into the main dish.

---

## 🛠️ Tech Stack

- **Framework:** [Next.js 16](https://nextjs.org/) (App Router)
- **Styling:** [Tailwind CSS 4](https://tailwindcss.com/)
- **Graph Engine:** [React Flow](https://reactflow.dev/)
- **AI Stack:** [Google Genkit](https://github.com/firebase/genkit) (`gemini-2.5-flash`, `imagen-4.0`)
- **Backend:** [Firebase](https://firebase.google.com/) (Firestore, Storage, Auth, Cloud Functions)
- **Testing:** [Playwright](https://playwright.dev/) (E2E), [Vitest](https://vitest.dev/) (Unit)

---

## 🚀 Getting Started

### Installation
1.  Clone the repository:
    ```bash
    git clone https://github.com/your-username/RecipeLanes.git
    cd recipe-lanes
    ```
2.  Install dependencies:
    ```bash
    npm install
    cd functions && npm install && cd ..
    ```
3.  Set up your `.env` with Firebase and Vertex AI credentials.

### Running Locally
```bash
# Start development server
npm run dev
```

### Testing
```bash
# Run unit tests
npm run test:unit

# Run E2E tests (requires Firebase Emulators)
npm run test:e2e
```

---

## 📝 About the Project
I made this as a weekend project and it has grown since then and maybe one day with some help I could make it into something really great. This is the first website I've ever tried to make and it's got some bugs but it's surprisingly useful.

*Created with ❤️ for better cooking.*
