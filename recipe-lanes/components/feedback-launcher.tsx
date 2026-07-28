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
import { usePathname } from 'next/navigation';
import { MessageSquare } from 'lucide-react';
import { FeedbackModal } from '@/components/feedback-modal';
import { feedbackLauncherClassName } from '@/lib/feedback-launcher';
import { useConsentPending } from '@/lib/use-consent';

/**
 * Global feedback entry point (Issue 282).
 *
 * `FeedbackModal` is a controlled overlay with no trigger of its own, and the
 * only thing wiring one up was `app/lanes/page.tsx` — so feedback was
 * unreachable everywhere else. This owns that wiring instead and is rendered
 * once from the root layout, which puts a feedback button on every page.
 *
 * The accessible name is deliberately *not* "Feedback & Contribute": that is
 * the `/lanes` header button's title, and reusing it would make locators match
 * two elements on that route.
 *
 * Which routes it shows on is decided by `lib/feedback-launcher.ts` (pure,
 * unit-tested); this component is only the state + markup shell around it.
 */
export function FeedbackLauncher() {
    const pathname = usePathname();
    const consentPending = useConsentPending();
    const [isOpen, setIsOpen] = useState(false);

    return (
        <>
            <button
                type="button"
                onClick={() => setIsOpen(true)}
                title="Send feedback"
                aria-label="Send feedback"
                data-testid="global-feedback-button"
                className={feedbackLauncherClassName(pathname, { consentPending })}
            >
                <MessageSquare className="w-4 h-4 text-yellow-500" aria-hidden="true" />
                <span className="hidden sm:inline">Feedback</span>
            </button>
            <FeedbackModal isOpen={isOpen} onClose={() => setIsOpen(false)} />
        </>
    );
}
