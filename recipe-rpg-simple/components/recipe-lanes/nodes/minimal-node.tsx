import React, { memo, useState } from 'react';
import { NodeProps, useReactFlow } from 'reactflow';
import { RecipeNode } from '../../../lib/recipe-lanes/types';
import { useSearchParams } from 'next/navigation';
import { MinimalNodeClassic } from './minimal-node-classic';
import { MinimalNodeModern } from './minimal-node-modern';
import { functions } from '@/lib/firebase-client';
import { httpsCallable } from 'firebase/functions';
import {rejectIcon} from '@/app/actions';

// Track rejected URLs for the session to prevent them from reappearing immediately
const sessionRejectedUrls = new Set<string>();

const MinimalNode = ({ id, data, selected }: NodeProps<RecipeNode & { onDelete?: () => void, onSetLongPress?: (active: boolean) => void, iconTheme?: 'classic' | 'modern' | 'modern_clean' }>) => {
  const [isRerolling, setIsRerolling] = useState(false);
  const [prevIconUrl, setPrevIconUrl] = useState(data.iconUrl);
  
  if (data.iconUrl !== prevIconUrl) {
      setPrevIconUrl(data.iconUrl);
      if (isRerolling) setIsRerolling(false);
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
      setIsRerolling(true);
      
      const ingredientName = data.visualDescription || data.text;
      
      try {
        
        await rejectIcon(
            recipeId || '', 
            id, 
            ingredientName, 
            data.iconId ||'' 
        );
        // State update handled by prop change from Firestore listener
      } catch (err) {
          console.error("Reroll failed", err);
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
