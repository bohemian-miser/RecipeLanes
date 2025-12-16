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
    return `Mock visual description for: ${prompt.slice(0, 20)}...`;
  }

  async generateImage(prompt: string): Promise<string> {
    return `https://placehold.co/64x64/png?text=Mock+${encodeURIComponent(prompt.slice(0, 10))}`;
  }
}

// Default to Real Service.
// Tests can swap this out using setAIService.
let currentService: AIService = new RealAIService();

export function getAIService(): AIService {
  return currentService;
}

export function setAIService(service: AIService) {
  currentService = service;
}
