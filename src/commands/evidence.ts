import { renderReport, writeReportFile } from '../core/evidence.ts';
import { loadJournal } from '../core/journal.ts';
import { sourceByName } from '../sources/index.ts';
import { log } from '../util/log.ts';
import { relative } from '../util/paths.ts';
import { loadTicket } from './fetch.ts';

export async function evidenceCommand(
  ticketId: string,
  options: { post?: boolean },
): Promise<string> {
  const journal = await loadJournal(ticketId);
  if (!journal) {
    throw new Error(`No run journal for "${ticketId}". Run \`bugproof verify ${ticketId}\` first.`);
  }

  const markdown = await renderReport(journal);
  const file = await writeReportFile(journal, markdown);
  log.ok(`report written to ${relative(file)}`);

  if (!options.post) {
    log.detail('Pass --post to publish it back to the ticket.');
    return file;
  }

  const ticket = await loadTicket(ticketId);
  const source = sourceByName(ticket.source);

  if (!source.comment) {
    log.warn(`The "${source.name}" source cannot post comments; the report stays local.`);
    return file;
  }

  if (!journal.certified) {
    log.warn('Posting an incomplete cycle — the comment will say so explicitly.');
  }

  const { url } = await source.comment(ticket, markdown);
  log.ok(`posted to ${url ?? ticket.ref}`);
  return file;
}
