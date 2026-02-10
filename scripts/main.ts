import { app, BrowserWindow } from "electron";
import path from "path";
import startServe, { closeServe } from "src/app";

function createMainWindow(): void {
  const win = new BrowserWindow({
    width: 900,
    height: 600,
    show: true,
    autoHideMenuBar: true,
  });
  // 开发环境和生产环境使用不同的路径
  const isDev = process.env.NODE_ENV === "dev" || !app.isPackaged;
  const htmlPath = isDev
    ? path.join(process.cwd(), "scripts", "web", "index.html")
    : path.join(app.getAppPath(), "scripts", "web", "index.html");
  void win.loadFile(htmlPath);
}
app.whenReady().then(async () => {
  createMainWindow();
  try {
    await startServe();
  } catch (err) {
    console.error("[服务启动失败]:", err);
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
});

app.on("before-quit", async (event) => {
  await closeServe();
});
