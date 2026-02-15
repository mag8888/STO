import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { getDialogues } from '../api';
import type { Dialogue } from '../api';
import clsx from 'clsx';
import { Search, LogIn, X, RefreshCw } from 'lucide-react';

const Sidebar: React.FC = () => {
    const [dialogues, setDialogues] = useState<Dialogue[]>([]);
    const [showLogin, setShowLogin] = useState(false);
    const [qrKey, setQrKey] = useState(0); // to force refresh image
    const location = useLocation();

    // Auto-refresh QR code every 3 seconds when modal is open
    useEffect(() => {
        let interval: any;
        if (showLogin) {
            interval = setInterval(() => {
                setQrKey(prev => prev + 1);
            }, 3000); // Telegram QR codes expire fast, good to refresh or just rely on user manual refresh
        }
        return () => clearInterval(interval);
    }, [showLogin]);

    const fetchDialogues = async () => {
        try {
            const data = await getDialogues();
            setDialogues(data);
        } catch (error) {
            console.error('Failed to fetch dialogues', error);
        }
    };

    useEffect(() => {
        fetchDialogues();
        // Poll for updates every 5 seconds
        const interval = setInterval(fetchDialogues, 5000);
        return () => clearInterval(interval);
    }, []);

    return (
        <div className="flex flex-col h-full bg-card relative">
            {/* Login Modal */}
            {showLogin && (
                <div className="absolute inset-0 z-50 bg-background/95 backdrop-blur-sm flex flex-col items-center justify-center p-4">
                    <button
                        onClick={() => setShowLogin(false)}
                        className="absolute top-4 right-4 p-2 hover:bg-muted rounded-full"
                    >
                        <X />
                    </button>
                    <h3 className="text-xl font-bold mb-4">Авторизация Telegram</h3>
                    <div className="bg-white p-4 rounded-lg shadow-lg mb-4">
                        <img
                            src={`http://localhost:3000/login-qr?t=${qrKey}`}
                            alt="Scan QR Code"
                            className="w-64 h-64 object-contain"
                            onError={(e) => {
                                (e.target as HTMLImageElement).src = 'https://via.placeholder.com/256?text=Loading+QR...';
                            }}
                        />
                    </div>
                    <p className="text-center text-muted-foreground mb-4 max-w-xs">
                        Откройте Telegram на телефоне, перейдите в Настройки &gt; Устройства &gt; Подключить устройство
                    </p>
                    <button
                        onClick={() => setQrKey(k => k + 1)}
                        className="flex items-center gap-2 px-4 py-2 bg-secondary rounded-md hover:bg-secondary/80"
                    >
                        <RefreshCw size={16} /> Обновить QR
                    </button>
                </div>
            )}

            <div className="p-4 border-b border-border space-y-3">
                <button
                    onClick={() => setShowLogin(true)}
                    className="w-full py-2 px-4 bg-primary text-primary-foreground rounded-md flex items-center justify-center gap-2 hover:bg-primary/90 transition-colors font-medium"
                >
                    <LogIn size={18} />
                    Авторизовать аккаунт
                </button>

                <div className="relative">
                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <input
                        placeholder="Поиск чатов..."
                        className="w-full pl-8 pr-4 py-2 bg-muted/50 rounded-md text-sm outline-none focus:ring-1 focus:ring-ring"
                    />
                </div>
            </div>

            <div className="flex-1 overflow-y-auto">
                {dialogues.map((dialogue) => {
                    const isActive = location.pathname === `/chat/${dialogue.id}`;
                    const lastMsg = dialogue.messages && dialogue.messages.length > 0 ? dialogue.messages[0] : null;
                    // We need to handle 'draftCount' if backend provides it, or calculate from messages if included
                    // The backend currently provides `messages: { take: 5 }`.
                    // If we want draft count, we might need to compute it or check messages.
                    // For now, let's just see if any of the last 5 is a draft.
                    const hasDraft = dialogue.messages?.some(m => m.status === 'DRAFT');

                    return (
                        <Link
                            key={dialogue.id}
                            to={`/chat/${dialogue.id}`}
                            className={clsx(
                                "block p-3 hover:bg-muted/50 transition-colors border-b border-border/50",
                                isActive ? "bg-muted border-l-2 border-l-primary" : "border-l-2 border-l-transparent"
                            )}
                        >
                            <div className="flex justify-between items-start mb-1">
                                <div className="font-semibold text-sm truncate pr-2">
                                    {dialogue.user?.firstName || dialogue.user?.username || `User ${dialogue.userId}`}
                                </div>
                                {lastMsg && (
                                    <div className="text-[10px] text-muted-foreground whitespace-nowrap">
                                        {new Date(lastMsg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </div>
                                )}
                            </div>

                            <div className="flex justify-between items-center">
                                <div className="text-xs text-muted-foreground truncate max-w-[180px]">
                                    {hasDraft ? (
                                        <span className="text-primary font-medium">Draft: {dialogue.messages.find(m => m.status === 'DRAFT')?.text}</span>
                                    ) : (
                                        lastMsg?.text || <span className="italic">Нет сообщений</span>
                                    )}
                                </div>
                                {hasDraft && (
                                    <div className="h-2 w-2 rounded-full bg-primary ml-2"></div>
                                )}
                            </div>
                        </Link>
                    );
                })}
            </div>
        </div>
    );
};

export default Sidebar;
