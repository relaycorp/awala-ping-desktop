import { Certificate, CertificationPath } from '@relaycorp/relaynet-core';
import { Container } from 'typedi';
import { DataSource } from 'typeorm';

import { FirstPartyEndpoint as FirstPartyEndpointEntity } from '../entities/FirstPartyEndpoint';
import { DBCertificateStore } from '../keystores/DBCertificateStore';
import { DBPrivateKeyStore } from '../keystores/DBPrivateKeyStore';
import { FirstPartyEndpoint } from './FirstPartyEndpoint';

export async function createFirstPartyEndpoint(
  endpointPrivateKey: CryptoKey,
  endpointCertificate: Certificate,
  gatewayCertificate: Certificate,
  dataSource: DataSource,
): Promise<FirstPartyEndpoint> {
  await Container.get(DBPrivateKeyStore).saveIdentityKey(endpointPrivateKey);

  const privateGatewayPrivateAddress = await gatewayCertificate.calculateSubjectPrivateAddress();
  await Container.get(DBCertificateStore).save(
    new CertificationPath(endpointCertificate, [gatewayCertificate]),
    privateGatewayPrivateAddress,
  );

  const endpointPrivateAddress = await endpointCertificate.calculateSubjectPrivateAddress();
  const firstPartyEndpointRepositoryRepository = dataSource.getRepository(FirstPartyEndpointEntity);
  await firstPartyEndpointRepositoryRepository.save(
    firstPartyEndpointRepositoryRepository.create({
      privateAddress: endpointPrivateAddress,
      privateGatewayPrivateAddress,
    }),
  );

  return new FirstPartyEndpoint(endpointCertificate, endpointPrivateKey, endpointPrivateAddress);
}
