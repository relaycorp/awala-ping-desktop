#!/usr/bin/env node

// tslint:disable:no-console

// tslint:disable-next-line:no-var-requires
require('make-promises-safe');

import { Argv, commandDir } from 'yargs';

const IS_TYPESCRIPT = __filename.endsWith('.ts');

// tslint:disable-next-line:no-unused-expression
commandDir('commands', { extensions: IS_TYPESCRIPT ? ['ts'] : ['js'] })
  .demandCommand()
  .fail((msg, err, yargs: Argv) => {
    console.error(err ? `${err.constructor.name}: ${err.message}` : msg);
    console.error();
    console.error(yargs.help());
    process.exit(1);
  })
  .strict()
  .help().argv;
