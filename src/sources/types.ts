import type { Ticket } from '../core/types.ts';

/**
 * A place bug tickets come from.
 *
 * Everything downstream of fetch() works on the normalized Ticket, so adding
 * Jira or Linear means implementing this interface and nothing else.
 */
export interface TicketSource {
  readonly name: string;

  /** Whether this source recognises the given reference. */
  handles(ref: string): boolean;

  /** Load and normalize a ticket. */
  fetch(ref: string): Promise<Ticket>;

  /** Post evidence back to the ticket. Optional: local files have nowhere to post. */
  comment?(ticket: Ticket, markdown: string): Promise<{ url: string | null }>;
}
