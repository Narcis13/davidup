# Phase 9: Template Library - Research

**Researched:** 2026-01-27
**Domain:** React UI for CRUD operations on templates with card grid layout, modals, and TanStack Query mutations
**Confidence:** HIGH

## Summary

This phase implements a template library UI for saving, organizing, and managing video templates generated from the chat interface (Phase 8). The core challenge is building a responsive card grid display with CRUD operations, integrating with the existing SQLite database schema (`studio_templates` table), and providing a seamless save-to-library flow from the chat interface.

Research confirms the standard approach: use shadcn/ui Card and Dialog components for the UI, TanStack Query mutations for CRUD operations with optimistic updates, and extend the existing Zustand store or create a dedicated template store for UI state. The existing database schema already has the `studio_templates` table with `id`, `name`, `spec`, `conversation_id`, `created_at`, and `updated_at` fields, which aligns perfectly with the requirements.

The template library follows a standard pattern: responsive grid layout with Card components showing template name and last modified date, Dialog/Modal for viewing full JSON content and editing names, AlertDialog for delete confirmation, and a "Save to Library" action integrated into the chat's TemplatePreview component. Navigation between chat and library views can be handled with simple tab-style navigation in the header or a sidebar pattern.

**Primary recommendation:** Build the template library as a sibling view to ChatContainer, using shadcn/ui Card for the grid items, Dialog for template preview/edit, and AlertDialog for delete confirmation. Use TanStack Query mutations with optimistic updates for all CRUD operations on templates.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @tanstack/react-query | ^5.90.20 | CRUD mutations & caching | Already installed, handles cache invalidation, optimistic updates |
| zustand | ^5.0.10 | UI state (selected template, modals) | Already installed, complements TanStack Query for ephemeral state |
| shadcn/ui Card | latest | Template card component | Official shadcn component, consistent with existing Button |
| shadcn/ui Dialog | latest | View/edit template modal | Official shadcn component, accessible, portal-rendered |
| shadcn/ui AlertDialog | latest | Delete confirmation | Official shadcn component, interrupting confirmations |
| shadcn/ui Input | latest | Template name editing | Official shadcn component, form input |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| lucide-react | ^0.563.0 | Icons (Trash, Edit, Save, Library) | Already installed, consistent icon set |
| date-fns | ^4.x | Relative date formatting | If needed; native Intl.RelativeTimeFormat is sufficient for MVP |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| shadcn/ui Dialog | Custom modal | Dialog provides focus trapping, portal, escape-to-close built-in |
| date-fns | dayjs | dayjs is smaller but date-fns tree-shakes well; native Intl sufficient for MVP |
| Zustand for UI state | React useState | useState fine for single component; Zustand better if state shared across views |
| TanStack Query | fetch + useState | Lose optimistic updates, cache invalidation, loading states |

**Installation:**

```bash
# In studio directory
pnpm dlx shadcn@latest add card dialog alert-dialog input

# Optional: only if relative time formatting needed beyond native Intl
npm install date-fns
```

## Architecture Patterns

### Recommended Project Structure

```
studio/src/
  components/
    templates/
      TemplateLibrary.tsx        # Main library view (grid + state)
      TemplateCard.tsx           # Individual template card
      TemplateViewDialog.tsx     # Modal for viewing full JSON
      TemplateEditDialog.tsx     # Modal for renaming template
      DeleteTemplateDialog.tsx   # AlertDialog for delete confirmation
    chat/
      TemplatePreview.tsx        # MODIFY: Add "Save to Library" button
      ChatContainer.tsx          # MODIFY: Possible nav to library
    ui/
      card.tsx                   # NEW: shadcn Card component
      dialog.tsx                 # NEW: shadcn Dialog component
      alert-dialog.tsx           # NEW: shadcn AlertDialog component
      input.tsx                  # NEW: shadcn Input component
  api/
    templates.ts                 # NEW: TanStack Query hooks for templates
  stores/
    templateStore.ts             # NEW: Optional UI state for selected template
  App.tsx                        # MODIFY: Add navigation between chat/library
```

