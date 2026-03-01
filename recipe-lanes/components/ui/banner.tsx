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

import React from 'react';
import { cn } from '@/lib/utils';

interface BannerProps {
    children: React.ReactNode;
    color?: 'blue' | 'green' | 'orange' | 'yellow';
    onDismiss?: () => void;
    onClick?: () => void;
    className?: string;
}

export function Banner({ children, color = 'blue', onDismiss, onClick, className }: BannerProps) {
    const colorStyles = {
        blue: 'bg-blue-500/95 text-blue-100 border-blue-400/30',
        green: 'bg-green-500/90 text-white border-green-400/30',
        orange: 'bg-orange-500/90 text-white border-orange-400/30 hover:bg-orange-600/90',
        yellow: 'bg-yellow-500/90 text-black border-yellow-400/30 hover:bg-yellow-400/90'
    };

    const handleClick = (e: React.MouseEvent) => {
        if (onClick) onClick();
        else if (onDismiss) onDismiss();
    };

    return (
        <div 
            onClick={handleClick}
            className={cn(
                "backdrop-blur-sm text-[10px] py-1.5 px-4 text-center font-mono pointer-events-auto shadow-lg rounded-xl w-fit max-w-[95vw] border transition-colors flex flex-wrap items-center justify-center gap-2 whitespace-normal animate-in slide-in-from-top-2",
                colorStyles[color],
                (onClick || onDismiss) && "cursor-pointer",
                className
            )}
            title={onDismiss ? "Tap to dismiss" : undefined}
        >
            {children}
        </div>
    );
}