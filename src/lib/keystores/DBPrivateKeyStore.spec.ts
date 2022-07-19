import { generateIdentityKeyPairSet } from '@relaycorp/relaynet-testing';
import { Container } from 'typedi';

import { setUpTestDataSource } from '../_test_utils';
import { DATA_SOURCE } from '../tokens';
import { DBPrivateKeyStore } from './DBPrivateKeyStore';

setUpTestDataSource();

let nodeKeyPair: CryptoKeyPair;
beforeAll(async () => {
  const pairSet = await generateIdentityKeyPairSet();
  nodeKeyPair = pairSet.privateGateway;
});

test('Constructor should initialize parent correctly', async () => {
  const dataSource = Container.get(DATA_SOURCE);

  const keystore = new DBPrivateKeyStore(dataSource);

  await keystore.saveIdentityKey('0deadbeef', nodeKeyPair.privateKey);
});
