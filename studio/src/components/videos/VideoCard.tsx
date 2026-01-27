import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Play, Film, HardDrive } from 'lucide-react';
import { formatDuration, formatFileSize } from '@/lib/format';
import { formatRelativeTime } from '@/lib/date';
import { useOpenVideo } from '@/api/videos';
import type { StudioVideo } from '@/api/videos';
import { DeleteVideoDialog } from './DeleteVideoDialog';

interface VideoCardProps {
  video: StudioVideo;
  selected?: boolean;
  onSelect?: (id: string) => void;
  onDelete?: (id: string) => void;
}

export function VideoCard({
  video,
  selected,
  onSelect,
  onDelete,
}: VideoCardProps) {
  const openVideo = useOpenVideo();

  const handleClick = () => {
    openVideo.mutate(video.id);
  };

  const handleCheckboxClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect?.(video.id);
  };

  return (
    <Card className="overflow-hidden bg-slate-900 border-slate-800">
      {/* Thumbnail with play overlay */}
      <div
        className="relative aspect-video bg-slate-800 cursor-pointer group"
        onClick={handleClick}
      >
        {/* Selection checkbox (only shown in batch mode) */}
        {onSelect && (
          <div
            className="absolute top-2 left-2 z-10"
            onClick={handleCheckboxClick}
          >
            <Checkbox
              checked={selected}
              className="bg-slate-900/80 border-slate-600 data-[state=checked]:bg-blue-600"
            />
          </div>
        )}

        {video.thumbnail_path ? (
          <img
            src={`/studio/thumbnails/${video.id}.jpg`}
            alt={video.filename}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Film className="size-12 text-slate-600" />
          </div>
        )}

        {/* Play overlay on hover */}
        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <Play className="size-12 text-white fill-white" />
        </div>

        {/* Duration badge */}
        {video.duration_ms && (
          <div className="absolute bottom-2 right-2 px-1.5 py-0.5 bg-black/70 rounded text-xs text-white">
            {formatDuration(video.duration_ms)}
          </div>
        )}
      </div>

      <CardContent className="p-3">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-slate-100 truncate">
              {video.filename}
            </p>
            <div className="flex items-center gap-3 mt-1 text-xs text-slate-400">
              {video.file_size_bytes && (
                <span className="flex items-center gap-1">
                  <HardDrive className="size-3" />
                  {formatFileSize(video.file_size_bytes)}
                </span>
              )}
              <span>{formatRelativeTime(video.created_at)}</span>
            </div>
            {video.template_name && (
              <p className="text-xs text-slate-500 mt-1 truncate">
                From: {video.template_name}
              </p>
            )}
          </div>
          <div onClick={(e) => e.stopPropagation()}>
            <DeleteVideoDialog videoId={video.id} videoName={video.filename} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
