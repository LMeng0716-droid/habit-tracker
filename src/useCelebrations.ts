import { useCallback, useEffect, useRef, useState } from "react";
import { ALL_CELEBRATION_MS, CARD_CELEBRATION_MS } from "./celebrations";
export type Celebration = {
  sequence: number;
  habitId: string;
  name: string;
  all: boolean;
  preview?: boolean;
  dock?: "top" | "bottom";
};
export function useCelebrations() {
  const [celebrating, setCelebrating] = useState<Record<string, number>>({});
  const [feedback, setFeedback] = useState<Celebration | null>(null);
  const cardTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const reset = useCallback(() => {
    for (const timer of cardTimers.current.values()) clearTimeout(timer);
    cardTimers.current.clear();
    clearTimeout(feedbackTimer.current);
    setCelebrating({});
    setFeedback(null);
  }, []);
  useEffect(
    () => () => {
      for (const timer of cardTimers.current.values()) clearTimeout(timer);
      clearTimeout(feedbackTimer.current);
    },
    [],
  );
  const clearHabit = useCallback((habitId: string, cancelAll = false) => {
    clearTimeout(cardTimers.current.get(habitId));
    cardTimers.current.delete(habitId);
    setCelebrating((previous) => {
      const next = { ...previous };
      delete next[habitId];
      return next;
    });
    setFeedback((previous) =>
      previous?.habitId === habitId || cancelAll ? null : previous,
    );
  }, []);
  const play = useCallback((event: Celebration) => {
    if (!event.preview) {
      clearTimeout(cardTimers.current.get(event.habitId));
      setCelebrating((previous) => ({
        ...previous,
        [event.habitId]: event.sequence,
      }));
      cardTimers.current.set(
        event.habitId,
        setTimeout(() => {
          setCelebrating((previous) => {
            if (previous[event.habitId] !== event.sequence) return previous;
            const next = { ...previous };
            delete next[event.habitId];
            return next;
          });
          cardTimers.current.delete(event.habitId);
        }, CARD_CELEBRATION_MS),
      );
    }
    clearTimeout(feedbackTimer.current);
    setFeedback(event);
    feedbackTimer.current = setTimeout(
      () =>
        setFeedback((previous) =>
          previous?.sequence === event.sequence ? null : previous,
        ),
      event.all ? ALL_CELEBRATION_MS : CARD_CELEBRATION_MS,
    );
  }, []);
  return { celebrating, feedback, reset, clearHabit, play };
}
