import fs from "node:fs";
import path from "node:path";
import { outRoot, readJson, writeJsonAtomic, now, sleep } from "./util.ts";

export const hasYtCreds = () => !!(process.env.YT_CLIENT_ID && process.env.YT_CLIENT_SECRET && process.env.YT_REFRESH_TOKEN);

export interface UploadResult { videoId: string; url: string; captionsUploaded: boolean; replaced?: string }
type Log = (m: string) => void;

export async function accessToken(): Promise<string> {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.YT_CLIENT_ID!,
      client_secret: process.env.YT_CLIENT_SECRET!,
      refresh_token: process.env.YT_REFRESH_TOKEN!,
      grant_type: "refresh_token",
    }),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) {
    const hint = j.error === "invalid_grant"
      ? " (refresh token revoked/expired – OAuth consent screen in 'Testing' expires tokens after 7 days; re-run scripts/yt-oauth.mjs)"
      : "";
    throw new Error(`OAuth token exchange failed: ${r.status} ${JSON.stringify(j)}${hint}`);
  }
  return j.access_token;
}

export function buildMetadata(out: string, recipeId: string) {
  const recipe = fs.existsSync(path.join(out, "recipe.json")) ? readJson(path.join(out, "recipe.json")) : {};
  const title = String(recipe.title || recipeId).slice(0, 100);
  const date = new Date().toISOString().slice(0, 10);
  const description = [
    recipe.title ? `${recipe.title}` : recipeId,
    "",
    "Automaticky generované onboardingové video Sloneek.",
    "",
    `recipe: ${recipe.id ?? recipeId}`,
    `version: ${recipe.version ?? "?"}`,
    `app_version: ${recipe.app_version ?? "?"}`,
    `generated: ${date}`,
  ].join("\n").slice(0, 4900);
  return {
    snippet: {
      title,
      description,
      tags: ["Sloneek", "onboarding", "HR", String(recipe.id ?? recipeId)],
      defaultLanguage: recipe.lang,
      defaultAudioLanguage: recipe.lang,
      categoryId: "27", // Education
    },
    status: {
      privacyStatus: process.env.YT_PRIVACY || "unlisted",
      selfDeclaredMadeForKids: false,
    },
  };
}

async function api(token: string, url: string, init: RequestInit = {}) {
  const r = await fetch(url, { ...init, headers: { authorization: `Bearer ${token}`, ...(init.headers as any) } });
  const text = await r.text();
  let json: any; try { json = JSON.parse(text); } catch { json = text; }
  if (!r.ok) throw new Error(`YouTube API ${r.status} ${url.split("?")[0]}: ${typeof json === "string" ? json : JSON.stringify(json.error ?? json)}`);
  return json;
}

async function uploadVideo(token: string, file: string, meta: object, log: Log): Promise<string> {
  const size = fs.statSync(file).size;
  const init = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json; charset=UTF-8",
      "x-upload-content-length": String(size),
      "x-upload-content-type": "video/mp4",
    },
    body: JSON.stringify(meta),
  });
  if (!init.ok) throw new Error(`resumable init failed ${init.status}: ${await init.text()}`);
  const loc = init.headers.get("location");
  if (!loc) throw new Error("resumable init returned no Location header");
  log(`upload session opened, sending ${(size / 1e6).toFixed(1)} MB`);
  const bytes = fs.readFileSync(file);
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      // The session URL is reusable: a whole-file PUT restarts the upload. (Chunked resume omitted – files are a few MB.)
      const r = await fetch(loc, { method: "PUT", headers: { "content-type": "video/mp4", "content-length": String(size) }, body: bytes });
      if (r.ok) {
        const j: any = await r.json();
        if (!j.id) throw new Error("upload finished but response has no video id: " + JSON.stringify(j));
        return j.id;
      }
      if (r.status < 500) throw Object.assign(new Error(`upload PUT failed ${r.status}: ${await r.text()}`), { fatal: true });
      lastErr = new Error(`upload PUT ${r.status}`);
    } catch (e: any) {
      if (e.fatal) throw e;
      lastErr = e;
    }
    log(`upload attempt ${attempt} failed (${(lastErr as Error).message}), retrying`);
    await sleep(2000 * attempt);
  }
  throw lastErr;
}

