import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useUpdateTemplate } from '@/api/templates';
import type { StudioTemplate } from '@/api/templates';

interface TemplateEditDialogProps {
  template: StudioTemplate | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TemplateEditDialog({
  template,
  open,
  onOpenChange,
}: TemplateEditDialogProps) {
  const [name, setName] = useState('');
  const updateTemplate = useUpdateTemplate();

  // Reset form when dialog opens with new template
  useEffect(() => {
    if (template && open) {
      setName(template.name);
    }
  }, [template, open]);

  if (!template) return null;

  const handleSave = async () => {
    if (!name.trim()) return;

    try {
      await updateTemplate.mutateAsync({
        id: template.id,
        name: name.trim(),
      });
      onOpenChange(false);
    } catch {
      // Error handled by mutation
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !updateTemplate.isPending) {
      handleSave();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename Template</DialogTitle>
        </DialogHeader>
        <div className="py-4">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Template name"
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={!name.trim() || updateTemplate.isPending}
          >
            {updateTemplate.isPending ? 'Saving...' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
