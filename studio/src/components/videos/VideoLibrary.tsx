import { useState } from 'react';
import { useVideos, useBatchDeleteVideos } from '@/api/videos';
import { useTemplates } from '@/api/templates';
import { Button } from '@/components/ui/button';
import { VideoCard } from './VideoCard';
import { VideoFilterBar } from './VideoFilterBar';
import { CheckSquare, Square, Trash2, X } from 'lucide-react';

export function VideoLibrary() {
  const [templateFilter, setTemplateFilter] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchMode, setBatchMode] = useState(false);

  const {
    data: videos,
    isLoading,
    error,
  } = useVideos({ templateId: templateFilter });
  const { data: templates } = useTemplates();
  const { mutate: batchDelete, isPending: isDeleting } = useBatchDeleteVideos();

  const handleToggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    if (videos) {
      setSelectedIds(new Set(videos.map((v) => v.id)));
    }
  };

  const handleClearSelection = () => {
    setSelectedIds(new Set());
  };

  const handleBatchDelete = () => {
    if (selectedIds.size === 0) return;

    batchDelete(Array.from(selectedIds), {
      onSuccess: () => {
        setSelectedIds(new Set());
        setBatchMode(false);
      },
    });
  };

  const handleExitBatchMode = () => {
    setBatchMode(false);
    setSelectedIds(new Set());
  };

  if (isLoading) {
    return <div className="p-6 text-slate-400">Loading videos...</div>;
  }

  if (error) {
    return <div className="p-6 text-red-400">Error loading videos</div>;
  }

  const hasVideos = videos && videos.length > 0;
  const allSelected = hasVideos && selectedIds.size === videos.length;

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold text-slate-100">Video Library</h2>

        <div className="flex items-center gap-3">
          {/* Batch mode controls */}
          {batchMode ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={allSelected ? handleClearSelection : handleSelectAll}
                className="text-slate-400"
              >
                {allSelected ? (
                  <>
                    <Square className="size-4 mr-1" />
                    Clear
                  </>
                ) : (
                  <>
                    <CheckSquare className="size-4 mr-1" />
                    Select All
                  </>
                )}
              </Button>

              {selectedIds.size > 0 && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleBatchDelete}
                  disabled={isDeleting}
                >
                  <Trash2 className="size-4 mr-1" />
                  {isDeleting
                    ? 'Deleting...'
                    : `Delete (${selectedIds.size})`}
                </Button>
              )}

              <Button
                variant="ghost"
                size="sm"
                onClick={handleExitBatchMode}
                className="text-slate-400"
              >
                <X className="size-4 mr-1" />
                Cancel
              </Button>
            </>
          ) : (
            hasVideos && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setBatchMode(true)}
                className="text-slate-400 border-slate-700"
              >
                <CheckSquare className="size-4 mr-1" />
                Select
              </Button>
            )
          )}

          {/* Template filter */}
          <VideoFilterBar
            templates={templates || []}
            selectedTemplateId={templateFilter}
            onFilterChange={setTemplateFilter}
          />
        </div>
      </div>

      {/* Empty state */}
      {!hasVideos ? (
        <div className="flex flex-col items-center justify-center h-64 text-slate-400">
          <p>No videos rendered yet.</p>
          <p className="text-sm mt-2">
            Render videos from templates to see them here.
          </p>
        </div>
      ) : (
        /* Video grid */
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {videos.map((video) => (
            <VideoCard
              key={video.id}
              video={video}
              selected={selectedIds.has(video.id)}
              onSelect={batchMode ? handleToggleSelect : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}
