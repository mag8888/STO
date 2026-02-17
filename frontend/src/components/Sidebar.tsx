import React from 'react';
import { useChat } from '../hooks/useChat';
import { Search, RotateCw, Plus } from 'lucide-react';
import { DialogueSource, UserStatus } from '../types';

interface SidebarProps {
    chatState: ReturnType<typeof useChat>;
}

const Sidebar: React.FC<SidebarProps> = ({ chatState }) => {
    const {
        dialogues,
        currentDialogue,
        selectChat,
        search,
        setSearch,
        filter,
        setFilter,
        syncChats,
        showRejected,
        setShowRejected,
        loading
    } = chatState;

    return (
        <div className="flex flex-col h-full bg-card border-r border-border">
            {/* Header / Search */}
            <div className="p-4 border-b border-border space-y-3">
                <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <input
                            type="text"
                            placeholder="Search chats..."
                            className="w-full pl-9 pr-4 py-2 bg-muted text-sm rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                        />
                    </div>
                    <button
                        onClick={syncChats}
                        disabled={loading}
                        className="p-2 hover:bg-muted rounded-md transition-colors text-muted-foreground hover:text-foreground"
                        title="Sync with Telegram"
                    >
                        <RotateCw className={`h-5 w-5 ${loading ? 'animate-spin' : ''}`} />
                    </button>
                    <button
                        className="p-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
                        title="Add New Chat"
                    >
                        <Plus className="h-5 w-5" />
                    </button>
                </div>

                {/* Filters */}
                <div className="flex items-center justify-between">
                    <div className="flex bg-muted p-1 rounded-lg">
                        {(['ALL', 'INBOUND', 'SCOUT'] as const).map((f) => (
                            <button
                                key={f}
                                onClick={() => setFilter(f as any)} // Cast to match FilterType
                                className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${filter === f
                                    ? 'bg-background text-foreground shadow-sm'
                                    : 'text-muted-foreground hover:text-foreground'
                                    }`}
                            >
                                {f === 'INBOUND' ? 'Direct' : f === 'ALL' ? 'All' : 'Scout'}
                            </button>
                        ))}
                    </div>

                    <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                        <input
                            type="checkbox"
                            checked={showRejected}
                            onChange={(e) => setShowRejected(e.target.checked)}
                            className="rounded border-border bg-muted"
                        />
                        Rejected
                    </label>
                </div>
            </div>

            {/* Chat List */}
            <div className="flex-1 overflow-y-auto">
                {dialogues.map((d) => {
                    const isActive = currentDialogue?.id === d.id;
                    const isScout = d.source === DialogueSource.SCOUT || d.user.sourceChatId;
                    const lastMsg = d.messages?.[0];

                    return (
                        <div
                            key={d.id}
                            onClick={() => selectChat(d.id)}
                            className={`p-3 border-b border-border/50 cursor-pointer transition-colors hover:bg-muted/50 ${isActive ? 'bg-muted border-l-4 border-l-primary' : ''
                                }`}
                        >
                            <div className="flex justify-between items-start mb-1">
                                <div className="font-medium text-sm truncate pr-2">
                                    {d.user.firstName || 'User'} {d.user.lastName}
                                    {d.user.username && <span className="text-muted-foreground text-xs ml-1">@{d.user.username}</span>}
                                </div>
                                <span className="text-xs text-muted-foreground whitespace-nowrap">
                                    {/* Date parsing would go here */}
                                </span>
                            </div>

                            <div className="flex items-center gap-2 mb-1">
                                <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${isScout
                                    ? 'bg-purple-500/10 text-purple-500'
                                    : 'bg-green-500/10 text-green-500'
                                    }`}>
                                    {isScout ? 'SCOUT' : 'DIRECT'}
                                </span>
                                {d.user.status === UserStatus.LEAD && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-500 font-medium">🔥 Lead</span>
                                )}
                                {d.user.status === UserStatus.REJECTED && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-500 font-medium">🚫 Rejected</span>
                                )}
                            </div>

                            <div className="text-xs text-muted-foreground truncate">
                                {lastMsg ? lastMsg.text : <span className="italic">No messages</span>}
                            </div>
                        </div>
                    );
                })}
                {dialogues.length === 0 && !loading && (
                    <div className="p-8 text-center text-muted-foreground text-sm">
                        No chats found
                    </div>
                )}
            </div>
        </div>
    );
};

export default Sidebar;
