import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function standardizeIngredientName(name: string): string {
    return name.trim().split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
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