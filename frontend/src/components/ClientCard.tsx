import React from 'react';
import { User } from '../types';
import { X, Briefcase, MapPin, DollarSign, Target, Heart } from 'lucide-react';

interface ClientCardProps {
    user: User;
    onClose: () => void;
}

const ClientCard: React.FC<ClientCardProps> = ({ user, onClose }) => {
    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-card w-full max-w-md rounded-xl shadow-xl border border-border overflow-hidden">
                {/* Header */}
                <div className="bg-muted/50 p-4 flex justify-between items-center border-b border-border">
                    <h3 className="font-semibold text-lg">Client Card</h3>
                    <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
                        <X className="h-5 w-5" />
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 space-y-6">
                    {/* Header Info */}
                    <div className="flex items-center gap-4">
                        <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center text-2xl font-bold text-primary">
                            {user.firstName?.[0] || 'U'}
                        </div>
                        <div>
                            <h2 className="text-xl font-bold">{user.firstName} {user.lastName}</h2>
                            <p className="text-sm text-muted-foreground">@{user.username || 'No username'}</p>
                            <span className={`text-xs px-2 py-0.5 rounded-full mt-1 inline-block ${user.status === 'LEAD' ? 'bg-orange-500/10 text-orange-500' :
                                    user.status === 'REJECTED' ? 'bg-red-500/10 text-red-500' : 'bg-green-500/10 text-green-500'
                                }`}>
                                {user.status}
                            </span>
                        </div>
                    </div>

                    {/* Fields Grid */}
                    <div className="grid grid-cols-1 gap-4">
                        <InfoItem icon={MapPin} label="City" value={user.city} />
                        <InfoItem icon={Briefcase} label="Activity" value={user.activity} />
                        <InfoItem icon={DollarSign} label="Income" value={user.currentIncome ? `${user.currentIncome} (Goal: ${user.desiredIncome})` : user.desiredIncome ? `Goal: ${user.desiredIncome}` : null} />
                        <InfoItem icon={Target} label="Requests" value={user.requests} />
                        <InfoItem icon={Heart} label="Hobbies" value={user.hobbies} />

                        {/* Business Card / Bio */}
                        {user.businessCard && (
                            <div className="mt-2 text-sm bg-muted/50 p-3 rounded-md">
                                <strong className="block mb-1 text-xs uppercase opacity-70">Business Card / Bio</strong>
                                {user.businessCard}
                            </div>
                        )}
                    </div>
                </div>

                <div className="p-4 border-t border-border bg-muted/20 text-center text-xs text-muted-foreground">
                    ID: {user.id} • Telegram ID: {user.telegramId}
                </div>
            </div>
        </div>
    );
};

const InfoItem = ({ icon: Icon, label, value }: { icon: any, label: string, value?: string | null }) => {
    if (!value) return null;
    return (
        <div className="flex items-start gap-3">
            <Icon className="h-5 w-5 text-muted-foreground mt-0.5" />
            <div>
                <div className="text-xs font-medium text-muted-foreground uppercase">{label}</div>
                <div className="text-sm">{value}</div>
            </div>
        </div>
    );
};

export default ClientCard;
