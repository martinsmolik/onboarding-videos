import path from "node:path";
import { args, writeJson } from "./_lib.mjs";
const a = args();
const videoId = "STUB" + Math.random().toString(36).slice(2, 9);
writeJson(path.join(a.out, "upload.json"), { videoId, url: `https://youtu.be/${videoId}`, captionsUploaded: false, stub: true });
console.log(`[stub upload] https://youtu.be/${videoId}`);