### Pattern 1: Template Card with Grid Layout

**What:** Display templates in responsive CSS Grid using shadcn Card components
**When to use:** Main library view showing all saved templates
**Example:**

```typescript
// studio/src/components/templates/TemplateLibrary.tsx
// Source: https://ui.shadcn.com/docs/components/card

import { useTemplates } from '@/api/templates';
import { TemplateCard } from './TemplateCard';

export function TemplateLibrary() {
  const { data: templates, isLoading, error } = useTemplates();

  if (isLoading) {
    return <div className="p-6 text-slate-400">Loading templates...</div>;
  }

  if (error) {
    return <div className="p-6 text-red-400">Error loading templates</div>;
  }

  if (!templates?.length) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-slate-400">
        <p>No templates saved yet.</p>
        <p className="text-sm mt-2">Generate templates in chat and save them here.</p>
      </div>
    );
  }

  return (
    <div className="p-6">
      <h2 className="text-xl font-semibold text-slate-100 mb-4">
        Template Library
      </h2>
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {templates.map((template) => (
          <TemplateCard key={template.id} template={template} />
        ))}
      </div>
    </div>
  );
}
```

### Pattern 2: TanStack Query for Template CRUD

**What:** Query hooks for fetching, creating, updating, and deleting templates
**When to use:** All template library operations
**Example:**

```typescript
// studio/src/api/templates.ts
// Source: https://tanstack.com/query/latest/docs/framework/react/guides/mutations

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

// Types matching backend/database schema
export interface StudioTemplate {
  id: string;
  name: string;
  spec: string; // JSON string of VideoSpec
  conversation_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateTemplateInput {
  name: string;
  spec: object;
  conversationId?: string;
}

export interface UpdateTemplateInput {
  id: string;
  name: string;
}

// Query keys for cache management
export const templateKeys = {
  all: ['studio-templates'] as const,
  list: () => [...templateKeys.all, 'list'] as const,
  detail: (id: string) => [...templateKeys.all, 'detail', id] as const,
};

// Fetch all templates
export function useTemplates() {
  return useQuery({
    queryKey: templateKeys.list(),
    queryFn: async (): Promise<StudioTemplate[]> => {
      const response = await fetch('/studio/templates');
      if (!response.ok) throw new Error('Failed to fetch templates');
      return response.json();
    },
    staleTime: 5 * 60 * 1000, // 5 minutes (project decision from 08-02)
  });
}

// Fetch single template
export function useTemplate(id: string) {
  return useQuery({
    queryKey: templateKeys.detail(id),
    queryFn: async (): Promise<StudioTemplate> => {
      const response = await fetch(`/studio/templates/${id}`);
      if (!response.ok) throw new Error('Failed to fetch template');
      return response.json();
    },
    enabled: !!id,
  });
}

// Create template (save from chat)
export function useCreateTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateTemplateInput): Promise<StudioTemplate> => {
      const response = await fetch('/studio/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!response.ok) throw new Error('Failed to save template');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: templateKeys.list() });
    },
  });
}

// Update template (rename)
export function useUpdateTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: UpdateTemplateInput): Promise<StudioTemplate> => {
      const response = await fetch(`/studio/templates/${input.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: input.name }),
      });
      if (!response.ok) throw new Error('Failed to update template');
      return response.json();
    },
    // Optimistic update
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: templateKeys.list() });
      const previous = queryClient.getQueryData<StudioTemplate[]>(templateKeys.list());

      queryClient.setQueryData<StudioTemplate[]>(templateKeys.list(), (old) =>
        old?.map((t) => (t.id === input.id ? { ...t, name: input.name } : t))
      );

      return { previous };
    },
    onError: (_, __, context) => {
      if (context?.previous) {
        queryClient.setQueryData(templateKeys.list(), context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: templateKeys.list() });
    },
  });
}

