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

import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".next-test/**",
    ".next-verify/**",
    ".playwright-mcp/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "warn",
      "prefer-const": "warn",
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/no-require-imports": "off",
      "react-hooks/rules-of-hooks": "off", 
      "react-hooks/exhaustive-deps": "warn",
      "@next/next/no-img-element": "off",
    },
  },
  {
    files: ["app/gallery/page.tsx"],
    rules: {
        "react-hooks/error-boundaries": "off" // Suppress try/catch JSX error for now
    }
  },
  // ---------------------------------------------------------------------------
  // RecipeNode / ShortlistEntry internals must only be accessed via model-utils.
  //
  // Direct property access on these types (e.g. node.iconShortlist,
  // entry.matchType) is only allowed inside lib/recipe-lanes/model-utils.ts.
  // All other callers must go through the exported helper functions so that
  // internal shape changes require edits in exactly one place.
  //
  // Fields guarded: iconShortlist, shortlistIndex, shortlistCycled, matchType,
  // iconTheme, hydeQueries, iconQuery.
  // (visualDescription and id are omitted — too broad, appear on many types.)
  //
  // Set to "warn" for now. Once existing violations are resolved this should
  // be promoted to "error".
  // ---------------------------------------------------------------------------
  {
    files: ["**/*.ts", "**/*.tsx"],
    ignores: [
      "lib/recipe-lanes/model-utils.ts",
      "lib/recipe-lanes/types.ts",
      "scripts/**",
      "functions/**",
    ],
    rules: {
      "no-restricted-syntax": [
        "warn",
        {
          selector: "MemberExpression[property.name='iconShortlist']",
          message: "Access RecipeNode.iconShortlist via model-utils (getNodeShortlistLength, getShortlistIconAt, getNodeShortlistKey, …).",
        },
        {
          selector: "MemberExpression[property.name='shortlistIndex']",
          message: "Access RecipeNode.shortlistIndex via model-utils (currentShortlistIndex, advanceShortlistIndex, …).",
        },
        {
          selector: "MemberExpression[property.name='shortlistCycled']",
          message: "Access RecipeNode.shortlistCycled via model-utils.",
        },
        {
          selector: "MemberExpression[property.name='matchType']",
          message: "Access ShortlistEntry.matchType via getEntryMatchType() in model-utils.",
        },
        {
          selector: "MemberExpression[property.name='iconTheme']",
          message: "Access RecipeNode.iconTheme via getNodeTheme() in model-utils.",
        },
        {
          selector: "MemberExpression[property.name='hydeQueries']",
          message: "Access RecipeNode.hydeQueries via getNodeHydeQueries() in model-utils.",
        },
        {
          selector: "MemberExpression[property.name='iconQuery']",
          message: "Access RecipeNode.iconQuery via model-utils.",
        },
      ],
    },
  },
]);

export default eslintConfig;