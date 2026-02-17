import React, { useState, useEffect } from 'react';
import { RotateCw } from 'lucide-react';

interface LoginScreenProps {
    onLogin: () => void;
}

const LoginScreen: React.FC<LoginScreenProps> = ({ onLogin }) => {
    const [qr, setQr] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    const checkStatus = async () => {
        try {
            const res = await fetch('/status');
            const data = await res.json();
            if (data.connected) {
                onLogin();
            } else if (data.qr) {
                setQr(data.qr);
                setLoading(false);
            }
        } catch (e) {
            console.error(e);
        }
    };

    useEffect(() => {
        checkStatus();
        const interval = setInterval(checkStatus, 3000); // Poll for login/QR
        return () => clearInterval(interval);
    }, []);

    return (
        <div className="flex h-screen w-full items-center justify-center bg-background text-foreground flex-col gap-6">
            <h1 className="text-2xl font-bold">Telegram Login</h1>

            {loading ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                    <RotateCw className="animate-spin w-5 h-5" /> Connecting...
                </div>
            ) : qr ? (
                <div className="bg-white p-4 rounded-lg shadow-lg">
                    {/* Render QR code image if backend sends base64, or text if using terminal QR */}
                    {/* Assuming backend sends base64 image data uri in 'qr' field or just raw string */}
                    {qr.startsWith('data:image') ? (
                        <img src={qr} alt="QR Code" className="w-64 h-64" />
                    ) : (
                        <div className="w-64 h-64 flex items-center justify-center text-xs font-mono break-all bg-muted p-2 overflow-hidden">
                            {/* Fallback if it's not an image string */}
                            Check backend console for QR
                        </div>
                    )}
                </div>
            ) : (
                <p className="text-muted-foreground">Waiting for QR Code...</p>
            )}

            <p className="text-sm text-muted-foreground max-w-xs text-center">
                Scan this QR code with your Telegram/Gram JS client to authenticate.
            </p>
        </div>
    );
};

export default LoginScreen;
