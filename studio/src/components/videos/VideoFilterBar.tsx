import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { StudioTemplate } from '@/api/templates';

interface VideoFilterBarProps {
  templates: StudioTemplate[];
  selectedTemplateId: string | null;
  onFilterChange: (templateId: string | null) => void;
}

export function VideoFilterBar({
  templates,
  selectedTemplateId,
  onFilterChange,
}: VideoFilterBarProps) {
  const handleValueChange = (value: string) => {
    // Empty string ("all") means clear filter
    onFilterChange(value === '' ? null : value);
  };

  return (
    <Select
      value={selectedTemplateId ?? ''}
      onValueChange={handleValueChange}
    >
      <SelectTrigger className="w-[200px] bg-slate-900 border-slate-700">
        <SelectValue placeholder="All templates" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="">All templates</SelectItem>
        {templates.map((template) => (
          <SelectItem key={template.id} value={template.id}>
            {template.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
