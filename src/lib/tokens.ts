import { GSCClient } from '@relaycorp/relaynet-core';
import { Paths } from 'env-paths';
import { P as pino } from 'pino';
import { Token } from 'typedi';

export const APP_DIRS = new Token<Paths>('APP_DIRS');

export const LOGGER = new Token<pino.Logger>('LOGGER');

export const GSC_CLIENT = new Token<GSCClient>('GSC_CLIENT');
