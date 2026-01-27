# Domain Pitfalls: Adding React Frontend to Existing Hono API

**Project:** GameMotion v0.2 Studio UI
**Researched:** 2026-01-27
**Domain:** React + Vite frontend integration with existing Hono Node.js API for local dev tools
**Confidence:** HIGH (verified with official docs, GitHub issues, and multiple authoritative sources)

---

## Critical Pitfalls

These will cause major problems if not addressed early.

| Pitfall | Impact | When It Hits | Prevention |
|---------|--------|--------------|------------|
| CORS misconfiguration between Vite and Hono | Critical | First API call from frontend | Configure both sides correctly, use Vite proxy |
| SSE connection limits blocking multiple tabs | Critical | Opening 6+ tabs | Use HTTP/2 or single connection architecture |
| Streaming response state corruption | High | AI chat with rapid messages | Use AbortController, proper cleanup |
| System player file access blocked by browser | High | First "preview video" attempt | Design around browser limitations early |
| Tailwind styles missing in production build | High | First production deploy | Correct content paths, avoid dynamic classes |

---

## Integration Pitfalls

### 1. CORS Configuration Conflicts Between Vite Dev Server and Hono

**What goes wrong:** API calls from React fail with CORS errors despite having CORS middleware configured in Hono.

**Why it happens:**
- Vite dev server runs on `localhost:5173`, Hono API on `localhost:3000` - different origins
- Vite has its own CORS handling that can conflict with Hono's
- Preflight OPTIONS requests not handled correctly
- Missing or incorrect `Access-Control-*` headers

**Warning signs:**
- Browser console shows `Access to fetch at ... has been blocked by CORS policy`
- OPTIONS requests return 404 or missing headers
- Works in one browser but not another
- Works with curl but not from browser

**Prevention:**

Two approaches - choose one:

**Option A: Vite Proxy (Recommended for dev)**
```typescript
// vite.config.ts
export default defineConfig({
  server: {
    cors: false, // Disable Vite's CORS - let Hono handle it
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000', // Use 127.0.0.1 not localhost (Node 17+ IPv6 issue)
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      '/render': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
      '/generate': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
      '/templates': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
    },
  },
});
```

**Option B: Direct CORS (Recommended for same-origin deploy)**
```typescript
// Hono app.ts - already configured correctly
app.use(
  '*',
  cors({
    origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Authorization', 'Content-Type'],
    credentials: true, // If using cookies
  })
);
```

**Detection:** Add this early in development:
```typescript
// Simple test route
app.get('/test-cors', (c) => c.json({ cors: 'working' }));
```

**Phase to address:** Phase 1 (Project Setup)

