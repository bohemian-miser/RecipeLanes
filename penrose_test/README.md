# Penrose Graph Test

This is a Next.js application that demonstrates the use of `@penrose/core` to render a graph layout.

## Features

- **Penrose Integration**: Uses the `@penrose/core` library to compile and optimize a diagram defined in the Trio language (Domain, Substance, Style).
- **Graph Layout**: Defines a simple graph with Nodes and Edges.
- **Repulsion Algorithm**: Implements a repulsion force between nodes using Penrose's `encourage` keyword and an inverse distance function, simulating a force-directed layout.
- **Constraints**: Uses `ensure disjoint` to prevent node overlap.

## How to Run

1.  `npm install`
2.  `npm run dev`
3.  Open `http://localhost:3000`