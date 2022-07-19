import { getPrivateAddressFromIdentityKey, MockKeyStoreSet } from '@relaycorp/relaynet-core';
import {
  generateIdentityKeyPairSet,
  generatePDACertificationPath,
  NodeKeyPairSet,
  PDACertPath,
} from '@relaycorp/relaynet-testing';

import { PublicEndpointChannel } from './PublicEndpointChannel';

const MOCK_STORES = new MockKeyStoreSet();
beforeEach(() => {
  MOCK_STORES.clear();
});

let keyPairSet: NodeKeyPairSet;
let pdaChain: PDACertPath;
let peerPrivateAddress: string;
beforeAll(async () => {
  keyPairSet = await generateIdentityKeyPairSet();
  pdaChain = await generatePDACertificationPath(keyPairSet);
  peerPrivateAddress = await getPrivateAddressFromIdentityKey(keyPairSet.pdaGrantee.publicKey);
});

const PEER_PUBLIC_ADDRESS = 'the-endpoint.com';

describe('constructor', () => {
  test('Parent class constructor should be called correctly', async () => {
    const cryptoOptions = { encryption: { aesKeySize: 512 } };

    const channel = new PublicEndpointChannel(
      keyPairSet.privateEndpoint.privateKey,
      pdaChain.privateEndpoint,
      peerPrivateAddress,
      PEER_PUBLIC_ADDRESS,
      keyPairSet.pdaGrantee.publicKey,
      MOCK_STORES,
      cryptoOptions,
    );

    expect(channel.nodeDeliveryAuth.isEqual(pdaChain.privateEndpoint)).toBeTrue();
    expect(channel.peerPrivateAddress).toEqual(peerPrivateAddress);
    expect(channel.peerPublicKey).toBe(keyPairSet.pdaGrantee.publicKey);
    expect(channel.cryptoOptions).toEqual(cryptoOptions);
  });

  test('Crypto options should be empty by default', async () => {
    const channel = new PublicEndpointChannel(
      keyPairSet.privateEndpoint.privateKey,
      pdaChain.privateEndpoint,
      peerPrivateAddress,
      PEER_PUBLIC_ADDRESS,
      keyPairSet.pdaGrantee.publicKey,
      MOCK_STORES,
    );

    expect(channel.cryptoOptions).toEqual({});
  });
});

describe('getOutboundRAMFAddress', () => {
  test('Public address should be returned', async () => {
    const channel = new PublicEndpointChannel(
      keyPairSet.privateEndpoint.privateKey,
      pdaChain.privateEndpoint,
      peerPrivateAddress,
      PEER_PUBLIC_ADDRESS,
      keyPairSet.pdaGrantee.publicKey,
      MOCK_STORES,
    );

    await expect(channel.getOutboundRAMFAddress()).resolves.toEqual(
      `https://${PEER_PUBLIC_ADDRESS}`,
    );
  });
});
