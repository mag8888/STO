import React, { useState } from 'react';
import type { Dialogue } from '../types';
import { useChat } from '../hooks/useChat';
import { Send, Archive, ShieldAlert, UserCheck, ArrowRightLeft } from 'lucide-react';

interface ChatWindowProps {
    dialogue: Dialogue | null;
    actions: ReturnType<typeof useChat>;
}

const ChatWindow: React.FC<ChatWindowProps> = ({ dialogue, actions }) => {
    const [input, setInput] = useState('');

    if (!dialogue) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
                <div className="text-4xl mb-4">💬</div>
                <p>Select a chat to start messaging</p>
            </div>
        );
    }

    const handleSend = async () => {
        if (!input.trim()) return;
        await actions.sendMessage(dialogue.id, input);
        setInput('');
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const isRejected = dialogue.user.status === 'REJECTED';
    const isScout = dialogue.source === 'SCOUT';

    return (
        <div className="flex flex-col h-full bg-background/50">
            {/* Header */}
            <div className="p-4 border-b border-border bg-card/50 backdrop-blur flex justify-between items-center">
                <div>
                    <h2 className="font-semibold text-lg flex items-center gap-2">
                        {dialogue.user.firstName} {dialogue.user.lastName}
                        {dialogue.user.username && <span className="text-sm text-muted-foreground">@{dialogue.user.username}</span>}
                        {isRejected && <span className="text-xs bg-red-500/10 text-red-500 px-2 py-0.5 rounded">Rejected</span>}
                    </h2>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>ID: {dialogue.user.telegramId}</span>
                    </div>
                </div>
                <div className="flex gap-2">
                    {!isScout && (
                        <button
                            onClick={() => actions.updateDialogueSource(dialogue.id, 'SCOUT')}
                            className="btn-secondary text-xs flex items-center gap-1"
                            title="Move to Scout"
                        >
                            <ArrowRightLeft className="w-3 h-3" /> To Scout
                        </button>
                    )}
                    {isScout && (
                        <button
                            onClick={() => actions.updateDialogueSource(dialogue.id, 'INBOUND')}
                            className="btn-secondary text-xs flex items-center gap-1"
                            title="Move to Direct"
                        >
                            <ArrowRightLeft className="w-3 h-3" /> To Direct
                        </button>
                    )}

                    {dialogue.user.status !== 'REJECTED' ? (
                        <button
                            onClick={() => actions.updateUserStatus(dialogue.userId, 'REJECTED')}
                            className="btn-destructive text-xs flex items-center gap-1 bg-red-500/10 text-red-500 hover:bg-red-500/20"
                        >
                            <ShieldAlert className="w-3 h-3" /> Reject
                        </button>
                    ) : (
                        <button
                            onClick={() => actions.updateUserStatus(dialogue.userId, 'LEAD')}
                            className="btn-primary text-xs flex items-center gap-1"
                        >
                            <UserCheck className="w-3 h-3" /> Un-Reject
                        </button>
                    )}

                    <button
                        onClick={() => actions.toggleArchive(dialogue.id)}
                        className="btn-ghost text-xs text-muted-foreground hover:text-foreground"
                        title="Archive"
                    >
                        <Archive className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {dialogue.messages && dialogue.messages.map((msg) => (
                    <div key={msg.id} className={`flex ${msg.sender === 'USER' ? 'justify-start' : 'justify-end'}`}>
                        <div className={`max-w-[70%] rounded-lg p-3 text-sm shadow-sm ${msg.sender === 'USER'
                            ? 'bg-muted text-foreground'
                            : 'bg-primary text-primary-foreground'
                            }`}>
                            <div className="whitespace-pre-wrap">{msg.text}</div>
                            <div className="text-[10px] opacity-70 text-right mt-1">
                                {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </div>
                        </div>
                    </div>
                ))}
                {(!dialogue.messages || dialogue.messages.length === 0) && (
                    <div className="text-center text-muted-foreground text-sm my-10">No messages yet.</div>
                )}
            </div>

            {/* Input */}
            <div className="p-4 border-t border-border bg-card">
                {/* AI Tools Toolbar */}
                <div className="flex gap-2 mb-2 overflow-x-auto pb-1">
                    <button
                        onClick={() => actions.regenerateResponse(dialogue.id)}
                        className="text-xs bg-indigo-500/10 text-indigo-500 hover:bg-indigo-500/20 px-3 py-1.5 rounded-full flex items-center gap-1 transition-colors whitespace-nowrap"
                        title="Force AI to generate a reply"
                    >
                        ✨ Generate Reply
                    </button>
                    <button
                        onClick={() => {
                            const instructions = prompt("Custom instructions for AI:");
                            if (instructions) actions.regenerateResponse(dialogue.id, instructions);
                        }}
                        className="text-xs bg-indigo-500/10 text-indigo-500 hover:bg-indigo-500/20 px-3 py-1.5 rounded-full flex items-center gap-1 transition-colors whitespace-nowrap"
                        title="Generate with instructions"
                    >
                        🪄 Generate with Hint...
                    </button>
                </div>

                <div className="flex gap-2">
                    <input
                        className="flex-1 bg-muted rounded-md px-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                        placeholder="Type a message..."
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                    />
                    <button
                        onClick={handleSend}
                        disabled={!input.trim()}
                        className="bg-primary text-primary-foreground px-4 py-2 rounded-md font-medium text-sm disabled:opacity-50 hover:bg-primary/90 transition-colors flex items-center gap-2"
                    >
                        <Send className="w-4 h-4" /> Send
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ChatWindow;
