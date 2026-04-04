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

import React, { memo, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { MinimalNodeClassic } from './minimal-node-classic';
import { MinimalNodeModern } from './minimal-node-modern';
import { forgeIconAction } from '@/app/actions';
import {
    getNodeIngredientName,
    getNodeTheme,
    getNodeIconId,
    getNodeShortlistLength,
    getNodeShortlistKey,
    getNodeIconUrlAt,
    isIconSearchMatchedAt,
} from '@/lib/recipe-lanes/model-utils';
import { useShortlistStore } from '@/lib/stores/shortlist-store';

export const MinimalNode: React.FC<any> = ({
    data, selected, isConnectable, id
}) => {
  const [isForging, setIsForging] = useState(false);
  const [isPivotMode, setIsPivotMode] = useState(false);
  const longPressTimer = React.useRef<NodeJS.Timeout | null>(null);
  const searchParams = useSearchParams();
  const recipeId = searchParams.get('id');

  const iconTheme = getNodeTheme(data);

  // ---------------------------------------------------------------------------
  // Shortlist store: the current display index lives here, not in Firestore.
  // The store is initialized from the node's server-side shortlistIndex on
  // mount and whenever the shortlist contents change (e.g. after a forge).
  // On save, react-flow-diagram.tsx overlays store indexes onto graph.nodes
  // via useShortlistStore.getState().getIndexes().
  // ---------------------------------------------------------------------------
  const { cycle, initialize, getIndex } = useShortlistStore();
  const shortlistKey = getNodeShortlistKey(data);

  useEffect(() => {
      initialize(id, data.shortlistIndex ?? 0);
  // Re-initialize whenever the shortlist contents change (forge prepends a new
  // shortlist and resets shortlistIndex to 0 on the server).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shortlistKey, id]);

  const currentIndex = getIndex(id, data.shortlistIndex ?? 0);
  const iconUrl = getNodeIconUrlAt(data, currentIndex);
  const isSearchMatched = isIconSearchMatchedAt(data, currentIndex);

  // ---------------------------------------------------------------------------
  // Forge state: cleared when a forge result arrives via Firestore snapshot,
  // which updates data.iconShortlist and therefore shortlistKey.
  // ---------------------------------------------------------------------------
  const [prevShortlistKey, setPrevShortlistKey] = useState(shortlistKey);
  if (shortlistKey !== prevShortlistKey) {
      setPrevShortlistKey(shortlistKey);
      if (isForging) setIsForging(false);
  }

  const handleTouchStart = () => {
      longPressTimer.current = setTimeout(() => {
          setIsPivotMode(true);
          if (data.onSetLongPress) data.onSetLongPress(true);
          if (navigator.vibrate) navigator.vibrate(50);
      }, 300);
  };

  const handleTouchEnd = () => {
      if (longPressTimer.current) {
          clearTimeout(longPressTimer.current);
          longPressTimer.current = null;
      }
      setTimeout(() => setIsPivotMode(false), 500);
  };

  const handleDelete = (e: React.MouseEvent) => {
      e.stopPropagation();
      if (data.onDelete) data.onDelete();
  };

  const handleReroll = (e: React.MouseEvent) => {
      e.stopPropagation();
      const length = getNodeShortlistLength(data);
      if (length === 0) return;
      cycle(id, length);
      // TODO: record impression fire-and-forget once a lightweight
      // recordImpressionAction (touching only ingredients_new, not the recipe
      // doc) is available. See docs/STATE_AND_PERSISTENCE.md.
  };

  const handleForge = async (e: React.MouseEvent) => {
      e.stopPropagation();
      setIsForging(true);
      const ingredientName = getNodeIngredientName(data);
      try {
          const result = await forgeIconAction(recipeId || '', ingredientName, getNodeIconId(data) || '');
          if (result && !result.success) {
              console.error("Forge failed:", result.error);
              setIsForging(false);
          }
      } catch (err) {
          console.error("Forge exception:", err);
          setIsForging(false);
      }
  };

  const handlers = {
      onReroll: handleReroll,
      onForge: handleForge,
      onDelete: handleDelete,
      onTouchStart: handleTouchStart,
      onTouchEnd: handleTouchEnd
  };

  if (iconTheme === 'modern' || iconTheme === 'modern_clean') {
      return <MinimalNodeModern data={data} selected={selected} isRerolling={false} isForging={isForging} isPivotMode={isPivotMode} iconUrl={iconUrl} isSearchMatched={isSearchMatched} handlers={handlers} />;
  }

  return <MinimalNodeClassic data={data} selected={selected} isRerolling={false} isForging={isForging} isPivotMode={isPivotMode} iconUrl={iconUrl} isSearchMatched={isSearchMatched} handlers={handlers} />;
};

export default memo(MinimalNode);
