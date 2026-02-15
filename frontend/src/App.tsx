import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import ChatWindow from './components/ChatWindow';

function App() {
  return (
    <Router>
      <div className="flex h-screen bg-background text-foreground overflow-hidden">
        <div className="w-80 border-r border-border flex flex-col">
          <Sidebar />
        </div>
        <div className="flex-1 flex flex-col bg-muted/20">
          <Routes>
            <Route path="/chat/:id" element={<ChatWindow />} />
            <Route path="/" element={
              <div className="flex-1 flex items-center justify-center text-muted-foreground">
                Select a chat to start messaging
              </div>
            } />
          </Routes>
        </div>
      </div>
    </Router>
  );
}

export default App;
