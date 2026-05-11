import type { LayoutPreset } from './types';

export const VISUAL_PRESETS: Record<string, LayoutPreset> = {
    timeline: {
        id: 'timeline',
        name: 'Timeline',
        iconStyle: 'timeline-circle',
        lineStyle: 'timeline-path',
        nodeLayout: 'timeline',
        backgrounds: ['timeline-grid', 'lane-bands-horizontal']
    },
    smart: {
        id: 'smart',
        name: 'Smart',
        iconStyle: 'modern_clean',
        lineStyle: 'floating',
        nodeLayout: 'dagre',
        backgrounds: []
    },
    'smart-lr': {
        id: 'smart-lr',
        name: 'Smart LR',
        iconStyle: 'modern_clean',
        lineStyle: 'straight',
        nodeLayout: 'dagre-lr',
        backgrounds: []
    },
    classic: {
        id: 'classic',
        name: 'Classic Lanes',
        iconStyle: 'classic',
        lineStyle: 'bezier',
        nodeLayout: 'swimlanes',
        backgrounds: ['lane-bands-vertical']
    }
};

export const DEFAULT_PRESET_ID = 'smart';
