import {
  derSerializePublicKey,
  generateRSAKeyPair,
  getIdFromIdentityKey,
} from '@relaycorp/relaynet-core';
import { Container } from 'typedi';

import { setUpTestDataSource } from '../_test_utils';
import { DBPrivateKeyStore } from '../keystores/DBPrivateKeyStore';
import { EndpointManager } from './EndpointManager';

setUpTestDataSource();

let nodeId: string;
let privateKey: CryptoKey;
beforeAll(async () => {
  const keyPair = await generateRSAKeyPair();
  privateKey = keyPair.privateKey;
  nodeId = await getIdFromIdentityKey(keyPair.privateKey);
});

describe('get', () => {
  let privateKeyStore: DBPrivateKeyStore;
  beforeEach(async () => {
    privateKeyStore = Container.get(DBPrivateKeyStore);
  });

  test('Null should be returned if the private key does not exist', async () => {
    const manager = Container.get(EndpointManager);

    await expect(manager.get(nodeId)).resolves.toBeNull();
  });

  test('Endpoint should be returned if private key exists', async () => {
    await privateKeyStore.saveIdentityKey(nodeId, privateKey);
    const manager = Container.get(EndpointManager);

    const endpoint = await manager.get(nodeId);

    expect(endpoint!.id).toEqual(nodeId);
    await expect(derSerializePublicKey(await endpoint!.getIdentityPublicKey())).resolves.toEqual(
      await derSerializePublicKey(privateKey),
    );
  });
});
