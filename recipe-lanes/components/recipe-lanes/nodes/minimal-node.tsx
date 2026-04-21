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

import React, { memo, useState } from 'react';
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
    currentShortlistIndex,
} from '@/lib/recipe-lanes/model-utils';
import { useRecipeStore } from '@/lib/stores/recipe-store';

export const MinimalNode: React.FC<any> = ({
    data, selected, isConnectable, id, dragging
}) => {
  const [isForging, setIsForging] = useState(false);
  const [isPivotMode, setIsPivotMode] = useState(false);
  const longPressTimer = React.useRef<NodeJS.Timeout | null>(null);

  React.useEffect(() => {
      if (dragging) {
          if (longPressTimer.current) {
              clearTimeout(longPressTimer.current);
              longPressTimer.current = null;
          }
          setIsPivotMode(false);
          if (data.onSetLongPress) {
              data.onSetLongPress(false);
          }
      }
  }, [dragging, data]);
  const searchParams = useSearchParams();
  const recipeId = searchParams.get('id');

  // Subscribe to this node in the recipe store.
  // cycleShortlist writes shortlistIndex directly onto graph.nodes[i], so this
  // selector re-renders only when this specific node changes.
  const storeNode = useRecipeStore(s => s.graph?.nodes.find(n => n.id === id));
  const cycleShortlist = useRecipeStore(s => s.cycleShortlist);

  // Use storeNode when available (it has up-to-date shortlistIndex after cycling).
  // Fall back to data prop for nodes not yet in the store.
  const node = storeNode ?? data;
  const iconTheme = getNodeTheme(data);

  const shortlistKey = getNodeShortlistKey(node);
  const currentIndex = Math.max(0, currentShortlistIndex(node));
  const iconUrl = getNodeIconUrlAt(node, currentIndex);
  const isSearchMatched = isIconSearchMatchedAt(node, currentIndex);

  // ---------------------------------------------------------------------------
  // Forge state: cleared when a forge result arrives via Firestore snapshot,
  // which causes mergeSnapshot to reset shortlistIndex and update the store node.
  // ---------------------------------------------------------------------------
  const [prevShortlistKey, setPrevShortlistKey] = useState(shortlistKey);
  if (shortlistKey !== prevShortlistKey) {
      setPrevShortlistKey(shortlistKey);
      if (isForging) setIsForging(false);
  }

  const touchStartPos = React.useRef<{x: number, y: number} | null>(null);

  const handlePointerDown = (e: React.PointerEvent) => {
      // Only listen to touch or pen, ignore mouse for long-press pivot
      if (e.pointerType === 'mouse') return;
      
      touchStartPos.current = { x: e.clientX, y: e.clientY };
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
      longPressTimer.current = setTimeout(() => {
          setIsPivotMode(true);
          if (data.onSetLongPress) data.onSetLongPress(true, id);
          if (navigator.vibrate) navigator.vibrate(50);
      }, 300);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
      if (!longPressTimer.current || !touchStartPos.current) return;
      const dx = e.clientX - touchStartPos.current.x;
      const dy = e.clientY - touchStartPos.current.y;
      if (Math.sqrt(dx*dx + dy*dy) > 10) {
          clearTimeout(longPressTimer.current);
          longPressTimer.current = null;
      }
  };

  const handlePointerUpOrCancel = () => {
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
      cycleShortlist(id);
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
      onPointerDownCapture: handlePointerDown,
      onPointerMoveCapture: handlePointerMove,
      onPointerUpCapture: handlePointerUpOrCancel,
      onPointerCancelCapture: handlePointerUpOrCancel
  };

  if (iconTheme === 'modern' || iconTheme === 'modern_clean') {
      return <MinimalNodeModern data={data} selected={selected} isRerolling={false} isForging={isForging} isPivotMode={isPivotMode} iconUrl={iconUrl} isSearchMatched={isSearchMatched} handlers={handlers} />;
  }

  return <MinimalNodeClassic data={data} selected={selected} isRerolling={false} isForging={isForging} isPivotMode={isPivotMode} iconUrl={iconUrl} isSearchMatched={isSearchMatched} handlers={handlers} />;
};

export default memo(MinimalNode);
