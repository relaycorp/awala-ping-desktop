import { getIdFromIdentityKey, MockKeyStoreSet } from '@relaycorp/relaynet-core';
import {
  generateIdentityKeyPairSet,
  generatePDACertificationPath,
  NodeKeyPairSet,
  PDACertPath,
} from '@relaycorp/relaynet-testing';

import { EndpointChannel } from './EndpointChannel';
import { PEER_INTERNET_ADDRESS } from '../_test_utils';

const MOCK_STORES = new MockKeyStoreSet();
beforeEach(() => {
  MOCK_STORES.clear();
});

let keyPairSet: NodeKeyPairSet;
let pdaChain: PDACertPath;
let peerId: string;
beforeAll(async () => {
  keyPairSet = await generateIdentityKeyPairSet();
  pdaChain = await generatePDACertificationPath(keyPairSet);
  peerId = await getIdFromIdentityKey(keyPairSet.pdaGrantee.publicKey);
});

describe('constructor', () => {
  test('Parent class constructor should be called correctly', async () => {
    const cryptoOptions = { encryption: { aesKeySize: 512 } };

    const channel = new EndpointChannel(
      keyPairSet.privateEndpoint.privateKey,
      pdaChain.privateEndpoint,
      peerId,
      PEER_INTERNET_ADDRESS,
      keyPairSet.pdaGrantee.publicKey,
      MOCK_STORES,
      cryptoOptions,
    );

    expect(channel.nodeDeliveryAuth.isEqual(pdaChain.privateEndpoint)).toBeTrue();
    expect(channel.peerId).toEqual(peerId);
    expect(channel.peerPublicKey).toBe(keyPairSet.pdaGrantee.publicKey);
    expect(channel.cryptoOptions).toEqual(cryptoOptions);
  });

  test('Crypto options should be empty by default', async () => {
    const channel = new EndpointChannel(
      keyPairSet.privateEndpoint.privateKey,
      pdaChain.privateEndpoint,
      peerId,
      PEER_INTERNET_ADDRESS,
      keyPairSet.pdaGrantee.publicKey,
      MOCK_STORES,
    );

    expect(channel.cryptoOptions).toEqual({});
  });
});

describe('getOutboundRAMFRecipient', () => {
  test('Id should be returned', async () => {
    const channel = new EndpointChannel(
      keyPairSet.privateEndpoint.privateKey,
      pdaChain.privateEndpoint,
      peerId,
      PEER_INTERNET_ADDRESS,
      keyPairSet.pdaGrantee.publicKey,
      MOCK_STORES,
    );

    const recipient = await channel.getOutboundRAMFRecipient();

    expect(recipient.id).toEqual(peerId);
  });

  test('Internet address should be returned', async () => {
    const channel = new EndpointChannel(
      keyPairSet.privateEndpoint.privateKey,
      pdaChain.privateEndpoint,
      peerId,
      PEER_INTERNET_ADDRESS,
      keyPairSet.pdaGrantee.publicKey,
      MOCK_STORES,
    );

    const recipient = await channel.getOutboundRAMFRecipient();

    expect(recipient.internetAddress).toEqual(PEER_INTERNET_ADDRESS);
  });
});
