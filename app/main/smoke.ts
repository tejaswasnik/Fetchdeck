export type SmokeTarget = {
  once(event: 'did-finish-load', listener: () => void): unknown;
  once(event: 'did-fail-load', listener: () => void): unknown;
};

export const SMOKE_FLAG = '--smoke';
export const SMOKE_TIMEOUT_MS = 30_000;

export const isSmokeRun = (argv: readonly string[]): boolean => argv.includes(SMOKE_FLAG);

// CI launches the built app with --smoke: exit 0 once the page has loaded, 1 if it fails to load or takes too long.
// `exit` is called at most once, whichever outcome comes first.
export const attachSmokeTest = (
  target: SmokeTarget,
  exit: (code: number) => void,
  timeoutMs: number = SMOKE_TIMEOUT_MS,
): void => {
  let finished = false;
  const finish = (code: number): void => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    exit(code);
  };
  const timer = setTimeout(() => finish(1), timeoutMs);
  target.once('did-finish-load', () => finish(0));
  target.once('did-fail-load', () => finish(1));
};
