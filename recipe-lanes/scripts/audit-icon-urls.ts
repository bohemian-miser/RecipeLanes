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

import dotenv from 'dotenv';
import { URL } from 'url';

async function auditIcons() {
    const args = process.argv.slice(2);
    const stagingIndex = args.indexOf('--staging');
    
    if (stagingIndex !== -1) {
        console.log('✨ Switching to STAGING environment (.env.staging)...');
        delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
        dotenv.config({ path: '.env.staging', override: true });
    } else {
        dotenv.config();
    }

    const { db } = await import('../lib/firebase-admin');

    console.log('Starting Icon URL Audit...');

    const snapshot = await db.collection('ingredients').get();
    console.log(`Scanned ${snapshot.size} ingredients.`);

    const allUrls: string[] = [];
    let iconCount = 0;

    snapshot.forEach(doc => {
        const data = doc.data();
        if (data.icons && Array.isArray(data.icons)) {
            data.icons.forEach((icon: any) => {
                if (icon.url) {
                    allUrls.push(icon.url);
                    iconCount++;
                }
            });
        }
    });
    
    console.log(`Found ${iconCount} icons in Ingredients.`);

    // Also scan Recipes
    console.log('Scanning Recipes...');
    const recipeSnapshot = await db.collection('recipes').get();
    console.log(`Scanned ${recipeSnapshot.size} recipes.`);
    
    let recipeIconCount = 0;
    recipeSnapshot.forEach(doc => {
        const data = doc.data();
        if (data.graph && Array.isArray(data.graph.nodes)) {
            data.graph.nodes.forEach((node: any) => {
                const url = node.icon?.iconUrl || node.icon?.url;
                if (url) {
                    allUrls.push(url);
                    recipeIconCount++;
                }
            });
        }
    });
    console.log(`Found ${recipeIconCount} icons in Recipes.`);

    console.log(`Total URLs to analyze: ${allUrls.length}`);

    const domains = new Set<string>();
    const paramsMap = new Map<string, Set<string>>();
    const domainCounts = new Map<string, number>();

    allUrls.forEach(u => {
        try {
            const parsed = new URL(u);
            const hostname = parsed.hostname;
            
            domains.add(hostname);
            domainCounts.set(hostname, (domainCounts.get(hostname) || 0) + 1);
            
            if (!paramsMap.has(hostname)) {
                paramsMap.set(hostname, new Set());
            }
            parsed.searchParams.forEach((_, key) => {
                paramsMap.get(hostname)?.add(key);
            });
        } catch (e) {
            console.warn(`Invalid URL encountered: ${u}`);
        }
    });

    console.log('\n--- Summary ---');
    console.log('Unique Domains found:', domains.size);
    
    console.log('\n--- Domain Details ---');
    domains.forEach(domain => {
        console.log(`Domain: ${domain}`);
        console.log(`  Count: ${domainCounts.get(domain)}`);
        console.log(`  Params: ${Array.from(paramsMap.get(domain) || []).join(', ') || '(none)'}`);
        console.log('');
    });

    const localIcons = allUrls.filter(u => u.includes('127.0.0.1') || u.includes('localhost'));
    if (localIcons.length > 0) {
        console.log('\n🚨 WARNING: Found Localhost/Loopback URLs! This causes the "Local Network" permission prompt on iOS/macOS.');
        console.log(`Total Local URLs: ${localIcons.length}`);
        console.log('Samples:');
        localIcons.slice(0, 5).forEach(u => console.log(`  - ${u}`));
    } else {
        console.log('\n✅ No localhost/127.0.0.1 URLs found.');
    }
}

auditIcons().catch(console.error);