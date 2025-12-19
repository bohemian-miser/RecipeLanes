import 'dotenv/config';
import { ai, textModel } from '../lib/genkit';
import { generateRecipePrompt, parseRecipeGraph } from '../lib/recipe-lanes/parser';

async function testRealRecipe(name: string, text: string) {
  console.log(`\n=== Testing Recipe: ${name} ===`);
  const prompt = generateRecipePrompt(text);
  
  try {
    const response = await ai.generate({
        model: textModel,
        prompt: prompt,
        config: { temperature: 0.2 }
    });
    
    const graph = parseRecipeGraph(response.text);
    console.log('✅ Parsed Successfully!');
    console.log(`Lanes: ${graph.lanes.length}`);
    console.log(`Nodes: ${graph.nodes.length}`);
    
    // Print simplified structure
    graph.lanes.forEach(lane => {
        console.log(`\nLane: ${lane.label} (${lane.type})`);
        const laneNodes = graph.nodes.filter(n => n.laneId === lane.id);
        laneNodes.forEach(node => {
            console.log(`  - [${node.type}] ${node.text} (Visual: ${node.visualDescription})`);
        });
    });

  } catch (e: any) {
      console.error('❌ Failed:', e.message);
  }
}

const RECIPE_MANGOMISU = `
**Mangomisu**
**Ingredients**
5 medium sized eggs, separated
5tbls caster sugar
300g Mascarpone cheese
1 cup fresh cream, whipped
3 mangoes
Grand marnier
Orange juice
1 large packet of sponge finger biscuits or savoiardi
½ tsp vanilla essence or a bean

**Method**
**Large bowl (1): –** where the action will happen
5 Egg yokes
5tbl Sugar
Wisk - Until Sugar is disolved

**Bowl (2):**
5 Egg whites
Wisk - Until Firm peaks

**Bowl (3):**
1 cup cream
Wisk - Until Firm peaks

**Large Bowl 1 (Yoke and Sugar):**
Slowly fold in
300g Marscarpone
Then Bowl 2 (Egg whites)
Then Bowl 3 (Cream)
Then ¼ cup of Grand Marnier
½ tsp Vanilla essence or bean seeds

**Shallow dish:**
Pour 1 cup Orange juice
¼ cup of Grand Marnier

**Serving Dish:**
Dip Biscuits into shallow dish then layer into serving dish
Create a layer of biscuits in dish
Cover with cream
Slices of mango
Repeat
Finish with an additional layer of biscuits...
Leave in fridge for 2hours
Cover in Raspberries and mango
`;

async function run() {
    await testRealRecipe('Mangomisu', RECIPE_MANGOMISU);
}

run();
