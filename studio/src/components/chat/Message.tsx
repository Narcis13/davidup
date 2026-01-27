import { cn } from '@/lib/utils';
import { TemplatePreview } from './TemplatePreview';

interface MessageProps {
  role: 'user' | 'assistant';
  content: string;
  template?: object;
}

export function Message({ role, content, template }: MessageProps) {
  const isUser = role === 'user';

  return (
    <div
      className={cn(
        'flex w-full',
        isUser ? 'justify-end' : 'justify-start'
      )}
    >
      <div
        className={cn(
          'max-w-3xl',
          isUser ? 'ml-auto' : 'mr-auto'
        )}
      >
        <div
          className={cn(
            'rounded-2xl px-4 py-3',
            isUser
              ? 'bg-blue-600 text-white rounded-br-sm'
              : 'bg-slate-800 text-slate-100 rounded-bl-sm'
          )}
        >
          <p className="whitespace-pre-wrap break-words">{content}</p>
        </div>
        {template && !isUser && (
          <TemplatePreview template={template} />
        )}
      </div>
    </div>
  );
}
