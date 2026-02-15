import React, { useEffect, useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { getDialogue, sendMessage, approveMessage } from '../api';
import type { Dialogue } from '../api';
import { MessageBubble } from './MessageBubble';
import { Send } from 'lucide-react';

const ChatWindow: React.FC = () => {
    const { id } = useParams<{ id: string }>();
    const [dialogue, setDialogue] = useState<Dialogue | null>(null);
    const [inputText, setInputText] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const fetchDialogue = async () => {
        if (!id) return;
        try {
            const data = await getDialogue(parseInt(id));
            setDialogue(data);
        } catch (error) {
            console.error('Failed to fetch dialogue', error);
        }
    };

    useEffect(() => {
        fetchDialogue();
        const interval = setInterval(fetchDialogue, 3000); // Poll frequently for new messages
        return () => clearInterval(interval);
    }, [id]);

    useEffect(() => {
        // Scroll to bottom on new messages
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [dialogue?.messages]);

    const handleSend = async () => {
        if (!inputText.trim() || !dialogue) return;
        setIsLoading(true);
        try {
            const username = dialogue.user.username || dialogue.user.telegramId;
            await sendMessage(username!, inputText);
            setInputText('');
            await fetchDialogue(); // Refresh immediately
        } catch (error) {
            console.error('Failed to send message', error);
            alert('Failed to send message');
        } finally {
            setIsLoading(false);
        }
    };

    const handleApprove = async (messageId: number, newText?: string) => {
        try {
            await approveMessage(messageId, newText);
            await fetchDialogue(); // Refresh to show it as SENT
        } catch (error: any) {
            console.error('Failed to approve message', error);
            // Extract error message from response if available
            const msg = error.response?.data?.details || error.response?.data?.error || error.message || 'Unknown error';
            alert(`Failed to send: ${msg}`);
        }
    };

    if (!dialogue) return <div className="flex h-full items-center justify-center">Loading...</div>;

    return (
        <div className="flex flex-col h-full">
            {/* Header */}
            <div className="bg-card px-4 py-3 border-b border-border flex items-center justify-between">
                <div>
                    <h2 className="font-semibold text-lg">{dialogue.user.firstName || dialogue.user.username}</h2>
                    <div className="text-xs text-muted-foreground">
                        @{dialogue.user.username} • {dialogue.status}
                    </div>
                </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {dialogue.messages.map((msg) => (
                    <MessageBubble
                        key={msg.id}
                        message={msg}
                        onApprove={msg.status === 'DRAFT' ? handleApprove : undefined}
                    />
                ))}
                <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="p-4 bg-card border-t border-border">
                <div className="flex gap-2">
                    <input
                        value={inputText}
                        onChange={(e) => setInputText(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                        placeholder="Type a message..."
                        className="flex-1 bg-muted rounded-md px-4 py-2 outline-none focus:ring-2 focus:ring-primary/50"
                        disabled={isLoading}
                    />
                    <button
                        onClick={handleSend}
                        disabled={isLoading || !inputText.trim()}
                        className="bg-primary text-primary-foreground p-2 rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors"
                    >
                        <Send size={20} />
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ChatWindow;
