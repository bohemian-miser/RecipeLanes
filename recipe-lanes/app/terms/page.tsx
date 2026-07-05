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
import { CURRENT_TERMS_VERSION } from '@/lib/legal/consent';

export const metadata: Metadata = {
  title: 'Terms of Service & Privacy — Recipe Lanes',
  description: 'Terms of Service, acceptable use, and privacy notice for Recipe Lanes.',
};

export default function TermsPage() {
  return (
    <main className="max-w-2xl mx-auto px-6 py-12 text-zinc-200">
      <Link
        href="/"
        className="text-xs font-mono text-yellow-500 hover:text-yellow-400 uppercase tracking-wider"
      >
        &larr; Back
      </Link>

      <h1 className="text-2xl font-bold mt-6 mb-2">Terms of Service &amp; Privacy</h1>
      <p className="text-xs font-mono text-zinc-500 mb-8">Version {CURRENT_TERMS_VERSION}</p>

      <section className="space-y-4 text-sm leading-relaxed">
        <h2 className="text-lg font-semibold mt-6">1. Acceptance</h2>
        <p>
          Recipe Lanes (&ldquo;the Service&rdquo;) turns recipe text into interactive
          diagrams. By signing in and using the Service you agree to these Terms of
          Service and to the privacy practices described below. If you do not agree,
          do not sign in or use the Service.
        </p>

        <h2 className="text-lg font-semibold mt-6">2. Your content</h2>
        <p>
          You retain ownership of the recipe text and other content you submit. You
          grant Recipe Lanes a limited licence to store and process that content solely
          to provide the Service (for example, to parse recipes and generate diagrams
          and icons). You are responsible for ensuring you have the right to submit any
          content you provide.
        </p>

        <h2 className="text-lg font-semibold mt-6">3. Acceptable use</h2>
        <p>
          You agree not to misuse the Service, including by submitting unlawful content,
          attempting to disrupt or reverse-engineer the infrastructure, or using it to
          generate harmful or infringing material.
        </p>

        <h2 className="text-lg font-semibold mt-6">4. AI-generated output</h2>
        <p>
          Diagrams, icons, and other output are generated with automated and AI systems
          and may contain errors. The Service is provided &ldquo;as is&rdquo; without
          warranties. Always verify recipes before relying on them.
        </p>

        <h2 className="text-lg font-semibold mt-6">5. Privacy &amp; consent</h2>
        <p>
          When you sign in with Google we receive your basic account profile (name and
          email) to authenticate you. Recipes you create and related metadata are stored
          in our database to provide the Service. We record the fact and version of your
          acceptance of these Terms. We do not sell your personal data. You may request
          deletion of your account data by contacting the operator.
        </p>

        <h2 className="text-lg font-semibold mt-6">6. Changes</h2>
        <p>
          We may update these Terms. When we do, the version identifier above changes and
          you will be asked to review and accept the updated Terms before continuing.
        </p>
      </section>

      <p className="text-xs font-mono text-zinc-600 mt-10">
        Recipe Lanes is free software licensed under the GNU AGPL v3.
      </p>
    </main>
  );
}