// Delete template
export function useDeleteTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const response = await fetch(`/studio/templates/${id}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error('Failed to delete template');
    },
    // Optimistic update
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: templateKeys.list() });
      const previous = queryClient.getQueryData<StudioTemplate[]>(templateKeys.list());

      queryClient.setQueryData<StudioTemplate[]>(templateKeys.list(), (old) =>
        old?.filter((t) => t.id !== id)
      );

      return { previous };
    },
    onError: (_, __, context) => {
      if (context?.previous) {
        queryClient.setQueryData(templateKeys.list(), context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: templateKeys.list() });
    },
  });
}
```

### Pattern 3: Delete Confirmation with AlertDialog

**What:** Confirmation modal before destructive delete action
**When to use:** Delete template button click
**Example:**

```typescript
// studio/src/components/templates/DeleteTemplateDialog.tsx
// Source: https://ui.shadcn.com/docs/components/alert-dialog

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Trash2 } from 'lucide-react';
import { useDeleteTemplate } from '@/api/templates';

interface DeleteTemplateDialogProps {
  templateId: string;
  templateName: string;
}

export function DeleteTemplateDialog({
  templateId,
  templateName,
}: DeleteTemplateDialogProps) {
  const deleteTemplate = useDeleteTemplate();

  const handleDelete = () => {
    deleteTemplate.mutate(templateId);
  };

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="text-slate-400 hover:text-red-400">
          <Trash2 className="size-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Template</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete "{templateName}"? This action cannot
            be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            className="bg-red-600 hover:bg-red-700"
          >
            {deleteTemplate.isPending ? 'Deleting...' : 'Delete'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

### Pattern 4: Save to Library from Chat

**What:** Add save button to TemplatePreview component in chat
**When to use:** When user wants to save a generated template
**Example:**

```typescript
// Modification to studio/src/components/chat/TemplatePreview.tsx
// Add save-to-library functionality

import { Save, Check, Copy } from 'lucide-react';
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard';
import { Button } from '@/components/ui/button';
import { useCreateTemplate } from '@/api/templates';
import { useState } from 'react';

interface TemplatePreviewProps {
  template: object;
  conversationId?: string | null;
}

export function TemplatePreview({ template, conversationId }: TemplatePreviewProps) {
  const { copy, isCopied } = useCopyToClipboard();
  const createTemplate = useCreateTemplate();
  const [isSaved, setIsSaved] = useState(false);

  const jsonString = JSON.stringify(template, null, 2);

  const handleCopy = () => {
    copy(jsonString);
  };

  const handleSave = async () => {
    try {
      await createTemplate.mutateAsync({
        name: `Template ${new Date().toLocaleDateString()}`,
        spec: template,
        conversationId: conversationId ?? undefined,
      });
      setIsSaved(true);
      setTimeout(() => setIsSaved(false), 2000);
    } catch {
      // Error handled by mutation
    }
  };

  return (
    <div className="mt-3 bg-slate-900 border border-slate-700 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-slate-800 border-b border-slate-700">
        <span className="text-sm font-medium text-slate-300">
          Generated Template
        </span>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleSave}
            disabled={createTemplate.isPending || isSaved}
            className="h-7 gap-1.5 text-slate-400 hover:text-slate-100"
          >
            {isSaved ? (
              <>
                <Check className="size-3.5" />
                <span>Saved!</span>
              </>
            ) : (
              <>
                <Save className="size-3.5" />
                <span>{createTemplate.isPending ? 'Saving...' : 'Save to Library'}</span>
              </>
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleCopy}
            className="h-7 gap-1.5 text-slate-400 hover:text-slate-100"
          >
            {isCopied ? (
              <>
                <Check className="size-3.5" />
                <span>Copied!</span>
              </>
            ) : (
              <>
                <Copy className="size-3.5" />
                <span>Copy JSON</span>
              </>
            )}
          </Button>
        </div>
      </div>
      <pre className="p-3 text-sm text-slate-300 overflow-x-auto max-h-60 overflow-y-auto">
        <code>{jsonString}</code>
      </pre>
    </div>
  );
}
```

### Pattern 5: Relative Date Formatting

**What:** Display "Last modified 2 hours ago" instead of raw timestamps
**When to use:** Template card metadata
**Example:**

```typescript
// studio/src/lib/date.ts
// Using native Intl.RelativeTimeFormat (no external dependency needed)

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

const DIVISIONS: Array<{ amount: number; name: Intl.RelativeTimeFormatUnit }> = [
  { amount: 60, name: 'seconds' },
  { amount: 60, name: 'minutes' },
  { amount: 24, name: 'hours' },
  { amount: 7, name: 'days' },
  { amount: 4.34524, name: 'weeks' },
  { amount: 12, name: 'months' },
  { amount: Number.POSITIVE_INFINITY, name: 'years' },
];

export function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  let duration = (date.getTime() - Date.now()) / 1000;

  for (const division of DIVISIONS) {
    if (Math.abs(duration) < division.amount) {
      return rtf.format(Math.round(duration), division.name);
    }
    duration /= division.amount;
  }

  return dateString; // Fallback
}
```

### Anti-Patterns to Avoid

- **Fetching template list on every modal open:** Use TanStack Query caching; data is already loaded.
- **Not using optimistic updates for delete:** Makes UI feel sluggish; delete should remove card immediately.
- **Storing template list in Zustand:** Template list is server state; use TanStack Query, not Zustand.
- **Inline confirmation dialogs:** Use AlertDialog component for accessibility and consistent UX.
- **Calling save without checking for existing name:** Prompt for name or use sensible default.
- **Hard-coding grid columns:** Use responsive Tailwind classes (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Modal/dialog | Custom overlay + portal | shadcn/ui Dialog | Focus trapping, escape handling, ARIA attributes |
| Delete confirmation | window.confirm() | shadcn/ui AlertDialog | Accessible, styled consistently |
| Form input | Raw `<input>` | shadcn/ui Input | Consistent styling, disabled states |
| Card container | Custom div styling | shadcn/ui Card | Consistent spacing, semantic structure |
| Relative dates | Custom date math | Intl.RelativeTimeFormat or date-fns | Edge cases with DST, locales |
| Optimistic updates | Manual state management | TanStack Query onMutate/onError | Handles rollback, race conditions |
| Cache invalidation | Manual refetch | TanStack Query invalidateQueries | Automatic, query-key scoped |

**Key insight:** shadcn/ui components are built on Radix UI primitives which handle accessibility, keyboard navigation, and focus management. Rolling your own modals/dialogs will miss edge cases that Radix has already solved.

## Common Pitfalls

### Pitfall 1: Double Save Due to Missing State

**What goes wrong:** User clicks "Save to Library" multiple times, creates duplicate templates
**Why it happens:** Button not disabled during mutation, no feedback that save succeeded
**How to avoid:** Disable button with `isPending`, show "Saved!" feedback state
**Warning signs:** Duplicate templates appearing in library

### Pitfall 2: Stale Data After CRUD Operation

**What goes wrong:** Template list shows old data after create/update/delete
**Why it happens:** Not invalidating TanStack Query cache after mutation
**How to avoid:** Call `queryClient.invalidateQueries({ queryKey: templateKeys.list() })` in onSettled
**Warning signs:** Need to refresh page to see changes

### Pitfall 3: Dialog State Leak

**What goes wrong:** Editing one template shows data from previously viewed template
**Why it happens:** Dialog open state managed outside, template data not reset on close
**How to avoid:** Reset form state on dialog close, or unmount dialog content when closed
**Warning signs:** Form pre-filled with wrong data

### Pitfall 4: Optimistic Delete Without Rollback

**What goes wrong:** Template disappears from UI, delete fails, template stays gone until refresh
**Why it happens:** No onError rollback logic in delete mutation
**How to avoid:** Store previous state in onMutate context, restore in onError
**Warning signs:** Deleted items sometimes reappear after server sync

### Pitfall 5: JSON Parsing on Display

**What goes wrong:** "Unexpected token" error when displaying template JSON
**Why it happens:** `spec` column stores JSON string, parsing fails on malformed data
**How to avoid:** Wrap `JSON.parse` in try/catch, show error state if invalid
**Warning signs:** Blank template preview, console errors

### Pitfall 6: Missing Loading and Empty States

**What goes wrong:** Blank page while loading, or confusing empty grid when no templates
**Why it happens:** Only handling the "data loaded" case
**How to avoid:** Add explicit loading skeleton and empty state components
**Warning signs:** Users think the app is broken

## Code Examples

### Template Card Component

```typescript
// studio/src/components/templates/TemplateCard.tsx
// Source: https://ui.shadcn.com/docs/components/card

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { DeleteTemplateDialog } from './DeleteTemplateDialog';
import { formatRelativeTime } from '@/lib/date';
import type { StudioTemplate } from '@/api/templates';

