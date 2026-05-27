// Mock electron module for Vitest
const handlers = new Map<string, Function>();

export const ipcMain = {
  handle: (channel: string, handler: Function) => {
    handlers.set(channel, handler);
  },
  _invoke: (event: any, channel: string, ...args: any[]) => {
    const h = handlers.get(channel);
    if (!h) throw new Error(`No handler for ${channel}`);
    // ipcMain.handle callbacks receive (event, ...args)
    return h(event, ...args);
  },
  _clear: () => handlers.clear(),
};

export const BrowserWindow = class {
  webContents = { send: () => {} };
  isDestroyed() { return false; }
  show() {}
  on() {}
  loadURL() {}
  loadFile() {}
};

export const app = {
  whenReady: () => Promise.resolve(),
  on: () => {},
  quit: () => {},
  requestSingleInstanceLock: () => true,
  getPath: () => '',
};

export const Tray = class {
  setToolTip() {}
  setContextMenu() {}
  on() {}
};

export const Menu = {
  buildFromTemplate: () => ({}),
};

export const dialog = {
  showSaveDialog: () => Promise.resolve({ canceled: true }),
  showOpenDialog: () => Promise.resolve({ canceled: true, filePaths: [] }),
};

export const nativeImage = {
  createEmpty: () => ({}),
};

export const ipcRenderer = {
  on: () => {},
  invoke: () => Promise.resolve(),
  removeListener: () => {},
  send: () => {},
};
