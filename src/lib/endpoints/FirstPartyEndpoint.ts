import {
  Certificate,
  CertificationPath,
  generateRSAKeyPair,
  issueDeliveryAuthorization,
  KeyStoreSet,
  PrivateNodeRegistration,
  PrivateNodeRegistrationRequest,
} from '@relaycorp/relaynet-core';
import { Container } from 'typedi';

import { Config, ConfigKey } from '../Config';
import { FirstPartyEndpoint as FirstPartyEndpointEntity } from '../entities/FirstPartyEndpoint';
import { DBCertificateStore } from '../keystores/DBCertificateStore';
import { DBPrivateKeyStore } from '../keystores/DBPrivateKeyStore';
import { DBPublicKeyStore } from '../keystores/DBPublicKeyStore';
import { DATA_SOURCE, GSC_CLIENT } from '../tokens';
import { Endpoint } from './Endpoint';
import { EndpointChannel } from './EndpointChannel';
import InvalidEndpointError from './InvalidEndpointError';
import { ThirdPartyEndpoint } from './thirdPartyEndpoints';

export class FirstPartyEndpoint extends Endpoint {
  public static async generate(): Promise<FirstPartyEndpoint> {
    const endpointKeyPair = await generateRSAKeyPair();
    const registration = await registerWithGateway(
      endpointKeyPair.publicKey,
      endpointKeyPair.privateKey,
    );

    const id = await saveRegistration(registration);

    const privateKeyStore = Container.get(DBPrivateKeyStore);
    await privateKeyStore.saveIdentityKey(id, endpointKeyPair.privateKey);

    const config = Container.get(Config);
    await config.set(ConfigKey.ACTIVE_FIRST_PARTY_ENDPOINT_ID, id);

    return new FirstPartyEndpoint(
      registration.privateNodeCertificate,
      endpointKeyPair.privateKey,
      id,
      registration.internetGatewayInternetAddress,
    );
  }

  public static async loadActive(): Promise<FirstPartyEndpoint | null> {
    const config = Container.get(Config);
    const id = await config.get(ConfigKey.ACTIVE_FIRST_PARTY_ENDPOINT_ID);
    if (!id) {
      return null;
    }

    const privateKeyStore = Container.get(DBPrivateKeyStore);
    const identityPrivateKey = await privateKeyStore.retrieveIdentityKey(id);
    if (!identityPrivateKey) {
      return null;
    }

    const firstPartyEndpointRepository =
      Container.get(DATA_SOURCE).getRepository(FirstPartyEndpointEntity);
    const endpointEntity = await firstPartyEndpointRepository.findOne({
      select: ['gatewayId', 'gatewayInternetAddress'],
      where: { id },
    });
    if (!endpointEntity) {
      return null;
    }

    const certificateStore = Container.get(DBCertificateStore);
    const identityCertificatePath = await certificateStore.retrieveLatest(
      id,
      endpointEntity.gatewayId,
    );
    if (!identityCertificatePath) {
      return null;
    }

    return new FirstPartyEndpoint(
      identityCertificatePath.leafCertificate,
      identityPrivateKey,
      id,
      endpointEntity.gatewayInternetAddress,
    );
  }

  public static async loadAll(): Promise<readonly FirstPartyEndpoint[]> {
    const privateKeyStore = Container.get(DBPrivateKeyStore);
    const certificateStore = Container.get(DBCertificateStore);
    const firstPartyEndpointRepository =
      Container.get(DATA_SOURCE).getRepository(FirstPartyEndpointEntity);
    const endpointRecords = await firstPartyEndpointRepository.find();
    return Promise.all(
      endpointRecords.map(async (r) => {
        const certPath = await certificateStore.retrieveLatest(r.id, r.gatewayId);
        if (!certPath) {
          throw new InvalidEndpointError(`Could not find certificate for ${r.id}`);
        }
        const privateKey = await privateKeyStore.retrieveIdentityKey(r.id);
        if (!privateKey) {
          throw new InvalidEndpointError(`Could not find private key for ${r.id}`);
        }
        return new FirstPartyEndpoint(
          certPath.leafCertificate,
          privateKey,
          r.id,
          r.gatewayInternetAddress,
        );
      }),
    );
  }

