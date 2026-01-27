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

  // Try to parse and format the JSON spec
  let jsonString: string;
  try {
    const parsedSpec = JSON.parse(template.spec);
    jsonString = JSON.stringify(parsedSpec, null, 2);
  } catch {
    // If parsing fails, show raw spec
    jsonString = template.spec;
  }

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
        <div className="flex-1 overflow-auto bg-slate-900 rounded-lg p-4 mt-4">
          <pre className="text-sm text-slate-300">
            <code>{jsonString}</code>
          </pre>
        </div>
      </DialogContent>
    </Dialog>
  );
}
