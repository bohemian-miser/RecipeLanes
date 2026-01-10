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