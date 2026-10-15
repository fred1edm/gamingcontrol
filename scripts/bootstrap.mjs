import { URL } from "node:url";
import console from "node:console";
import fs from "node:fs";
import { randomBytes } from "node:crypto";
fs.mkdirSync(".local", { recursive: true });
if (!fs.existsSync(".env")) {
  const password = randomBytes(24).toString("hex");
  fs.writeFileSync(
    ".env",
    `DATABASE_URL=postgresql://gaming:${password}@127.0.0.1:55432/gaming_control\nJWT_SECRET=${randomBytes(48).toString("hex")}\nAPI_HOST=127.0.0.1\nAPI_PORT=3001\nCORS_ORIGIN=http://localhost:5173\nADMIN_EMAIL=admin@gaming.local\nADMIN_PASSWORD=${randomBytes(20).toString("hex")}\nBUSINESS_NAME=Gaming Control\nTIMEZONE=America/Lima\n`,
  );
}
const match = fs.readFileSync(".env", "utf8").match(/^DATABASE_URL=(.+)$/m);
const url = new URL(match?.[1]?.trim() ?? "");
if (
  url.hostname !== "127.0.0.1" ||
  url.port !== "55432" ||
  url.username !== "gaming" ||
  url.pathname !== "/gaming_control"
) {
  throw new Error(
    "Este script solo configura gaming@127.0.0.1:55432/gaming_control. Para otra base sigue docs/setup.md. No se cambió .env.",
  );
}
fs.writeFileSync(".local/db-password", decodeURIComponent(url.password));
console.log("Configuración local lista; secretos guardados en .env.");