async function uploadCaptions(token: string, videoId: string, srt: string, lang: string, log: Log): Promise<boolean> {
  try {
    const boundary = "svp" + Math.random().toString(36).slice(2);
    const metadata = JSON.stringify({ snippet: { videoId, language: lang, name: "Titulky", isDraft: false } });
    const body =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
      `--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n${fs.readFileSync(srt, "utf8")}\r\n--${boundary}--`;
    await api(token, "https://www.googleapis.com/upload/youtube/v3/captions?uploadType=multipart&part=snippet", {
      method: "POST",
      headers: { "content-type": `multipart/related; boundary=${boundary}` },
      body,
    });
    log("captions uploaded");
    return true;
  } catch (e: any) {
    log(`captions upload skipped: ${e.message}`);
    return false;
  }
}

/**
 * YouTube cannot replace the media of an existing video (videos.update is metadata-only).
 * So "replace" = upload new + make old private + record the mapping so the portal can swap the link.
 */
async function retireOld(token: string, oldId: string, newId: string, log: Log): Promise<void> {
  const cur = await api(token, `https://www.googleapis.com/youtube/v3/videos?part=status,snippet&id=${oldId}`);
  const item = cur.items?.[0];
  if (!item) { log(`old video ${oldId} not found – nothing to retire`); return; }
  // videos.update deletes unspecified mutable fields of the part, so resend the current status with privacy changed.
  await api(token, "https://www.googleapis.com/youtube/v3/videos?part=status", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: oldId, status: { ...item.status, privacyStatus: "private" } }),
  });
  log(`old video ${oldId} set to private (superseded by ${newId})`);
}

function updateMap(recipeId: string, videoId: string, replaced?: string) {
  const f = path.join(outRoot(), "video-map.json");
  const map = fs.existsSync(f) ? readJson(f) : {};
  const prev = map[recipeId];
  map[recipeId] = {
    video_id: videoId,
    url: `https://youtu.be/${videoId}`,
    updated_at: now(),
    superseded: [...(prev?.superseded ?? []), ...(prev?.video_id && prev.video_id !== videoId ? [prev.video_id] : []), ...(replaced && replaced !== prev?.video_id ? [replaced] : [])],
  };
  writeJsonAtomic(f, map);
}

export async function uploadVideoStage(id: string, out: string, opts: { replace?: string }, log: Log = console.log): Promise<UploadResult> {
  if (!hasYtCreds()) throw new Error("missing YT_CLIENT_ID / YT_CLIENT_SECRET / YT_REFRESH_TOKEN (run scripts/yt-oauth.mjs once)");
  const file = path.join(out, "final.mp4");
  if (!fs.existsSync(file)) throw new Error(`${file} not found – run mux first`);
  const token = await accessToken();
  const meta = buildMetadata(out, id);
  const videoId = await uploadVideo(token, file, meta, log);
  log(`uploaded: https://youtu.be/${videoId} (${meta.status.privacyStatus})`);
  const srt = path.join(out, "final.srt");
  const captionsUploaded = fs.existsSync(srt) ? await uploadCaptions(token, videoId, srt, (meta.snippet.defaultLanguage as string) || "cs", log) : false;
  if (opts.replace && opts.replace !== videoId) {
    try { await retireOld(token, opts.replace, videoId, log); } catch (e: any) { log(`could not retire old video: ${e.message}`); }
  }
  updateMap(id, videoId, opts.replace);
  const res: UploadResult = { videoId, url: `https://youtu.be/${videoId}`, captionsUploaded, replaced: opts.replace };
  writeJsonAtomic(path.join(out, "upload.json"), { ...res, privacy: meta.status.privacyStatus, uploaded_at: now() });
  return res;
}
