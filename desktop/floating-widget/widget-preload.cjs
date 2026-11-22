'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const settingsPage = new URLSearchParams(location.search).has('settings');
const sends = new Set(settingsPage
  ? ['widget-settings-ready', 'widget-settings-action', 'widget-settings-close']
  : ['widget-action', 'widget-window-cmd', 'widget-request-window-state', 'widget-request-snapshot', 'widget-settings-state']);
const receives = new Set(settingsPage
  ? ['widget-settings-state']
  : ['widget-update', 'widget-announcement', 'widget-visibility', 'widget-window-state', 'widget-resized',
    'show-context-menu', 'widget-settings-request-state', 'widget-settings-action']);
const listeners = new Set();

contextBridge.exposeInMainWorld('foliaWidget', Object.freeze({
  send(channel, payload) {
    if (sends.has(channel)) ipcRenderer.send(channel, payload);
  },
  on(channel, callback) {
    if (!receives.has(channel) || typeof callback !== 'function') return () => {};
    // Never expose the Electron event or its sender to the page.
    const listener = (_event, payload) => callback(null, payload);
    const entry = { channel, listener };
    listeners.add(entry);
    ipcRenderer.on(channel, listener);
    return () => { ipcRenderer.removeListener(channel, listener); listeners.delete(entry); };
  }
}));

window.addEventListener('pagehide', () => {
  for (const { channel, listener } of listeners) ipcRenderer.removeListener(channel, listener);
  listeners.clear();
}, { once: true });
