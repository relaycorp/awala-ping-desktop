import { PrivateKey, PublicKey } from '@relaycorp/keystore-db';
import {
  generateNodeKeyPairSet,
  generatePDACertificationPath,
  NodeKeyPairSet,
  PDACertPath,
} from '@relaycorp/relaynet-testing';
import bufferToArray from 'buffer-to-arraybuffer';
import { Paths } from 'env-paths';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Container, Token } from 'typedi';
import { Connection, createConnection, getConnectionOptions } from 'typeorm';

import { APP_DIRS } from './tokens';

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
  cb: (keyPairSet: NodeKeyPairSet, certPath: PDACertPath) => Promise<void>,
): void {
  beforeAll(async () => {
    const keyPairSet = await generateNodeKeyPairSet();
    const certPath = await generatePDACertificationPath(keyPairSet);

    await cb(keyPairSet, certPath);
  });
}

export function setUpTestDBConnection(): void {
  let connection: Connection;

  beforeAll(async () => {
    const originalConnectionOptions = await getConnectionOptions();

    const entityDirPath = join(__dirname, 'entities', '**', IS_TYPESCRIPT ? '*.ts' : '*.js');
    const connectionOptions = {
      ...originalConnectionOptions,
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
