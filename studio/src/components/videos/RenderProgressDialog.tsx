import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { CheckCircle, XCircle, Loader2 } from 'lucide-react';

interface RenderProgressDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  status: 'queued' | 'processing' | 'completed' | 'failed' | null;
  progress?: number;
  error?: string;
}

export function RenderProgressDialog({
  open,
  onOpenChange,
  status,
  progress,
  error,
}: RenderProgressDialogProps) {
  // Dialog cannot be closed while rendering is in progress
  const canClose = status === 'completed' || status === 'failed';

  const handleOpenChange = (newOpen: boolean) => {
    if (canClose) {
      onOpenChange(newOpen);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {status === 'queued' && 'Preparing render...'}
            {status === 'processing' && 'Rendering video...'}
            {status === 'completed' && 'Render complete!'}
            {status === 'failed' && 'Render failed'}
          </DialogTitle>
        </DialogHeader>

        <div className="py-4">
          {status === 'queued' && (
            <div className="flex items-center justify-center gap-2 text-slate-400">
              <Loader2 className="size-5 animate-spin" />
              <span>Waiting in queue...</span>
            </div>
          )}

          {status === 'processing' && (
            <div className="space-y-2">
              <Progress value={progress || 0} className="h-2" />
              <p className="text-sm text-slate-400 text-center">
                {progress || 0}% complete
              </p>
            </div>
          )}

          {status === 'completed' && (
            <div className="flex flex-col items-center gap-2 text-green-400">
              <CheckCircle className="size-12" />
              <span>Video rendered successfully!</span>
              <p className="text-sm text-slate-400">
                Opening in your video player...
              </p>
            </div>
          )}

          {status === 'failed' && (
            <div className="flex flex-col items-center gap-2 text-red-400">
              <XCircle className="size-12" />
              <span>Render failed</span>
              {error && (
                <p className="text-sm text-slate-400 text-center mt-2">
                  {error}
                </p>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
