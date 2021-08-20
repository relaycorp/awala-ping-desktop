import * as importCommand from './importPublic';

import { Argv } from 'yargs';

export const command = 'third-party-endpoints';

export const description = 'Manage third-party endpoints';

export function builder(yargs: Argv): Argv {
  return yargs
    .command([importCommand] as any)
    .demandCommand()
    .help();
}
