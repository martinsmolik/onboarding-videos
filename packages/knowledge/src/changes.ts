import { join } from "node:path";
import { log, srcDir, writeJson } from "./util.js";

export type Change = { identifier?: string; title: string; description_excerpt: string; completedAt: string; project?: string; labels: string[]; url?: string };
export type ChangesOptions = { since: string; out: string; keywords?: string[] };

const QUERY = `query($since: DateTimeOrDuration!, $after: String) {
  issues(first: 100, after: $after, filter: { completedAt: { gt: $since } }, orderBy: updatedAt) {
    pageInfo { hasNextPage endCursor }
    nodes { identifier title description completedAt url project { name } labels { nodes { name } } }
  }
}`;

function stripMd(s: string): string {
  return s.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[#>*_`]/g, "").replace(/\s+/g, " ").trim();
}
/** accent-insensitive lowercase, so "docházka" matches "Dochazka" */
export const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

export function matchesKeywords(c: Pick<Change, "title" | "description_excerpt" | "project" | "labels">, keywords: string[]): boolean {
  if (!keywords.length) return true;
  const hay = norm([c.title, c.description_excerpt, c.project ?? "", ...c.labels].join(" "));
  return keywords.some((k) => hay.includes(norm(k)));
}

export async function changes(opts: ChangesOptions): Promise<{ changes: Change[]; warnings: string[] }> {
  const warnings: string[] = [];
  const keywords = (opts.keywords ?? []).map((k) => k.trim()).filter(Boolean);
  let result: Change[] = [];
  const key = process.env.LINEAR_API_KEY;
  if (!key) {
    warnings.push("LINEAR_API_KEY missing - writing empty changes.json");
  } else {
    try {
      let after: string | null = null;
      for (let page = 0; page < 10; page++) {
        const res = await fetch("https://api.linear.app/graphql", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: key }, // personal keys: no "Bearer"
          body: JSON.stringify({ query: QUERY, variables: { since: opts.since, after } }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
        const j: any = await res.json();
        if (j.errors) throw new Error(JSON.stringify(j.errors).slice(0, 300));
        for (const n of j.data.issues.nodes) {
          const c: Change = {
            identifier: n.identifier,
            title: n.title,
            description_excerpt: stripMd(n.description ?? "").slice(0, 400),
            completedAt: n.completedAt,
            project: n.project?.name,
            labels: (n.labels?.nodes ?? []).map((l: any) => l.name),
            url: n.url,
          };
          if (matchesKeywords(c, keywords)) result.push(c);
        }
        if (!j.data.issues.pageInfo.hasNextPage) break;
        after = j.data.issues.pageInfo.endCursor;
      }
    } catch (e) {
      warnings.push(`Linear query failed: ${(e as Error).message} - writing empty changes.json`);
      result = [];
    }
  }
  warnings.forEach((w) => log("WARN", w));
  const dir = srcDir(opts.out);
  writeJson(join(dir, "changes.json"), result);
  writeJson(join(dir, "changes.meta.json"), { since: opts.since, keywords, warnings, fetched_at: new Date().toISOString() });
  return { changes: result, warnings };
}
