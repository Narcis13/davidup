import { useState } from 'react';
import { useTemplates } from '@/api/templates';
import type { StudioTemplate } from '@/api/templates';
import { TemplateCard } from './TemplateCard';
import { TemplateViewDialog } from './TemplateViewDialog';
import { TemplateEditDialog } from './TemplateEditDialog';

export function TemplateLibrary() {
  const { data: templates, isLoading, error } = useTemplates();
  const [selectedTemplate, setSelectedTemplate] = useState<StudioTemplate | null>(null);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);

  const handleCardClick = (template: StudioTemplate) => {
    setSelectedTemplate(template);
    setViewDialogOpen(true);
  };

  const handleEditClick = () => {
    setViewDialogOpen(false);
    setEditDialogOpen(true);
  };

  const handleEditClose = (open: boolean) => {
    setEditDialogOpen(open);
    if (!open) {
      // When edit dialog closes, reopen view dialog
      setViewDialogOpen(true);
    }
  };

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
          <TemplateCard
            key={template.id}
            template={template}
            onClick={() => handleCardClick(template)}
          />
        ))}
      </div>

      <TemplateViewDialog
        template={selectedTemplate}
        open={viewDialogOpen}
        onOpenChange={setViewDialogOpen}
        onEdit={handleEditClick}
      />

      <TemplateEditDialog
        template={selectedTemplate}
        open={editDialogOpen}
        onOpenChange={handleEditClose}
      />
    </div>
  );
}
