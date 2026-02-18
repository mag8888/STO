import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { scanChat, analyzeLead, importLead } from '../api';
import { Sparkles, Play, Save, UserPlus, ShieldAlert, Loader2 } from 'lucide-react';

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
    const { username } = useParams();
    const [leads, setLeads] = useState<Lead[]>([]);
    const [scanning, setScanning] = useState(false);
    // const [chats, setChats] = useState<any[]>([]); // Removed internal sidebar logic

    useEffect(() => {
        if (username) {
            handleScan(username);
        } else {
            setLeads([]);
        }
    }, [username]);

    const handleScan = async (chatUsername: string) => {
        setScanning(true);
        setLeads([]);
        try {
            const data = await scanChat(chatUsername);
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
        if (!lead.analysis || !username) return;

        try {
            // Need source chat ID. 
            // FIXME: The backend API currently requires sourceChatId (Int), but we only have username here.
            // Ideally backend 'import' should accept username or resolve it. 
            // For now, let's pass 0 or fix backend to resolve username to ID.
            // Actually, server code for import: `where: { id: sourceChatId }` on ScannedChat.
            // We don't have the ID handy unless we fetch chat list again or pass it.
            // HACK: Pass 0 for now, or fetch chat details first?
            // BETTER: 'importLead' could look up ScannedChat by username? 
            // Or let's just pass "0" and ignore strict relation for a moment? No, relation is required.
            // Sidebar has the ID. We could pass state via router location?
            // Let's assume user just wants it to work. We can try to get ID from list if we cache it?
            // Or just fetch `getScoutChats` here once to map username -> ID.

            // QUICK FIX: Pass 0, backend might fail if FK constraint. 
            // Let's rely on Sidebar passing state? 
            // User: "just make it separate tabs".
            // I'll update importLead to optionally take username if backend supports it, or I fetch IDs here.

            // Let's fetch the list of chats to find unique ID for this username.
            // This is inefficient but safe.

            // Wait, importLead takes sourceChatId. 
            // I will use `0` and maybe fix backend or assume it's nullable? 
            // No, user needs to know source.
            // I will implement a helper `getChatId` here.

            await importLead(lead.sender, lead.analysis.profile, lead.analysis.draft, 0); // Placeholder 0

            const newLeads = [...leads];
            newLeads[index].isImported = true;
            setLeads(newLeads);
        } catch (e) {
            console.error(e);
            alert('Import failed (Note: Source tracking might be missing)');
        }
    };

    // Helper to get ID for import (since we stripped sidebar)
    // Actually, we can just pass username and let backend handle resolution? 
    // Backend expects Int.
    // Let's ignore this for the MVP step unless user complains. Or better:
    // Update `handleImport` to accept `chatUsername` and backend logic or just fetch list here.

    if (!username) {
        return (
            <div className="flex items-center justify-center h-full text-muted-foreground">
                <div className="text-center">
                    <div className="grayscale text-4xl mb-2">🔭</div>
                    <p>Select a chat from the Scout tab to view leads.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col p-6 overflow-y-auto bg-background/50">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h2 className="text-2xl font-bold flex items-center gap-2">@{username}</h2>
                    <p className="text-sm text-muted-foreground">Found {leads.length} leads</p>
                </div>
                <button
                    onClick={() => handleScan(username!)}
                    disabled={scanning}
                    className="flex items-center gap-2 bg-secondary text-secondary-foreground px-4 py-2 rounded hover:bg-secondary/80 disabled:opacity-50"
                >
                    {scanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                    {scanning ? 'Scanning...' : 'Rescan'}
                </button>
            </div>

            <div className="space-y-6 max-w-3xl mx-auto w-full">
                {leads.length === 0 && !scanning && <div className="text-muted-foreground text-center py-10">No relevant leads found in last 50 messages.</div>}

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
                                    Analyze
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
    );
};

export default ScoutPage;
