declare global {
  interface Window {
    electron: {
      showContextMenu: () => Promise<void>;
    };
  }
}

export {};