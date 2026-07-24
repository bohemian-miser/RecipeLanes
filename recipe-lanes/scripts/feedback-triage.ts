/**
 * CLI for the feedback-triage agent (.github/workflows/feedback-triage.yml).
 *
 * Reads user feedback from the `feedback` Firestore collection and marks docs
 * as triaged once the agent has filed (or deliberately skipped) a GitHub
 * issue for them. Output is PII-safe (no emails, truncated userIds) because
 * the repo and its issue tracker are public — see scripts/lib/feedback-triage-lib.ts.
 *
 * Usage:
 *   npx tsx scripts/feedback-triage.ts list [--limit 50]
 *       Print untriaged feedback docs as JSON (newest first).
 *   npx tsx scripts/feedback-triage.ts mark <docId> --issue <number>
 *       Record that a GitHub issue was filed for the doc.
 *   npx tsx scripts/feedback-triage.ts mark <docId> --skip "<reason>"
 *       Record that the doc was reviewed and deliberately not filed.
 *
 * Auth: ADC (GOOGLE_APPLICATION_CREDENTIALS) or FIREBASE_SERVICE_ACCOUNT_KEY,
 * with NEXT_PUBLIC_FIREBASE_PROJECT_ID selecting the project — same as the
 * other scripts in this directory.
 */

import dotenv from 'dotenv';
import { FieldValue } from 'firebase-admin/firestore';
import { DB_COLLECTION_FEEDBACK } from '../lib/config';
import { scanCollection } from './lib/db-tools';
import { isUntriaged, toTriageItem } from './lib/feedback-triage-lib';

dotenv.config();

function usageDie(msg: string): never {
    console.error(msg);
    console.error('Usage: feedback-triage.ts list [--limit N] | mark <docId> --issue <n> | mark <docId> --skip "<reason>"');
    process.exit(1);
}

async function main() {
    const { db } = await import('../lib/firebase-admin');
    const [cmd, ...rest] = process.argv.slice(2);

    if (cmd === 'list') {
        const limitIdx = rest.indexOf('--limit');
        const limit = limitIdx >= 0 ? parseInt(rest[limitIdx + 1], 10) : 50;
        if (!Number.isFinite(limit) || limit < 1) usageDie('Invalid --limit');

        // No `triage` field on legacy docs, so a query can't select them —
        // and orderBy('created_at') would silently drop any doc missing that
        // field. Scan the whole collection (feedback volume is tiny) and
        // filter here; --limit caps how many items are emitted per run.
        const items = [];
        let scanned = 0;
        for await (const doc of scanCollection(db, DB_COLLECTION_FEEDBACK)) {
            scanned++;
            if (isUntriaged(doc.data())) items.push(toTriageItem(doc.id, doc.data()));
            if (items.length >= limit) break;
        }
        console.log(JSON.stringify(items, null, 2));
        console.error(`${items.length} untriaged of ${scanned} scanned (limit ${limit})`);
        return;
    }

    if (cmd === 'mark') {
        const [docId] = rest;
        if (!docId) usageDie('mark requires a docId');
        const issueIdx = rest.indexOf('--issue');
        const skipIdx = rest.indexOf('--skip');
        if ((issueIdx >= 0) === (skipIdx >= 0)) usageDie('mark requires exactly one of --issue <n> or --skip "<reason>"');

        const ref = db.collection(DB_COLLECTION_FEEDBACK).doc(docId);
        const doc = await ref.get();
        if (!doc.exists) usageDie(`No feedback doc ${docId}`);

        let triage: Record<string, unknown>;
        if (issueIdx >= 0) {
            const issue = parseInt(rest[issueIdx + 1], 10);
            if (!Number.isFinite(issue) || issue < 1) usageDie('Invalid --issue number');
            triage = { status: 'filed', issue, at: FieldValue.serverTimestamp() };
        } else {
            const reason = rest[skipIdx + 1];
            if (!reason) usageDie('--skip requires a reason');
            triage = { status: 'skipped', reason, at: FieldValue.serverTimestamp() };
        }
        await ref.update({ triage });
        console.log(`Marked ${docId}: ${JSON.stringify({ ...triage, at: 'serverTimestamp' })}`);
        return;
    }

    usageDie(`Unknown command: ${cmd ?? '(none)'}`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
