import { getPrivateAddressFromIdentityKey, MockKeyStoreSet } from '@relaycorp/relaynet-core';
import {
  generateIdentityKeyPairSet,
  generatePDACertificationPath,
  NodeKeyPairSet,
  PDACertPath,
} from '@relaycorp/relaynet-testing';

import { PrivateEndpointChannel } from './PrivateEndpointChannel';

const MOCK_STORES = new MockKeyStoreSet();
beforeEach(() => {
  MOCK_STORES.clear();
});

let keyPairSet: NodeKeyPairSet;
let pdaChain: PDACertPath;
beforeAll(async () => {
  keyPairSet = await generateIdentityKeyPairSet();
  pdaChain = await generatePDACertificationPath(keyPairSet);
});

describe('getOutboundRAMFAddress', () => {
  test('Recipient private address should be returned', async () => {
    const peerPrivateAddress = await getPrivateAddressFromIdentityKey(
      keyPairSet.pdaGrantee.publicKey,
    );
    const channel = new PrivateEndpointChannel(
      keyPairSet.privateEndpoint.privateKey,
      pdaChain.privateEndpoint,
      peerPrivateAddress,
      keyPairSet.pdaGrantee.publicKey,
      MOCK_STORES,
    );

    await expect(channel.getOutboundRAMFAddress()).resolves.toEqual(peerPrivateAddress);
  });
});
