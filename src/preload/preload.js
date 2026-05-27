"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const mcpGateway = {
    getServers: () => electron_1.ipcRenderer.invoke('servers:list'),
    toggleServer: (id, enabled) => electron_1.ipcRenderer.invoke('server:toggle', { id, enabled }),
    addServer: (config) => electron_1.ipcRenderer.invoke('server:add', config),
    deleteServer: (id) => electron_1.ipcRenderer.invoke('server:delete', { id }),
    reconnectServer: (id) => electron_1.ipcRenderer.invoke('server:reconnect', { id }),
    getEndpointInfo: () => electron_1.ipcRenderer.invoke('endpoint:info'),
    onStateChanged: (callback) => {
        const handler = (_, state) => callback(state);
        electron_1.ipcRenderer.on('servers:state-changed', handler);
        // Return cleanup function
        return () => {
            electron_1.ipcRenderer.removeListener('servers:state-changed', handler);
        };
    },
};
electron_1.contextBridge.exposeInMainWorld('mcpGateway', mcpGateway);
