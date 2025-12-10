import React, { useState } from 'react';
import type { RecipeGraph } from './types';
import { parseRecipe } from './utils/parser';
import SwimlaneDiagram from './components/SwimlaneDiagram';
import './App.css';

const LEMON_CURD_DEMO: RecipeGraph = {
  ingredients: [
    { id: 'lemon', name: 'Lemon (juice + zest)', quantity: '1', icon: '🍋' },
    { id: 'sugar', name: 'Sugar', quantity: '3/4 cup', icon: '🍚' },
    { id: 'yolks', name: 'Egg Yolks', quantity: '2', icon: '🥚' },
    { id: 'butter', name: 'Butter', quantity: '1/4 cup', icon: '🧈' },
  ],
  steps: [
    {
      id: 'step-1',
      label: '1',
      description: 'Squeeze lemon & zest into sugar.',
      resource: 'bench',
      resourceType: 'prep',
      dependencies: ['lemon', 'sugar'],
      state: 'done',
      duration: '5m',
      icon: '🥣'
    },
    {
      id: 'step-2',
      label: '2',
      description: 'Whip in egg yolks until pale.',
      resource: 'bench',
      resourceType: 'prep',
      dependencies: ['step-1', 'yolks'],
      state: 'done',
      duration: '3m',
      icon: '🌪️'
    },
    {
      id: 'step-3',
      label: '3',
      description: 'Cook stirring constantly.',
      resource: 'stove',
      resourceType: 'cook',
      dependencies: ['step-2'],
      state: 'active',
      duration: '10m',
      temperature: '82°C',
      icon: '🍳'
    },
    {
      id: 'step-4',
      label: '4',
      description: 'Remove from heat.',
      resource: 'off_heat',
      resourceType: 'cool',
      dependencies: ['step-3'],
      state: 'waiting',
      duration: '1m',
      icon: '❄️'
    },
    {
      id: 'step-5',
      label: '5',
      description: 'Stir in cold butter.',
      resource: 'off_heat',
      resourceType: 'cool',
      dependencies: ['step-4', 'butter'],
      state: 'waiting',
      duration: '5m',
      icon: '🧈'
    }
  ],
  lanes: ['bench', 'stove', 'off_heat']
};

const PASTA_TEXT = `- 200g Flour
- 2 Eggs
1. Pour flour into a mound [Bench]
2. Crack eggs into center [Bench] (1)
3. Whisk eggs gradually incorporating flour {5m} [Bench] (2)
4. Knead dough until smooth {10m} [Bench] (3)
5. Rest dough {30m} [Fridge] (4)
6. Roll out sheets [Bench] (5)
7. Boil salted water @100C [Stove]
8. Cook pasta {3m} @100C [Stove] (6, 7)`;

const STEAK_TEXT = `- Steak (Ribeye)
- Salt & Pepper
- Butter
- Garlic & Thyme
1. Pat steak dry and season generously [Prep]
2. Preheat cast iron pan @High [Stove]
3. Sear steak until crusty {4m} [Stove] (1, 2)
4. Flip and add butter/herbs [Stove] (3)
5. Baste continuously {3m} [Stove] (4)
6. Rest meat {10m} [Board] (5)`;

class ErrorBoundary extends React.Component<{children: React.ReactNode}, {hasError: boolean, error: any}> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 20, border: '1px solid red', borderRadius: 4, background: '#fee' }}>
          <h3>Something went wrong.</h3>
          <pre>{this.state.error?.toString()}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

const App: React.FC = () => {
  const [mode, setMode] = useState<'demo' | 'editor'>('demo');
  const [recipeText, setRecipeText] = useState<string>(PASTA_TEXT);
  const [parsedGraph, setParsedGraph] = useState<RecipeGraph | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  // Auto-parse on load
  React.useEffect(() => {
    if (mode === 'editor') {
      handleParse();
    }
  }, [mode]);

  const handleParse = () => {
    setParseError(null);
    try {
      const graph = parseRecipe(recipeText);
      console.log("Parsed Graph:", graph); // Debug log
      setParsedGraph(graph);
    } catch (error: any) {
      console.error("Error parsing recipe:", error);
      setParseError(error.message || "Unknown parsing error");
      setParsedGraph(null);
    }
  };

  const loadExample = (text: string) => {
    setRecipeText(text);
    // setTimeout to allow state update before parse if we were synchronous, 
    // but here we can just parse the text directly or wait for effect?
    // Let's just set text and let the user click parse, or call parse directly.
    try {
        const graph = parseRecipe(text);
        setParsedGraph(graph);
        setMode('editor');
        setParseError(null);
    } catch (e: any) {
        setParseError(e.message);
    }
  };

  return (
    <div className="app-container">
      <header>
        <h1>RecipeLanes 👩‍🍳</h1>
        <p>Turn recipes into clear, beautiful infographics.</p>
      </header>
      
      <div className="controls">
        <button className={mode === 'demo' ? 'active' : ''} onClick={() => setMode('demo')}>
          Lemon Curd Demo
        </button>
        <button className={mode === 'editor' ? 'active' : ''} onClick={() => setMode('editor')}>
          Editor
        </button>
      </div>

      {mode === 'editor' && (
        <div className="editor-container">
           <div className="sidebar">
             <h3>Examples</h3>
             <button onClick={() => loadExample(PASTA_TEXT)}>🍝 Fresh Pasta</button>
             <button onClick={() => loadExample(STEAK_TEXT)}>🥩 Perfect Steak</button>
             
             <div className="syntax-guide">
               <h4>Syntax Guide</h4>
               <code>1. Action {'{Duration}'} @Temp [Lane] (Deps)</code>
               <ul>
                 <li><strong>{'{10m}'}</strong> Duration</li>
                 <li><strong>@180C</strong> Temperature</li>
                 <li><strong>[Oven]</strong> Lane/Resource</li>
                 <li><strong>(1, 2)</strong> Depends on Step 1 & 2</li>
               </ul>
             </div>
           </div>

           <div className="main-input">
              <textarea
                value={recipeText}
                onChange={(e) => setRecipeText(e.target.value)}
                placeholder="Type your recipe here..."
                spellCheck={false}
              />
              <button className="primary-btn" onClick={handleParse}>
                Update Graph ⚡
              </button>
              {parseError && (
                  <div style={{ color: 'red', marginTop: 10, padding: 10, background: '#fee', borderRadius: 4 }}>
                      Error: {parseError}
                  </div>
              )}
           </div>
        </div>
      )}

      <div className="visualization-section">
        <ErrorBoundary key={mode === 'demo' ? 'demo' : (parsedGraph ? parsedGraph.steps.length : 'empty')}>
            {(mode === 'demo' ? LEMON_CURD_DEMO : parsedGraph) ? (
            <SwimlaneDiagram graph={mode === 'demo' ? LEMON_CURD_DEMO : parsedGraph!} />
            ) : (
            <div className="empty-state">Graph will appear here...</div>
            )}
        </ErrorBoundary>
      </div>
    </div>
  );
};

export default App;
