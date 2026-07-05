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

import Link from 'next/link';

/**
 * Persistent, always-available link to the Terms of Service / Privacy page
 * (Issue 147). The consent banner is one-time and cannot be reopened once
 * dismissed, so this gives users a permanent way back to the legal text.
 *
 * Rendered once from the root layout so it appears on every page. It is styled
 * to be as unobtrusive as the ReactFlow attribution badge and sits just to the
 * left of it (bottom-right) on the editor, without covering it.
 */
export function TermsLink() {
    return (
        <Link
            href="/terms"
            className="fixed bottom-0 right-[74px] z-[80] px-1.5 py-[3px] text-[11px] leading-none text-zinc-500 hover:text-zinc-300 hover:underline transition-colors"
        >
            Terms of Service
        </Link>
    );
}
