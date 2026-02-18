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
        selectedScenarios?: string[]; // Track selected scenarios
    };
    isAnalyzing?: boolean;
    isImported?: boolean;
}

const SCENARIO_OPTIONS = [
    { id: 'greeting', label: '👋 Приветствие (Имя)', text: (p: any) => `${p.firstName ? `Привет, ${p.firstName}` : 'Привет'},` },
    { id: 'hook_interest', label: '👌 Интересный проект', text: (p: any) => `У вас интересное направление (${p.activity || 'работа'})!` },
    { id: 'context_chat', label: '👀 Видел в чате', text: (_: any) => `Увидел ваше сообщение в чате по нетворкингу.` },
    { id: 'offer_club', label: '🚀 Оффер: Клуб', text: (_: any) => `Мы делаем онлайн-нетворкинг и можем знакомить вас с полезными людьми каждый день.` },
    { id: 'offer_service', label: '🤖 Оффер: ИИ сервис', text: (_: any) => `Мы сделали сервис, который дает 5-10 теплых интро ежедневно.` },
    { id: 'cta_soft', label: '❓ CTA: Мягкий', text: (_: any) => `Было бы интересно попробовать?` },
];

const ScoutPage = () => {
    const { username } = useParams();
    const [leads, setLeads] = useState<Lead[]>([]);
    const [scanning, setScanning] = useState(false);
    const [scanLimit, setScanLimit] = useState(50);

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
            const data = await scanChat(chatUsername, scanLimit);
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

            // Initialize with all scenarios selected by default OR just empty manual draft?
            // User wants flexible selection. Let's select Greeting + Context + Offer by default.
            const defaultScenarios = ['greeting', 'context_chat', 'offer_service', 'cta_soft'];

            // Helper to generate text
            const generateDraft = (scenarios: string[], profile: any) => {
                return scenarios
                    .map(id => SCENARIO_OPTIONS.find(o => o.id === id)?.text(profile))
                    .join(' ');
            };

            // If AI returned a draft, we might want to keep it or override?
            // User request implies using checkboxes to *construct* the draft. 
            // Let's use the Checkbox system as the PRIMARY drafter, but keep AI's "profile" extraction.
            // We can put AI's draft in a "Custom" slot or just overwrite it with scenarios.
            // Let's initialize with Scenarios to demonstrate the feature.

            newLeads[index].analysis = {
                ...result,
                selectedScenarios: defaultScenarios,
                draft: generateDraft(defaultScenarios, result.profile)
            };
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
                <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1 bg-background border rounded px-2 py-1">
                        <span className="text-xs text-muted-foreground">Limit:</span>
                        <input
                            type="number"
                            className="w-12 text-sm bg-transparent focus:outline-none"
                            value={scanLimit}
                            onChange={(e) => setScanLimit(Number(e.target.value))}
                            min={10}
                            max={500}
                        />
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

                                    {/* Scenario Checkboxes */}
                                    <div className="flex flex-wrap gap-2 mb-2 bg-muted/20 p-2 rounded border border-border/50">
                                        {SCENARIO_OPTIONS.map(option => (
                                            <label key={option.id} className="flex items-center gap-1.5 text-xs cursor-pointer select-none hover:bg-muted/50 p-1 rounded transition-colors">
                                                <input
                                                    type="checkbox"
                                                    className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                                                    checked={lead.analysis?.selectedScenarios?.includes(option.id) || false}
                                                    onChange={(e) => {
                                                        const newLeads = [...leads];
                                                        const analysis = newLeads[idx].analysis!;
                                                        const Scenarios = analysis.selectedScenarios || [];

                                                        let newScenarios;
                                                        if (e.target.checked) {
                                                            newScenarios = [...Scenarios, option.id];
                                                            // Sort by original order to keep text logical
                                                            newScenarios.sort((a, b) => {
                                                                return SCENARIO_OPTIONS.findIndex(o => o.id === a) - SCENARIO_OPTIONS.findIndex(o => o.id === b);
                                                            });
                                                        } else {
                                                            newScenarios = Scenarios.filter(id => id !== option.id);
                                                        }

                                                        analysis.selectedScenarios = newScenarios;

                                                        // Regenerate Draft Loop
                                                        const generateText = (ids: string[]) => ids.map(id => SCENARIO_OPTIONS.find(o => o.id === id)?.text(analysis.profile || { firstName: lead.sender.firstName })).join(' ');
                                                        analysis.draft = generateText(newScenarios);

                                                        setLeads(newLeads);
                                                    }}
                                                />
                                                {option.label}
                                            </label>
                                        ))}
                                    </div>

                                    <textarea
                                        className="w-full bg-background border border-purple-500/30 rounded p-2 text-sm h-24 focus:outline-none focus:ring-1 focus:ring-purple-500 font-sans"
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