**Sources:**
- [Hono CORS Middleware](https://hono.dev/docs/middleware/builtin/cors)
- [Vite Proxy Configuration](https://vite.dev/config/server-options.html#server-proxy)
- [Vite CORS Discussion](https://github.com/vitejs/vite/discussions/15185)

---

### 2. Vite Proxy Does Not Work in Production Build

**What goes wrong:** API calls work in development but fail after `npm run build` because Vite proxy only exists during dev server.

**Why it happens:**
- Vite's `server.proxy` is development-only - it doesn't exist in production
- Production build is static files, no proxy server
- Teams forget to configure production deployment differently

**Warning signs:**
- Works in dev, fails in production
- 404 errors for API routes after deploy
- "Network request failed" in production only

**Prevention:**

```typescript
// Use environment-aware API base URL
// src/lib/api.ts
const API_BASE = import.meta.env.PROD
  ? '' // Same origin in production
  : ''; // Vite proxy handles in dev

export async function fetchApi(path: string, options?: RequestInit) {
  return fetch(`${API_BASE}${path}`, options);
}
```

For local dev deployment (both served from same port):
```typescript
// Production: serve React build from Hono
import { serveStatic } from '@hono/node-server/serve-static';

// In production, serve the built React app
if (process.env.NODE_ENV === 'production') {
  app.use('/*', serveStatic({ root: './dist/client' }));
}
```

**Phase to address:** Phase 1 (Project Setup) - design for this from start

**Sources:**
- [Vite Proxy Discussion](https://github.com/vitejs/vite/discussions/8043)
- [Vite Backend Integration](https://vite.dev/guide/backend-integration)

---

### 3. Node.js 17+ IPv6 DNS Resolution Breaks localhost Proxy

**What goes wrong:** Vite proxy fails to connect to backend with `ECONNREFUSED ::1:3000`.

**Why it happens:**
- Node.js 17+ changed DNS resolution to prefer IPv6
- `localhost` resolves to `::1` (IPv6) but backend might be listening on `127.0.0.1` (IPv4)
- Different behaviors between macOS and Linux

**Warning signs:**
- `Error: connect ECONNREFUSED ::1:3000`
- Works on some machines but not others
- Works in browser directly but not through proxy

**Prevention:**
```typescript
// Always use explicit IPv4 address in Vite proxy config
server: {
  proxy: {
    '/api': {
      target: 'http://127.0.0.1:3000', // NOT localhost
      changeOrigin: true,
    },
  },
}

// Or: Backend listens on both IPv4 and IPv6
serve({
  fetch: app.fetch,
  port: 3000,
  hostname: '::', // Listen on all interfaces
});
```

**Phase to address:** Phase 1 (Project Setup)

**Sources:**
- [Vite Proxy IPv6 Discussion](https://github.com/vitejs/vite/discussions/9285)

---

## Streaming Response Pitfalls

### 4. SSE Connection Limit Blocks Multiple Browser Tabs

**What goes wrong:** After opening 6 tabs, new SSE connections fail or existing ones drop.

**Why it happens:**
- HTTP/1.1 limits browsers to 6 concurrent connections per domain
- Each SSE connection is long-lived, consuming one connection slot
- Limit is per browser (not per tab), so affects all tabs
- Marked "Won't fix" by Chrome and Firefox teams

**Warning signs:**
- 7th tab's chat doesn't stream
- Existing tabs stop receiving updates when new tab opens
- Works fine with 1-5 tabs, breaks at 6+

**Prevention:**

**Option A: Use HTTP/2 (recommended)**
```typescript
// For production, ensure HTTPS with HTTP/2
// HTTP/2 supports 100+ concurrent streams by default

// Local dev: Use single connection architecture
```

**Option B: Shared connection via BroadcastChannel**
```typescript
// Only one tab maintains SSE connection, broadcasts to others
// src/lib/shared-sse.ts
const channel = new BroadcastChannel('ai-chat');

// Leader election - first tab becomes the SSE handler
if (!sessionStorage.getItem('sse-leader')) {
  sessionStorage.setItem('sse-leader', 'true');
  // This tab handles SSE
  const eventSource = new EventSource('/api/stream');
  eventSource.onmessage = (event) => {
    channel.postMessage(event.data);
  };
}

// All tabs listen to broadcast
channel.onmessage = (event) => {
  // Update UI with streamed data
};
```

**Option C: Accept limitation for local dev tool**
```typescript
// Document the limitation, don't try to fix it
// Local dev tool = single user = probably won't hit this
```

**Phase to address:** Phase 2 (Chat UI) - design decision needed

**Sources:**
- [MDN Server-Sent Events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events)
- [SSE Connection Limits](https://blog.logrocket.com/using-fetch-event-source-server-sent-events-react/)

---

### 5. Hono SSE Stream Auto-Closes Prematurely

**What goes wrong:** SSE stream closes after sending first message or after short delay.

**Why it happens:**
- Hono's `streamSSE` requires `stream.sleep()` to keep connection alive
- Without explicit keep-alive, stream closes automatically
- Different runtimes (Bun vs Node) behave differently

**Warning signs:**
- Stream sends one message then closes
- Connection closes after ~30 seconds
- Works locally but fails on different runtime

**Prevention:**
```typescript
// Hono SSE endpoint for AI streaming
import { streamSSE } from 'hono/streaming';

app.get('/api/chat/stream', async (c) => {
  return streamSSE(c, async (stream) => {
    // Send initial connection confirmation
    await stream.writeSSE({ data: JSON.stringify({ type: 'connected' }) });

    // Keep connection alive while waiting for AI response
    const keepAliveInterval = setInterval(async () => {
      await stream.writeSSE({ data: ':keepalive' });
    }, 15000);

    try {
      // Stream AI response chunks
      for await (const chunk of aiResponse) {
        await stream.writeSSE({
          data: JSON.stringify({ type: 'chunk', content: chunk }),
        });
      }

      // Send completion
      await stream.writeSSE({ data: JSON.stringify({ type: 'done' }) });
    } finally {
      clearInterval(keepAliveInterval);
    }
  });
});
```

**Phase to address:** Phase 2 (Chat UI)

**Sources:**
- [Hono Streaming Helper](https://hono.dev/docs/helpers/streaming)
- [Hono SSE Discussion](https://github.com/orgs/honojs/discussions/1355)
- [Hono SSE Implementation Guide](https://yanael.io/articles/hono-sse/)

---

### 6. React State Corruption from Streaming Updates

**What goes wrong:** Chat messages appear duplicated, out of order, or get lost during rapid streaming.

**Why it happens:**
- Multiple rapid setState calls batched incorrectly
- Race condition between streaming chunks and UI updates
- Component unmounts mid-stream, causing memory leak warnings
- Missing AbortController cleanup

**Warning signs:**
- Duplicate message fragments in UI
- Messages appear out of order
- Console warnings about unmounted component updates
- Memory usage grows with each chat session

**Prevention:**

```typescript
// src/hooks/useStreamingChat.ts
import { useState, useCallback, useRef, useEffect } from 'react';

export function useStreamingChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(async (content: string) => {
    // Abort any existing stream
    abortControllerRef.current?.abort();
    abortControllerRef.current = new AbortController();

    const userMessage: Message = { role: 'user', content };
    const assistantMessage: Message = { role: 'assistant', content: '' };

    // Add both messages atomically
    setMessages(prev => [...prev, userMessage, assistantMessage]);
    setIsStreaming(true);

    try {
      const response = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: content }),
        signal: abortControllerRef.current.signal,
      });

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);

        // Update ONLY the last message, using functional update
        setMessages(prev => {
          const newMessages = [...prev];
          const lastIndex = newMessages.length - 1;
          newMessages[lastIndex] = {
            ...newMessages[lastIndex],
            content: newMessages[lastIndex].content + chunk,
          };
          return newMessages;
        });
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        // Expected - user cancelled or navigated away
        return;
      }
      throw error;
    } finally {
      setIsStreaming(false);
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  return { messages, isStreaming, sendMessage };
}
```

**Phase to address:** Phase 2 (Chat UI)

**Sources:**
- [React useEffect Cleanup](https://blog.logrocket.com/understanding-react-useeffect-cleanup-function/)
- [Avoiding Memory Leaks with AbortController](https://www.wisdomgeek.com/development/web-development/react/avoiding-race-conditions-memory-leaks-react-useeffect/)
- [Vercel AI SDK useChat Hook](https://ai-sdk.dev/docs/ai-sdk-rsc/streaming-react-components)

---

### 7. EventSource API Limitations for POST Requests

**What goes wrong:** Can't send message history with SSE because EventSource only supports GET requests.

**Why it happens:**
- Browser's EventSource API is GET-only by design
- Can't send request body or custom headers (except cookies)
- Need to send conversation context for AI continuity

**Warning signs:**
- Can't pass conversation history to AI
- Have to encode everything in URL query params
- Workarounds feel hacky

**Prevention:**

Use fetch API with ReadableStream instead of EventSource:
```typescript
// More flexible than EventSource, supports POST
async function streamChat(messages: Message[]): AsyncGenerator<string> {
  const response = await fetch('/api/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
  });

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    yield decoder.decode(value);
  }
}

// Or use @microsoft/fetch-event-source library
import { fetchEventSource } from '@microsoft/fetch-event-source';

await fetchEventSource('/api/chat/stream', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ messages }),
  onmessage(event) {
    // Handle each SSE message
  },
});
```

**Phase to address:** Phase 2 (Chat UI)

**Sources:**
- [Fetch Event Source for SSE in React](https://blog.logrocket.com/using-fetch-event-source-server-sent-events-react/)
- [Streaming LLM Responses with SSE](https://upstash.com/blog/sse-streaming-llm-responses)

---

## System Integration Pitfalls

### 8. Browser Cannot Open System Video Player

**What goes wrong:** "Preview in player" button doesn't work - browser can't launch VLC/QuickTime.

**Why it happens:**
- Browsers run in sandbox, cannot execute system applications
- File System Access API allows file read/write but not app launch
- Security restriction, not a bug

**Warning signs:**
- Clicking "open in player" does nothing
- No browser API exists to launch external applications
- Works in Electron but not in browser

**Prevention:**

**Option A: Download + Manual Open (Simplest)**
```typescript
// Just download the file, user opens manually
function downloadVideo(videoPath: string, filename: string) {
  const link = document.createElement('a');
  link.href = videoPath;
  link.download = filename;
  link.click();
}
```

**Option B: Custom Protocol Handler**
```typescript
// Register custom protocol during installation
// gamemotion://open?path=/path/to/video.mp4

// 1. Create protocol handler script (requires user setup)
// 2. Frontend uses custom URL
function openInPlayer(videoPath: string) {
  window.location.href = `gamemotion://open?path=${encodeURIComponent(videoPath)}`;
}

// Caveat: Requires user to install/register protocol handler
```

**Option C: Backend Triggers Player (Recommended for local dev)**
```typescript
// API endpoint that opens file in system player
// ONLY for local dev tools, never expose in production

// Backend route
app.post('/dev/open-in-player', async (c) => {
  const { path } = await c.req.json();

  // Security: Only allow paths in outputs directory
  if (!path.startsWith(OUTPUTS_DIR)) {
    return c.json({ error: 'Invalid path' }, 400);
  }

  const { exec } = await import('child_process');
  const command = process.platform === 'darwin'
    ? `open "${path}"`
    : process.platform === 'win32'
    ? `start "" "${path}"`
    : `xdg-open "${path}"`;

  exec(command);
  return c.json({ success: true });
});

// Frontend
async function openInPlayer(videoPath: string) {
  await fetch('/dev/open-in-player', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: videoPath }),
  });
}
```

**Security note:** Option C is acceptable ONLY because this is a local dev tool. Never expose file system access in production APIs.

**Phase to address:** Phase 3 (Video Library) - must decide approach early

**Sources:**
- [File System Access API](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access)
- [Browser-fs-access Library](https://github.com/GoogleChromeLabs/browser-fs-access)

---

### 9. File Path Handling Differences Between OS

**What goes wrong:** Video paths work on macOS but break on Windows, or vice versa.

**Why it happens:**
- Path separators differ: `/` vs `\`
- Absolute path formats differ: `/Users/...` vs `C:\Users\...`
- File URLs differ: `file:///path` vs `file:///C:/path`

**Warning signs:**
- Works on dev machine, fails on tester's machine
- "File not found" with correct-looking path
- Paths rendered incorrectly in UI

**Prevention:**
```typescript
// Always use path module for path operations
import path from 'path';

// Backend: Normalize paths before sending to frontend
const normalizedPath = path.normalize(outputPath);
const relativePath = path.relative(OUTPUTS_DIR, outputPath);

// Frontend: Use relative paths, let API construct full path
// Store: { id: 'abc', filename: 'output.mp4' }
// Display: `/api/videos/abc/stream`

// For file URLs (if needed)
function pathToFileUrl(filePath: string): string {
  return new URL(`file://${path.resolve(filePath)}`).href;
}
```

**Phase to address:** Phase 1 (Project Setup) - establish conventions early

---

## Build and Configuration Pitfalls

### 10. Tailwind Styles Missing in Production Build

**What goes wrong:** Styles work in dev but disappear after build.

**Why it happens:**
- Tailwind's JIT compiler only generates classes it finds in scanned files
- Content paths in config don't match actual file locations
- Dynamic class names not detected by scanner
- monorepo paths not configured correctly

**Warning signs:**
- Styles work in dev, missing in production
- Some components styled, others unstyled
- Dynamic classes (e.g., `bg-${color}-500`) never work

**Prevention:**

```javascript
// tailwind.config.js - ensure ALL paths are covered
module.exports = {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
    // If using component libraries
    './node_modules/@yourorg/ui/**/*.{js,ts,jsx,tsx}',
  ],
  // ...
};
```

**For dynamic classes:**
```typescript
// BAD: Tailwind can't detect this
const bgColor = `bg-${status}-500`;

// GOOD: Use complete class names
const bgColors = {
  success: 'bg-green-500',
  error: 'bg-red-500',
  pending: 'bg-yellow-500',
};
const bgColor = bgColors[status];

// Or safelist if you must use dynamic
// tailwind.config.js
module.exports = {
  safelist: [
    'bg-green-500',
    'bg-red-500',
    'bg-yellow-500',
  ],
};
```

**Phase to address:** Phase 1 (Project Setup)

**Sources:**
- [Tailwind Purge Issues Discussion](https://github.com/tailwindlabs/tailwindcss/discussions/7568)
- [Debugging Tailwind in Vite](https://medium.com/@Faizahameds/debugging-tailwind-css-not-working-in-vite-2025-c799279ae9a0)

---

### 11. Tailwind v4 First-Load Style Flash

**What goes wrong:** On initial page load in dev, styles are missing for ~1 second, then appear on refresh.

**Why it happens:**
- Tailwind v4 changed compilation approach
- Initial load may not have all styles ready
- Known issue in development mode specifically

**Warning signs:**
- Flash of unstyled content on first load
- Refreshing fixes it
- Production build works fine

**Prevention:**
```bash
# Option A: Use Tailwind v3 for stability
npm install -D tailwindcss@3.4.1 postcss autoprefixer

# Option B: Accept dev mode quirk, verify production works
# This is a known v4 issue that doesn't affect production
```

**Phase to address:** Phase 1 (Project Setup) - choose Tailwind version

**Sources:**
- [Tailwind v4 First Load Issue](https://github.com/tailwindlabs/tailwindcss/discussions/16399)

---

### 12. Monorepo Package Resolution Failures

**What goes wrong:** Frontend can't import from backend shared types, or builds fail with "module not found".

**Why it happens:**
- Workspace package not linked correctly
- TypeScript paths not aligned with build output
- Vite not configured to handle workspace packages
- Dev vs build have different resolution behaviors

**Warning signs:**
- Works with `npm link` but not in workspace
- TypeScript finds types but runtime fails
- Different behavior between `npm run dev` and `npm run build`

**Prevention:**

**For shared types (no runtime code):**
```json
// packages/shared/package.json
{
  "name": "@gamemotion/shared",
  "exports": {
    ".": {
      "types": "./src/index.ts"
    }
  }
}

// apps/web/tsconfig.json
{
  "compilerOptions": {
    "paths": {
      "@gamemotion/shared": ["../../packages/shared/src"]
    }
  }
}
```

**For shared runtime code:**
```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@gamemotion/shared': path.resolve(__dirname, '../../packages/shared/src'),
    },
  },
  optimizeDeps: {
    include: ['@gamemotion/shared'],
  },
});
```

**Simpler approach for this project:**
```typescript
// Since it's local dev tool, just copy types
// Don't over-engineer with monorepo complexity
// apps/web/src/types/api.ts - manually sync from backend
```

**Phase to address:** Phase 1 (Project Setup) - decide on project structure

**Sources:**
- [Turborepo with Vite](https://blog.abrocadabro.com/set-up-a-turborepo-monorepo-with-vite-typescript-tailwind-express-and-react-vue)
- [React Monorepo with pnpm and Vite](https://dev.to/lico/react-monorepo-setup-tutorial-with-pnpm-and-vite-react-project-ui-utils-5705)

---

## State Management Pitfalls

### 13. Over-Engineering State Management for Simple Local Tool

**What goes wrong:** Team implements Redux/Zustand/complex state for a single-user local dev tool.

**Why it happens:**
- Cargo-culting from production app patterns
- Anticipating complexity that won't exist
- Not recognizing "local dev tool" simplicity

**Warning signs:**
- Adding state management libraries before having state problems
- Global state for things that could be component-local
- Complex patterns for simple data flows

**Prevention:**

For local dev tool with single user:
```typescript
// Start with useState + context
// Only add libraries when you feel pain

// Simple context for shared state
const AppContext = createContext<{
  templates: Template[];
  videos: Video[];
  activeChat: Message[];
} | null>(null);

// Component-local state for UI
function ChatPanel() {
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  // ...
}
```

**When to add state library:**
- Multiple components need to modify same state
- State updates are complex with many edge cases
- You're passing props through 4+ component levels

**Phase to address:** Phase 2+ - resist urge to add early

**Sources:**
- [React State Management 2025/2026](https://www.nucamp.co/blog/state-management-in-2026-redux-context-api-and-modern-patterns)

---

### 14. Missing Loading and Error States for API Calls

**What goes wrong:** UI hangs or shows stale data during API calls, errors swallowed silently.

**Why it happens:**
- Happy-path thinking during development
- Not considering network failures in local dev
- Forgetting that even localhost can fail

**Warning signs:**
- Click button, nothing happens (loading state missing)
- Old data shows while new data loads
- Errors disappear with no user feedback
- Console.log errors but UI shows success

**Prevention:**
```typescript
// Custom hook with proper states
function useApiQuery<T>(url: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const execute = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      setData(await response.json());
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setIsLoading(false);
    }
  }, [url]);

  return { data, error, isLoading, execute };
}

// Component usage
function TemplateList() {
  const { data, error, isLoading, execute } = useApiQuery<Template[]>('/api/templates');

  useEffect(() => { execute(); }, [execute]);

  if (isLoading) return <LoadingSpinner />;
  if (error) return <ErrorMessage error={error} onRetry={execute} />;
  if (!data?.length) return <EmptyState />;

  return <TemplateGrid templates={data} />;
}
```

**Or use TanStack Query:**
```typescript
import { useQuery } from '@tanstack/react-query';

function TemplateList() {
  const { data, error, isLoading } = useQuery({
    queryKey: ['templates'],
    queryFn: () => fetch('/api/templates').then(r => r.json()),
  });
  // Automatic loading, error, caching, refetching
}
```

**Phase to address:** Phase 1 (Project Setup) - establish patterns early

---

## Security Pitfalls (Even for Local Dev)

### 15. CSRF Vulnerability on localhost

**What goes wrong:** Malicious website can make requests to your local dev server using your session.

**Why it happens:**
- "It's just localhost" thinking
- Session cookies automatically sent to localhost from any origin
- Browser doesn't distinguish localhost from other sites

**Warning signs:**
- Using session cookies for auth on localhost
- No CSRF protection because "it's local"

**Prevention:**

**For local dev tool without auth (your case):**
```typescript
// No sessions = no CSRF risk
// But still protect dangerous endpoints

// Add simple check that request came from expected origin
app.use('/dev/*', async (c, next) => {
  const origin = c.req.header('origin');
  const host = c.req.header('host');

  // Only allow from same host or no origin (direct API call)
  if (origin && !origin.includes(host?.split(':')[0] ?? 'localhost')) {
    return c.json({ error: 'Invalid origin' }, 403);
  }

  return next();
});
```

**If adding auth later:**
```typescript
// Use token in Authorization header, not cookies
// Authorization header is NOT sent automatically cross-origin
fetch('/api/templates', {
  headers: {
    'Authorization': `Bearer ${token}`,
  },
});
```

**Phase to address:** Phase 1 (Project Setup) - establish secure patterns

**Sources:**
- [CSRF on Localhost](https://medium.com/@instatunnel/your-dev-server-is-not-safe-the-hidden-danger-of-csrf-on-localhost-36fed5cf0e38)
- [React CSRF Protection](https://www.stackhawk.com/blog/react-csrf-protection-guide-examples-and-how-to-enable-it/)

---

### 16. Exposing File System Paths to Frontend

**What goes wrong:** API returns full absolute file paths, creating security risk if app ever becomes public.

**Why it happens:**
- Convenience during development
- Not thinking about future exposure
- Direct mapping between filesystem and API

**Warning signs:**
- API responses contain `/Users/yourname/...` paths
- Frontend constructs file paths directly
- Backend blindly trusts path input from frontend

**Prevention:**
```typescript
// Backend: Use IDs, not paths
// Store mapping: id -> path server-side

const videoStore = new Map<string, string>(); // id -> absolutePath

app.post('/render', async (c) => {
  const videoId = generateId();
  const outputPath = path.join(OUTPUTS_DIR, `${videoId}.mp4`);

  await render(spec, outputPath);

  videoStore.set(videoId, outputPath);

  return c.json({
    id: videoId,
    // NOT outputPath!
  });
});

app.get('/videos/:id/stream', (c) => {
  const absolutePath = videoStore.get(c.req.param('id'));
  if (!absolutePath) return c.notFound();

  // Serve file without exposing path
  return streamFile(absolutePath);
});
```

**Phase to address:** Phase 1 (Project Setup) - design API contracts

---

## Development Workflow Pitfalls

### 17. Forgetting to Start Both Servers

**What goes wrong:** Frontend starts but API calls fail because backend isn't running.

**Why it happens:**
- Two separate processes to manage
- Easy to forget one
- Different terminal windows

**Warning signs:**
- "Fetch failed" errors on startup
- Works sometimes (when you remember both)
- New team members always hit this

**Prevention:**
```json
// package.json - single command for both
{
  "scripts": {
    "dev": "concurrently \"npm run dev:api\" \"npm run dev:web\"",
    "dev:api": "tsx watch src/api/server.ts",
    "dev:web": "vite",
    "dev:web:wait": "wait-on http://127.0.0.1:3000/health && vite"
  }
}
```

Or use Turborepo:
```json
// turbo.json
{
  "pipeline": {
    "dev": {
      "cache": false,
      "persistent": true
    }
  }
}
```

**Phase to address:** Phase 1 (Project Setup)

---

### 18. Hot Reload Conflicts Between Vite and Backend

**What goes wrong:** Changes to shared code trigger both servers to reload, causing race conditions.

**Why it happens:**
- Both Vite and tsx watch the same files
- Shared types/utilities watched by both
- Reload timing not coordinated

**Warning signs:**
- Random "connection refused" during development
- Have to manually restart after certain changes
- Works after second save

**Prevention:**
```typescript
// vite.config.ts - exclude backend from watching
export default defineConfig({
  server: {
    watch: {
      ignored: ['**/src/api/**', '**/dist/**'],
    },
  },
});

// Keep frontend and backend code clearly separated
// src/
//   api/     <- backend only, tsx watches
//   web/     <- frontend only, vite watches
//   shared/  <- types only, no runtime code
```

**Phase to address:** Phase 1 (Project Setup)

---

## Moderate Pitfalls

### 19. Vite Config Not Reloading

**What goes wrong:** Changes to `vite.config.ts` don't take effect.

**Why it happens:**
- Vite hot-reloads most changes but not config file
- Proxy changes especially require restart

**Prevention:**
- Always restart Vite dev server after config changes
- Add comment at top of config reminding to restart

---

### 20. TypeScript Strict Mode Differences

**What goes wrong:** Code compiles in frontend but fails in backend, or vice versa.

**Why it happens:**
- Different tsconfig.json settings
- Frontend more permissive than backend
- Type imports vs value imports

**Prevention:**
```json
// Use same base config
// tsconfig.base.json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    // ... shared settings
  }
}

