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
import { useReactFlow } from 'reactflow';
import { RecipeNode } from '../../../lib/recipe-lanes/types';
import { useSearchParams } from 'next/navigation';
import { MinimalNodeClassic } from './minimal-node-classic';
import { MinimalNodeModern } from './minimal-node-modern';
import { forgeIconAction, updateShortlistIndexAction } from '@/app/actions';
import { getEntryIcon, getNodeIconId, getNodeIconUrl, getNodeIngredientName, getNodeTheme } from '@/lib/recipe-lanes/model-utils';

export const MinimalNode: React.FC<any> = ({
    data, selected, isConnectable, id
}) => {
  const [isRerolling, setIsRerolling] = useState(false);
  const [isForging, setIsForging] = useState(false);
  const [prevIconUrl, setPrevIconUrl] = useState(getNodeIconUrl(data));

  const currentIconUrl = getNodeIconUrl(data);
  if (currentIconUrl !== prevIconUrl) {
      setPrevIconUrl(currentIconUrl);
      if ((isRerolling || isForging) && currentIconUrl) {
          setIsRerolling(false);
          setIsForging(false);
      }
  }

  const [isPivotMode, setIsPivotMode] = useState(false);
  const longPressTimer = React.useRef<NodeJS.Timeout | null>(null);
  const { setNodes } = useReactFlow();
  const searchParams = useSearchParams();
  const recipeId = searchParams.get('id');

  const iconTheme = getNodeTheme(data);

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

  const handleReroll = async (e: React.MouseEvent) => {
      e.stopPropagation();

      const shortlist: any[] = data.iconShortlist || [];
      if (shortlist.length === 0) return; // nothing to cycle through

      const currentIdx = data.shortlistIndex ?? 0;
      const newIdx = (currentIdx + 1) % shortlist.length;
      const nextEntry = shortlist[newIdx];
      const nextIcon = getEntryIcon(nextEntry);

      // Optimistically update the local React state
      setNodes((nds: any[]) => nds.map((n: any) => {
          if (n.id !== id) return n;
          return {
              ...n,
              data: {
                  ...n.data,
                  shortlistIndex: newIdx,
              },
          };
      }));

      // Persist the new index to Firestore
      try {
          await updateShortlistIndexAction(recipeId || '', id, newIdx);
      } catch (err) {
          console.error("Reroll persist failed:", err);
      }
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
      return <MinimalNodeModern data={data} selected={selected} isRerolling={isRerolling} isForging={isForging} isPivotMode={isPivotMode} handlers={handlers} />;
  }

  return <MinimalNodeClassic data={data} selected={selected} isRerolling={isRerolling} isForging={isForging} isPivotMode={isPivotMode} handlers={handlers} />;
};

export default memo(MinimalNode);