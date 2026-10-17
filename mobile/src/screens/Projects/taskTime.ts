/**
 * A task's time for cards and rows (17 Oct 2026): logged so far, and while the
 * timer runs, a live clock plus what is left of the estimate — the same
 * numbers on the Board and in the List.
 */
export interface TaskTime { display: string; isRunning: boolean; isOver: boolean }

const short = (min: number) => (min < 60 ? `${Math.round(min)}m` : `${(min / 60).toFixed(1)}h`);

export function isTimerRunning(issue: any): boolean {
  return !!(issue?.workStartedAt && !issue?.workCompletedAt);
}

export function taskTime(issue: any, now: number): TaskTime | null {
  const running = isTimerRunning(issue);
  let loggedMin = 0;
  let openAt: number | null = null;
  for (const log of issue?.timeLogs ?? []) {
    if (log.endedAt || log.durationMin) loggedMin += log.durationMin || 0;
    else if (log.startedAt) openAt = Math.max(openAt ?? 0, new Date(log.startedAt).getTime());
  }
  const estMin = (issue?.estimatedHours || 0) * 60;
  if (!running && loggedMin === 0 && estMin === 0) return null;

  if (running) {
    const start = openAt ?? new Date(issue.workStartedAt).getTime();
    const sec = Math.max(0, Math.floor(loggedMin * 60 + (now - start) / 1000));
    const clock = `${Math.floor(sec / 3600)}:${String(Math.floor((sec % 3600) / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
    if (estMin > 0) {
      const left = estMin - sec / 60;
      return { display: left >= 0 ? `${clock} · ${short(left)} left` : `${clock} · over ${short(-left)}`, isRunning: true, isOver: left < 0 };
    }
    return { display: clock, isRunning: true, isOver: false };
  }
  if (estMin > 0) return { display: `${short(loggedMin)} / ${short(estMin)}`, isRunning: false, isOver: loggedMin > estMin };
  return { display: short(loggedMin), isRunning: false, isOver: false };
}
