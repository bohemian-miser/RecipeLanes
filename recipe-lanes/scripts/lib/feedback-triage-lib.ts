/**
 * Pure helpers for the feedback-triage pipeline (scripts/feedback-triage.ts).
 *
 * The repo is PUBLIC: anything the triage agent sees can end up in a GitHub
 * issue, so items handed to it must never contain reporter PII. Email is
 * dropped entirely and userId is truncated to a lookup hint; the Firestore
 * doc id is the owner's key back to the full record.
 */

export interface TriageItem {
    id: string;
    message: string;
    url: string;
    userIdHint: string | null;
    createdAt: string | null;
}

export function isUntriaged(data: Record<string, unknown>): boolean {
    return data.triage === undefined;
}

export function toTriageItem(id: string, data: Record<string, unknown>): TriageItem {
    const userId = typeof data.userId === 'string' ? data.userId : null;
    const createdAt = data.created_at as { toDate?: () => Date } | undefined;
    return {
        id,
        message: typeof data.message === 'string' ? data.message : '',
        url: typeof data.url === 'string' ? data.url : '',
        userIdHint: userId ? `${userId.slice(0, 8)}…` : null,
        createdAt: createdAt?.toDate ? createdAt.toDate().toISOString() : null,
    };
}
