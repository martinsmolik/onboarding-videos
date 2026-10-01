export { tts, linearAlignment, sayArgs, sayConfig, parseSayVoices, chooseProvider, SAY_DEFAULT_VOICE, SAY_DEFAULT_RATE } from "./tts.js";
export type { TtsOptions, TtsResult, Alignment, Provider } from "./tts.js";
export { mux } from "./mux.js";
export type { MuxOptions, MuxResult } from "./mux.js";
export { splitNarration, cuesForStep, toSrt } from "./srt.js";
export { probeDurationMs } from "./util.js";
export { writeManifest, buildManifest, acceptExternal, classifyStep, parseAlignment, findExternalAudio } from "./external.js";
export type { Manifest, ManifestStep } from "./external.js";
