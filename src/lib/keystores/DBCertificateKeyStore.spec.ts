import { Certificate } from '@relaycorp/relaynet-core';
import {
  generateIdentityKeyPairSet,
  generatePDACertificationPath,
} from '@relaycorp/relaynet-testing';
import { Container } from 'typedi';

import { setUpTestDataSource } from '../_test_utils';
import { DATA_SOURCE } from '../tokens';
import { DBCertificateStore } from './DBCertificateStore';

setUpTestDataSource();

let endpointCertificate: Certificate;
beforeAll(async () => {
  const keyPairSet = await generateIdentityKeyPairSet();
  const certificateChain = await generatePDACertificationPath(keyPairSet);
  endpointCertificate = certificateChain.privateEndpoint;
});

test('Constructor should initialize parent correctly', async () => {
  const dataSource = Container.get(DATA_SOURCE);

  const keystore = new DBCertificateStore(dataSource);

  await keystore.save(endpointCertificate, [], endpointCertificate.getIssuerPrivateAddress()!);
});
