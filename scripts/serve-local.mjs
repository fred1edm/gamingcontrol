import { spawn } from "node:child_process";
import process from "node:process";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const command = (args) =>
  process.platform === "win32"
    ? [
        process.env.ComSpec ?? "cmd.exe",
        ["/d", "/s", "/c", `${npm} ${args.join(" ")}`],
      ]
    : [npm, args];
const spawnNpm = (args) => {
  const [file, fileArgs] = command(args);
  return spawn(file, fileArgs, {
    stdio: "inherit",
    windowsVerbatimArguments: false,
  });
};
const children = [
  spawnNpm(["run", "start", "-w", "@gaming/api"]),
  spawnNpm(["run", "preview", "-w", "@gaming/admin", "--", "--port", "5173"]),
];
async function openPanelWhenReady() {
  if (process.platform !== "win32") return;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await globalThis.fetch("http://127.0.0.1:5173");
      if (response.ok) {
        spawn(
          process.env.ComSpec ?? "cmd.exe",
          ["/d", "/s", "/c", "start", "", "http://localhost:5173"],
          { stdio: "ignore", windowsHide: true, detached: true },
        ).unref();
        return;
      }
    } catch {
      // El panel todavía está iniciando.
    }
    await new Promise((resolve) => globalThis.setTimeout(resolve, 500));
  }
}
void openPanelWhenReady();
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  globalThis.setTimeout(() => process.exit(code), 250);
}
for (const child of children)
  child.on("exit", (code) => {
    if (!stopping && code !== 0) stop(code ?? 1);
  });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => stop());
