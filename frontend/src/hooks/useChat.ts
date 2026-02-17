import { useState, useEffect, useCallback } from 'react';
import type { Dialogue } from '../types';
import { DialogueSource } from '../types';

export const useChat = () => {
    const [dialogues, setDialogues] = useState<Dialogue[]>([]);
    const [currentDialogue, setCurrentDialogue] = useState<Dialogue | null>(null);
    const [filter, setFilter] = useState<'ALL' | DialogueSource>('ALL');
    const [search, setSearch] = useState('');
    const [loading, setLoading] = useState(false);
    const [showRejected, setShowRejected] = useState(false);

    // Fetch Dialogues
    const loadDialogues = useCallback(async () => {
        try {
            setLoading(true);
            const res = await fetch('/dialogues');
            if (!res.ok) throw new Error('Failed to fetch dialogues');
            const data: Dialogue[] = await res.json();
            setDialogues(data);

            // Update current dialogue if selected
            if (currentDialogue) {
                const updated = data.find(d => d.id === currentDialogue.id);
                if (updated) setCurrentDialogue(updated);
            }
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    }, [currentDialogue]);

    // Initial Load & Polling
    useEffect(() => {
        loadDialogues();
        // Poll every 10s (less aggressive than before)
        const interval = setInterval(loadDialogues, 10000);
        return () => clearInterval(interval);
    }, [loadDialogues]);

    // Derived State: Filtered List
    const filteredDialogues = dialogues.filter(d => {
        // 1. Rejected Filter
        if (!showRejected && d.user.status === 'REJECTED') return false;

        // 2. Tab Filter
        if (filter !== 'ALL') {
            const isScout = d.source === 'SCOUT' || (d.user.sourceChatId !== null);
            if (filter === 'SCOUT' && !isScout) return false;
            if (filter === 'INBOUND' && isScout) return false;
        }

        // 3. Search Filter
        if (search) {
            const term = search.toLowerCase();
            const fn = (d.user.firstName || '').toLowerCase();
            const ln = (d.user.lastName || '').toLowerCase();
            const un = (d.user.username || '').toLowerCase();
            return fn.includes(term) || ln.includes(term) || un.includes(term);
        }
        return true;
    });

    const selectChat = async (id: number) => {
        // 1. Optimistic update (show partial data immediately)
        const partial = dialogues.find(d => d.id === id);
        if (partial) setCurrentDialogue(partial);

        try {
            setLoading(true);
            const res = await fetch(`/dialogues/${id}`);
            if (!res.ok) throw new Error('Failed to fetch chat details');
            const fullDialogue: Dialogue = await res.json();
            setCurrentDialogue(fullDialogue);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const syncChats = async () => {
        try {
            setLoading(true);
            await fetch('/sync-chats', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ limit: 100 })
            });
            await loadDialogues();
        } catch (e) {
            alert('Sync failed');
        } finally {
            setLoading(false);
        }
    };

    const sendMessage = async (dialogueId: number, text: string) => {
        try {
            await fetch('/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dialogueId, message: text })
            });
            await selectChat(dialogueId);
        } catch (e) {
            console.error(e);
            alert('Failed to send message');
        }
    };

    const updateUserStatus = async (userId: number, status: string) => {
        try {
            await fetch(`/users/${userId}/status`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status })
            });
            await loadDialogues();
        } catch (e) {
            console.error(e);
        }
    };

    const updateDialogueSource = async (dialogueId: number, source: string) => {
        try {
            await fetch(`/dialogues/${dialogueId}/source`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ source })
            });
            await loadDialogues();
            if (currentDialogue?.id === dialogueId) await selectChat(dialogueId);
        } catch (e) {
            console.error(e);
        }
    };

    const toggleArchive = async (dialogueId: number) => {
        try {
            await fetch(`/dialogues/${dialogueId}/archive`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            await loadDialogues();
            if (currentDialogue?.id === dialogueId) setCurrentDialogue(null);
        } catch (e) {
            console.error(e);
        }
    };

    return {
        dialogues: filteredDialogues,
        currentDialogue,
        selectChat,
        loadDialogues,
        syncChats,
        sendMessage,
        updateUserStatus,
        updateDialogueSource,
        toggleArchive,
        filter,
        setFilter,
        search,
        setSearch,
        loading,
        showRejected,
        setShowRejected
    };
};
