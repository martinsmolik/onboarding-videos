export { ingest, parseVtt } from "./ingest.js";
export { transcribe, wordsToSegments } from "./transcribe.js";
export { changes, matchesKeywords } from "./changes.js";
export { scenarize, validateScenario, lintScenario, SYSTEM_PROMPT } from "./scenarize.js";
export { renderReview } from "./review.js";

import { ingest } from "./ingest.js";
import { transcribe, Provider } from "./transcribe.js";
import { changes } from "./changes.js";
import { scenarize, Lang, Audience } from "./scenarize.js";

/** Programmatic end-to-end run: any subset of inputs. */
export async function run(o: {
  out: string;
  youtube?: string;
  since?: string;
  keywords?: string[];
  lang: Lang;
  audience: Audience;
  title?: string;
  productNotes?: string;
  provider?: Provider;
  fakeLlm?: boolean;
}) {
  if (o.youtube) {
    const r = await ingest({ youtube: o.youtube, out: o.out });
    if (!r.transcriptFrom) await transcribe({ out: o.out, provider: o.provider, language: o.lang });
  }
  if (o.since) await changes({ since: o.since, out: o.out, keywords: o.keywords });
  return scenarize({ out: o.out, lang: o.lang, audience: o.audience, title: o.title, productNotes: o.productNotes, fakeLlm: o.fakeLlm, since: o.since });
}
