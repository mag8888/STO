import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || '';

export const api = axios.create({
    baseURL: API_URL,
});

export interface User {
    id: number;
    telegramId: string;
    username: string | null;
    firstName: string | null;
    status: string;
}

export interface Message {
    id: number;
    dialogueId: number;
    sender: 'USER' | 'SIMULATOR' | 'OPERATOR';
    text: string;
    status: 'SENT' | 'DRAFT' | 'RECEIVED';
    createdAt: string;
}

export interface Dialogue {
    id: number;
    userId: number;
    status: string;
    stage: string;
    createdAt: string;
    updatedAt: string;
    user: User;
    messages: Message[];
    unreadCount?: number; // Optional, computed by backend
    draftCount?: number; // Optional, computed by backend
    lastMessage?: Message; // Optional
}

export const getDialogues = async () => {
    const response = await api.get<Dialogue[]>('/dialogues');
    return response.data;
};

export const getDialogue = async (id: number) => {
    const response = await api.get<Dialogue>(`/dialogues/${id}`);
    return response.data;
};

export const sendMessage = async (username: string, message: string) => {
    const response = await api.post('/send', { username, message });
    return response.data;
};

export const approveMessage = async (messageId: number, updatedText?: string) => {
    const response = await api.post(`/messages/${messageId}/approve`, { updatedText });
    return response.data;
};

export const createDraft = async (_: number, __: string) => {
    // We need an endpoint for this if we want manual drafting
    // For now, assume it's done via other means or add endpoint
    // return api.post(`/dialogues/${dialogueId}/draft`, { text });
};
