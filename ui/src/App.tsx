import { useState } from 'react'
import SwimlaneDiagram from './components/SwimlaneDiagram'
import type { RecipeGraph } from './types'
import './App.css'

const BOLOGNESE_EXAMPLE: RecipeGraph = {
  "lanes": [
    { "id": "lane-1", "label": "Pot (Pasta)", "type": "cook" },
    { "id": "lane-2", "label": "Pan (Sauce)", "type": "cook" }
  ],
  "nodes": [
    {
      "id": "node-1",
      "laneId": "lane-1",
      "text": "Add Spaghetti to boiling water",
      "visualDescription": "Spaghetti boiling in a pot of water",
      "iconUrl": "https://placehold.co/64x64/png?text=Boil",
      "type": "action",
      "duration": "10 min"
    },
    {
      "id": "node-2",
      "laneId": "lane-1",
      "text": "Drain",
      "visualDescription": "Pasta in a colander",
      "iconUrl": "https://placehold.co/64x64/png?text=Drain",
      "type": "action",
      "inputs": ["node-1"]
    },
    {
      "id": "node-3",
      "laneId": "lane-2",
      "text": "2 Onions",
      "visualDescription": "Chopped onion",
      "iconUrl": "https://placehold.co/64x64/png?text=Onion",
      "type": "ingredient"
    },
    {
      "id": "node-4",
      "laneId": "lane-2",
      "text": "3 cloves garlic",
      "visualDescription": "Chopped garlic",
      "iconUrl": "https://placehold.co/64x64/png?text=Garlic",
      "type": "ingredient"
    },
    {
      "id": "node-5",
      "laneId": "lane-2",
      "text": "Fry until soft",
      "visualDescription": "Onions and garlic frying in a pan",
      "iconUrl": "https://placehold.co/64x64/png?text=Fry",
      "type": "action",
      "inputs": ["node-3", "node-4"]
    },
    {
      "id": "node-6",
      "laneId": "lane-2",
      "text": "500g Minced Beef",
      "visualDescription": "Raw minced beef",
      "iconUrl": "https://placehold.co/64x64/png?text=Beef",
      "type": "ingredient"
    },
    {
      "id": "node-7",
      "laneId": "lane-2",
      "text": "Add Meat & Brown",
      "visualDescription": "Browned mince meat in a pan",
      "iconUrl": "https://placehold.co/64x64/png?text=Brown",
      "type": "action",
      "inputs": ["node-5", "node-6"]
    },
    {
      "id": "node-8",
      "laneId": "lane-2",
      "text": "Can of Tomato Sauce",
      "visualDescription": "Can of tomato sauce",
      "iconUrl": "https://placehold.co/64x64/png?text=Sauce",
      "type": "ingredient"
    },
    {
      "id": "node-9",
      "laneId": "lane-2",
      "text": "Add Sauce & Simmer",
      "visualDescription": "Red sauce simmering in a pan",
      "iconUrl": "https://placehold.co/64x64/png?text=Simmer",
      "type": "action",
      "duration": "15 min",
      "inputs": ["node-7", "node-8"]
    },
    {
      "id": "node-10",
      "laneId": "lane-2",
      "text": "Combine & Serve",
      "visualDescription": "Spaghetti being tossed in red sauce",
      "iconUrl": "https://placehold.co/64x64/png?text=Done",
      "type": "action",
      "inputs": ["node-2", "node-9"]
    }
  ]
};

function App() {
  const [graph] = useState<RecipeGraph>(BOLOGNESE_EXAMPLE);

  return (
    <div style={{ padding: '20px', fontFamily: 'Inter, sans-serif' }}>
      <h1>Recipe Lanes</h1>
      <SwimlaneDiagram graph={graph} />
    </div>
  )
}

export default App
