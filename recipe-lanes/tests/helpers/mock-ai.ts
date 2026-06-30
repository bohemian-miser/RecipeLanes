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

import { setAIService } from '../../lib/ai-service';
import { MockAIService } from '../../lib/ai-service.mock';

/**
 * Inject the mock AI service via dependency injection.
 *
 * This is the ONLY way tests get the mock — there is no MOCK_AI env flag.
 * Call it once at the top of a test file, or in a `beforeEach`, before any
 * code under test invokes `getAIService()`.
 */
export function useMockAI(): MockAIService {
  const mock = new MockAIService();
  setAIService(mock);
  return mock;
}