// apps/web/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx"
  }
}
```

---

### 21. API Response Type Drift

**What goes wrong:** Frontend types don't match actual API responses.

**Why it happens:**
- Backend schema changes, frontend types not updated
- Manual type definitions get stale
- No runtime validation on frontend

**Prevention:**

**Option A: Generate types from Zod schemas**
```typescript
// Share Zod schemas, generate types
// packages/shared/src/schemas.ts
import { z } from 'zod';

export const TemplateSchema = z.object({
  id: z.string(),
  name: z.string(),
  // ...
});

export type Template = z.infer<typeof TemplateSchema>;

// Both frontend and backend import from here
```

**Option B: API response validation on frontend**
```typescript
// Validate responses in development
const response = await fetch('/api/templates');
const data = await response.json();

if (import.meta.env.DEV) {
  const result = TemplatesArraySchema.safeParse(data);
  if (!result.success) {
    console.error('API response type mismatch:', result.error);
  }
}
```

**Phase to address:** Phase 1 (Project Setup)

---

## Minor Pitfalls

### 22. Console Spam from Development Logging

**What goes wrong:** Console cluttered with logs, hard to find real errors.

**Prevention:**
```typescript
// Create debug utility with namespaces
const debug = {
  api: (msg: string, ...args: unknown[]) =>
    import.meta.env.DEV && console.log(`[API] ${msg}`, ...args),
  stream: (msg: string, ...args: unknown[]) =>
    import.meta.env.DEV && console.log(`[Stream] ${msg}`, ...args),
  // ...
};

