import { useState } from 'react';
import { Copy, Check, Save } from 'lucide-react';
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard';
import { useCreateTemplate } from '@/api/templates';
import { Button } from '@/components/ui/button';

interface TemplatePreviewProps {
  template: object;
  conversationId?: string | null;
}

export function TemplatePreview({ template, conversationId }: TemplatePreviewProps) {
  const { copy, isCopied } = useCopyToClipboard();
  const [isSaved, setIsSaved] = useState(false);
  const createTemplate = useCreateTemplate();
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
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleSave}
            disabled={createTemplate.isPending || isSaved}
            className="h-7 gap-1.5 text-slate-400 hover:text-slate-100"
          >
            {createTemplate.isPending ? (
              <span>Saving...</span>
            ) : isSaved ? (
              <>
                <Check className="size-3.5" />
                <span>Saved!</span>
              </>
            ) : (
              <>
                <Save className="size-3.5" />
                <span>Save to Library</span>
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
