'use client';

import { useEffect, useRef } from 'react';
import { useRecipeStore } from '@/lib/stores/recipe-store';
import { MessageSquare, ChefHat, X } from 'lucide-react';
import type { ChatMessage } from '@/lib/recipe-lanes/types';

interface ChatPanelProps {
    onClose: () => void;
}

function Message({ msg }: { msg: ChatMessage }) {
    const isUser = msg.role === 'user';
    return (
        <div className={`flex gap-2 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
            <div className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs ${
                isUser ? 'bg-zinc-900 text-white' : 'bg-yellow-100 text-yellow-700'
            }`}>
                {isUser ? '↑' : <ChefHat className="w-4 h-4" />}
            </div>
            <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                isUser
                    ? 'bg-zinc-900 text-white rounded-tr-sm'
                    : 'bg-zinc-100 text-zinc-800 rounded-tl-sm'
            }`}>
                {msg.content}
            </div>
        </div>
    );
}

export function ChatPanel({ onClose }: ChatPanelProps) {
    const messages = useRecipeStore(s => s.messages);
    const bottomRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages.length]);

    return (
        <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 w-full max-w-lg bg-white/95 backdrop-blur border border-zinc-200 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
             style={{ maxHeight: '60vh' }}>
            <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-100 shrink-0">
                <div className="flex items-center gap-2 text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                    <MessageSquare className="w-3.5 h-3.5" />
                    Recipe Chat
                </div>
                <button onClick={onClose} className="text-zinc-400 hover:text-zinc-700 transition-colors">
                    <X className="w-4 h-4" />
                </button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
                {messages.length === 0 ? (
                    <p className="text-xs text-zinc-400 text-center py-4">
                        Paste a recipe or start adjusting — your conversation will appear here.
                    </p>
                ) : (
                    messages.map(msg => <Message key={msg.id} msg={msg} />)
                )}
                <div ref={bottomRef} />
            </div>
        </div>
    );
}
