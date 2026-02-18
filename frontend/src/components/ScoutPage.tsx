import { useState, useEffect } from 'react';
import { getScoutChats, addScoutChat, scanChat, analyzeLead, importLead } from '../api';
import { Sparkles, Play, Save, UserPlus, ShieldAlert, Loader2 } from 'lucide-react';

interface ScannedChat {
    id: number;
    title: string;
    username: string;
    link: string;
}

interface Lead {
    text: string;
    date: number;
    isAdmin: boolean;
    sender: {
        id: string;
        username: string | null;
        firstName: string | null;
        lastName: string | null;
        accessHash: string | null;
    };
    // Local state
    analysis?: {
        profile: any;
        draft: string;
    };
    isAnalyzing?: boolean;
    isImported?: boolean;
}

const ScoutPage = () => {
    const [chats, setChats] = useState<ScannedChat[]>([]);
    const [selectedChat, setSelectedChat] = useState<ScannedChat | null>(null);
    const [leads, setLeads] = useState<Lead[]>([]);
    const [scanning, setScanning] = useState(false);
    const [newChatLink, setNewChatLink] = useState('');

    useEffect(() => {
        loadChats();
    }, []);

    const loadChats = async () => {
        try {
            const data = await getScoutChats();
            setChats(data);
        } catch (e) {
            console.error(e);
        }
    };

    const handleAddChat = async () => {
        if (!newChatLink) return;
        try {
            await addScoutChat(newChatLink);
            setNewChatLink('');
            loadChats();
        } catch (e) {
            alert('Failed to add chat');
        }
    };

    const handleSelectChat = async (chat: ScannedChat) => {
        setSelectedChat(chat);
        setScanning(true);
        setLeads([]);
        try {
            const data = await scanChat(chat.username);
            setLeads(data.leads);
        } catch (e) {
            console.error(e);
            alert('Scan failed');
        } finally {
            setScanning(false);
        }
    };

    const handleAnalyze = async (index: number) => {
        const lead = leads[index];
        const newLeads = [...leads];
        newLeads[index].isAnalyzing = true;
        setLeads(newLeads);

        try {
            const result = await analyzeLead(lead.text, lead.sender);
            newLeads[index].analysis = result;
        } catch (e) {
            console.error(e);
            alert('Analysis failed');
        } finally {
            newLeads[index].isAnalyzing = false;
            setLeads(newLeads);
        }
    };

    const handleImport = async (index: number) => {
        const lead = leads[index];
        if (!lead.analysis || !selectedChat) return;

        try {
            await importLead(lead.sender, lead.analysis.profile, lead.analysis.draft, selectedChat.id);
            const newLeads = [...leads];
            newLeads[index].isImported = true;
            setLeads(newLeads);
        } catch (e) {
            console.error(e);
            alert('Import failed');
        }
    };

    return (
        <div className="flex h-full">
            {/* Sidebar: Chats */}
            <div className="w-1/4 min-w-[250px] border-r border-border p-4 bg-muted/10 flex flex-col">
                <h2 className="font-bold mb-4 flex items-center gap-2"><Sparkles className="w-4 h-4 text-purple-400" /> Scout Chats</h2>

                <div className="flex gap-2 mb-4">
                    <input
                        className="flex-1 bg-background border border-border rounded px-2 py-1 text-sm"
                        placeholder="t.me/chatlink"
                        value={newChatLink}
                        onChange={e => setNewChatLink(e.target.value)}
                    />
                    <button onClick={handleAddChat} className="bg-primary text-primary-foreground px-2 rounded">+</button>
                </div>

                <div className="flex-1 overflow-y-auto space-y-2">
                    {chats.map(chat => (
                        <div
                            key={chat.id}
                            onClick={() => handleSelectChat(chat)}
                            className={`p-3 rounded cursor-pointer border hover:bg-muted/50 transition-colors ${selectedChat?.id === chat.id ? 'bg-muted border-primary' : 'border-border bg-card'}`}
                        >
                            <div className="font-medium truncate">{chat.title}</div>
                            <div className="text-xs text-muted-foreground truncate">@{chat.username}</div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Main: Leads */}
            <div className="flex-1 p-6 overflow-y-auto bg-background">
                {!selectedChat ? (
                    <div className="text-center text-muted-foreground mt-20">Select a chat to start scouting</div>
                ) : (
                    <div>
                        <div className="flex justify-between items-center mb-6">
                            <h2 className="text-xl font-bold">Leads from {selectedChat.title}</h2>
                            <button
                                onClick={() => handleSelectChat(selectedChat)}
                                disabled={scanning}
                                className="flex items-center gap-2 bg-secondary text-secondary-foreground px-4 py-2 rounded hover:bg-secondary/80 disabled:opacity-50"
                            >
                                {scanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                                {scanning ? 'Scanning...' : 'Rescan'}
                            </button>
                        </div>

                        <div className="space-y-6">
                            {leads.length === 0 && !scanning && <div className="text-muted-foreground">No relevant leads found.</div>}

                            {leads.map((lead, idx) => (
                                <div key={idx} className={`border rounded-lg p-4 bg-card shadow-sm ${lead.isImported ? 'opacity-50 border-green-500/30' : 'border-border'}`}>
                                    {/* Header */}
                                    <div className="flex justify-between items-start mb-2">
                                        <div className="flex items-center gap-2">
                                            <div className="font-bold text-lg text-primary">
                                                {lead.sender.firstName} {lead.sender.lastName}
                                            </div>
                                            <div className="text-sm text-muted-foreground">@{lead.sender.username || 'No Username'}</div>
                                            {lead.isAdmin && (
                                                <span className="bg-red-500/10 text-red-400 text-xs px-2 py-0.5 rounded border border-red-500/20 flex items-center gap-1">
                                                    <ShieldAlert className="w-3 h-3" /> Admin
                                                </span>
                                            )}
                                        </div>
                                        <div className="text-xs text-muted-foreground">
                                            {new Date(lead.date * 1000).toLocaleString()}
                                        </div>
                                    </div>

                                    {/* Message */}
                                    <div className="bg-muted/30 p-3 rounded mb-4 text-sm whitespace-pre-wrap font-mono text-muted-foreground border border-border/50">
                                        "{lead.text}"
                                    </div>

                                    {/* Actions / Analysis */}
                                    {!lead.analysis ? (
                                        <div className="flex justify-end">
                                            <button
                                                onClick={() => handleAnalyze(idx)}
                                                disabled={lead.isAnalyzing}
                                                className="flex items-center gap-2 bg-purple-600 text-white px-4 py-2 rounded shadow hover:bg-purple-700 transition-colors disabled:opacity-50"
                                            >
                                                {lead.isAnalyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                                                Result (AI Analyze)
                                            </button>
                                        </div>
                                    ) : (
                                        <div className="bg-purple-500/5 border border-purple-500/20 rounded-lg p-4 animate-in fade-in duration-300">
                                            <div className="grid grid-cols-2 gap-4 mb-4 text-sm">
                                                <div><span className="text-muted-foreground">Activity:</span> <span className="text-foreground font-medium">{lead.analysis.profile.activity || '—'}</span></div>
                                                <div><span className="text-muted-foreground">City:</span> <span className="text-foreground font-medium">{lead.analysis.profile.city || '—'}</span></div>
                                                <div className="col-span-2"><span className="text-muted-foreground">Business Card:</span> <span className="text-foreground">{lead.analysis.profile.businessCard || '—'}</span></div>
                                            </div>

                                            <div className="mb-4">
                                                <label className="text-xs text-muted-foreground uppercase font-bold mb-1 block">Draft Proposal:</label>
                                                <textarea
                                                    className="w-full bg-background border border-purple-500/30 rounded p-2 text-sm h-20 focus:outline-none focus:ring-1 focus:ring-purple-500"
                                                    value={lead.analysis.draft}
                                                    onChange={(e) => {
                                                        const newLeads = [...leads];
                                                        if (newLeads[idx].analysis) {
                                                            newLeads[idx].analysis!.draft = e.target.value;
                                                            setLeads(newLeads);
                                                        }
                                                    }}
                                                />
                                            </div>

                                            <div className="flex justify-end gap-2">
                                                <button
                                                    onClick={() => setLeads(prev => { const n = [...prev]; delete n[idx].analysis; return n; })}
                                                    className="px-3 py-1 text-sm text-muted-foreground hover:text-foreground"
                                                >
                                                    Cancel
                                                </button>
                                                {!lead.isImported && (
                                                    <button
                                                        onClick={() => handleImport(idx)}
                                                        className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 shadow-sm"
                                                    >
                                                        <UserPlus className="w-4 h-4" /> Import to CRM
                                                    </button>
                                                )}
                                                {lead.isImported && (
                                                    <span className="flex items-center gap-2 text-green-500 font-medium px-4 py-2">
                                                        <Save className="w-4 h-4" /> Imported
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default ScoutPage;
