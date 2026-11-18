import { useEffect, useState } from 'react';

// Le temps qui reste (en millisecondes) avant une date, recalculé chaque seconde. 0 une fois la date passée.
export function useCountdown(isoDate: string): number {
  const target = new Date(isoDate).getTime();
  const [remaining, setRemaining] = useState(() => Math.max(0, target - Date.now()));

  useEffect(() => {
    const timer = setInterval(() => setRemaining(Math.max(0, target - Date.now())), 1000);
    return () => clearInterval(timer);
  }, [target]);

  return remaining;
}
