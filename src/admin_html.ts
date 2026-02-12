export const adminHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Telegram Simulator Admin</title>
    <style>
        :root {
            --bg-color: #ffffff;
            --secondary-bg: #f4f4f5;
            --text-primary: #000000;
            --text-secondary: #707579;
            --accent-blue: #3390ec;
            --accent-green: #34c759;
            --accent-red: #ef4444;
            --border-color: #e5e7eb;
            --hover-bg: #f5f5f5;
        }

        body {
            background-color: var(--secondary-bg);
            color: var(--text-primary);
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            margin: 0;
            padding: 0;
        }

        .header {
            background: var(--bg-color);
            padding: 15px 20px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            box-shadow: 0 1px 2px rgba(0,0,0,0.05);
            position: sticky;
            top: 0;
            z-index: 100;
        }

        .header h1 {
            font-size: 18px;
            margin: 0;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .status-badge {
            font-size: 12px;
            background: #e0f2f1;
            color: #00695c;
            padding: 4px 8px;
            border-radius: 12px;
        }

        .container {
            max-width: 1000px;
            margin: 20px auto;
            display: grid;
            grid-template-columns: 1fr 340px;
            gap: 20px;
            padding: 0 20px;
        }

        .section-card {
            background: var(--bg-color);
            border-radius: 16px;
            overflow: hidden;
            box-shadow: 0 2px 4px rgba(0,0,0,0.02);
            margin-bottom: 20px;
        }

        .card-header {
            padding: 15px 20px;
            border-bottom: 1px solid var(--border-color);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .card-header h2 {
            margin: 0;
            font-size: 16px;
            font-weight: 600;
        }

        /* Live Screen */
        .screen-wrapper {
            background: #000;
            aspect-ratio: 16/10;
            display: flex;
            align-items: center;
            justify-content: center;
            position: relative;
        }
        #live-screen {
            width: 100%;
            height: 100%;
            object-fit: contain;
        }

        /* Message List (Telegram Style) */
        .chat-list {
            list-style: none;
            padding: 0;
            margin: 0;
            max-height: 600px;
            overflow-y: auto;
        }

        .chat-item {
            display: flex;
            padding: 10px 15px;
            cursor: pointer;
            transition: background 0.2s;
            border-bottom: 1px solid transparent;
        }

        .chat-item:hover {
            background-color: var(--hover-bg);
            border-radius: 12px;
        }

        .avatar {
            width: 48px;
            height: 48px;
            border-radius: 50%;
            background: linear-gradient(135deg, #66a6ff 0%, #89f7fe 100%);
            color: white;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: bold;
            font-size: 18px;
            margin-right: 12px;
            flex-shrink: 0;
        }

        .chat-content {
            flex: 1;
            min-width: 0; /* for text overflow */
        }

        .chat-header {
            display: flex;
            justify-content: space-between;
            margin-bottom: 4px;
        }

        .chat-name {
            font-weight: 600;
            font-size: 15px;
        }

        .chat-time {
            font-size: 12px;
            color: var(--text-secondary);
        }

        .chat-preview {
            color: var(--text-secondary);
            font-size: 14px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            display: flex;
            justify-content: space-between;
        }

        .badge {
            background: var(--accent-blue);
            color: white;
            border-radius: 10px;
            padding: 0 8px;
            font-size: 11px;
            height: 18px;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .badge.out { background: #e0e0e0; color: #555; }

        /* Controls */
        .controls-grid {
            padding: 15px;
            display: grid;
            gap: 12px;
        }

        .tg-button {
            background: var(--accent-blue);
            color: white;
            border: none;
            padding: 12px;
            border-radius: 10px;
            font-weight: 500;
            font-size: 14px;
            cursor: pointer;
            width: 100%;
            text-align: center;
            transition: opacity 0.2s;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            text-decoration: none;
        }

        .tg-button:hover { opacity: 0.9; }
        .tg-button.secondary { background: #eef2f5; color: var(--accent-blue); }
        .tg-button.danger { background: rgba(239, 68, 68, 0.1); color: var(--accent-red); }

        .form-group { margin-bottom: 12px; }
        .form-label { display: block; font-size: 13px; color: var(--text-secondary); margin-bottom: 6px; font-weight: 500; }
        .tg-input {
            width: 100%;
            padding: 12px;
            border: 1px solid var(--border-color);
            border-radius: 10px;
            font-size: 15px;
            background: var(--bg-color);
            box-sizing: border-box;
            outline: none;
            transition: border-color 0.2s;
        }
        .tg-input:focus { border-color: var(--accent-blue); }

        @media (max-width: 800px) {
            .container { grid-template-columns: 1fr; }
            .header { border-bottom: 1px solid var(--border-color); }
        }
    </style>
</head>
<body>

    <div class="header">
        <h1>
            <span style="font-size: 24px;">🤖</span> 
            Telegram Simulator 
            <span id="browser-status" class="status-badge">Checking...</span>
        </h1>
    </div>

    <div class="container">
        <!-- Center Column: Messages -->
        <div>
           <div class="section-card">
                <div class="card-header">
                    <h2>Recent Messages</h2>
                    <button class="tg-button secondary" onclick="loadMessages()" style="width: auto; padding: 6px 12px; font-size: 12px;">Update</button>
                </div>
                <div id="message-log" class="chat-list">
                    <div style="padding: 20px; text-align: center; color: var(--text-secondary);">Loading chats...</div>
                </div>
            </div>
            
             <div class="section-card">
                <div class="card-header">
                     <h2>Live Browser View</h2>
                     <span style="font-size: 12px; color: var(--text-secondary);">Auto-updates every 5s</span>
                </div>
                <div class="screen-wrapper">
                    <img id="live-screen" src="/screen" alt="Connecting...">
                </div>
            </div>
        </div>

        <!-- Right Column: Actions -->
        <div>
            <div class="section-card">
                <div class="card-header"><h2>Actions</h2></div>
                <div class="controls-grid">
                    <button class="tg-button" onclick="document.getElementById('send-form-card').scrollIntoView({behavior: 'smooth'})">
                        ✏️ New Message
                    </button>
                    <a href="/login-qr" target="_blank" class="tg-button secondary">
                        📱 Open QR Login
                    </a>
                     <button class="tg-button danger" onclick="reloadBrowser()">
                        ⚠️ Reload Browser
                    </button>
                    <button class="tg-button danger" style="background: rgba(239, 68, 68, 0.2);" onclick="resetSession()">
                        🔴 Reset Session
                    </button>
                </div>
            </div>

            <!-- Phone Auth Card -->
            <div class="section-card">
                <div class="card-header"><h2>Phone Login</h2></div>
                <div class="controls-grid">
                    <div class="form-group">
                        <label class="form-label">Phone Number</label>
                        <input type="text" id="phone-input" class="tg-input" placeholder="+1234567890">
                    </div>
                    <button class="tg-button" onclick="loginPhone()">1. Send Code</button>
                    
                    <div style="border-top: 1px solid var(--border-color); margin: 10px 0;"></div>
                    
                    <div class="form-group">
                        <label class="form-label">Verification Code</label>
                        <input type="text" id="code-input" class="tg-input" placeholder="12345">
                    </div>
                    <button class="tg-button secondary" onclick="loginCode()">2. Login with Code</button>

                    <div style="border-top: 1px solid var(--border-color); margin: 10px 0;"></div>

                    <div class="form-group">
                        <label class="form-label">2FA Password (Cloud)</label>
                        <input type="password" id="password-input" class="tg-input" placeholder="Your Password">
                    </div>
                    <button class="tg-button secondary" onclick="loginPassword()">3. Login with Password</button>
                    
                </div>
                </div>
            </div>

            <!-- Session Import Card -->
            <div class="section-card">
                <div class="card-header"><h2>Import Session (Advanced)</h2></div>
                <div class="controls-grid">
                     <p style="font-size: 12px; color: var(--text-secondary); margin: 0;">
                        1. Open Console in your browser (F12)<br>
                        2. Run extraction code (see below)<br>
                        3. Paste JSON result here
                    </p>
                    <textarea id="session-input" class="tg-input" rows="3" placeholder='{"key": "value", ...}'></textarea>
                    <button class="tg-button" onclick="importSession()">🚀 Inject Session</button>
                    <button class="tg-button secondary" onclick="copyExtractionCode()">📋 Copy Extraction Code</button>
                </div>
            </div>
            
            <div id="send-form-card" class="section-card">
                <div class="card-header"><h2>Send Message</h2></div>
                <div class="controls-grid">
                    <form id="send-form" onsubmit="sendMessage(event)">
                        <div class="form-group">
                            <label class="form-label">Username</label>
                            <input type="text" id="username" class="tg-input" placeholder="e.g. durov" required>
                        </div>
                        <div class="form-group">
                            <label class="form-label">Message</label>
                            <textarea id="message" rows="3" class="tg-input" placeholder="Type a message..." required></textarea>
                        </div>
                        <button type="submit" class="tg-button">Send</button>
                        <div id="send-status" style="margin-top: 10px; font-size: 13px; text-align: center;"></div>
                    </form>
                </div>
            </div>
        </div>
    </div>

    <script>
        // Start auto-refresh for screen
        setInterval(refreshScreen, 5000);

        function refreshScreen() {
            const img = document.getElementById('live-screen');
            img.src = '/screen?t=' + new Date().getTime();
        }

        async function reloadBrowser() {
            if(!confirm('Reload browser page?')) return;
            try {
                const res = await fetch('/reload');
                const data = await res.json();
                alert(data.message || 'Reloaded');
                setTimeout(refreshScreen, 1000);
            } catch(e) { alert('Error: ' + e); }
        }

        async function resetSession() {
            if(!confirm('⚠️ Are you sure? This will LOG OUT the bot and delete all session data. You will need to scan QR again.')) return;
            try {
                const res = await fetch('/reset-session');
                const data = await res.json();
                alert(data.message);
                setTimeout(refreshScreen, 5000);
            } catch(e) { alert('Error: ' + e); }
        }

        async function loginPhone() {
            const phone = document.getElementById('phone-input').value;
            if(!phone) return alert('Enter phone number');
            
            try {
                const res = await fetch('/login-phone', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ phone })
                });
                const data = await res.json();
                alert(data.success ? data.message : 'Error: ' + data.error + '\nDetails: ' + (data.details || ''));
            } catch(e) { alert('Net Error: ' + e); }
        }

        async function loginCode() {
            const code = document.getElementById('code-input').value;
            if(!code) return alert('Enter code');
            
            try {
                const res = await fetch('/login-code', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ code })
                });
                const data = await res.json();
                alert(data.success ? data.message : 'Error: ' + data.error + '\nDetails: ' + (data.details || ''));
                if(data.success) setTimeout(refreshScreen, 3000);
            } catch(e) { alert('Net Error: ' + e); }
        }

        async function loginPassword() {
            const password = document.getElementById('password-input').value;
            if(!password) return alert('Enter password');
            
            try {
                const res = await fetch('/login-password', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ password })
                });
                const data = await res.json();
                alert(data.success ? data.message : 'Error: ' + data.error + '\nDetails: ' + (data.details || ''));
                if(data.success) setTimeout(refreshScreen, 3000);
            } catch(e) { alert('Net Error: ' + e); }
        }

        async function importSession() {
            const sessionJson = document.getElementById('session-input').value;
            if(!sessionJson) return alert('Paste session JSON');
            
            try {
                const res = await fetch('/import-session', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sessionJson })
                });
                const data = await res.json();
                alert(data.success ? data.message : 'Error: ' + data.error + '\nDetails: ' + (data.details || ''));
                if(data.success) setTimeout(refreshScreen, 3000);
            } catch(e) { alert('Net Error: ' + e); }
        }

        function copyExtractionCode() {
            const code = \`(function(){const s={};for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);s[k]=localStorage.getItem(k);}const j=JSON.stringify(s);console.log(j);copy(j);alert('Copied to clipboard!');})();\`;
            navigator.clipboard.writeText(code).then(() => alert('Code copied! Run it in your browser Console.'));
        }

        async function sendMessage(e) {
            e.preventDefault();
            const btn = e.target.querySelector('button');
            const status = document.getElementById('send-status');
            const username = document.getElementById('username').value;
            const message = document.getElementById('message').value;

            btn.disabled = true;
            btn.style.opacity = '0.7';
            status.textContent = 'Sending...';
            status.style.color = 'var(--text-secondary)';

            try {
                const res = await fetch('/send', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, message })
                });
                const data = await res.json();
                
                if(data.success) {
                    status.textContent = '✅ Message sent';
                    status.style.color = 'var(--accent-green)';
                    document.getElementById('message').value = '';
                    loadMessages();
                } else {
                    status.textContent = '❌ ' + (data.details || data.error);
                    status.style.color = 'var(--accent-red)';
                }
            } catch(e) {
                status.textContent = '❌ Network Error';
                status.style.color = 'var(--accent-red)';
            } finally {
                btn.disabled = false;
                btn.style.opacity = '1';
            }
        }

        function getInitials(name) {
            return name ? name.substring(0, 2).toUpperCase() : '??';
        }

        function getRandomColor(name) {
            const colors = [
                'linear-gradient(135deg, #FF9966 0%, #FF5E62 100%)', // Orange
                'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', // Purple
                'linear-gradient(135deg, #66a6ff 0%, #89f7fe 100%)', // Blue
                'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)', // Green
                'linear-gradient(135deg, #fc4a1a 0%, #f7b733 100%)'  // Yellow/Red
            ];
            let hash = 0;
            for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
            return colors[Math.abs(hash) % colors.length];
        }

        async function loadMessages() {
            const log = document.getElementById('message-log');
            try {
                const res = await fetch('/messages');
                const data = await res.json();
                
                if(data.messages && data.messages.length > 0) {
                    log.innerHTML = data.messages.map(m => {
                        const isOut = m.sender === 'SIMULATOR';
                        const user = m.dialogue?.user?.username || m.dialogue?.user?.firstName || 'Unknown';
                        const time = new Date(m.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
                        const initials = getInitials(user);
                        const bg = getRandomColor(user);
                        
                        return \`
                            <div class="chat-item">
                                <div class="avatar" style="background: \${bg} !important">\${initials}</div>
                                <div class="chat-content">
                                    <div class="chat-header">
                                        <span class="chat-name">\${user}</span>
                                        <span class="chat-time">\${time}</span>
                                    </div>
                                    <div class="chat-preview">
                                        <span>\${isOut ? 'You: ' : ''}\${m.text}</span>
                                        \${isOut ? '' : '<span class="badge">NEW</span>'}
                                    </div>
                                </div>
                            </div>
                        \`;
                    }).join('');
                } else {
                    log.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-secondary);">No messages history yet</div>';
                }
            } catch(e) {
                console.error(e);
                log.innerText = 'Failed to load messages.';
            }
        }

        // Init
        loadMessages();
        fetch('/').then(r => r.json()).then(d => {
            if(d.browserStatus) document.getElementById('browser-status').textContent = d.browserStatus;
        }).catch(() => {});
        // End of script
    </script>
</body>
</html>
`;
