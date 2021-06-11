import { PrivateKey, PublicKey } from '@relaycorp/keystore-db';
import { PoWebClient } from '@relaycorp/relaynet-poweb';
import envPaths from 'env-paths';
import { promises as fs } from 'fs';
import { join } from 'path';
import pino from 'pino';
import { PassThrough } from 'stream';
import { Container } from 'typedi';
import * as typeorm from 'typeorm';

import { mockSpy, mockToken } from './_test_utils';
import { bootstrap } from './bootstrap';
import { APP_DIRS, GSC_CLIENT, LOGGER } from './tokens';

mockToken(APP_DIRS);
mockToken(LOGGER);

const mockCreateConnection = mockSpy(jest.spyOn(typeorm, 'createConnection'));

const mockMkdir = mockSpy(jest.spyOn(fs, 'mkdir'));

const PATHS = envPaths('AwalaPing', { suffix: '' });

let mockStderr: PassThrough;
beforeEach(() => {
  mockStderr = new PassThrough({ objectMode: true });
});
const mockPinoDestination = mockSpy(jest.spyOn(pino, 'destination'), () => mockStderr);

describe('bootstrap', () => {
  test('GSC client should be initialized', async () => {
    const initSpy = jest.spyOn(PoWebClient, 'initLocal');

    await bootstrap();

    expect(Container.get(GSC_CLIENT)).toBeInstanceOf(PoWebClient);
    expect(initSpy).toBeCalledWith(13276);
  });

  test('DB connection should be established', async () => {
    const originalConnectionOptions = await typeorm.getConnectionOptions();

    await bootstrap();

    const entitiesDir = __filename.endsWith('.ts')
      ? join(__dirname, 'entities', '**', '*.ts')
      : join(__dirname, 'entities', '**', '*.js');
    const dbPath = join(PATHS.data, 'db.sqlite');
    expect(mockCreateConnection).toBeCalledWith({
      ...originalConnectionOptions,
      database: dbPath,
      entities: [entitiesDir, PrivateKey, PublicKey],
    });
  });

  describe('Logging', () => {
    test('LOGGER token should be registered', async () => {
      expect(Container.has(LOGGER)).toBeFalse();

      await bootstrap();

      expect(Container.has(LOGGER)).toBeTrue();
    });

    test('Logs should be sent to stderr', async (cb) => {
      const message = 'Hello world';

      await bootstrap();

      expect(mockPinoDestination).toBeCalledWith(2);
      mockStderr.once('data', (data) => {
        expect(JSON.parse(data)).toHaveProperty('msg', message);
        cb();
      });
      const logger = Container.get(LOGGER);
      logger.info(message);
    });
  });

  describe('App directories', () => {
    test('Data directory should be created', async () => {
      await bootstrap();

      expect(mockMkdir).toBeCalledWith(PATHS.data, { recursive: true });
    });

    test('APP_DIRS token should be registered', async () => {
      expect(Container.has(APP_DIRS)).toBeFalse();

      await bootstrap();

      expect(Container.get(APP_DIRS)).toEqual(PATHS);
    });
  });
});