// Can be filtered in browser console
```

---

### 23. Browser DevTools Network Tab Overwhelmed by SSE

**What goes wrong:** Network tab shows hundreds of SSE messages, hard to debug other requests.

**Prevention:**
- Use browser filter: `-method:GET` or filter by type
- Use dedicated SSE debugging tools
- Add "Clear on navigate" in DevTools

---

## Phase-Specific Warnings

| Phase | Likely Pitfalls | Mitigation |
|-------|-----------------|------------|
| Phase 1: Project Setup | CORS config, proxy setup, Tailwind config, dual server management | Validate API connectivity before building UI |
| Phase 2: Chat UI | SSE streaming bugs, state corruption, abort handling, EventSource limitations | Build simple non-streaming version first, add streaming after |
| Phase 3: Video Library | File path handling, system player access, OS differences | Design file ID system, accept download-only approach |
| Phase 4: Template Library | Type drift, API response validation | Share Zod schemas, validate in dev mode |
| Phase 5: Polish | Build issues, production differences | Test production build early and often |

---

## Testing Strategies

How to test for these pitfalls:

| Pitfall | Test |
|---------|------|
| CORS | Open browser console, verify no CORS errors on API call |
| SSE limits | Open 7 tabs, verify all receive streamed content |
| Streaming state | Send 10 rapid messages, verify no duplicates/losses |
| System player | Click preview, verify file opens (or downloads) |
| Tailwind build | Run `npm run build`, verify styles match dev |
| Proxy production | Run production build, verify API calls work |
| Memory leaks | Send 50 chat messages, monitor memory in DevTools |

---

## Quick Reference Checklist

Before starting each phase:

- [ ] Can frontend call backend API without CORS errors?
- [ ] Does Vite proxy work for all routes?
- [ ] Do both dev servers start with single command?
- [ ] Is Tailwind generating styles correctly?
- [ ] Are API response types shared/validated?
- [ ] Is streaming working with proper cleanup?
- [ ] Are loading/error states handled everywhere?

---

## Sources

### Hono and CORS
- [Hono CORS Middleware](https://hono.dev/docs/middleware/builtin/cors)
- [Hono Streaming Helper](https://hono.dev/docs/helpers/streaming)
- [Hono SSE Discussion](https://github.com/orgs/honojs/discussions/1355)

### Vite Configuration
- [Vite Proxy Configuration](https://vite.dev/config/server-options.html#server-proxy)
- [Vite Backend Integration](https://vite.dev/guide/backend-integration)
- [Vite IPv6 Discussion](https://github.com/vitejs/vite/discussions/9285)

### React Streaming and State
- [React useEffect Cleanup](https://blog.logrocket.com/understanding-react-useeffect-cleanup-function/)
- [Fetch Event Source for SSE](https://blog.logrocket.com/using-fetch-event-source-server-sent-events-react/)
- [Vercel AI SDK](https://ai-sdk.dev/docs/ai-sdk-rsc/streaming-react-components)
- [MDN Server-Sent Events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events)

### Tailwind CSS
- [Tailwind Purge Issues](https://github.com/tailwindlabs/tailwindcss/discussions/7568)
- [Debugging Tailwind in Vite](https://medium.com/@Faizahameds/debugging-tailwind-css-not-working-in-vite-2025-c799279ae9a0)

### Security
- [CSRF on Localhost](https://medium.com/@instatunnel/your-dev-server-is-not-safe-the-hidden-danger-of-csrf-on-localhost-36fed5cf0e38)
- [React CSRF Protection](https://www.stackhawk.com/blog/react-csrf-protection-guide-examples-and-how-to-enable-it/)

### File System Access
- [File System Access API](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access)
- [Browser-fs-access Library](https://github.com/GoogleChromeLabs/browser-fs-access)
