import { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import ChatWindow from './components/ChatWindow';
import LoginScreen from './components/LoginScreen';
import { useChat } from './hooks/useChat';

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);

  // Create chatState only if authenticated or always? 
  // Hooks inside conditionals are bad. Call it always, but maybe it won't fetch if auth fails?
  // Easier: render LoginScreen if !auth.

  const chatState = useChat();

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const res = await fetch('/status');
        const data = await res.json();
        if (data.connected) {
          setIsAuthenticated(true);
        }
      } catch (e) {
        console.error(e);
      } finally {
        setCheckingAuth(false);
      }
    };
    checkAuth();
  }, []);

  if (checkingAuth) {
    return <div className="flex h-screen items-center justify-center">Loading...</div>;
  }

  if (!isAuthenticated) {
    return <LoginScreen onLogin={() => setIsAuthenticated(true)} />;
  }

  return (
    <Router>
      <div className="flex h-screen bg-background text-foreground overflow-hidden font-sans">
        <div className="w-80 border-r border-border flex flex-col shrink-0">
          <Sidebar chatState={chatState} />
        </div>
        <div className="flex-1 flex flex-col bg-muted/20 relative">
          <Routes>
            <Route path="/" element={<ChatWindow dialogue={chatState.currentDialogue} actions={chatState} />} />
          </Routes>
        </div>
      </div>
    </Router>
  );
}

export default App;
