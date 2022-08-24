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
  gatewayInternetAddress: string,
  dataSource: DataSource,
): Promise<FirstPartyEndpoint> {
  const privateGatewayId = await gatewayCertificate.calculateSubjectId();
  await Container.get(DBCertificateStore).save(
    new CertificationPath(endpointCertificate, [gatewayCertificate]),
    privateGatewayId,
  );

  const endpointId = await endpointCertificate.calculateSubjectId();
  await Container.get(DBPrivateKeyStore).saveIdentityKey(endpointId, endpointPrivateKey);
  const firstPartyEndpointRepositoryRepository = dataSource.getRepository(FirstPartyEndpointEntity);
  await firstPartyEndpointRepositoryRepository.save(
    firstPartyEndpointRepositoryRepository.create({
      id: endpointId,
      gatewayId: privateGatewayId,
      gatewayInternetAddress,
    }),
  );

  return new FirstPartyEndpoint(
    endpointCertificate,
    endpointPrivateKey,
    endpointId,
    gatewayInternetAddress,
  );
}
