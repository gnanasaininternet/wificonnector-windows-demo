const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const wifiProfile = require("./wifiProfile");

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile("index.html");
  
  // Optional: Open DevTools in development
  // win.webContents.openDevTools();
}

app.whenReady().then(createWindow);

ipcMain.handle("create-and-connect", async (event, payload) => {
  const backendUrl = "http://13.200.248.171:8000/create_user";
  return await wifiProfile.createUserAndConnect(payload, backendUrl);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
