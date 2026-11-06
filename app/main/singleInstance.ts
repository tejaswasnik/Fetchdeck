export type WindowLike = {
  isMinimized: () => boolean;
  restore: () => void;
  focus: () => void;
};

// A second copy would run a second queue over the same state folder and .part files.
export const shouldQuitAsDuplicate = (gotLock: boolean): boolean => !gotLock;

// When someone launches the app again, bring the existing window forward.
export const revealWindow = (win: WindowLike | null | undefined): void => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
};
