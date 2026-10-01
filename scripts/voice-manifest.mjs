#!/usr/bin/env node
// pnpm voice:manifest <recipe.json> [--id <id>]
// Writes out/<id>/audio/manifest.json (step id, tts_text = narration_tts ?? narration, subtitle, expected
// file name, status) and creates the empty audio/ + audio/alignment/ dirs. Voice ONLY `tts_text`; a clip is
// "stale" when tts_text changed after it was accepted (a subtitle-only edit never invalidates audio). Nothing is synthesized: this is the to-do list Claude uses to
// generate the voiceover with the ElevenLabs connector (files: out/<id>/audio/<stepId>.mp3).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const userCwd = process.env.INIT_CWD || process.cwd();
const argv = process.argv.slice(2).filter((a) => a !== '--');
const recipeArg = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--id');
const idIdx = argv.indexOf('--id');
if (!recipeArg) { console.error('usage: pnpm voice:manifest <recipe.json> [--id <id>]'); process.exit(1); }
const recipePath = path.resolve(userCwd, recipeArg);
let recipe;
try { recipe = JSON.parse(fs.readFileSync(recipePath, 'utf8')); } catch (e) { console.error(`cannot read ${recipeArg}: ${e.message}`); process.exit(1); }
const id = idIdx >= 0 && argv[idIdx + 1] ? argv[idIdx + 1] : recipe.id;
const outDir = path.join(path.resolve(process.env.SVP_OUT_DIR || path.join(root, 'out')), id);
fs.mkdirSync(path.join(outDir, 'audio', 'alignment'), { recursive: true });
if (recipe.voice?.provider && recipe.voice.provider !== 'external') console.log(`note: recipe voice.provider is "${recipe.voice.provider}" – the manifest is only used with provider external`);
const differ = (recipe.steps || []).filter((s) => (s.narration_tts ?? s.narration ?? '').trim() !== (s.subtitle ?? s.narration ?? '').trim());
if (differ.length) console.log(`note: ${differ.length} step(s) speak a different text (tts_text) than the subtitle shows: ${differ.map((s) => s.id).join(', ')} – voice tts_text only`);
const r = spawnSync('pnpm', ['-s', '--filter', '@svp/assembler', 'start', '--', 'manifest', '--recipe', recipePath, '--out', outDir], { cwd: root, stdio: 'inherit', env: process.env });
process.exit(r.status ?? 1);