interface TemplateCardProps {
  template: StudioTemplate;
  onClick: () => void;
}

export function TemplateCard({ template, onClick }: TemplateCardProps) {
  return (
    <Card
      className="cursor-pointer hover:border-slate-600 transition-colors"
      onClick={onClick}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <CardTitle className="text-base font-medium text-slate-100 line-clamp-1">
            {template.name}
          </CardTitle>
          <div onClick={(e) => e.stopPropagation()}>
            <DeleteTemplateDialog
              templateId={template.id}
              templateName={template.name}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <p className="text-xs text-slate-400">
          {formatRelativeTime(template.updated_at)}
        </p>
      </CardContent>
    </Card>
  );
}
```

### Template View Dialog

```typescript
// studio/src/components/templates/TemplateViewDialog.tsx
// Source: https://ui.shadcn.com/docs/components/dialog

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Copy, Check, Pencil } from 'lucide-react';
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard';
import type { StudioTemplate } from '@/api/templates';

interface TemplateViewDialogProps {
  template: StudioTemplate | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit: () => void;
}

export function TemplateViewDialog({
  template,
  open,
  onOpenChange,
  onEdit,
}: TemplateViewDialogProps) {
  const { copy, isCopied } = useCopyToClipboard();

  if (!template) return null;

  let parsedSpec: object | null = null;
  try {
    parsedSpec = JSON.parse(template.spec);
  } catch {
    // Invalid JSON
  }

  const jsonString = parsedSpec
    ? JSON.stringify(parsedSpec, null, 2)
    : template.spec;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <div className="flex items-center justify-between pr-8">
            <DialogTitle>{template.name}</DialogTitle>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={onEdit}
                className="h-7 gap-1.5"
              >
                <Pencil className="size-3.5" />
                Rename
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => copy(jsonString)}
                className="h-7 gap-1.5"
              >
                {isCopied ? (
                  <>
                    <Check className="size-3.5" />
                    Copied!
                  </>
                ) : (
                  <>
                    <Copy className="size-3.5" />
                    Copy JSON
                  </>
                )}
              </Button>
            </div>
          </div>
        </DialogHeader>
        <div className="flex-1 overflow-auto bg-slate-900 rounded-lg p-4">
          <pre className="text-sm text-slate-300">
            <code>{jsonString}</code>
          </pre>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

