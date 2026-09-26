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

// Per-user icon-credit balances (`user_credits/{uid}`), Admin-SDK-only.
//
// The balance deliberately does NOT live on `users/{uid}`: firestore.rules
// gives a signed-in user full write access to their own user doc, so any
// balance stored there would be trivially self-editable. `user_credits` has
// no rules block (default deny), matching the `icon_forge_usage` precedent.
//
// There is no purchase flow yet. Every account is seeded with
// STARTER_ICON_CREDITS the first time its balance is touched, inside the
// same transaction that reads it — no backfill needed.
//
// Injectable service (setUserCreditsService) following the
// data-service/auth-service pattern, so the emulator-free pure test tier can
// exercise forgeIconAction against MemoryUserCreditsService.

import { FieldValue } from 'firebase-admin/firestore';
import { db } from './firebase-admin';
import { DB_COLLECTION_USER_CREDITS, STARTER_ICON_CREDITS } from './config';

export interface UserCredits {
    /** Spendable balance. */
    balance: number;
    /** Lifetime credits granted (starter grant + future purchases/awards). */
    granted: number;
    /** Lifetime credits spent. */
    spent: number;
}

export interface SpendResult {
    ok: boolean;
    /** Balance after the spend (or the unchanged balance when ok is false). */
    balance: number;
}

export interface UserCreditsService {
    /** Reads the balance, seeding the starter grant on first touch. */
    getCredits(uid: string): Promise<UserCredits>;
    /**
     * Atomically spends `cost` credits (starter grant seeded first for a
     * brand-new account). ok=false leaves the balance untouched.
     */
    spend(uid: string, cost: number): Promise<SpendResult>;
    /**
     * Returns `cost` credits, e.g. when a spend succeeded but the forge it
     * paid for failed to enqueue. Best-effort compensation — callers should
     * log (not throw) on failure.
     */
    refund(uid: string, cost: number): Promise<void>;
}

function assertValidCost(op: string, cost: number): void {
    if (!Number.isInteger(cost) || cost <= 0) {
        throw new Error(`${op}: invalid cost ${cost}`);
    }
}

// ---------------------------------------------------------------------------
// Firestore implementation (production)
// ---------------------------------------------------------------------------

function toUserCredits(raw: FirebaseFirestore.DocumentData | undefined): UserCredits {
    return {
        balance: typeof raw?.balance === 'number' ? raw.balance : 0,
        granted: typeof raw?.granted === 'number' ? raw.granted : 0,
        spent: typeof raw?.spent === 'number' ? raw.spent : 0,
    };
}

function starterDoc(uid: string) {
    return {
        uid,
        balance: STARTER_ICON_CREDITS,
        granted: STARTER_ICON_CREDITS,
        spent: 0,
        created_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
    };
}

export class FirestoreUserCreditsService implements UserCreditsService {
    private ref(uid: string) {
        return db.collection(DB_COLLECTION_USER_CREDITS).doc(uid);
    }

    async getCredits(uid: string): Promise<UserCredits> {
        return db.runTransaction(async (t) => {
            const ref = this.ref(uid);
            const snap = await t.get(ref);
            if (!snap.exists) {
                t.set(ref, starterDoc(uid));
                return { balance: STARTER_ICON_CREDITS, granted: STARTER_ICON_CREDITS, spent: 0 };
            }
            return toUserCredits(snap.data());
        });
    }

    async spend(uid: string, cost: number): Promise<SpendResult> {
        assertValidCost('spend', cost);
        return db.runTransaction(async (t) => {
            const ref = this.ref(uid);
            const snap = await t.get(ref);
            const current = snap.exists ? toUserCredits(snap.data()) : toUserCredits(starterDoc(uid));
            if (current.balance < cost) {
                // Still persist the starter grant for a first-touch account.
                if (!snap.exists) t.set(ref, starterDoc(uid));
                return { ok: false, balance: current.balance };
            }
            if (snap.exists) {
                t.update(ref, {
                    balance: FieldValue.increment(-cost),
                    spent: FieldValue.increment(cost),
                    updated_at: FieldValue.serverTimestamp(),
                });
            } else {
                t.set(ref, {
                    ...starterDoc(uid),
                    balance: STARTER_ICON_CREDITS - cost,
                    spent: cost,
                });
            }
            return { ok: true, balance: current.balance - cost };
        });
    }

    async refund(uid: string, cost: number): Promise<void> {
        assertValidCost('refund', cost);
        await this.ref(uid).set(
            {
                uid,
                balance: FieldValue.increment(cost),
                spent: FieldValue.increment(-cost),
                updated_at: FieldValue.serverTimestamp(),
            },
            { merge: true },
        );
    }
}

// ---------------------------------------------------------------------------
// In-memory implementation (pure test tier)
// ---------------------------------------------------------------------------

export class MemoryUserCreditsService implements UserCreditsService {
    private accounts = new Map<string, UserCredits>();

    private account(uid: string): UserCredits {
        let acc = this.accounts.get(uid);
        if (!acc) {
            acc = { balance: STARTER_ICON_CREDITS, granted: STARTER_ICON_CREDITS, spent: 0 };
            this.accounts.set(uid, acc);
        }
        return acc;
    }

    async getCredits(uid: string): Promise<UserCredits> {
        return { ...this.account(uid) };
    }

    async spend(uid: string, cost: number): Promise<SpendResult> {
        assertValidCost('spend', cost);
        const acc = this.account(uid);
        if (acc.balance < cost) return { ok: false, balance: acc.balance };
        acc.balance -= cost;
        acc.spent += cost;
        return { ok: true, balance: acc.balance };
    }

    async refund(uid: string, cost: number): Promise<void> {
        assertValidCost('refund', cost);
        const acc = this.account(uid);
        acc.balance += cost;
        acc.spent -= cost;
    }
}

// ---------------------------------------------------------------------------
// Singleton / factory (mirrors data-service / auth-service)
// ---------------------------------------------------------------------------

let currentService: UserCreditsService | null = null;

export function getUserCreditsService(): UserCreditsService {
    if (!currentService) currentService = new FirestoreUserCreditsService();
    return currentService;
}

export function setUserCreditsService(service: UserCreditsService): void {
    currentService = service;
}

// Thin function wrappers kept for call-site brevity.

export async function getUserCredits(uid: string): Promise<UserCredits> {
    return getUserCreditsService().getCredits(uid);
}

export async function spendIconCredits(uid: string, cost: number): Promise<SpendResult> {
    return getUserCreditsService().spend(uid, cost);
}

export async function refundIconCredits(uid: string, cost: number): Promise<void> {
    return getUserCreditsService().refund(uid, cost);
}
