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
    if (prompt.includes("Test Scrambled Eggs")) {
        return JSON.stringify({
            title: "Cheesy Scrambled Eggs",
            lanes: [{ id: "l1", label: "Prep", type: "prep" }, { id: "l2", label: "Cook", type: "cook" }],
            nodes: [
                { id: "egg", laneId: "l1", text: "3 Eggs", type: "ingredient", visualDescription: "egg" },
                { id: "salt", laneId: "l1", text: "Pinch of Salt", type: "ingredient", visualDescription: "salt" },
                { id: "butter", laneId: "l2", text: "Butter", type: "ingredient", visualDescription: "butter" },
                { id: "cheese", laneId: "l2", text: "Cheese", type: "ingredient", visualDescription: "cheese" },
                
                { id: "crack", laneId: "l1", text: "Cracked eggs", type: "action", visualDescription: "cracked eggs", inputs: ["egg"] },
                { id: "whisk", laneId: "l1", text: "Whisked eggs with salt", type: "action", visualDescription: "whisked eggs", inputs: ["crack", "salt"] },
                { id: "melt", laneId: "l2", text: "Melted butter", type: "action", visualDescription: "melted butter", inputs: ["butter"] },
                { id: "cook", laneId: "l2", text: "Scrambled eggs cooking", type: "action", visualDescription: "cooking eggs", inputs: ["whisk", "melt"] },
                { id: "final", laneId: "l2", text: "Scrambled eggs with cheese", type: "action", visualDescription: "final eggs", inputs: ["cook", "cheese"] }
            ]
        });
    }
    // Always return Swimlane JSON in mock mode for stability (default)
    return JSON.stringify({
        title: "Mock Recipe",
        lanes: [{ id: "l1", label: "Prep", type: "prep" }],
        nodes: [
            { id: "1", laneId: "l1", text: "Mock Ingredient 1", type: "ingredient", visualDescription: "Mock Ing 1" },
            { id: "2", laneId: "l1", text: "Mock Ingredient 2", type: "ingredient", visualDescription: "Mock Ing 2" },
            { id: "3", laneId: "l1", text: "Mock Action", type: "action", inputs: ["1", "2"], visualDescription: "Mock Act" }
        ]
    });
  }

  async generateImage(prompt: string): Promise<string> {
    return `https://placehold.co/64x64/png?text=Mock+${encodeURIComponent(prompt.slice(0, 10))}&uuid=${Math.random().toString(36).substring(7)}`;
  }
}

// Default to Real Service.
// Tests can swap this out using setAIService.
let currentService: AIService = new RealAIService();

export function getAIService(): AIService {
  console.log('[getAIService] MOCK_AI:', process.env.MOCK_AI);
  if (process.env.MOCK_AI === 'true') {
      return new MockAIService();
  }
  return currentService;
}

export function setAIService(service: AIService) {
  currentService = service;
}
