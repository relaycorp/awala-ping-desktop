import pino, { Logger } from 'pino';
import split2 from 'split2';
import { Container, Token } from 'typedi';

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
