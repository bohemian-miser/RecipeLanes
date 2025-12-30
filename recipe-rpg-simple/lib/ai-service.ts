import { ai, textModel, imageModelName } from './genkit';

export interface AIService {
  generateText(prompt: string): Promise<string>;
  generateImage(prompt: string): Promise<string>;
}

export class RealAIService implements AIService {
  async generateText(prompt: string): Promise<string> {
    try {
        const response = await ai.generate({
        model: textModel,
        prompt: prompt,
        });
        return response.text || '';
    } catch (e) {
        console.error("Real AI failed, NOT falling back to Mock:", e);
        return "ai failed";
    }
  }

  async generateImage(prompt: string): Promise<string> {
    console.log(`[RealAIService] generateImage called with prompt: "${prompt.substring(0, 30)}"...`);
    try {
        const response = await ai.generate({
        model: imageModelName,
        prompt: prompt,
        });
        if (!response.media || !response.media.url) {
             throw new Error('No media returned');
        }
        console.log(`[RealAIService] Success. URL: ${response.media.url.substring(0, 50)}...`);
        return response.media.url;
    } catch (e) {
        console.error("Real AI Image Generation failed, NOT falling back to Mock (well kinda not):", e);
        return `https://placehold.co/64x64/png?text=Error+${encodeURIComponent(prompt.slice(0, 10))}`;
    }
  }
}

export class MockAIService implements AIService {
  async generateText(prompt: string): Promise<string> {
    const lower = prompt.toLowerCase();
    console.log("[MockAIService] generateText received prompt:", prompt);
    if (lower.includes("test eggs")) {
        // .slice(0, -1); is to remove trailing '"'
        const extraIngredient = lower.includes("test eggs with ") ? lower.split("test eggs with ")[1].trim().slice(0, -1) : null;
        
        const nodes = [
                { id: "1", laneId: "l1", text: "2 Eggs", type: "ingredient", visualDescription: "Eggs" },
                { id: "2", laneId: "l1", text: "100g Flour", type: "ingredient", visualDescription: "Flour" },
                { id: "3", laneId: "l1", text: "Mix", type: "action", inputs: ["1", "2"], visualDescription: "Mixing bowl" }
        ];

        if (extraIngredient) {
            nodes.push({ id: "4", laneId: "l1", text: extraIngredient, type: "ingredient", visualDescription: extraIngredient });
            // @ts-ignore
            nodes[2].inputs.push("4");
        }

        return JSON.stringify({
            title: "Mock Recipe",
            lanes: [{ id: "l1", label: "Prep", type: "prep" }],
            nodes
        });
    }
    if (lower.includes("complex")) {
        return JSON.stringify({
            title: "Complex Mock Recipe",
            lanes: [
                { id: "l1", label: "Prep", type: "prep" },
                { id: "l2", label: "Cook", type: "cook" }
            ],
            nodes: [
                // Parents (ingredients)
                { id: "1", laneId: "l1", text: "Ingredient A", type: "ingredient", visualDescription: "Ing A" },
                { id: "2", laneId: "l1", text: "Ingredient B", type: "ingredient", visualDescription: "Ing B" },
                // A and B (first level actions)
                { id: "3", laneId: "l1", text: "Process A", type: "action", inputs: ["1"], visualDescription: "Proc A" },
                { id: "4", laneId: "l1", text: "Process B", type: "action", inputs: ["2"], visualDescription: "Proc B" },
                // C - common node that A and B both point to
                { id: "5", laneId: "l2", text: "Combine (Common)", type: "action", inputs: ["3", "4"], visualDescription: "Common" },
                // D - extra thing A points to
                { id: "6", laneId: "l1", text: "Extra from A", type: "action", inputs: ["3"], visualDescription: "Extra A" },
                // E - extra thing B points to
                { id: "7", laneId: "l1", text: "Extra from B", type: "action", inputs: ["4"], visualDescription: "Extra B" },
                // F - one of the things C points to, also receives from D
                { id: "8", laneId: "l2", text: "Final Step F", type: "action", inputs: ["5", "6"], visualDescription: "Final F" },
                // G - the other thing C points to
                { id: "9", laneId: "l2", text: "Final Step G", type: "action", inputs: ["5"], visualDescription: "Final G" },
            ]
        });
    }
    // Generic fallback for E2E tests - Try to extract ingredient from prompt
    // Prompt usually contains: "convert the following cooking instructions... Input Recipe ... "
    // Handle both quoted and unquoted inputs, and varying newlines
    const match = prompt.match(/Input Recipe\s*\n\s*"?([\s\S]*)"?\s*$/);
    const inputDerived = match ? match[1].trim() : "Mock Ingredient 1";
    const lines = inputDerived.split('\n').filter(l => l.trim());
    const nodes = lines.map((l, i) => ({
        id: (i + 1).toString(),
        laneId: "l1",
        text: l.trim(),
        type: i === 0 ? "ingredient" : "action" as const,
        inputs: i > 0 ? [i.toString()] : undefined,
        visualDescription: l.trim()
    }));

    return JSON.stringify({
            title: "Mock Recipe",
            lanes: [{ id: "l1", label: "Prep", type: "prep" }],
            nodes: nodes.length > 0 ? nodes : [{ id: "1", laneId: "l1", text: "Mock Ingredient 1", type: "ingredient", visualDescription: "Mock Ingredient 1" }]
        });
  }

  async generateImage(prompt: string): Promise<string> {
    console.log(`[MockAIService] generateImage called for: "${prompt.substring(0, 30)}"...`);
    // Append random UUID to ensure unique URL for each generation (simulate reroll)
    const uuid = Math.random().toString(36).substring(7);
    const url = `https://placehold.co/64x64/png?text=Mock+${encodeURIComponent(prompt.slice(0, 10))}&uuid=${uuid}`;
    console.log(`[MockAIService] Returning mock URL: ${url}`);
    return url;
  }
}

// Default to Real or Mock based on env.
// Tests can swap this out using setAIService.
let currentService: AIService = process.env.MOCK_AI === 'true' ? new MockAIService() : new RealAIService();

export function getAIService(): AIService {
  return currentService;
}

export function setAIService(service: AIService) {
  currentService = service;
}
