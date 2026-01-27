import { useVideos } from '@/api/videos';
import { Film } from 'lucide-react';

/**
 * VideoLibrary component - Placeholder for 10-03.
 * Displays a video grid or empty state.
 */
export function VideoLibrary() {
  const { data: videos, isLoading, error } = useVideos();

  if (isLoading) {
    return <div className="p-6 text-slate-400">Loading videos...</div>;
  }

  if (error) {
    return <div className="p-6 text-red-400">Error loading videos</div>;
  }

  return (
    <div className="flex-1 p-6 overflow-auto">
      <h2 className="text-xl font-semibold text-slate-100 mb-4">Video Library</h2>

      {!videos?.length ? (
        <div className="flex flex-col items-center justify-center h-64 text-slate-400">
          <Film className="size-12 mb-4 text-slate-600" />
          <p>No videos rendered yet.</p>
          <p className="text-sm mt-2">
            Render videos from templates to see them here.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {videos.map((video) => (
            <div
              key={video.id}
              className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden"
            >
              <div className="aspect-video bg-slate-800 flex items-center justify-center">
                <Film className="size-8 text-slate-600" />
              </div>
              <div className="p-3">
                <p className="text-sm font-medium text-slate-100 truncate">
                  {video.filename}
                </p>
                <p className="text-xs text-slate-400">
                  {video.status}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
