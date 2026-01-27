import { Copy, Check } from 'lucide-react';
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard';
import { Button } from '@/components/ui/button';

interface TemplatePreviewProps {
  template: object;
}

export function TemplatePreview({ template }: TemplatePreviewProps) {
  const { copy, isCopied } = useCopyToClipboard();
  const jsonString = JSON.stringify(template, null, 2);

  const handleCopy = () => {
    copy(jsonString);
  };

  return (
    <div className="mt-3 bg-slate-900 border border-slate-700 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-slate-800 border-b border-slate-700">
        <span className="text-sm font-medium text-slate-300">
          Generated Template
        </span>
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
      <pre className="p-3 text-sm text-slate-300 overflow-x-auto max-h-60 overflow-y-auto">
        <code>{jsonString}</code>
      </pre>
    </div>
  );
}
