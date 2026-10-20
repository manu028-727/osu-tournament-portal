type PollEnvironment = {
  active: () => boolean;
  listen: (resume: () => void) => () => void;
};

// Schedule after completion, not at fixed intervals, so slow polls cannot overlap.
export function startPolling(task: () => Promise<unknown>, delay: number, env: PollEnvironment) {
  let stopped = false,
    running = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    if (!stopped && env.active()) timer = setTimeout(() => void tick(), delay);
  };
  const tick = async () => {
    if (stopped || running || !env.active()) return;
    running = true;
    try {
      await task();
    } catch {
      // The resource hook owns the visible error and retains the last saved state.
    } finally {
      running = false;
      schedule();
    }
  };
  const unlisten = env.listen(() => {
    clearTimeout(timer);
    if (env.active()) void tick();
  });
  schedule();
  return () => {
    stopped = true;
    clearTimeout(timer);
    unlisten();
  };
}
