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

'use client';

import { useState } from 'react';
import { MessageSquare } from 'lucide-react';
import { FeedbackModal } from '@/components/feedback-modal';

/** The nav-item styling every top bar uses. Kept identical to the copies in
 *  app/gallery, app/icon_overview and app/lanes so the button sits flush with
 *  the links beside it. */
const NAV_ITEM_CLASS =
    'flex items-center gap-2 px-3 py-1.5 rounded-md text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors text-xs font-medium';

interface FeedbackButtonProps {
    /** Replaces the default top-bar styling (e.g. for the light umap toolbar). */
    className?: string;
    /** Hide the text label, leaving just the icon. */
    iconOnly?: boolean;
}

/**
 * Feedback entry point for a page's top bar (Issue 282).
 *
 * `FeedbackModal` is a controlled overlay with no trigger of its own, and the
 * only thing wiring one up was `app/lanes/page.tsx` — so every other route had
 * no way to send feedback. This is the same control as the `/lanes` header
 * button, packaged so it can be dropped into any top bar: it owns the modal's
 * open state, so a server-component page (`/gallery`, `/terms`) can import it
 * without needing client state of its own, exactly like `LogoutButton`.
 *
 * It deliberately renders inline in the header rather than floating over the
 * page. A floating overlay competes with whatever else is pinned to the
 * viewport — the consent banner covers the bottom strip entirely — whereas a
 * header button sits in normal flow next to the other nav items and inherits
 * their styling, so it cannot be occluded by page chrome.
 */
export function FeedbackButton({ className, iconOnly = false }: FeedbackButtonProps) {
    const [isOpen, setIsOpen] = useState(false);

    return (
        <>
            <button
                type="button"
                onClick={() => setIsOpen(true)}
                title="Feedback & Contribute"
                aria-label="Feedback & Contribute"
                data-testid="feedback-button"
                className={className ?? NAV_ITEM_CLASS}
            >
                <MessageSquare className="w-4 h-4" aria-hidden="true" />
                {!iconOnly && <span className="hidden md:inline">Feedback</span>}
            </button>
            <FeedbackModal isOpen={isOpen} onClose={() => setIsOpen(false)} />
        </>
    );
}
