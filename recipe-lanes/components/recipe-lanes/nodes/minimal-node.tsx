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
import { functions } from '@/lib/firebase-client';
import { httpsCallable } from 'firebase/functions';
import { rejectIcon } from '@/app/actions';
import { getNodeIconId, getNodeIconUrl, nextShortlistIcon } from '@/lib/recipe-lanes/model-utils';

// Track rejected URLs for the session to prevent them from reappearing immediately
const sessionRejectedUrls = new Set<string>();

export const MinimalNode: React.FC<any> = ({
    data, selected, isConnectable, id
}) => {
  const [isRerolling, setIsRerolling] = useState(false);
  const [prevIconUrl, setPrevIconUrl] = useState(getNodeIconUrl(data));

  const currentIconUrl = getNodeIconUrl(data);
  if (currentIconUrl !== prevIconUrl) {
      setPrevIconUrl(currentIconUrl);
      // Only stop rerolling if we received a valid URL (ignore clearing updates)
      if (isRerolling && currentIconUrl) {
          setIsRerolling(false);
      }
  }

  const [isPivotMode, setIsPivotMode] = useState(false);
  const longPressTimer = React.useRef<NodeJS.Timeout | null>(null);
  const { setNodes } = useReactFlow();
  const searchParams = useSearchParams();
  const recipeId = searchParams.get('id');

  const iconTheme = data.iconTheme || 'classic';

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

      // --- Shortlist cycling: try next entry before hitting Firestore ---
      const nextIcon = nextShortlistIcon(data);
      if (nextIcon) {
          // Apply next shortlist entry optimistically in ReactFlow state
          setNodes((nds: any[]) => nds.map((n: any) => {
              if (n.id !== id) return n;
              return {
                  ...n,
                  data: {
                      ...n.data,
                      icon: { id: nextIcon.id, url: nextIcon.url, metadata: nextIcon.metadata },
                      iconQuery: n.data.iconQuery
                          ? { ...n.data.iconQuery, outcome: 'rerolled_past' as const }
                          : undefined,
                  },
              };
          }));
          return;
      }
      // nextIcon is null — shortlist exhausted or absent, fall through to Firestore path

      setIsRerolling(true);
      const ingredientName = data.visualDescription || data.text;
      try {
        const result = await rejectIcon(
            recipeId || '',
            ingredientName,
            getNodeIconId(data) || '',
        );

        if (result && !result.success) {
            console.error("Reroll failed:", result.error);
            setIsRerolling(false);
            // Optionally alert the user here, but for now we just stop the spinner
        }
        // Success state update handled by prop change from Firestore listener
      } catch (err) {
          console.error("Reroll exception:", err);
          setIsRerolling(false);
      }
  };

  const handlers = {
      onReroll: handleReroll,
      onDelete: handleDelete,
      onTouchStart: handleTouchStart,
      onTouchEnd: handleTouchEnd
  };

  if (iconTheme === 'modern' || iconTheme === 'modern_clean') {
      return <MinimalNodeModern data={data} selected={selected} isRerolling={isRerolling} isPivotMode={isPivotMode} handlers={handlers} />;
  }

  return <MinimalNodeClassic data={data} selected={selected} isRerolling={isRerolling} isPivotMode={isPivotMode} handlers={handlers} />;
};

export default memo(MinimalNode);