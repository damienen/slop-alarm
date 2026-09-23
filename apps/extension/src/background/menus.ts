/** The single context-menu item: "Check selection for AI writing" (selection mode). */
export const SELECTION_MENU_ID = 'slop-alarm-check-selection';

export function createContextMenu(): void {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create(
      {
        id: SELECTION_MENU_ID,
        title: 'Check selection for AI writing',
        contexts: ['selection'],
      },
      () => {
        // Reading lastError prevents an "Unchecked runtime.lastError" console warning if the
        // menu already existed for some reason.
        void chrome.runtime.lastError;
      },
    );
  });
}
