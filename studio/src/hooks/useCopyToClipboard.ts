import { useState, useCallback, useRef } from 'react';

export function useCopyToClipboard() {
  const [isCopied, setIsCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copy = useCallback(async (text: string): Promise<boolean> => {
    // Clear any existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    try {
      await navigator.clipboard.writeText(text);
      setIsCopied(true);

      // Auto-reset after 2 seconds
      timeoutRef.current = setTimeout(() => {
        setIsCopied(false);
        timeoutRef.current = null;
      }, 2000);

      return true;
    } catch {
      console.error('Failed to copy to clipboard');
      setIsCopied(false);
      return false;
    }
  }, []);

  return { copy, isCopied };
}
