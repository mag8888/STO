import React from 'react';
import clsx from 'clsx';
import { Check, CheckCheck, Clock } from 'lucide-react';
import type { Message } from '../api';

interface MessageBubbleProps {
    message: Message;
    onApprove?: (id: number, newText?: string) => void;
    onReject?: (id: number) => void;
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({ message, onApprove }) => {
    const isMe = message.sender === 'SIMULATOR' || message.sender === 'OPERATOR';
    const isDraft = message.status === 'DRAFT';
    const [isEditing, setIsEditing] = React.useState(false);
    const [editText, setEditText] = React.useState(message.text);

    const handleApprove = () => {
        if (onApprove) {
            onApprove(message.id, isEditing ? editText : undefined);
        }
    };

    return (
        <div className={clsx(
            "flex w-full mb-2",
            isMe ? "justify-end" : "justify-start"
        )}>
            <div className={clsx(
                "max-w-[85%] rounded-lg p-3 relative",
                isMe && !isDraft ? "bg-primary text-primary-foreground rounded-tr-none" : "",
                !isMe ? "bg-secondary text-secondary-foreground rounded-tl-none" : "",
                isDraft ? "bg-blue-50 border border-blue-200 text-blue-900 w-full" : ""
            )}>
                {isDraft && (
                    <div className="text-xs font-bold text-blue-600 mb-2 uppercase tracking-wider flex items-center justify-between">
                        <span className="flex items-center gap-1"><Clock size={12} /> Proposed Reply</span>
                        {!isEditing && (
                            <button
                                onClick={() => setIsEditing(true)}
                                className="text-blue-500 hover:text-blue-700 underline px-2"
                            >
                                Edit
                            </button>
                        )}
                    </div>
                )}

                <div className="whitespace-pre-wrap word-break-break-word">
                    {isEditing ? (
                        <textarea
                            value={editText}
                            onChange={(e) => setEditText(e.target.value)}
                            className="w-full p-2 text-sm border rounded bg-white text-black focus:ring-2 focus:ring-blue-500 outline-none"
                            rows={4}
                        />
                    ) : (
                        message.text
                    )}
                </div>

                <div className={clsx(
                    "text-[10px] mt-1 flex items-center justify-end gap-1 opacity-70",
                    isMe ? "text-primary-foreground/80" : "text-muted-foreground",
                    isDraft ? "text-blue-800/60" : ""
                )}>
                    {new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    {isMe && !isDraft && (
                        <span>
                            {message.status === 'SENT' ? <Check size={12} /> : <CheckCheck size={12} />}
                        </span>
                    )}
                </div>

                {isDraft && (
                    <div className="mt-2 flex gap-2 justify-end border-t border-blue-200 pt-2">
                        {isEditing && (
                            <button
                                onClick={() => { setIsEditing(false); setEditText(message.text); }}
                                className="px-3 py-1 text-xs text-blue-700 hover:bg-blue-100 rounded"
                            >
                                Cancel
                            </button>
                        )}
                        <button
                            onClick={handleApprove}
                            className="px-4 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors flex items-center gap-1 font-bold shadow-sm"
                        >
                            <Check size={14} /> {isEditing ? 'Save & Send' : 'Approve & Send'}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};
