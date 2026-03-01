#  *
#  * Copyright (C) 2026 Bohemian Miser <https://substack.com/@bohemianmiser>
#  *
#  * This program is free software: you can redistribute it and/or modify
#  * it under the terms of the GNU Affero General Public License as published
#  * by the Free Software Foundation, either version 3 of the License, or
#  * (at your option) any later version.
#  *
#  * This program is distributed in the hope that it will be useful,
#  * but WITHOUT ANY WARRANTY; without even the implied warranty of
#  * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
#  * GNU Affero General Public License for more details.
#  *
#  * You should have received a copy of the GNU Affero General Public License
#  * along with this program.  If not, see <https://www.gnu.org/licenses/>.
#  *
import os

HEADER = """/*
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
"""

FILES = [
    "./recipe-lanes/playwright.config.ts",
    "./recipe-lanes/next.config.ts",
    "./recipe-lanes/lib/recipe-lanes/graph-utils.ts",
    "./recipe-lanes/lib/recipe-lanes/adjuster.ts",
    "./recipe-lanes/lib/recipe-lanes/layout.ts",
    "./recipe-lanes/lib/recipe-lanes/parser.ts",
    "./recipe-lanes/lib/recipe-lanes/layout-force.ts",
    "./recipe-lanes/lib/recipe-lanes/model-utils.ts",
    "./recipe-lanes/lib/recipe-lanes/types.ts",
    "./recipe-lanes/lib/firebase-admin.js",
    "./recipe-lanes/lib/data-service.ts",
    "./recipe-lanes/lib/store.ts",
    "./recipe-lanes/lib/genkit.ts",
    "./recipe-lanes/lib/firebase-admin.ts",
    "./recipe-lanes/lib/auth-service.ts",
    "./recipe-lanes/lib/config.ts",
    "./recipe-lanes/lib/ai-service.ts",
    "./recipe-lanes/lib/flows.ts",
    "./recipe-lanes/lib/utils.ts",
    "./recipe-lanes/lib/firebase-client.ts",
    "./recipe-lanes/eslint.config.mjs",
    "./recipe-lanes/tests/undo-scrambled-logic.test.ts",
    "./recipe-lanes/tests/stats.test.ts",
    "./recipe-lanes/tests/functions-metadata.test.ts",
    "./recipe-lanes/tests/graph-utils.test.ts",
    "./recipe-lanes/tests/undo-complex.test.ts",
    "./recipe-lanes/tests/image-processing.test.ts",
    "./recipe-lanes/tests/lifecycle.test.ts",
    "./recipe-lanes/tests/verify-production-logic.test.ts",
    "./recipe-lanes/tests/undo.test.ts",
    "./recipe-lanes/tests/admin-security.test.ts",
    "./recipe-lanes/tests/optimistic-flow.test.ts",
    "./recipe-lanes/tests/social-features.test.ts",
    "./recipe-lanes/tests/gallery-view.test.ts",
    "./recipe-lanes/e2e/issue-69-repro.spec.ts",
    "./recipe-lanes/e2e/undo-race.spec.ts",
    "./recipe-lanes/e2e/save-and-share.spec.ts",
    "./recipe-lanes/e2e/download.spec.ts",
    "./recipe-lanes/e2e/pending-creations.spec.ts",
    "./recipe-lanes/e2e/lanes-icon-generation.spec.ts",
    "./recipe-lanes/e2e/utils/fixtures.ts",
    "./recipe-lanes/e2e/utils/devices.ts",
    "./recipe-lanes/e2e/utils/actions.ts",
    "./recipe-lanes/e2e/utils/admin-utils.ts",
    "./recipe-lanes/e2e/utils/seed-data.ts",
    "./recipe-lanes/e2e/utils/screenshot.ts",
    "./recipe-lanes/e2e/issue-66-repro.spec.ts",
    "./recipe-lanes/e2e/graph-interaction.spec.ts",
    "./recipe-lanes/e2e/reroll-sanity.spec.ts",
    "./recipe-lanes/e2e/issue-61-glitch.spec.ts",
    "./recipe-lanes/e2e/issue-34-hide-uid.spec.ts",
    "./recipe-lanes/e2e/basic.spec.ts",
    "./recipe-lanes/e2e/comprehensive.spec.ts",
    "./recipe-lanes/e2e/guest-fork.spec.ts",
    "./recipe-lanes/e2e/icon-generation.spec.ts",
    "./recipe-lanes/e2e/arrow-alignment.spec.ts",
    "./recipe-lanes/e2e/stats-comprehensive.spec.ts",
    "./recipe-lanes/e2e/layout-reset.spec.ts",
    "./recipe-lanes/e2e/issue-67-repro.spec.ts",
    "./recipe-lanes/e2e/stats-tracking.spec.ts",
    "./recipe-lanes/e2e/ui-features.spec.ts",
    "./recipe-lanes/e2e/move-node-save.spec.ts",
    "./recipe-lanes/e2e/banners.spec.ts",
    "./recipe-lanes/e2e/issue-74-repro.spec.ts",
    "./recipe-lanes/e2e/delete-recipe.spec.ts",
    "./recipe-lanes/e2e/gallery-search.spec.ts",
    "./recipe-lanes/e2e/optimistic-ui.spec.ts",
    "./recipe-lanes/e2e/pivot.spec.ts",
    "./recipe-lanes/e2e/vetting.spec.ts",
    "./recipe-lanes/e2e/nav-auth.spec.ts",
    "./recipe-lanes/e2e/undo-persistence.spec.ts",
    "./recipe-lanes/e2e/auth-flow.spec.ts",
    "./recipe-lanes/e2e/delete-recipe-mobile.spec.ts",
    "./recipe-lanes/e2e/feedback.spec.ts",
    "./recipe-lanes/e2e/forking-workflow.spec.ts",
    "./recipe-lanes/e2e/graph-icon-transition.spec.ts",
    "./recipe-lanes/e2e/ingredients-sidebar.spec.ts",
    "./recipe-lanes/e2e/sharing-comprehensive.spec.ts",
    "./recipe-lanes/components/login-button.tsx",
    "./recipe-lanes/components/recipe-lanes/react-flow-diagram.tsx",
    "./recipe-lanes/components/recipe-lanes/edges/floating-edge.tsx",
    "./recipe-lanes/components/recipe-lanes/ui/ingredients-sidebar.tsx",
    "./recipe-lanes/components/recipe-lanes/nodes/minimal-node-classic.tsx",
    "./recipe-lanes/components/recipe-lanes/nodes/micro-node.tsx",
    "./recipe-lanes/components/recipe-lanes/nodes/lane-node.tsx",
    "./recipe-lanes/components/recipe-lanes/nodes/minimal-node.tsx",
    "./recipe-lanes/components/recipe-lanes/nodes/minimal-node-modern.tsx",
    "./recipe-lanes/components/login.tsx",
    "./recipe-lanes/components/feedback-modal.tsx",
    "./recipe-lanes/components/queue-monitor.tsx",
    "./recipe-lanes/components/ingredient-form.tsx",
    "./recipe-lanes/components/icon-display.tsx",
    "./recipe-lanes/components/reroll-monitor.tsx",
    "./recipe-lanes/components/ui/card.tsx",
    "./recipe-lanes/components/ui/recipe-card.tsx",
    "./recipe-lanes/components/ui/banner.tsx",
    "./recipe-lanes/components/logout-button.tsx",
    "./recipe-lanes/components/shared-gallery.tsx",
    "./recipe-lanes/components/auth-provider.tsx",
    "./recipe-lanes/app/page.tsx",
    "./recipe-lanes/app/api/generate/route.ts",
    "./recipe-lanes/app/api/auth/login/route.ts",
    "./recipe-lanes/app/api/auth/logout/route.ts",
    "./recipe-lanes/app/actions.ts",
    "./recipe-lanes/app/layout.tsx",
    "./recipe-lanes/app/gallery/page.tsx",
    "./recipe-lanes/app/lanes/page.tsx",
    "./recipe-lanes/app/icon_overview/page.tsx",
    "./recipe-lanes/postcss.config.mjs",
    "./recipe-lanes/functions/src/index.ts",
    "./recipe-lanes/functions/src/image-processing.ts",
    "./recipe-lanes/functions/src/icon-generator.ts",
    "./recipe-lanes/scripts/make-admin.ts",
    "./recipe-lanes/scripts/migrate-recipe-icons.ts",
    "./recipe-lanes/scripts/reprocess-recipes.ts",
    "./recipe-lanes/scripts/reset-db.ts",
    "./recipe-lanes/scripts/migrate-icon-struct.ts",
    "./recipe-lanes/scripts/cleanup-zombies.ts",
    "./recipe-lanes/scripts/debug-cache.ts",
    "./recipe-lanes/scripts/reprocess-backgrounds.ts",
    "./recipe-lanes/scripts/test-integrity.ts",
    "./recipe-lanes/scripts/check-icon.ts",
    "./recipe-lanes/scripts/test-deletion-sync.ts",
    "./recipe-lanes/scripts/test-real-recipes.ts",
    "./recipe-lanes/scripts/verify-env.ts",
    "./recipe-lanes/scripts/audit-icon-urls.ts",
    "./recipe-lanes/scripts/check-db.ts",
    "./recipe-lanes/scripts/backfill-vetting.ts",
    "./recipe-lanes/scripts/migrate-ingredients.ts",
    "./recipe-lanes/scripts/test-comprehensive.ts",
    "./recipe-lanes/scripts/analyze-recipe-ingredients.ts",
    "./recipe-lanes/scripts/backfill-recipes.ts",
    "./recipe-lanes/scripts/test-extended-scenarios.ts",
    "./recipe-lanes/scripts/analyze-ingredients.ts",
    "./recipe-lanes/scripts/test-chat-adjust.ts",
    "./recipe-lanes/scripts/cleanup-duplicates.ts",
    "./recipe-lanes/scripts/backfill-metadata.ts",
    "./recipe-lanes/scripts/backfill-names.ts",
    "./recipe-lanes/scripts/test-flow.ts",
    "./recipe-lanes/scripts/verify-bg-removal.ts",
    "./recipe-lanes/scripts/mcp-server.ts",
    "./recipe-lanes/scripts/fix-broken-icons.ts",
    "./recipe-lanes/scripts/fix-phantom-icons.ts",
    "./recipe-lanes/scripts/fetch-real-icons.ts",
    "./recipe-lanes/scripts/cleanup-placeholders.ts",
    "./recipe-lanes/scripts/list-models.ts"
]

def add_header(file_path):
    if not os.path.exists(file_path):
        print(f"File not found: {file_path}")
        return

    with open(file_path, 'r') as f:
        content = f.read()

    if "Copyright (C) 2026 Bohemian Miser" in content:
        print(f"Header already exists in {file_path}")
        return

    lines = content.splitlines()
    insert_idx = 0
    
    # Check for directives
    if lines and (lines[0].strip() == "'use client'" or lines[0].strip() == '"use client"' or
                  lines[0].strip() == "'use server'" or lines[0].strip() == '"use server"'):
        insert_idx = 1
        # Skip following blank lines
        while insert_idx < len(lines) and not lines[insert_idx].strip():
            insert_idx += 1

    new_content = "\n".join(lines[:insert_idx])
    if insert_idx > 0:
        new_content += "\n\n"
    
    new_content += HEADER + "\n"
    new_content += "\n".join(lines[insert_idx:])

    with open(file_path, 'w') as f:
        f.write(new_content)
    print(f"Added header to {file_path}")

for f in FILES:
    add_header(f)
