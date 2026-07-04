"use strict";
const electron = require("electron");
const preload = require("@electron-toolkit/preload");
const pxpipe = {
  getSettings: () => electron.ipcRenderer.invoke("pxpipe:getSettings"),
  updateSettings: (patch) => electron.ipcRenderer.invoke("pxpipe:updateSettings", patch),
  startProxy: (patch) => electron.ipcRenderer.invoke("pxpipe:startProxy", patch),
  stopProxy: () => electron.ipcRenderer.invoke("pxpipe:stopProxy"),
  getProxyStatus: () => electron.ipcRenderer.invoke("pxpipe:getProxyStatus"),
  listEvents: (limit) => electron.ipcRenderer.invoke("pxpipe:listEvents", limit),
  getStats: () => electron.ipcRenderer.invoke("pxpipe:getStats"),
  listSessions: (limit) => electron.ipcRenderer.invoke("pxpipe:listSessions", limit),
  getProxyVerification: () => electron.ipcRenderer.invoke("pxpipe:getProxyVerification"),
  getDashboardRecent: () => electron.ipcRenderer.invoke("pxpipe:getDashboardRecent"),
  getProxyStats: () => electron.ipcRenderer.invoke("pxpipe:getProxyStats"),
  getCurrentSession: () => electron.ipcRenderer.invoke("pxpipe:getCurrentSession"),
  setCompressionEnabled: (enabled) => electron.ipcRenderer.invoke("pxpipe:setCompressionEnabled", enabled),
  getImageVsTextBreakdown: (id) => electron.ipcRenderer.invoke("pxpipe:getImageVsTextBreakdown", id),
  getTokenImage: (id) => electron.ipcRenderer.invoke("pxpipe:getTokenImage", id),
  getImageSource: (id) => electron.ipcRenderer.invoke("pxpipe:getImageSource", id),
  launchClaude: (cwd) => electron.ipcRenderer.invoke("pxpipe:launchClaude", cwd),
  launchCodex: (cwd) => electron.ipcRenderer.invoke("pxpipe:launchCodex", cwd),
  importJsonl: (path) => electron.ipcRenderer.invoke("pxpipe:importJsonl", path),
  onProxyEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    electron.ipcRenderer.on("pxpipe:event", listener);
    return () => electron.ipcRenderer.off("pxpipe:event", listener);
  },
  onProxyStatus: (callback) => {
    const listener = (_event, payload) => callback(payload);
    electron.ipcRenderer.on("pxpipe:status", listener);
    return () => electron.ipcRenderer.off("pxpipe:status", listener);
  }
};
if (process.contextIsolated) {
  try {
    electron.contextBridge.exposeInMainWorld("electron", preload.electronAPI);
    electron.contextBridge.exposeInMainWorld("pxpipe", pxpipe);
  } catch (error) {
    console.error(error);
  }
} else {
  window.electron = preload.electronAPI;
  window.pxpipe = pxpipe;
}
