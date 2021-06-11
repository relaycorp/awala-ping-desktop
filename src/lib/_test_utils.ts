import { PrivateKey, PublicKey } from '@relaycorp/keystore-db';
import {
  generateNodeKeyPairSet,
  generatePDACertificationPath,
  NodeKeyPairSet,
  PDACertPath,
} from '@relaycorp/relaynet-testing';
import bufferToArray from 'buffer-to-arraybuffer';
import { join } from 'path';
import pino, { Logger } from 'pino';
import split2 from 'split2';
import { Container, Token } from 'typedi';
import { Connection, createConnection, getConnectionOptions } from 'typeorm';

const IS_TYPESCRIPT = __filename.endsWith('.ts');

// tslint:disable-next-line:readonly-array
export type MockLogSet = object[];

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

export interface MockLogging {
  readonly logger: Logger;
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

export function arrayBufferFrom(value: string): ArrayBuffer {
  return bufferToArray(Buffer.from(value));
}

export function setUpPKIFixture(
  cb: (keyPairSet: NodeKeyPairSet, certPath: PDACertPath) => void,
): void {
  beforeAll(async () => {
    const keyPairSet = await generateNodeKeyPairSet();
    const certPath = await generatePDACertificationPath(keyPairSet);

    cb(keyPairSet, certPath);
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
