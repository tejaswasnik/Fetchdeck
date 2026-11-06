export type QuitGuardDeps = {
  hasActiveDownloads: () => boolean;
  confirmQuit: () => Promise<boolean>;
};

// Closing the window with downloads running asks first; cancelling keeps the app open.
export const shouldCloseWindow = async ({ hasActiveDownloads, confirmQuit }: QuitGuardDeps): Promise<boolean> =>
  !hasActiveDownloads() || (await confirmQuit());

// before-quit fires again when we call app.quit() ourselves, so only the first one is intercepted.
export const createQuitGate = (): { begin: () => boolean } => {
  let started = false;
  return {
    begin: () => {
      if (started) return false;
      started = true;
      return true;
    },
  };
};
