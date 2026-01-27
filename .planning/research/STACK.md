# Technology Stack: v0.2 Studio UI

**Project:** GameMotion
**Researched:** 2026-01-27
**Scope:** React + Tailwind frontend additions for local dev studio

## Recommended Stack Additions

### Core Frontend

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Vite | ^7.3.1 | Build tool & dev server | Fastest HMR, native ESM, official Tailwind v4 plugin support |
| React | ^19.2.4 | UI framework | Latest stable, project scope uses React |
| TypeScript | ^5.9.3 | Type safety | Already in use, share types with backend |
| Tailwind CSS | ^4.1.18 | Styling | Project scope specifies Tailwind, v4 has simpler setup |
| @tailwindcss/vite | ^4.1.18 | Vite integration | New v4 plugin, no PostCSS config needed |

### UI Components

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| shadcn/ui | latest (CLI) | Component primitives | Unstyled, accessible, Tailwind-native, copy-paste model |
| lucide-react | ^0.563.0 | Icons | shadcn default, tree-shakeable, consistent style |
| class-variance-authority | ^0.7.1 | Component variants | shadcn dependency, variant management |
| clsx | ^2.1.1 | Class merging | shadcn dependency, conditional classes |
| tailwind-merge | ^3.0.1 | Tailwind class merging | Handles conflicting Tailwind classes |

### State Management

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| @tanstack/react-query | ^5.90.20 | Server state | Auto caching, background refetch, optimistic updates |
| zustand | ^5.0.10 | Client state | Minimal boilerplate, perfect for chat UI state |

### Routing (Optional - Defer)

| Technology | Version | Purpose | When to Add |
|------------|---------|---------|-------------|
| react-router-dom | ^7.13.0 | Client routing | Only if multiple pages needed |

---

## Build Architecture

### Recommendation: Vite SPA served by Hono

**Why Vite over alternatives:**

| Option | Verdict | Reason |
|--------|---------|--------|
| **Vite** | **USE** | Fastest dev experience, native Tailwind v4 support, simple SPA build |
| Next.js | SKIP | SSR/RSC overkill for local dev tool, adds complexity |
| Create React App | SKIP | Deprecated, slow, no Tailwind v4 plugin |
| Remix | SKIP | Full-stack framework overhead unnecessary |

**Why serve from Hono (not separate server):**

For a local dev studio, running two servers (Vite dev + Hono API) adds friction. Instead:

**Development mode:**
- Vite dev server on port 5173 (HMR, fast refresh)
- Hono API on port 3000
- Vite proxies API calls to Hono

**Production mode:**
- Vite builds to `/dist/ui`
- Hono serves static files from `/dist/ui`
- Single port (3000) for everything

```typescript
// vite.config.ts - dev proxy
export default defineConfig({
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
```

```typescript
// src/api/app.ts - production static serving
import { serveStatic } from '@hono/node-server/serve-static';

// Serve React SPA
app.use('/*', serveStatic({ root: './dist/ui' }));
// SPA fallback for client-side routing
app.get('*', serveStatic({ path: './dist/ui/index.html' }));
```

---

## State Management Strategy

### Server State: TanStack Query

Use for all API interactions with the Hono backend.

```typescript
// hooks/useTemplates.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export function useTemplates() {
  return useQuery({
    queryKey: ['templates'],
    queryFn: () => fetch('/api/templates').then(r => r.json()),
  });
}

export function useCreateTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data) => fetch('/api/templates', {
      method: 'POST',
      body: JSON.stringify(data),
    }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] });
    },
  });
}
```

**Why TanStack Query:**
- Automatic caching (avoid re-fetching template list)
- Background refetching when window focuses
- Optimistic updates for instant UI feedback
- Loading/error states built-in
- ~40% of React projects use it (de-facto standard)

### Client State: Zustand

Use for UI state that doesn't come from the server.

```typescript
// stores/chatStore.ts
import { create } from 'zustand';

interface ChatStore {
  messages: Message[];
  isStreaming: boolean;
  addMessage: (message: Message) => void;
  setStreaming: (streaming: boolean) => void;
  clearMessages: () => void;
}

export const useChatStore = create<ChatStore>((set) => ({
  messages: [],
  isStreaming: false,
  addMessage: (message) => set((state) => ({
    messages: [...state.messages, message],
  })),
  setStreaming: (streaming) => set({ isStreaming: streaming }),
  clearMessages: () => set({ messages: [] }),
}));
```

**Why Zustand over alternatives:**