  constructor(
    public identityCertificate: Certificate,
    public privateKey: CryptoKey,
    id: string,
    public gatewayInternetAddress: string,
  ) {
    super(id);
  }

  public getChannel(thirdPartyEndpoint: ThirdPartyEndpoint): EndpointChannel {
    const keyStores: KeyStoreSet = {
      certificateStore: Container.get(DBCertificateStore),
      privateKeyStore: Container.get(DBPrivateKeyStore),
      publicKeyStore: Container.get(DBPublicKeyStore),
    };
    return new EndpointChannel(
      this.privateKey,
      this.identityCertificate,
      thirdPartyEndpoint.id,
      thirdPartyEndpoint.internetAddress,
      thirdPartyEndpoint.identityKey,
      keyStores,
    );
  }

  public async issueAuthorization(
    thirdPartyEndpoint: ThirdPartyEndpoint,
    expiryDate: Date,
  ): Promise<ArrayBuffer> {
    const pda = await issueDeliveryAuthorization({
      issuerCertificate: this.identityCertificate,
      issuerPrivateKey: this.privateKey,
      subjectPublicKey: thirdPartyEndpoint.identityKey,
      validityEndDate: expiryDate,
    });

    const certificateStore = Container.get(DBCertificateStore);
    const identityCertificatePath = await certificateStore.retrieveLatest(
      this.id,
      this.identityCertificate.getIssuerId()!,
    );
    if (!identityCertificatePath) {
      throw new InvalidEndpointError('Could not find gateway certificate for first-party endpoint');
    }

    const pdaPath = new CertificationPath(pda, [
      this.identityCertificate,
      ...identityCertificatePath.certificateAuthorities,
    ]);
    return pdaPath.serialize();
  }

  /**
   * @internal
   */
  public async renewCertificate(): Promise<FirstPartyEndpoint | null> {
    const registration = await registerWithGateway(
      await this.identityCertificate.getPublicKey(),
      this.privateKey,
    );

    if (registration.privateNodeCertificate.expiryDate <= this.identityCertificate.expiryDate) {
      return null;
    }

    await saveRegistration(registration);

    return new FirstPartyEndpoint(
      registration.privateNodeCertificate,
      this.privateKey,
      this.id,
      registration.internetGatewayInternetAddress,
    );
  }
}

async function registerWithGateway(
  endpointPublicKey: CryptoKey,
  endpointPrivateKey: CryptoKey,
): Promise<PrivateNodeRegistration> {
  const gscClient = Container.get(GSC_CLIENT);
  const auth = await gscClient.preRegisterNode(endpointPublicKey);
  const registrationRequest = new PrivateNodeRegistrationRequest(endpointPublicKey, auth);
  return gscClient.registerNode(await registrationRequest.serialize(endpointPrivateKey));
}

async function saveRegistration(registration: PrivateNodeRegistration): Promise<string> {
  const endpointCertificate = registration.privateNodeCertificate;
  const gatewayCertificate = registration.gatewayCertificate;
  const privateGatewayId = await gatewayCertificate.calculateSubjectId();

  const certificateStore = Container.get(DBCertificateStore);
  await certificateStore.save(
    new CertificationPath(endpointCertificate, [gatewayCertificate]),
    privateGatewayId,
  );

  const firstPartyEndpointRepository =
    Container.get(DATA_SOURCE).getRepository(FirstPartyEndpointEntity);
  const endpointId = await endpointCertificate.calculateSubjectId();
  await firstPartyEndpointRepository.save(
    firstPartyEndpointRepository.create({
      gatewayInternetAddress: registration.internetGatewayInternetAddress,
      id: endpointId,
      gatewayId: privateGatewayId,
    }),
  );
  return endpointId;
}
