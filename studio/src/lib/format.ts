// studio/src/lib/format.ts
// Format helpers for duration and file size display

/**
 * Format milliseconds as human-readable duration.
 * Returns MM:SS for durations under 1 hour, HH:MM:SS for 1 hour or more.
 *
 * @param ms - Duration in milliseconds
 * @returns Formatted string like "1:23" or "1:05:30"
 *
 * @example
 * formatDuration(0)        // "0:00"
 * formatDuration(5000)     // "0:05"
 * formatDuration(65000)    // "1:05"
 * formatDuration(3665000)  // "1:01:05"
 */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Format bytes as human-readable file size.
 * Uses appropriate unit (B, KB, MB, GB) based on magnitude.
 *
 * @param bytes - File size in bytes
 * @returns Formatted string like "1.5 MB" or "256 KB"
 *
 * @example
 * formatFileSize(500)          // "500 B"
 * formatFileSize(2048)         // "2.0 KB"
 * formatFileSize(1536000)      // "1.5 MB"
 * formatFileSize(2147483648)   // "2.00 GB"
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
