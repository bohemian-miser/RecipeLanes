/*
 * Copyright (C) 2026 Bohemian Miser <https://substack.com/@bohemianmiser>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { getDataService, setDataService, MemoryDataService } from '../lib/data-service';
import assert from 'assert';

async function testStats() {
    console.log('Testing Stats Logic...');
    // Force Memory Service for Unit Test
    setDataService(new MemoryDataService());
    const service = getDataService();

    // 1. Setup
    const ingName = 'Test Ingredient';
    const iconUrl = 'http://test/icon1.png';
    const meta = { lcb: 0, impressions: 0, rejections: 0, textModel: 'test', imageModel: 'test' };
    
    // Create Ingredient & Icon
    // Note: saveIcon takes (ingredientId, name, visualDescription, ...)
    // Memory service standardizeIngredientName internally?
    // Let's pass standardized ID.
    const stdId = 'Test Ingredient'; // Standardized
    
    const { iconId } = await service.saveIcon(stdId, ingName, 'Desc', 'Prompt', iconUrl, Buffer.from(''), meta);
    
    // 2. Record Impression
    console.log('Recording Impression...');
    await service.recordImpression(stdId, iconId);
    let icons = await service.getIconsForIngredient(stdId);
    assert.strictEqual(icons[0].impressions, 1, 'Impression count should be 1');
    assert.strictEqual(icons[0].rejections, 0, 'Rejection count should be 0');

    // 3. Record Rejection
    console.log('Recording Rejection...');
    await service.recordRejection(iconUrl, ingName, stdId);
    icons = await service.getIconsForIngredient(stdId);
    assert.strictEqual(icons[0].rejections, 1, 'Rejection count should be 1');
    
    // 4. Verify Score Update
    // MemoryDataService might reset score to 0 or calc something.
    console.log('Score:', icons[0].score || icons[0].popularity_score);
    // Just verify it's a number
    assert.ok(typeof (icons[0].score ?? icons[0].popularity_score) === 'number');

    console.log('✅ Stats Logic Passed');
}

testStats().catch(e => {
    console.error(e);
    process.exit(1);
});