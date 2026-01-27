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
