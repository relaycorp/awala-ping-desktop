import {
  Certificate,
  generateRSAKeyPair,
  issueDeliveryAuthorization,
  PrivateNodeRegistrationRequest,
} from '@relaycorp/relaynet-core';
import { Container } from 'typedi';

import { Config, ConfigKey } from '../Config';
import { FirstPartyEndpoint as FirstPartyEndpointEntity } from '../entities/FirstPartyEndpoint';
import { DBCertificateStore } from '../keystores/DBCertificateStore';
import { DBPrivateKeyStore } from '../keystores/DBPrivateKeyStore';
import { DATA_SOURCE, GSC_CLIENT } from '../tokens';
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

    const privateAddress =
      await registration.privateNodeCertificate.calculateSubjectPrivateAddress();
    const privateGatewayPrivateAddress =
      await registration.gatewayCertificate.calculateSubjectPrivateAddress();

    const privateKeyStore = Container.get(DBPrivateKeyStore);
    await privateKeyStore.saveIdentityKey(endpointKeyPair.privateKey);

    const certificateStore = Container.get(DBCertificateStore);
    await certificateStore.save(
      registration.privateNodeCertificate,
      [registration.gatewayCertificate],
      privateGatewayPrivateAddress,
    );

    const config = Container.get(Config);
    await config.set(ConfigKey.ACTIVE_FIRST_PARTY_ENDPOINT_ADDRESS, privateAddress);

    const firstPartyEndpointRepository =
      Container.get(DATA_SOURCE).getRepository(FirstPartyEndpointEntity);
    await firstPartyEndpointRepository.save(
      firstPartyEndpointRepository.create({
        privateAddress,
        privateGatewayPrivateAddress,
      }),
    );

    return new FirstPartyEndpoint(
      registration.privateNodeCertificate,
      endpointKeyPair.privateKey,
      privateAddress,
    );
  }

  public static async loadActive(): Promise<FirstPartyEndpoint | null> {
    const config = Container.get(Config);
    const privateAddress = await config.get(ConfigKey.ACTIVE_FIRST_PARTY_ENDPOINT_ADDRESS);
    if (!privateAddress) {
      return null;
    }

    const privateKeyStore = Container.get(DBPrivateKeyStore);
    const identityPrivateKey = await privateKeyStore.retrieveIdentityKey(privateAddress);
    if (!identityPrivateKey) {
      return null;
    }

    const firstPartyEndpointRepository =
      Container.get(DATA_SOURCE).getRepository(FirstPartyEndpointEntity);
    const endpointEntity = await firstPartyEndpointRepository.findOne({
      where: { privateAddress },
    });
    if (!endpointEntity) {
      return null;
    }

    const certificateStore = Container.get(DBCertificateStore);
    const identityCertificatePath = await certificateStore.retrieveLatest(
      privateAddress,
      endpointEntity.privateGatewayPrivateAddress,
    );
    if (!identityCertificatePath) {
      return null;
    }

    return new FirstPartyEndpoint(
      identityCertificatePath.leafCertificate,
      identityPrivateKey,
      privateAddress,
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
      subjectPublicKey: thirdPartyEndpoint.identityKey,
      validityEndDate: expiryDate,
    });

    const identityCertificateSerialized = Buffer.from(this.identityCertificate.serialize());

    const certificateStore = Container.get(DBCertificateStore);
    const identityCertificatePath = await certificateStore.retrieveLatest(
      this.privateAddress,
      this.identityCertificate.getIssuerPrivateAddress()!,
    );
    if (!identityCertificatePath) {
      throw new InvalidEndpointError('Could not find gateway certificate for first-party endpoint');
    }

    const chainCertificates = identityCertificatePath.chain.map((c) => Buffer.from(c.serialize()));
    return {
      pdaChainSerialized: [identityCertificateSerialized, ...chainCertificates],
      pdaSerialized: Buffer.from(pda.serialize()),
    };
  }
}
