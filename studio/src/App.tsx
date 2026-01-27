import { useState } from 'react';
import { MessageSquare, Library, Plus, Video } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ChatContainer } from '@/components/chat/ChatContainer';
import { TemplateLibrary } from '@/components/templates/TemplateLibrary';
import { VideoLibrary } from '@/components/videos/VideoLibrary';
import { useChatStore } from '@/stores/chatStore';

type View = 'chat' | 'library' | 'videos';

function App() {
  const [view, setView] = useState<View>('chat');
  const clearConversation = useChatStore((state) => state.clearConversation);

  return (
    <div className="h-screen flex flex-col bg-slate-950">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900">
        <h1 className="text-xl font-semibold bg-gradient-to-r from-blue-400 to-violet-400 bg-clip-text text-transparent">
          GameMotion Studio
        </h1>
        <div className="flex items-center gap-2">
          {view === 'chat' && (
            <Button
              variant="outline"
              size="sm"
              onClick={clearConversation}
              className="gap-2"
            >
              <Plus className="size-4" />
              New Chat
            </Button>
          )}
          <Button
            variant={view === 'chat' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setView('chat')}
            className="gap-2"
          >
            <MessageSquare className="size-4" />
            Chat
          </Button>
          <Button
            variant={view === 'library' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setView('library')}
            className="gap-2"
          >
            <Library className="size-4" />
            Library
          </Button>
          <Button
            variant={view === 'videos' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setView('videos')}
            className="gap-2"
          >
            <Video className="size-4" />
            Videos
          </Button>
        </div>
      </header>

      {/* Content */}
      {view === 'chat' && <ChatContainer />}
      {view === 'library' && <TemplateLibrary />}
      {view === 'videos' && <VideoLibrary />}
    </div>
  );
}

export default App;
