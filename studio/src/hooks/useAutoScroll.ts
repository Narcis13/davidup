import { useRef, useState, useCallback, useEffect } from 'react';

const BOTTOM_THRESHOLD = 100; // Consider "at bottom" if within 100px

export function useAutoScroll<T extends HTMLElement = HTMLDivElement>() {
  const containerRef = useRef<T | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);

  const checkIfAtBottom = useCallback(() => {
    const container = containerRef.current;
    if (!container) {
      return true;
    }

    const { scrollTop, scrollHeight, clientHeight } = container;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    return distanceFromBottom <= BOTTOM_THRESHOLD;
  }, []);

  const scrollToBottom = useCallback(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    container.scrollTo({
      top: container.scrollHeight,
      behavior: 'smooth',
    });
  }, []);

  // Set up scroll event listener
  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const handleScroll = () => {
      setIsAtBottom(checkIfAtBottom());
    };

    container.addEventListener('scroll', handleScroll);
    return () => {
      container.removeEventListener('scroll', handleScroll);
    };
  }, [checkIfAtBottom]);

  return { containerRef, isAtBottom, scrollToBottom };
}
