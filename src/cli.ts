#!/usr/bin/env node

// tslint:disable:no-console

import 'make-promises-safe';
import 'reflect-metadata'; // Needed for TypeORM

import yargs, { Argv } from 'yargs';
// tslint:disable-next-line:no-submodule-imports
import { hideBin } from 'yargs/helpers';

import { commands } from './commands';

// tslint:disable-next-line:no-unused-expression
yargs(hideBin(process.argv))
  .command(commands as any)
  .demandCommand()
  .fail((msg, err, args: Argv) => {
    console.error(err ? `${err.constructor.name}: ${err.message}` : msg);
    console.error();
    console.error(args.help());
    process.exit(1);
  })
  .strict()
  .help().argv;
