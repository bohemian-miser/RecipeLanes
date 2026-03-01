# [RecipeLanes.com](http://recipelanes.com/) 🍳🛣️

**Recipe Lanes** is a visual recipe platform that transforms text into flowchart-style diagrams. It's an attempt to make cooking instructions more intuitive by showing the process as a structured flow instead of a wall of text.

---

## 🔗 Quick Links
- **Live Site:** [recipelanes.com](http://recipelanes.com)
- **Staging:** [staging.recipelanes.com](https://staging.recipelanes.com)
- **Screenshots & Demos:** [Browse all assets in /docs/screenshots](./docs/screenshots)
- **Architecture:** [Detailed System Design](./recipe-lanes/ARCHITECTURE.md)

---

### 🎨 AI Icons & Global Cache
Every ingredient icon is stored in a **global cache**, meaning once an icon is generated for "Carrot," it's available for everyone. If you don't like an icon the AI picked, you can **reroll** it until you find one that fits.

[![Reroll Icons](docs/screenshots/reroll-short.gif)](docs/screenshots/reroll-short.gif)

---

## 🚀 Visual Showcase

| **The Lanes Editor** | **Visual Themes** | **Smart Layouts** |
| :---: | :---: | :---: |
| [![Lanes Editor](docs/screenshots/lane.png)](docs/screenshots/lane.png) | [![Themes](docs/screenshots/style.png)](docs/screenshots/style.png) | [![Layouts](docs/screenshots/smart.png)](docs/screenshots/smart.png) |
| *Separate prep and cooking steps.* | *Classic, Modern, and Clean themes.* | *Auto-organized for readability.* |

---

## 🖱️ Interactive Experience

The site is fully interactive. You can rearrange your recipe flow in real-time.

| **Drag & Drop** | **Smart Tooling** |
| :---: | :---: |
| [![Move Nodes](docs/screenshots/move%20nodes.gif)](docs/screenshots/move%20nodes.gif) | [![Graph Tooling](docs/screenshots/graph-tooling.gif)](docs/screenshots/graph-tooling.gif) |
| *Rearrange steps manually.* | *Tools for graph manipulation.* |

---

## ✨ How it Works

### 1. 🛣️ Lanes Editor
- **AI Logic:** An LLM converts the recipe into structured metadata with icon descriptions and then these are generated with an image model.
- **Interactive Graphs:** Drag-and-drop nodes, edit text, and visualize the entire process at a glance.

### 2. 🎨 Icon Maker
- **Forge Icons:** Generate unique 8-bit art for any ingredient.
- **Gallery:** Browse and vote on icons created by the community.

### 3. 🖼️ Public Gallery
- **Search:** Find recipes by title or ingredient.
- **Fork:** Clone any recipe to your private library to customize it.

---

## 🛠️ Tech Stack

- **Framework:** [Next.js 16](https://nextjs.org/) (App Router)
- **Styling:** [Tailwind CSS 4](https://tailwindcss.com/)
- **Graph Engine:** [React Flow](https://reactflow.dev/)
- **AI:** [Google Genkit](https://github.com/firebase/genkit)
- **Backend:** [Firebase](https://firebase.google.com/) (Firestore, Storage, Auth, Functions)
- **Testing:** [Playwright](https://playwright.dev/), [Vitest](https://vitest.dev/)

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
I made this as a weekend project and it has grown since then. This is the first website I've ever tried to make and it's got some bugs but it's surprisingly useful.

We even enabled force simulation, it's not too usefull but it is entertaining.

[![Physics](docs/screenshots/physics.gif)](docs/screenshots/physics.gif)

*Created with ❤️ for better cooking.*
