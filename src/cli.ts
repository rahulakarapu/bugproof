#!/usr/bin/env node
import { Command } from 'commander';
import { commitCommand } from './commands/commit.ts';
import { evidenceCommand } from './commands/evidence.ts';
import { fetchCommand } from './commands/fetch.ts';
import { scaffoldCommand } from './commands/scaffold.ts';
import { bugsCommand, listTicketsCommand, statusCommand } from './commands/status.ts';
import { verifyCommand } from './commands/verify.ts';
import { fatal } from './util/log.ts';

const program = new Command();

program
  .name('bugproof')
  .description('Turn bug tickets into verified Playwright regression guards.')
  .version('0.1.0');

program
  .command('fetch')
  .description('Load a bug ticket and normalize its repro steps')
  .argument('<ref>', 'issue number, issue URL, or local ticket name')
  .option('-s, --source <name>', 'force a ticket source (github, local)')
  .action(async (ref: string, options: { source?: string }) => {
    await fetchCommand(ref, options);
  });

program
  .command('scaffold')
  .description('Generate the regression spec skeleton for a fetched ticket')
  .argument('<ticketId>', 'ticket id from fetch, e.g. gh-12 or tax-rounding')
  .option('-f, --force', 'overwrite an existing spec')
  .action(async (ticketId: string, options: { force?: boolean }) => {
    await scaffoldCommand(ticketId, options);
  });

program
  .command('verify')
  .description('Run the red/green/guard cycle and judge whether the bug is proven')
  .argument('<ticketId>')
  .option('-p, --phase <phase>', 'red, green, guard, or all', 'all')
  .option('--arm <bugs>', 'override armed defects (comma separated, empty string for none)')
  .option('--keep-going', 'run later phases even after one fails its requirement')
  .action(
    async (
      ticketId: string,
      options: { phase: string; arm?: string; keepGoing?: boolean },
    ) => {
      const journal = await verifyCommand(ticketId, options);
      // Non-zero exit lets CI gate on certification.
      if (!journal.certified && options.phase === 'all') process.exitCode = 1;
    },
  );

program
  .command('evidence')
  .description('Render the trace/screenshot evidence report, optionally posting it to the ticket')
  .argument('<ticketId>')
  .option('--post', 'publish the report as a ticket comment')
  .action(async (ticketId: string, options: { post?: boolean }) => {
    await evidenceCommand(ticketId, options);
  });

program
  .command('commit')
  .description('Commit the certified spec as a permanent regression guard')
  .argument('<ticketId>')
  .option('-f, --force', 'commit even if the cycle is not certified')
  .action(async (ticketId: string, options: { force?: boolean }) => {
    await commitCommand(ticketId, options);
  });

program
  .command('status')
  .description('Show the recorded cycle for a ticket')
  .argument('<ticketId>')
  .action(async (ticketId: string) => {
    await statusCommand(ticketId);
  });

program.command('list').description('List fetched tickets and their cycle state').action(listTicketsCommand);

program.command('bugs').description('List the seeded defects in the demo app').action(bugsCommand);

async function main(): Promise<void> {
  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    fatal(error instanceof Error ? error.message : String(error));
  }
}

await main();
