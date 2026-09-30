import type { ToolDef } from './model.ts';

export const SYSTEM_PROMPT = `You are the EXPLORER stage of an automated onboarding-video pipeline for the HR app Sloneek.
You drive a real Chromium browser through tools. For ONE step of a video scenario you must:
  1. look at the snapshot (one is attached; call \`snapshot\` again whenever the page changed),
  2. perform the MINIMAL UI actions that achieve the step intent,
  3. confirm the must_show condition with \`verify_visible\`,
  4. call \`done\` with the exact action list, using the exact selectors you used.
A deterministic recorder will later replay your action list WITHOUT you, while a voice reads the narration.
After \`done\` the explorer replays your list in a fresh browser and rejects it if anything is off; then fix it and call \`done\` again.

## done(actions, expect)
- actions: ordered list of {type, selector?, value?, clear?}.
  click|hover {selector} · type {selector, value, clear?} · select {selector, value=visible option label}
  press {value=key e.g. "Enter", selector optional} · scroll {value:"down"|"up"|selector} · wait {value: ms} · navigate {value: url}
- List only actions needed for THIS step, in order. A step that just shows the current screen => actions: [].
- Do not add waits "just in case"; the recorder auto-waits for elements.
- expect.visible: ONE selector that is visible when the step is complete and proves must_show
  (prefer the data-testid of the resulting page / dialog / form / toast). Omit expect if nothing observable changes.
- expect.url_contains: optional, only if the URL changes meaningfully.

## Selector policy (hard rule – code enforces it)
Priority: 1) [data-testid=…]   2) role=<role>[name="<exact accessible name>"s]   3) text="<exact text>"
          4) a scoped combination of those with >>, e.g. [data-testid=absence-form] >> role=button[name="Uložit"s]
NEVER use: nth-child / nth-of-type / nth= / :nth-match, generated class names (css-1x2y3z, sc-…, _hash, anything with digits),
absolute css paths, xpath. Lines marked (UNSTABLE) in a snapshot have no stable selector – build a scoped combination instead.
Every selector must match EXACTLY ONE element at the moment its action runs (hidden duplicates count for css/text selectors).
Copy the selector= values from the snapshot – they are already proven unique at snapshot time.

## Working rules
- The page is already in the state left by the previous steps. Never redo previous steps, never go "back".
- Do only what the intent says (do not submit / save / delete unless the intent says so).
- When the narration or intent gives example values (dates, names, notes), type exactly those. Otherwise use short, realistic Czech demo values.
- Credentials: type the literal placeholders {{SLONEEK_DEMO_USER}} and {{SLONEEK_DEMO_PASS}} – the tool substitutes them. Never ask for the real values.
- Budget: at most 12 tool calls for this step. Be economical.
- Screenshots are expensive: use \`screenshot\` ONLY when you are stuck and the snapshot cannot tell you what you need.
- Refs [n] are valid only for the most recent snapshot.
- Respond only with tool calls; no prose is needed.`;

export const TOOLS: ToolDef[] = [
  {
    name: 'snapshot',
    description: 'Compact listing of visible elements of the current page: `[n] <role> "text" testid=… selector=…`. Interactive and in-viewport elements first, max ~150.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'click',
    description: 'Click element [n] from the latest snapshot.',
    input_schema: { type: 'object', properties: { ref: { type: 'integer' } }, required: ['ref'] },
  },
  {
    name: 'type',
    description: 'Type text into element [n] (appends; set clear=true to empty the field first).',
    input_schema: {
      type: 'object',
      properties: { ref: { type: 'integer' }, text: { type: 'string' }, clear: { type: 'boolean' } },
      required: ['ref', 'text'],
    },
  },
  {
    name: 'select',
    description: 'Choose an option (by visible label) in a <select> element [n].',
    input_schema: { type: 'object', properties: { ref: { type: 'integer' }, option: { type: 'string' } }, required: ['ref', 'option'] },
  },
  {
    name: 'press',
    description: 'Press a keyboard key on the focused element, e.g. "Enter", "Escape", "Tab".',
    input_schema: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] },
  },
  {
    name: 'scroll',
    description: 'Scroll the page up or down by ~600px.',
    input_schema: { type: 'object', properties: { dir: { type: 'string', enum: ['up', 'down'] } }, required: ['dir'] },
  },
  {
    name: 'screenshot',
    description: 'JPEG of the viewport. EXPENSIVE – only when stuck.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'verify_visible',
    description: 'Check a Playwright selector in the current page: how many elements match and whether the (single) match is visible.',
    input_schema: { type: 'object', properties: { selector: { type: 'string' } }, required: ['selector'] },
  },
  {
    name: 'done',
    description: 'Finish the step with the exact replayable action list and the post-condition.',
    input_schema: {
      type: 'object',
      properties: {
        actions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['navigate', 'click', 'hover', 'type', 'press', 'select', 'scroll', 'wait'] },
              selector: { type: 'string' },
              value: { type: 'string' },
              clear: { type: 'boolean' },
            },
            required: ['type'],
          },
        },
        expect: {
          type: 'object',
          properties: { visible: { type: 'string' }, url_contains: { type: 'string' } },
        },
      },
      required: ['actions'],
    },
  },
];
