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

import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function standardizeIngredientName(name: string) {
    return name
    .trim()
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

export function removeUndefined(obj: any): any {
    if (Array.isArray(obj)) {
        return obj.map(v => removeUndefined(v));
    } else if (obj !== null && typeof obj === 'object') {
        // Preserve Date, Firestore types (FieldValue, Timestamp, etc.), and other classes
        if (obj.constructor !== Object) {
            return obj;
        }
        return Object.entries(obj).reduce((acc, [k, v]) => {
            if (v !== undefined) {
                acc[k] = removeUndefined(v);
            }
            return acc;
        }, {} as any);
    }
    return obj;
}


export function calculateWilsonLCB(n: number, r: number): number {
    if (n === 0) return 0;
    const k = n - r; const p = k / n; const z = 1.645;
    const den = 1 + (z * z) / n;
    const centre = p + (z * z) / (2 * n);
    const adj = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n);
    return Math.max(0, (centre - adj) / den);
  }