| Option | Verdict | Reason |
|--------|---------|--------|
| **Zustand** | **USE** | 3KB, zero boilerplate, perfect for chat state |
| Jotai | SKIP | Atom model better for complex interdependent state |
| Redux | SKIP | Overkill, too much boilerplate for this scope |
| Context | SKIP | Re-render issues without memoization |

**State ownership:**

| State Type | Owner | Examples |
|------------|-------|----------|
| Templates | TanStack Query | Template list, template details |
| Videos | TanStack Query | Video list, render status |
| Chat messages | Zustand | Message history, streaming state |
| UI preferences | Zustand | Sidebar open, selected template |

---

## Chat UI Components

### Recommendation: Build with shadcn, not a chat library

**Why not use a chat UI library:**

| Library | Verdict | Reason |
|---------|---------|--------|
| chatscope/chat-ui-kit | SKIP | Opinionated styling conflicts with Tailwind |
| @llamaindex/chat-ui | SKIP | LLM-specific, couples to their patterns |
| CometChat | SKIP | Real-time chat service, not needed |

**Why build with shadcn:**

1. **Tailwind-native**: Styled with utility classes, matches project approach
2. **Simple requirements**: Chat UI is just messages + input, not complex
3. **Full control**: Customize streaming, markdown rendering, etc.
4. **Accessible**: shadcn primitives are WAI-ARIA compliant

**Required shadcn components:**

```bash
npx shadcn@latest add button input textarea card scroll-area avatar
```

**Chat message structure:**

```typescript
// components/ChatMessage.tsx
import { Card } from '@/components/ui/card';
import { Avatar } from '@/components/ui/avatar';

interface ChatMessageProps {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: Date;
}

export function ChatMessage({ role, content, timestamp }: ChatMessageProps) {
  return (
    <div className={cn(
      'flex gap-3 p-4',
      role === 'user' ? 'flex-row-reverse' : 'flex-row'
    )}>
      <Avatar>
        {role === 'user' ? 'U' : 'AI'}
      </Avatar>
      <Card className={cn(
        'max-w-[80%] p-3',
        role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted'
      )}>
        {content}
      </Card>
    </div>
  );
}
```

---

## Project Structure

### Recommendation: Frontend in `/ui` subdirectory

```
davidup/
  src/                    # Existing backend
    api/
    render/
    ...
  ui/                     # NEW: Frontend
    src/
      components/
        ui/               # shadcn components
        chat/             # Chat-specific components
        templates/        # Template library components
        videos/           # Video library components
      hooks/              # Custom hooks
      stores/             # Zustand stores
      lib/                # Utilities
      App.tsx
      main.tsx
      index.css
    index.html
    vite.config.ts
    tsconfig.json
    package.json          # Separate from root
  package.json            # Root (backend)
```

**Why separate `/ui` directory:**

1. **Separate package.json**: Frontend deps don't bloat backend
2. **Separate tsconfig**: React JSX settings don't affect backend
3. **Clear boundaries**: Backend and frontend are distinct
4. **Simpler builds**: `npm run build:ui` vs `npm run build:api`

**Why NOT a monorepo tool (pnpm workspaces, turborepo):**

- Single developer, single machine
- Adds complexity without benefits at this scale
- Simple `cd ui && npm run dev` is sufficient

---

## Integration with Existing Hono API

### New API Routes for Studio

The existing API has auth middleware. For local dev studio, add an unauthenticated dev mode:

```typescript
// src/api/app.ts
const isDev = process.env.NODE_ENV !== 'production';

// Studio routes - no auth in dev mode
if (isDev) {
  app.route('/api/studio', studioRoutes);
}
```

**Studio-specific endpoints:**

| Endpoint | Purpose |
|----------|---------|
| `POST /api/studio/chat` | Stream AI responses for chat |
| `GET /api/studio/templates` | List templates with versions |
| `POST /api/studio/templates` | Save new template |
| `GET /api/studio/videos` | List rendered videos |
| `POST /api/studio/preview` | Render and open in system player |

### Streaming Chat Responses

Use Server-Sent Events (SSE) for streaming AI responses:

```typescript
// src/api/routes/studio.ts
import { streamSSE } from 'hono/streaming';

studioRoutes.post('/chat', async (c) => {
  const { messages } = await c.req.json();

  return streamSSE(c, async (stream) => {
    // Stream from AI provider
    for await (const chunk of aiClient.streamChat(messages)) {
      await stream.writeSSE({
        data: JSON.stringify({ content: chunk }),
      });
    }
  });
});
```

