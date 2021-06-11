import { PrivateKey } from '@relaycorp/keystore-db';
import { Certificate } from '@relaycorp/relaynet-core';
import { generateNodeKeyPairSet, generatePDACertificationPath } from '@relaycorp/relaynet-testing';
import { getConnection } from 'typeorm';

import { setUpTestDBConnection } from '../_test_utils';
import { DBPrivateKeyStore } from './DBPrivateKeyStore';

setUpTestDBConnection();

let nodeKeyPair: CryptoKeyPair;
let nodeCertificate: Certificate;
beforeAll(async () => {
  const pairSet = await generateNodeKeyPairSet();
  const certPath = await generatePDACertificationPath(pairSet);

  nodeKeyPair = pairSet.privateGateway;
  nodeCertificate = certPath.privateGateway;
});

test('Constructor should initialize parent correctly', async () => {
  const connection = getConnection();
  const privateKeyRepository = connection.getRepository(PrivateKey);

  const keystore = new DBPrivateKeyStore(privateKeyRepository);

  await keystore.saveNodeKey(nodeKeyPair.privateKey, nodeCertificate);
});
