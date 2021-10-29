import {
  Certificate,
  generateRSAKeyPair,
  issueDeliveryAuthorization,
  PrivateNodeRegistrationRequest,
} from '@relaycorp/relaynet-core';
import { Container } from 'typedi';
import { getRepository } from 'typeorm';

import { Config, ConfigKey } from '../Config';
import { GatewayCertificate } from '../entities/GatewayCertificate';
import { DBPrivateKeyStore } from '../keystores/DBPrivateKeyStore';
import { GSC_CLIENT } from '../tokens';
import { AuthorizationBundle } from './AuthorizationBundle';
import { Endpoint } from './Endpoint';
import InvalidEndpointError from './InvalidEndpointError';
import { ThirdPartyEndpoint } from './thirdPartyEndpoints';

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

    const config = Container.get(Config);
    await config.set(
      ConfigKey.ACTIVE_FIRST_PARTY_ENDPOINT_ID,
      registration.privateNodeCertificate.getSerialNumberHex(),
    );

    const gatewayCertificateRepo = getRepository(GatewayCertificate);
    const gatewayCertificate = gatewayCertificateRepo.create({
      derSerialization: Buffer.from(registration.gatewayCertificate.serialize()),
      expiryDate: registration.gatewayCertificate.expiryDate,
      privateAddress: await registration.gatewayCertificate.calculateSubjectPrivateAddress(),
    });
    await gatewayCertificateRepo.save(gatewayCertificate);

    return new FirstPartyEndpoint(
      registration.privateNodeCertificate,
      endpointKeyPair.privateKey,
      await registration.privateNodeCertificate.calculateSubjectPrivateAddress(),
    );
  }

  public static async loadActive(): Promise<FirstPartyEndpoint | null> {
    const config = Container.get(Config);
    const endpointId = await config.get(ConfigKey.ACTIVE_FIRST_PARTY_ENDPOINT_ID);
    if (!endpointId) {
      return null;
    }

    const privateKeyStore = Container.get(DBPrivateKeyStore);
    const identityKeyPair = await privateKeyStore.fetchNodeKey(Buffer.from(endpointId, 'hex'));
    return new FirstPartyEndpoint(
      identityKeyPair.certificate,
      identityKeyPair.privateKey,
      await identityKeyPair.certificate.calculateSubjectPrivateAddress(),
    );
  }

  constructor(
    public identityCertificate: Certificate,
    public privateKey: CryptoKey,
    privateAddress: string,
  ) {
    super(privateAddress);
  }

  public async getAddress(): Promise<string> {
    return this.privateAddress;
  }

  public async issueAuthorization(
    thirdPartyEndpoint: ThirdPartyEndpoint,
    expiryDate: Date,
  ): Promise<AuthorizationBundle> {
    const pda = await issueDeliveryAuthorization({
      issuerCertificate: this.identityCertificate,
      issuerPrivateKey: this.privateKey,
      subjectPublicKey: await thirdPartyEndpoint.getIdentityKey(),
      validityEndDate: expiryDate,
    });

    const identityCertificateSerialized = Buffer.from(this.identityCertificate.serialize());
    const gatewayCertificateRepository = getRepository(GatewayCertificate);
    const gatewayCertificate = await gatewayCertificateRepository.findOne({
      privateAddress: this.identityCertificate.getIssuerPrivateAddress()!,
    });
    if (!gatewayCertificate) {
      throw new InvalidEndpointError('Could not find gateway certificate for first-party endpoint');
    }

    return {
      pdaChainSerialized: [identityCertificateSerialized, gatewayCertificate.derSerialization],
      pdaSerialized: Buffer.from(pda.serialize()),
    };
  }
}
