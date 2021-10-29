import { PrivateKey, PublicKey } from '@relaycorp/keystore-db';
import {
  generateIdentityKeyPairSet,
  generatePDACertificationPath,
  NodeKeyPairSet,
  PDACertPath,
} from '@relaycorp/relaynet-testing';
import bufferToArray from 'buffer-to-arraybuffer';
import { Paths } from 'env-paths';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import pino from 'pino';
import split2 from 'split2';
import { Container, Token } from 'typedi';
import { Connection, createConnection } from 'typeorm';

import { BASE_DB_OPTIONS } from './bootstrap';
import { APP_DIRS, LOGGER } from './tokens';

export const SERVICE_MESSAGE_TYPE = 'text/foo';
export const SERVICE_MESSAGE_CONTENT = Buffer.from('the content');

const IS_TYPESCRIPT = __filename.endsWith('.ts');

// tslint:disable-next-line:readonly-array
export function mockSpy<T, Y extends any[]>(
  spy: jest.MockInstance<T, Y>,
  mockImplementation?: (...args: readonly any[]) => any,
): jest.MockInstance<T, Y> {
  beforeEach(() => {
    spy.mockReset();
    if (mockImplementation) {
      spy.mockImplementation(mockImplementation);
    }
  });

  afterAll(() => {
    spy.mockRestore();
  });

  return spy;
}

export function mockToken<T>(token: Token<T>): void {
  let originalValue: T;

  beforeAll(() => {
    if (Container.has(token)) {
      originalValue = Container.get(token);
    }
  });

  const restoreOriginalValue = () => {
    if (!Container.has(token)) {
      return;
    }
    if (originalValue === undefined) {
      Container.remove(token);
    } else {
      Container.set(token, originalValue);
    }
  };
  beforeEach(restoreOriginalValue);
  afterAll(restoreOriginalValue);
}

export function useTemporaryAppDirs(): () => Paths {
  mockToken(APP_DIRS);

  let tempDir: string;
  let tempAppDirs: Paths;
  beforeAll(async () => {
    tempDir = await fs.mkdtemp(join(tmpdir(), 'app-dirs'));
    tempAppDirs = {
      cache: `${tempDir}/cache`,
      config: `${tempDir}/config`,
      data: `${tempDir}/data`,
      log: `${tempDir}/log`,
      temp: `${tempDir}/temp`,
    };
  });

  beforeEach(() => {
    Container.set(APP_DIRS, tempAppDirs);
  });

  afterEach(async () => {
    await fs.rmdir(tempDir, { recursive: true });
  });

  return () => tempAppDirs;
}

export function arrayBufferFrom(value: string): ArrayBuffer {
  return bufferToArray(Buffer.from(value));
}

export function setUpPKIFixture(
  cb: (idKeyPairSet: NodeKeyPairSet, certPath: PDACertPath) => Promise<void>,
): void {
  beforeAll(async () => {
    const idKeyPairSet = await generateIdentityKeyPairSet();
    const certPath = await generatePDACertificationPath(idKeyPairSet);

    await cb(idKeyPairSet, certPath);
  });
}

export function setUpTestDBConnection(): void {
  let connection: Connection;

  beforeAll(async () => {
    const entityDirPath = join(__dirname, 'entities', '**', IS_TYPESCRIPT ? '*.ts' : '*.js');
    const connectionOptions = {
      ...BASE_DB_OPTIONS,
      database: ':memory:',
      dropSchema: true,
      entities: [entityDirPath, PublicKey, PrivateKey],
    };
    connection = await createConnection(connectionOptions as any);
  });

  beforeEach(async () => {
    await connection.synchronize(true);
  });

  afterEach(async () => {
    await connection.dropDatabase();
  });

  afterAll(async () => {
    await connection.close();
  });
}

export async function getPromiseRejection<E extends Error>(
  promise: Promise<any>,
  expectedErrorClass: new () => E,
): Promise<E> {
  try {
    await promise;
  } catch (error) {
    if (!(error instanceof expectedErrorClass)) {
      throw new Error(`"${error}" does not extend ${expectedErrorClass.name}`);
    }
    return error;
  }
  throw new Error('Expected project to reject');
}

export async function asyncIterableToArray<T>(iterable: AsyncIterable<T>): Promise<readonly T[]> {
  // tslint:disable-next-line:readonly-array
  const values = [];
  for await (const item of iterable) {
    values.push(item);
  }
  return values;
}

export async function* arrayToAsyncIterable<T>(array: readonly T[]): AsyncIterable<T> {
  for (const item of array) {
    yield item;
  }
}

//region Logging

// tslint:disable-next-line:readonly-array
export type MockLogSet = object[];

export interface MockLogging {
  readonly logger: pino.Logger;
  readonly logs: MockLogSet;
}

export function makeMockLoggingFixture(): MockLogging {
  // tslint:disable-next-line:readonly-array
  const logs: object[] = [];
  const stream = split2((data) => {
    logs.push(JSON.parse(data));
  });
  const logger = pino({ level: 'debug' }, stream);

  beforeEach(() => {
    logs.splice(0, logs.length);
  });

  return { logger, logs };
}

export function mockLoggerToken(): MockLogSet {
  const mockLogging = makeMockLoggingFixture();

  mockToken(LOGGER);

  beforeEach(() => {
    Container.set(LOGGER, mockLogging.logger);
  });

  return mockLogging.logs;
}

export function partialPinoLog(level: pino.Level, message: string, extraAttributes?: any): object {
  const levelNumber = pino.levels.values[level];
  return expect.objectContaining({
    level: levelNumber,
    msg: message,
    ...(extraAttributes && extraAttributes),
  });
}

//endregion
