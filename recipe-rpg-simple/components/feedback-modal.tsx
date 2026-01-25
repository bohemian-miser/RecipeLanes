'use client';

import React, { useState } from 'react';
import { X, Loader2, Send, MessageSquare } from 'lucide-react';
import { submitFeedbackAction } from '@/app/actions';

interface FeedbackModalProps {
    isOpen: boolean;
    onClose: () => void;
    graphJson?: string;
}

export function FeedbackModal({ isOpen, onClose, graphJson }: FeedbackModalProps) {
    const [message, setMessage] = useState('');
    const [email, setEmail] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [success, setSuccess] = useState(false);
    const [error, setError] = useState<string | null>(null);

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!message.trim()) return;

        setIsSubmitting(true);
        setError(null);

        try {
            const result = await submitFeedbackAction({
                message,
                email,
                url: window.location.href,
                graphJson
            });

            if (result.error) {
                setError(result.error);
            } else {
                setSuccess(true);
                setTimeout(() => {
                    onClose();
                    setSuccess(false);
                    setMessage('');
                    setEmail('');
                }, 2000);
            }
        } catch (err) {
            setError('Failed to submit feedback.');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
            <div 
                className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between p-4 border-b border-zinc-800 bg-zinc-900/50">
                    <h3 className="font-bold text-zinc-100 flex items-center gap-2">
                        <MessageSquare className="w-4 h-4 text-yellow-500" />
                        Feedback & Contribute
                    </h3>
                    <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="p-6">
                    {success ? (
                        <div className="flex flex-col items-center justify-center py-8 text-center space-y-3">
                            <div className="w-12 h-12 bg-green-500/10 rounded-full flex items-center justify-center text-green-500">
                                <Send className="w-6 h-6" />
                            </div>
                            <h4 className="text-lg font-bold text-white">Thank You!</h4>
                            <p className="text-zinc-400 text-sm">Your feedback has been sent.</p>
                        </div>
                    ) : (
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div className="space-y-2">
                                <p className="text-sm text-zinc-400">
                                    Found a bug? Have a suggestion? Or are you a developer who wants to collaborate on this open-source project? Let me know!
                                </p>
                            </div>

                            <div className="space-y-2">
                                <label htmlFor="message" className="text-xs font-bold uppercase text-zinc-500">Message</label>
                                <textarea
                                    id="message"
                                    value={message}
                                    onChange={(e) => setMessage(e.target.value)}
                                    placeholder="Describe your issue or say hi..."
                                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-yellow-500/50 focus:ring-1 focus:ring-yellow-500/50 min-h-[120px] resize-none"
                                    required
                                />
                            </div>

                            <div className="space-y-2">
                                <label htmlFor="email" className="text-xs font-bold uppercase text-zinc-500">Email (Optional)</label>
                                <input
                                    id="email"
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder="your@email.com"
                                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-yellow-500/50 focus:ring-1 focus:ring-yellow-500/50"
                                />
                            </div>

                            {error && (
                                <div className="text-xs text-red-400 bg-red-900/10 border border-red-900/20 p-2 rounded">
                                    {error}
                                </div>
                            )}

                            <div className="flex justify-end pt-2">
                                <button
                                    type="submit"
                                    disabled={isSubmitting || !message.trim()}
                                    className="flex items-center gap-2 bg-zinc-100 hover:bg-white text-zinc-900 font-bold py-2 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                                >
                                    {isSubmitting ? (
                                        <>
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                            Sending...
                                        </>
                                    ) : (
                                        <>
                                            Send Feedback
                                        </>
                                    )}
                                </button>
                            </div>
                        </form>
                    )}
                </div>
            </div>
        </div>
    );
}
