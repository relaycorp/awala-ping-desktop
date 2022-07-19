import {
  derSerializePublicKey,
  generateRSAKeyPair,
  getPrivateAddressFromIdentityKey,
} from '@relaycorp/relaynet-core';
import { Container } from 'typedi';

import { setUpTestDataSource } from '../_test_utils';
import { DBPrivateKeyStore } from '../keystores/DBPrivateKeyStore';
import { EndpointManager } from './EndpointManager';

setUpTestDataSource();

let privateAddress: string;
let privateKey: CryptoKey;
beforeAll(async () => {
  const keyPair = await generateRSAKeyPair();
  privateKey = keyPair.privateKey;
  privateAddress = await getPrivateAddressFromIdentityKey(keyPair.privateKey);
});

describe('get', () => {
  let privateKeyStore: DBPrivateKeyStore;
  beforeEach(async () => {
    privateKeyStore = Container.get(DBPrivateKeyStore);
  });

  test('Null should be returned if the private key does not exist', async () => {
    const manager = Container.get(EndpointManager);

    await expect(manager.get(privateAddress)).resolves.toBeNull();
  });

  test('Endpoint should be returned if private key exists', async () => {
    await privateKeyStore.saveIdentityKey(privateAddress, privateKey);
    const manager = Container.get(EndpointManager);

    const endpoint = await manager.get(privateAddress);

    expect(endpoint!.privateAddress).toEqual(privateAddress);
    await expect(derSerializePublicKey(await endpoint!.getIdentityPublicKey())).resolves.toEqual(
      await derSerializePublicKey(privateKey),
    );
  });
});
