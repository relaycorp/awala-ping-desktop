import { MockGSCClient, MockMethodCall } from '@relaycorp/relaynet-testing';
import { Container } from 'typedi';

import { mockToken } from '../_test_utils';
import { GSC_CLIENT } from '../tokens';

// tslint:disable-next-line:readonly-array
export function mockGSCClient(): (...calls: MockMethodCall<any, any>[]) => void {
  mockToken(GSC_CLIENT);

  afterEach(() => {
    if (Container.has(GSC_CLIENT)) {
      const mockGscClient = Container.get(GSC_CLIENT) as MockGSCClient;
      expect(mockGscClient.callsRemaining).toEqual(0);
    }
  });

  return (...calls) => {
    const mockGscClient = new MockGSCClient(calls);
    Container.set(GSC_CLIENT, mockGscClient);
  };
}
