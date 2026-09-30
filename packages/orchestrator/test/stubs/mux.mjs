import fs from "node:fs";
import path from "node:path";
import { args, sleep } from "./_lib.mjs";
const a = args();
if (!fs.existsSync(path.join(a.out, "raw.webm"))) { console.error("raw.webm missing"); process.exit(2); }
await sleep(300);
fs.writeFileSync(path.join(a.out, "final.mp4"), "stub-mp4");
fs.writeFileSync(path.join(a.out, "final.srt"), "1\n00:00:00,000 --> 00:00:02,000\nStub\n");
console.log("[stub mux] final.mp4 + final.srt");
