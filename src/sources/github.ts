import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseReproPlan } from '../core/ticket.ts';
import type { Ticket } from '../core/types.ts';
import { commandExists, run } from '../util/exec.ts';
import { ensureDir, paths } from '../util/paths.ts';
import type { TicketSource } from './types.ts';

interface GhIssue {
  number: number;
  title: string;
  body: string | null;
  url: string;
  labels?: Array<{ name: string }>;
}

const NUMERIC = /^#?(\d+)$/;
const ISSUE_URL = /^https?:\/\/github\.com\/[^/]+\/[^/]+\/issues\/(\d+)/;
const OWNER_REPO_HASH = /^([\w.-]+\/[\w.-]+)#(\d+)$/;

/** Pull the issue number and optional `owner/repo` out of any accepted reference form. */
function parseRef(ref: string): { number: string; repo: string | null } | null {
  const trimmed = ref.trim();

  const numeric = trimmed.match(NUMERIC);
  if (numeric?.[1]) return { number: numeric[1], repo: null };

  const url = trimmed.match(ISSUE_URL);
  if (url?.[1]) return { number: url[1], repo: null };

  const ownerRepo = trimmed.match(OWNER_REPO_HASH);
  if (ownerRepo?.[1] && ownerRepo[2]) return { number: ownerRepo[2], repo: ownerRepo[1] };

  return null;
}

export class GitHubTicketSource implements TicketSource {
  readonly name = 'github';

  handles(ref: string): boolean {
    return parseRef(ref) !== null;
  }

  async fetch(ref: string): Promise<Ticket> {
    const parsed = parseRef(ref);
    if (!parsed) throw new Error(`"${ref}" is not a GitHub issue reference.`);

    if (!(await commandExists('gh'))) {
      throw new Error(
        'The GitHub CLI (gh) is required for the github ticket source. Install it, then run `gh auth login`.',
      );
    }

    const args = ['issue', 'view', parsed.number, '--json', 'number,title,body,url,labels'];
    if (parsed.repo) args.push('--repo', parsed.repo);

    const result = await run('gh', args);
    if (result.code !== 0) {
      throw new Error(`gh could not read issue ${ref}: ${result.stderr.trim()}`);
    }

    const issue = JSON.parse(result.stdout) as GhIssue;
    const labels = (issue.labels ?? []).map((l) => l.name);
    const body = issue.body ?? '';

    return {
      id: `gh-${issue.number}`,
      source: this.name,
      ref: trimRef(ref),
      url: issue.url,
      title: issue.title,
      labels,
      repro: parseReproPlan(body, labels),
      fetchedAt: new Date().toISOString(),
    };
  }

  /** Body goes via a temp file so markdown never has to survive shell quoting. */
  async comment(ticket: Ticket, markdown: string): Promise<{ url: string | null }> {
    const parsed = parseRef(ticket.ref);
    if (!parsed) throw new Error(`Cannot comment on ticket ${ticket.id}: unrecognised reference.`);

    await ensureDir(paths.tmp);
    const bodyFile = join(paths.tmp, `${ticket.id}-comment.md`);
    await writeFile(bodyFile, markdown, 'utf8');

    try {
      const args = ['issue', 'comment', parsed.number, '--body-file', bodyFile];
      if (parsed.repo) args.push('--repo', parsed.repo);

      const result = await run('gh', args);
      if (result.code !== 0) {
        throw new Error(`gh could not comment on ${ticket.ref}: ${result.stderr.trim()}`);
      }
      return { url: result.stdout.trim() || ticket.url };
    } finally {
      await rm(bodyFile, { force: true });
    }
  }
}

function trimRef(ref: string): string {
  return ref.trim();
}
