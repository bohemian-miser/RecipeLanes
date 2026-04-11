/**
 * Backward-compat re-export from the central icon search registry.
 * Add new methods in lib/icon-search-registry.ts — not here.
 */
export type { IconSearchMethod as IconSearchProvider, IconSearchResult } from './icon-search-registry';
export { iconSearchMethods as iconSearchProviders } from './icon-search-registry';
