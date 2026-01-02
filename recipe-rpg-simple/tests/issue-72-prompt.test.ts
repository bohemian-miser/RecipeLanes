import { generateRecipePrompt } from '../lib/recipe-lanes/parser';
import { assert } from 'console';

function testPromptAmbiguityGuidance() {
    const prompt = generateRecipePrompt("Salt and Pepper");
    
    // Check if the prompt contains the new guidance
    const expectedGuidance = 'Avoid "Bell Pepper" unless specified';
    
    if (!prompt.includes(expectedGuidance)) {
        console.error('FAIL: Prompt does not contain ambiguity guidance for Pepper.');
        console.error('Expected to find:', expectedGuidance);
        console.error('Prompt content:', prompt);
        process.exit(1);
    }
    
    console.log('PASS: Prompt contains ambiguity guidance.');
}

testPromptAmbiguityGuidance();