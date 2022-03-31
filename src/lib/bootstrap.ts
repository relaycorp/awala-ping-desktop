import { ENTITIES } from '@relaycorp/keystore-db';
import { PoWebClient } from '@relaycorp/relaynet-poweb';
import envPaths from 'env-paths';
import { promises as fs } from 'fs';
import { join } from 'path';
import pino from 'pino';
import { Container } from 'typedi';
import { DataSource, DataSourceOptions } from 'typeorm';

import { APP_DIRS, DATA_SOURCE, GSC_CLIENT, LOGGER } from './tokens';

const DB_FILE_NAME = 'db.sqlite';
export const BASE_DB_OPTIONS = {
  logging: false,
  synchronize: true,
  type: 'sqlite',
};

const IS_TYPESCRIPT = __filename.endsWith('.ts');

const APP_NAME = 'AwalaPing';

export async function bootstrap(): Promise<void> {
  const logger = pino(pino.destination(2));
  Container.set(LOGGER, logger);

  const gscClient = PoWebClient.initLocal(13276);
  Container.set(GSC_CLIENT, gscClient);

  const paths = envPaths(APP_NAME, { suffix: '' });
  const neededPaths: readonly string[] = [paths.data, paths.log];
  await Promise.all(neededPaths.map((p) => fs.mkdir(p, { recursive: true })));
  Container.set(APP_DIRS, paths);

  await createDBConnection();
}

async function createDBConnection(): Promise<void> {
  const { data: dataPath } = Container.get(APP_DIRS);
  /* istanbul ignore next */
  const entityDirPath = join(__dirname, 'entities', '**', IS_TYPESCRIPT ? '*.ts' : '*.js');
  const connectionOptions = {
    ...BASE_DB_OPTIONS,
    database: join(dataPath, DB_FILE_NAME),
    entities: [entityDirPath, ...ENTITIES],
  };
  const dataSource = new DataSource(connectionOptions as DataSourceOptions);
  await dataSource.initialize();
  Container.set(DATA_SOURCE, dataSource);
}
