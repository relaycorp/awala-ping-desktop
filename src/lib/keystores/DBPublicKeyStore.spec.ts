import { PublicKey } from '@relaycorp/keystore-db';
import { generateECDHKeyPair, SessionKey } from '@relaycorp/relaynet-core';
import { getConnection } from 'typeorm';

import { setUpTestDBConnection } from '../_test_utils';
import { DBPublicKeyStore } from './DBPublicKeyStore';

setUpTestDBConnection();

const peerPrivateAddress = '0deadbeef';

let sessionKey: SessionKey;
beforeAll(async () => {
  const sessionKeyPair = await generateECDHKeyPair();
  sessionKey = {
    keyId: Buffer.from('key id'),
    publicKey: sessionKeyPair.publicKey,
  };
});

test('Constructor should initialize parent correctly', async () => {
  const connection = getConnection();
  const publicKeyRepository = connection.getRepository(PublicKey);

  const keystore = new DBPublicKeyStore(publicKeyRepository);

  await keystore.saveSessionKey(sessionKey, peerPrivateAddress, new Date());
});
