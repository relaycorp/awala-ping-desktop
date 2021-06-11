import { generateRSAKeyPair, PrivateNodeRegistrationRequest } from '@relaycorp/relaynet-core';
import { Container } from 'typedi';
import { getRepository } from 'typeorm';

import { GatewayCertificate } from '../entities/GatewayCertificate';
import { DBPrivateKeyStore } from '../keystores/DBPrivateKeyStore';
import { GSC_CLIENT } from '../tokens';
import { Endpoint } from './Endpoint';

export class FirstPartyEndpoint extends Endpoint {
  public static async register(): Promise<FirstPartyEndpoint> {
    const gscClient = Container.get(GSC_CLIENT);
    const endpointKeyPair = await generateRSAKeyPair();
    const auth = await gscClient.preRegisterNode(endpointKeyPair.publicKey);
    const registrationRequest = new PrivateNodeRegistrationRequest(endpointKeyPair.publicKey, auth);
    const registration = await gscClient.registerNode(
      await registrationRequest.serialize(endpointKeyPair.privateKey),
    );

    const keystore = Container.get(DBPrivateKeyStore);
    await keystore.saveNodeKey(endpointKeyPair.privateKey, registration.privateNodeCertificate);

    const gatewayCertificateRepo = getRepository(GatewayCertificate);
    const gatewayCertificate = gatewayCertificateRepo.create({
      derSerialization: Buffer.from(registration.gatewayCertificate.serialize()),
      expiryDate: registration.gatewayCertificate.expiryDate,
      id: registration.gatewayCertificate.getSerialNumberHex(),
    });
    await gatewayCertificateRepo.save(gatewayCertificate);

    return new FirstPartyEndpoint(registration.privateNodeCertificate);
  }

  public async getAddress(): Promise<string> {
    return this.getPrivateAddress();
  }
}
