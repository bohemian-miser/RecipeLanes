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

/**
 * Audits ingredients_new for icons missing required IconStats fields (id, visualDescription).
 *
 * Usage:
 *   npx tsx scripts/audit-icon-schema.ts            # production
 *   npx tsx scripts/audit-icon-schema.ts --staging  # staging
 */

import dotenv from 'dotenv';
import { DB_COLLECTION_INGREDIENTS } from '../lib/config';
import { scanCollection, createAuditor } from './lib/db-tools';

const staging = process.argv.includes('--staging');
if (staging) {
    console.log('✨ Switching to STAGING environment (.env.staging)...');
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    dotenv.config({ path: '.env.staging', override: true });
} else {
    dotenv.config();
}

async function main() {
    const { db } = await import('../lib/firebase-admin');

    const auditor = createAuditor('IngredientDoc icons[]', {
        'icons[].id': (v) => typeof v === 'string' || 'missing id',
        'icons[].visualDescription': (v) => typeof v === 'string' || 'missing visualDescription',
    });

    for await (const doc of scanCollection(db, DB_COLLECTION_INGREDIENTS, 200)) {
        auditor.check(doc.id, doc.data());
    }

    auditor.report();
}

main().catch(e => {
    console.error('Script failed:', e);
    process.exit(1);
});
