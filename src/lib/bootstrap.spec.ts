import { ENTITIES } from '@relaycorp/keystore-db';
import { PoWebClient } from '@relaycorp/relaynet-poweb';
import envPaths, { Paths } from 'env-paths';
import { promises as fs } from 'fs';
import { join } from 'path';
import pino from 'pino';
import { PassThrough } from 'stream';
import { Container } from 'typedi';
import { DataSourceOptions } from 'typeorm';

import { generateAppDirs, makeTemporaryDir, mockSpy, mockToken } from './_test_utils';
import { bootstrap } from './bootstrap';
import * as maintenance from './maintenance';
import { APP_DIRS, DATA_SOURCE, GSC_CLIENT, LOGGER } from './tokens';

mockToken(APP_DIRS);
mockToken(LOGGER);

afterEach(async () => {
  const dataSource = Container.get(DATA_SOURCE);
  await dataSource.destroy();
});

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

const mockRunMaintenance = mockSpy(jest.spyOn(maintenance, 'runMaintenance'));

describe('bootstrap', () => {
  test('GSC client should be initialized', async () => {
    const initSpy = jest.spyOn(PoWebClient, 'initLocal');

    await bootstrap();

    expect(Container.get(GSC_CLIENT)).toBeInstanceOf(PoWebClient);
    expect(initSpy).toBeCalledWith(13276);
  });

  test('Data source should be established', async () => {
    await bootstrap();

    const entitiesDir = __filename.endsWith('.ts')
      ? join(__dirname, 'entities', '**', '*.ts')
      : join(__dirname, 'entities', '**', '*.js');
    const dbPath = join(mockPaths.data, 'db.sqlite');
    const dataSource = Container.get(DATA_SOURCE);
    expect(dataSource.isInitialized).toBeTrue();
    expect(dataSource.options).toMatchObject<Partial<DataSourceOptions>>({
      database: dbPath,
      entities: [entitiesDir, ...ENTITIES],
      logging: false,
      synchronize: true,
      type: 'sqlite',
    });
  });

  test('Maintenance routine should be run', async () => {
    await bootstrap();

    expect(mockRunMaintenance).toBeCalled();
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
