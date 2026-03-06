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

import React, { memo } from 'react';
import { Handle } from 'reactflow';
// NodeProps not exported in this version
// import { NodeProps } from 'reactflow';

export const MicroNode: React.FC<any> = ({ data, selected }) => {
  const isIngredient = data.type === 'ingredient';
  const color = isIngredient ? 'bg-orange-400' : 'bg-zinc-600';
  
  return (
    <div className="group relative flex items-center justify-center w-3 h-3">
            <Handle type="target" position="top" className="!bg-transparent !w-full !h-full !border-0 top-0 left-0 transform-none rounded-none" />
      
      <div className={`w-3 h-3 rounded-full ${color} shadow-sm border border-white/50 hover:scale-150 transition-transform cursor-pointer`} />

      {/* Tooltip on hover */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none bg-zinc-800 text-white text-[9px] px-2 py-1 rounded whitespace-nowrap z-50">
          {data.visualDescription || data.text.substring(0, 30)}
      </div>

      <Handle type="source" position="bottom" className="!bg-transparent !w-1 !h-1 !border-0" />
    </div>
  );
};

export default memo(MicroNode);