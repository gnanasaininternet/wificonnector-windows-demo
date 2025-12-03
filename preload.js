const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("wifiAPI", {
  createAndConnect: (payload) => ipcRenderer.invoke("create-and-connect", payload),
});
