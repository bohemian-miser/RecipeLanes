import type { Firestore, QueryDocumentSnapshot, DocumentReference } from 'firebase-admin/firestore';

/**
 * An async generator that pages through a Firestore collection in batches and yields each QueryDocumentSnapshot.
 * Handles the startAfter cursor internally so callers never think about pagination.
 *
 * @param db The Firestore instance
 * @param collectionName The name of the collection to scan
 * @param batchSize The number of documents to fetch per page (default: 500)
 */
export async function* scanCollection(
    db: Firestore,
    collectionName: string,
    batchSize: number = 500
): AsyncGenerator<QueryDocumentSnapshot> {
    let query = db.collection(collectionName).limit(batchSize);
    let lastDoc: QueryDocumentSnapshot | null = null;

    while (true) {
        const snap = lastDoc ? await query.startAfter(lastDoc).get() : await query.get();
        if (snap.empty) break;

        for (const doc of snap.docs) {
            yield doc;
        }

        lastDoc = snap.docs[snap.docs.length - 1];
        if (snap.size < batchSize) break;
    }
}

/**
 * Returns an auditor object. fields is a record of dot-path -> validator function.
 * Supports a single level of array flattening using '[]' notation (e.g. 'icons[].id').
 *
 * @param name Name of the auditor for reporting
 * @param fields Record of dot-path -> validator function returning true on success or a string on failure
 */
export function createAuditor(name: string, fields: Record<string, (v: any) => boolean | string>) {
    const issues: Array<{ docId: string; path: string; error: string }> = [];
    let checkedCount = 0;

    return {
        check(docId: string, docData: any) {
            checkedCount++;
            for (const [path, validator] of Object.entries(fields)) {
                if (path.includes('[]')) {
                    const parts = path.split('[]');
                    const arrayPath = parts[0];
                    const restPath = parts[1]?.startsWith('.') ? parts[1].substring(1) : parts[1];

                    const keys = arrayPath ? arrayPath.split('.') : [];
                    let arr = docData;
                    if (arrayPath) {
                        for (const key of keys) {
                            arr = arr?.[key];
                        }
                    }

                    if (!Array.isArray(arr)) {
                        continue;
                    }

                    arr.forEach((item, index) => {
                        let val = item;
                        if (restPath) {
                            const itemKeys = restPath.split('.');
                            for (const key of itemKeys) {
                                val = val?.[key];
                            }
                        }
                        const res = validator(val);
                        if (res !== true) {
                            issues.push({
                                docId,
                                path: `${arrayPath}[${index}]${restPath ? `.${restPath}` : ''}`,
                                error: typeof res === 'string' ? res : 'validation failed'
                            });
                        }
                    });
                } else {
                    const keys = path.split('.');
                    let val = docData;
                    for (const key of keys) {
                        val = val?.[key];
                    }
                    const res = validator(val);
                    if (res !== true) {
                        issues.push({
                            docId,
                            path,
                            error: typeof res === 'string' ? res : 'validation failed'
                        });
                    }
                }
            }
        },
        report() {
            console.log(`\nAudit Report: ${name}`);
            console.log(`Documents checked: ${checkedCount}`);
            if (issues.length === 0) {
                console.log('✅ No issues found.');
            } else {
                console.log(`❌ ${issues.length} issue(s) found:\n`);
                for (const issue of issues) {
                    console.log(`  doc: "${issue.docId}"  path: ${issue.path}  issue: ${issue.error}`);
                }
            }
            return issues;
        }
    };
}

/**
 * Returns a migrator object that wraps writes with dry-run protection and accumulates a change log.
 *
 * @param name Name of the migration for reporting
 * @param options Configuration options including dryRun (default true)
 */
export function createMigrator(name: string, options: { dryRun?: boolean } = {}) {
    const dryRun = options.dryRun ?? true;
    const log: Array<{ docPath: string; message: string }> = [];

    return {
        async apply(docRef: DocumentReference, data: any, message: string) {
            log.push({ docPath: docRef.path, message });
            if (!dryRun) {
                await docRef.update(data);
            }
        },
        report() {
            console.log(`\nMigration Report: ${name} (Dry Run: ${dryRun})`);
            if (log.length === 0) {
                console.log('No changes applied.');
            } else {
                console.log(`${dryRun ? 'Would apply' : 'Applied'} ${log.length} change(s):\n`);
                const displayLog = log.slice(0, 50);
                for (const entry of displayLog) {
                    console.log(`  ${entry.docPath}: ${entry.message}`);
                }
                if (log.length > 50) {
                    console.log(`  ... and ${log.length - 50} more`);
                }
            }
            return log;
        }
    };
}
