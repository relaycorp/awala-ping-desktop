import { PrivateKey, PublicKey } from '@relaycorp/keystore-db';
import { PoWebClient } from '@relaycorp/relaynet-poweb';
import envPaths, { Paths } from 'env-paths';
import { promises as fs } from 'fs';
import { join } from 'path';
import pino from 'pino';
import { PassThrough } from 'stream';
import { Container } from 'typedi';
import { ConnectionOptions, getConnection } from 'typeorm';

import { generateAppDirs, makeTemporaryDir, mockSpy, mockToken } from './_test_utils';
import { bootstrap } from './bootstrap';
import { APP_DIRS, GSC_CLIENT, LOGGER } from './tokens';

mockToken(APP_DIRS);
mockToken(LOGGER);

const mockMkdir = mockSpy(jest.spyOn(fs, 'mkdir'));

let mockPaths: Paths;
const getTemporaryDirPath = makeTemporaryDir();
beforeAll(async () => {
  mockPaths = generateAppDirs(getTemporaryDirPath());
});
jest.mock('env-paths', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => mockPaths),
  };
});

let mockStderr: PassThrough;
beforeEach(() => {
  mockStderr = new PassThrough({ objectMode: true });
});
const mockPinoDestination = mockSpy(jest.spyOn(pino, 'destination'), () => mockStderr);

afterEach(async () => {
  await getConnection().close();
});

describe('bootstrap', () => {
  test('GSC client should be initialized', async () => {
    const initSpy = jest.spyOn(PoWebClient, 'initLocal');

    await bootstrap();

    expect(Container.get(GSC_CLIENT)).toBeInstanceOf(PoWebClient);
    expect(initSpy).toBeCalledWith(13276);
  });

  test('DB connection should be established', async () => {
    expect(getConnection().isConnected).toBeFalse();

    await bootstrap();

    const entitiesDir = __filename.endsWith('.ts')
      ? join(__dirname, 'entities', '**', '*.ts')
      : join(__dirname, 'entities', '**', '*.js');
    const dbPath = join(mockPaths.data, 'db.sqlite');
    const connection = getConnection();
    expect(connection.isConnected).toBeTrue();
    expect(connection.options).toMatchObject<Partial<ConnectionOptions>>({
      database: dbPath,
      entities: [entitiesDir, PrivateKey, PublicKey],
      logging: false,
      synchronize: true,
      type: 'sqlite',
    });
  });

  describe('Logging', () => {
    test('LOGGER token should be registered', async () => {
      expect(Container.has(LOGGER)).toBeFalse();

      await bootstrap();

      expect(Container.has(LOGGER)).toBeTrue();
    });

    test('Logs should be sent to stderr', async () => {
      const message = 'Hello world';

      setImmediate(() => {
        const logger = Container.get(LOGGER);
        logger.info(message);
      });
      const [, stderrData] = await Promise.all([
        bootstrap(),
        new Promise((resolve) => {
          mockStderr.once('data', resolve);
        }),
      ]);

      expect(mockPinoDestination).toBeCalledWith(2);
      expect(JSON.parse(stderrData as string)).toHaveProperty('msg', message);
    });
  });

  describe('App directories', () => {
    test('App name should be part of the paths', async () => {
      await bootstrap();

      expect(envPaths).toBeCalledWith('AwalaPing', { suffix: '' });
    });

    test('Data directory should be created', async () => {
      await bootstrap();

      expect(mockMkdir).toBeCalledWith(mockPaths.data, { recursive: true });
    });

    test('APP_DIRS token should be registered', async () => {
      expect(Container.has(APP_DIRS)).toBeFalse();

      await bootstrap();

      expect(Container.get(APP_DIRS)).toEqual(mockPaths);
    });
  });
});