```typescript
// ui/src/hooks/useChat.ts
export function useChat() {
  const { addMessage, setStreaming } = useChatStore();

  const sendMessage = async (content: string) => {
    addMessage({ role: 'user', content });
    setStreaming(true);

    const response = await fetch('/api/studio/chat', {
      method: 'POST',
      body: JSON.stringify({ messages }),
    });

    const reader = response.body?.getReader();
    let assistantContent = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const text = new TextDecoder().decode(value);
      assistantContent += parseSSE(text);
      // Update UI incrementally
    }

    addMessage({ role: 'assistant', content: assistantContent });
    setStreaming(false);
  };

  return { sendMessage };
}
```

---

## What NOT to Add

| Technology | Why Skip |
|------------|----------|
| **Next.js** | SSR/RSC unnecessary for local dev tool |
| **Redux** | Overkill; Zustand is simpler for this scope |
| **Socket.io** | SSE sufficient for chat streaming |
| **Chat UI library** | Conflicts with Tailwind, simple to build |
| **react-router-dom** | Single page sufficient initially; add if needed |
| **Monaco Editor** | JSON editing not in v0.2 scope |
| **Video.js** | System player, not in-browser playback |
| **Authentication** | Local dev, single user |

---

## Installation

### Step 1: Create UI directory

```bash
mkdir -p ui
cd ui
npm create vite@latest . -- --template react-ts
```

### Step 2: Install dependencies

```bash
# Core
npm install tailwindcss @tailwindcss/vite
npm install @tanstack/react-query zustand
npm install lucide-react
npm install class-variance-authority clsx tailwind-merge

# Dev
npm install -D @types/node
```

### Step 3: Initialize shadcn

```bash
npx shadcn@latest init
```

Select:
- Style: Default
- Base color: Neutral (or preference)
- CSS variables: Yes

### Step 4: Add components

```bash
npx shadcn@latest add button input textarea card scroll-area avatar
```

### Step 5: Configure Vite

```typescript
// ui/vite.config.ts
import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
  build: {
    outDir: '../dist/ui',
  },
});
```

### Step 6: Update root package.json scripts

```json
{
  "scripts": {
    "dev": "concurrently \"npm run dev:api\" \"npm run dev:ui\"",
    "dev:api": "node --import tsx src/api/server.ts",
    "dev:ui": "cd ui && npm run dev",
    "build:ui": "cd ui && npm run build",
    "start": "node dist/api/server.js"
  }
}
```

---

## Version Constraints

| Package | Min Version | Verified | Notes |
|---------|-------------|----------|-------|
| vite | ^7.3.1 | npm registry | Latest stable |
| react | ^19.2.4 | npm registry | Latest stable |
| tailwindcss | ^4.1.18 | npm registry | v4 with Vite plugin |
| @tailwindcss/vite | ^4.1.18 | npm registry | Matches Tailwind version |
| @tanstack/react-query | ^5.90.20 | npm registry | Latest v5 |
| zustand | ^5.0.10 | npm registry | Latest v5 |
| lucide-react | ^0.563.0 | npm registry | Latest |
| @hono/node-server | ^1.19.9 | npm registry | Already installed |

---

## Sources

- [Tailwind CSS v4 + Vite Installation](https://tailwindcss.com/docs)
- [shadcn/ui Vite Installation](https://ui.shadcn.com/docs/installation/vite)
- [TanStack Query Overview](https://tanstack.com/query/latest/docs/framework/react/overview)
- [Zustand vs Redux vs Jotai](https://betterstack.com/community/guides/scaling-nodejs/zustand-vs-redux-toolkit-vs-jotai/)
- [Hono Node.js Static Files](https://hono.dev/docs/getting-started/nodejs)
- [React State Management 2026](https://www.patterns.dev/react/react-2026/)
- [15 Best React UI Libraries 2026](https://www.builder.io/blog/react-component-libraries-2026)

---

## Summary

The v0.2 Studio UI adds:

| Category | Technology | Rationale |
|----------|------------|-----------|
| Build | Vite 7 | Fastest DX, Tailwind v4 native |
| UI | React 19 + Tailwind v4 | Project scope, modern stack |
| Components | shadcn/ui | Accessible, Tailwind-native, copy-paste |
| Server state | TanStack Query | Caching, background refresh |
| Client state | Zustand | Minimal, perfect for chat |
| Serving | Hono static | Single port, no separate server |

This stack prioritizes:
- **Developer experience**: Fast HMR, type safety, minimal config
- **Simplicity**: No SSR, no monorepo tools, no chat libraries
- **Integration**: Proxy in dev, static serve in prod, shared types
