import { generateECDHKeyPair, SessionKey } from '@relaycorp/relaynet-core';
import { Container } from 'typedi';

import { setUpTestDataSource } from '../_test_utils';
import { DATA_SOURCE } from '../tokens';
import { DBPublicKeyStore } from './DBPublicKeyStore';

setUpTestDataSource();

const peerId = '0deadbeef';

let sessionKey: SessionKey;
beforeAll(async () => {
  const sessionKeyPair = await generateECDHKeyPair();
  sessionKey = {
    keyId: Buffer.from('key id'),
    publicKey: sessionKeyPair.publicKey,
  };
});

test('Constructor should initialize parent correctly', async () => {
  const dataSource = Container.get(DATA_SOURCE);

  const keystore = new DBPublicKeyStore(dataSource);

  await keystore.saveSessionKey(sessionKey, peerId, new Date());
});
