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

import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { TERMS_VERSION } from '@/lib/consent';

export const metadata: Metadata = {
    title: 'Terms of Service & Privacy — Recipe Lanes',
    description: 'Terms of Service and Privacy Policy for Recipe Lanes.',
};

/**
 * Terms of Service & Privacy Policy (Issue 147).
 *
 * Static informational page linked from the consent banner. This is a plain,
 * good-faith summary — it is not legal advice and should be reviewed by counsel
 * before relying on it in production.
 */
export default function TermsPage() {
    return (
        <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans">
            <header className="h-14 shrink-0 border-b border-zinc-800 flex items-center px-4 bg-zinc-950 sticky top-0 z-20">
                <Link
                    href="/lanes"
                    className="flex items-center gap-2 text-xs font-mono text-zinc-400 hover:text-white transition-colors"
                >
                    <ArrowLeft className="w-4 h-4" />
                    <span>Back to editor</span>
                </Link>
            </header>

            <main className="mx-auto max-w-3xl px-6 py-10 space-y-8 leading-relaxed text-zinc-300">
                <div>
                    <h1 className="text-2xl font-bold text-zinc-100">
                        Terms of Service &amp; Privacy Policy
                    </h1>
                    <p className="mt-1 text-xs font-mono text-zinc-500">
                        Version {TERMS_VERSION}
                    </p>
                </div>

                <section className="space-y-3">
                    <h2 className="text-lg font-semibold text-zinc-100">
                        1. Acceptance of terms
                    </h2>
                    <p>
                        Recipe Lanes (&ldquo;the Service&rdquo;) is a tool for turning
                        recipe text into interactive diagrams. By accessing or using the
                        Service you agree to these Terms of Service and the Privacy Policy
                        below. If you do not agree, please do not use the Service.
                    </p>
                </section>

                <section className="space-y-3">
                    <h2 className="text-lg font-semibold text-zinc-100">
                        2. Your content
                    </h2>
                    <p>
                        You retain ownership of the recipe text and images you submit. By
                        submitting content you grant us the limited rights needed to
                        store, process, and display it back to you and — where you choose
                        to publish a recipe — to other users. Do not submit content you do
                        not have the right to share.
                    </p>
                </section>

                <section className="space-y-3">
                    <h2 className="text-lg font-semibold text-zinc-100">
                        3. Acceptable use
                    </h2>
                    <p>
                        You agree not to misuse the Service, including by attempting to
                        disrupt it, reverse its access controls, or submit unlawful or
                        harmful content. We may suspend access that threatens the Service
                        or other users.
                    </p>
                </section>

                <section className="space-y-3">
                    <h2 className="text-lg font-semibold text-zinc-100">
                        4. AI processing
                    </h2>
                    <p>
                        The Service uses third-party AI models to parse recipes and
                        generate icons. Content you submit may be sent to those providers
                        for processing. AI output can be inaccurate; always use judgment,
                        especially around allergens, quantities, and food safety.
                    </p>
                </section>

                <section className="space-y-3">
                    <h2 className="text-lg font-semibold text-zinc-100">
                        5. No warranty
                    </h2>
                    <p>
                        The Service is provided &ldquo;as is&rdquo;, without warranties of
                        any kind. To the extent permitted by law, we are not liable for
                        any damages arising from your use of the Service.
                    </p>
                </section>

                <section className="space-y-3">
                    <h2 className="text-lg font-semibold text-zinc-100">
                        Privacy Policy
                    </h2>
                    <p>
                        <strong className="text-zinc-100">What we collect.</strong> When
                        you sign in with Google we receive your account&rsquo;s basic
                        profile (name, email, and identifier) to create your account. We
                        store the recipes and images you create, and basic usage/diagnostic
                        data needed to operate the Service.
                    </p>
                    <p>
                        <strong className="text-zinc-100">Cookies &amp; local
                        storage.</strong> We use a session cookie to keep you signed in and
                        browser local storage to remember preferences and your acceptance
                        of these terms. You can clear these at any time in your browser.
                    </p>
                    <p>
                        <strong className="text-zinc-100">Sharing.</strong> We do not sell
                        your personal information. We share data with infrastructure and AI
                        providers only as needed to run the Service. Recipes are private
                        unless you choose to publish them.
                    </p>
                    <p>
                        <strong className="text-zinc-100">Your choices.</strong> You may
                        request deletion of your account and associated recipes by
                        contacting us.
                    </p>
                </section>

                <section className="space-y-3">
                    <h2 className="text-lg font-semibold text-zinc-100">
                        Contact
                    </h2>
                    <p>
                        Questions about these terms can be sent to{' '}
                        <a
                            href="mailto:commercial@recipelanes.com"
                            className="text-yellow-500 underline underline-offset-2 hover:text-yellow-400"
                        >
                            commercial@recipelanes.com
                        </a>
                        .
                    </p>
                </section>

                <p className="pt-4 text-xs text-zinc-500">
                    This page is a good-faith summary provided for transparency and is not
                    legal advice.
                </p>
            </main>
        </div>
    );
}
