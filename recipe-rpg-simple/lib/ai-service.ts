import { ai, textModel, imageModelName } from './genkit';

export interface AIService {
  generateText(prompt: string): Promise<string>;
  generateImage(prompt: string): Promise<string>;
}

export class RealAIService implements AIService {
  async generateText(prompt: string): Promise<string> {
    const response = await ai.generate({
      model: textModel,
      prompt: prompt,
    });
    return response.text || '';
  }

  async generateImage(prompt: string): Promise<string> {
    const response = await ai.generate({
      model: imageModelName,
      prompt: prompt,
    });
    if (!response.media || !response.media.url) {
      throw new Error('Real AI Image generation failed: No media returned');
    }
    return response.media.url;
  }
}

export class MockAIService implements AIService {
  async generateText(prompt: string): Promise<string> {
    const lower = prompt.toLowerCase();
    
    if (lower.includes("swimlane graph") || lower.includes("test scrambled eggs") || lower.includes("test eggs")) {
        const extraIngredient = lower.includes("test eggs with ") ? lower.split("test eggs with ")[1].trim() : null;
        
        const nodes = [
                { id: "1", laneId: "l1", text: "Mock Ingredient 1", type: "ingredient", visualDescription: "Mock Ing 1" },
                { id: "2", laneId: "l1", text: "Mock Ingredient 2", type: "ingredient", visualDescription: "Mock Ing 2" },
                { id: "3", laneId: "l1", text: "Mock Action", type: "action", inputs: ["1", "2"], visualDescription: "Mock Act" }
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
    // Generic fallback for E2E tests
    return JSON.stringify({
            title: "Mock Recipe",
            lanes: [{ id: "l1", label: "Prep", type: "prep" }],
            nodes: [{ id: "1", laneId: "l1", text: "Mock Ingredient 1", type: "ingredient", visualDescription: "Mock Ing 1" }]
        });
  }

  async generateImage(prompt: string): Promise<string> {
    // Append random UUID to ensure unique URL for each generation (simulate reroll)
    const uuid = Math.random().toString(36).substring(7);
    return `https://placehold.co/64x64/png?text=Mock+${encodeURIComponent(prompt.slice(0, 10))}&uuid=${uuid}`;
  }
}

// Default to Real Service.
// Tests can swap this out using setAIService.
let currentService: AIService = new RealAIService();

export function getAIService(): AIService {
  // Check process.env.MOCK_AI for runtime toggle (e.g. E2E tests via npm run start)
  if (process.env.MOCK_AI === 'true') {
      return new MockAIService();
  }
  return currentService;
}

export function setAIService(service: AIService) {
  currentService = service;
}