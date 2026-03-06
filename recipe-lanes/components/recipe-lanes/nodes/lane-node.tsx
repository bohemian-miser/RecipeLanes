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
// NodeProps not exported in this version
// import { NodeProps } from 'reactflow';

const LaneNode = ({ data }: any) => {
  return (
    <div 
        className="w-full h-full border-r-2 border-zinc-200 border-dashed relative group"
    >
      <div className="absolute top-4 left-0 w-full text-center">
          <span className="text-xs font-bold text-zinc-400 uppercase tracking-widest">{data.label}</span>
      </div>
    </div>
  );
};

export default memo(LaneNode);