### Simple Navigation Between Views

```typescript
// studio/src/App.tsx
// Simple tab-style navigation between Chat and Library

import { useState } from 'react';
import { ChatContainer } from '@/components/chat/ChatContainer';
import { TemplateLibrary } from '@/components/templates/TemplateLibrary';
import { Button } from '@/components/ui/button';
import { MessageSquare, Library } from 'lucide-react';

type View = 'chat' | 'library';

function App() {
  const [view, setView] = useState<View>('chat');

  return (
    <div className="h-screen flex flex-col bg-slate-950">
      {/* Navigation Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900">
        <h1 className="text-xl font-semibold bg-gradient-to-r from-blue-400 to-violet-400 bg-clip-text text-transparent">
          GameMotion Studio
        </h1>
        <div className="flex gap-2">
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
        </div>
      </header>

      {/* View Content */}
      {view === 'chat' ? <ChatContainer /> : <TemplateLibrary />}
    </div>
  );
}

export default App;
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| window.confirm() | shadcn AlertDialog | 2024 | Accessible, styled, focus-trapped |
| Manual fetch + useState | TanStack Query mutations | 2023-2024 | Optimistic updates, caching, auto-refetch |
| Moment.js | date-fns / Intl.RelativeTimeFormat | 2022-2023 | Smaller bundle, tree-shakeable |
| Custom CSS grid | Tailwind grid utilities | 2021+ | Responsive classes, consistent spacing |
| Redux for everything | TanStack Query + Zustand split | 2024-2025 | Server vs UI state separation |

**Deprecated/outdated:**
- **Moment.js:** Use date-fns or native Intl APIs
- **window.confirm():** Use AlertDialog for consistent UX
- **Manual cache management:** TanStack Query handles this

## Open Questions

1. **Template naming on save**
   - What we know: Need to name templates when saving from chat
   - What's unclear: Prompt for name immediately, or use auto-generated name with edit option?
   - Recommendation: Auto-generate name (e.g., "Template - Jan 27, 2026"), let user rename later. Simpler flow.

2. **Navigation pattern**
   - What we know: Need to switch between Chat and Library views
   - What's unclear: Tab nav in header, sidebar, or routing?
   - Recommendation: Simple tab buttons in header for MVP. No routing needed for two views.

3. **Template versioning**
   - What we know: Database has `template_versions` table
   - What's unclear: Phase 9 requirements don't mention versioning
   - Recommendation: Defer to future phase. Phase 9 focuses on basic CRUD, not version history.

## Sources

### Primary (HIGH confidence)
- [shadcn/ui Card](https://ui.shadcn.com/docs/components/card) - Card component structure and API
- [shadcn/ui Dialog](https://ui.shadcn.com/docs/components/dialog) - Dialog component structure and API
- [shadcn/ui AlertDialog](https://ui.shadcn.com/docs/components/alert-dialog) - Alert dialog for confirmations
- [shadcn/ui Input](https://ui.shadcn.com/docs/components/input) - Input component for forms
- [TanStack Query Mutations](https://tanstack.com/query/latest/docs/framework/react/guides/mutations) - useMutation patterns
- [TanStack Query Optimistic Updates](https://tanstack.com/query/latest/docs/framework/react/guides/optimistic-updates) - onMutate/onError patterns

### Secondary (MEDIUM confidence)
- [Day.js RelativeTime](https://day.js.org/docs/en/plugin/relative-time) - Relative time formatting reference
- [Intl.RelativeTimeFormat MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/RelativeTimeFormat) - Native browser API for relative time

### Tertiary (LOW confidence)
- WebSearch results on grid layouts and state management patterns

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Uses existing dependencies (TanStack Query, Zustand, shadcn/ui) with documented patterns
- Architecture: HIGH - Standard CRUD patterns with React Query mutations and shadcn components
- UI components: HIGH - Official shadcn/ui documentation verified
- Pitfalls: MEDIUM - Based on common React patterns and TanStack Query documentation

**Research date:** 2026-01-27
**Valid until:** ~30 days (stable patterns, shadcn/ui components are mature)
