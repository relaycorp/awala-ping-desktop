import { Certificate as CertificateEntity, IdentityPrivateKey } from '@relaycorp/keystore-db';
import {
  Certificate,
  CertificationPath,
  derSerializePrivateKey,
  derSerializePublicKey,
  generateRSAKeyPair,
  getIdFromIdentityKey,
  issueEndpointCertificate,
  issueGatewayCertificate,
  PrivateNodeRegistration,
} from '@relaycorp/relaynet-core';
import { MockGSCClient, PreRegisterNodeCall, RegisterNodeCall } from '@relaycorp/relaynet-testing';
import { addDays, addSeconds } from 'date-fns';
import { Container } from 'typedi';

import {
  arrayBufferFrom,
  mockToken,
  NODE_INTERNET_ADDRESS,
  PEER_INTERNET_ADDRESS,
  setUpPKIFixture,
  setUpTestDataSource,
} from '../_test_utils';
import { Config, ConfigKey } from '../Config';
import { ConfigItem } from '../entities/ConfigItem';
import { FirstPartyEndpoint as FirstPartyEndpointEntity } from '../entities/FirstPartyEndpoint';
import { DBCertificateStore } from '../keystores/DBCertificateStore';
import { DBPrivateKeyStore } from '../keystores/DBPrivateKeyStore';
import { GSC_CLIENT } from '../tokens';
import { createFirstPartyEndpoint } from './_test_utils';
import { FirstPartyEndpoint } from './FirstPartyEndpoint';
import InvalidEndpointError from './InvalidEndpointError';
import { PrivateThirdPartyEndpoint, ThirdPartyEndpoint } from './thirdPartyEndpoints';

const REGISTRATION_AUTH_SERIALIZED = arrayBufferFrom('the auth');

const getDataSource = setUpTestDataSource();

mockToken(GSC_CLIENT);

let endpointCertificate: Certificate;
let endpointPrivateKey: CryptoKey;
let endpointId: string;
let thirdPartyEndpoint: ThirdPartyEndpoint;
let gatewayCertificate: Certificate;
let gatewayPrivateKey: CryptoKey;
setUpPKIFixture(async (keyPairSet, certPath) => {
  endpointCertificate = certPath.privateEndpoint;
  endpointPrivateKey = keyPairSet.privateEndpoint.privateKey;
  endpointId = await endpointCertificate.calculateSubjectId();

  thirdPartyEndpoint = new PrivateThirdPartyEndpoint(
    await certPath.pdaGrantee.calculateSubjectId(),
    PEER_INTERNET_ADDRESS,
    keyPairSet.pdaGrantee.publicKey,
  );

  gatewayCertificate = certPath.privateGateway;
  gatewayPrivateKey = keyPairSet.privateGateway.privateKey;
});

describe('getChannel', () => {
  let firstPartyEndpoint: FirstPartyEndpoint;
  beforeEach(() => {
    firstPartyEndpoint = new FirstPartyEndpoint(
      endpointCertificate,
      endpointPrivateKey,
      endpointId,
      NODE_INTERNET_ADDRESS,
    );
  });

  test('Channel should inherit relevant properties from 1st party endpoint', async () => {
    const channel = firstPartyEndpoint.getChannel(thirdPartyEndpoint);

    expect(channel.nodeDeliveryAuth).toEqual(firstPartyEndpoint.identityCertificate);
  });

  test('Channel should inherit relevant properties from 3rd party endpoint', async () => {
    const channel = firstPartyEndpoint.getChannel(thirdPartyEndpoint);

    expect(channel.peerId).toEqual(thirdPartyEndpoint.id);
    expect(channel.peerPublicKey).toBe(thirdPartyEndpoint.identityKey);
    expect(channel.peerInternetAddress).toEqual(thirdPartyEndpoint.internetAddress);
  });
});

describe('issueAuthorization', () => {
  const PDA_EXPIRY_DATE = addDays(new Date(), 1);
  PDA_EXPIRY_DATE.setMilliseconds(0);

  let firstPartyEndpoint: FirstPartyEndpoint;
  beforeAll(async () => {
    firstPartyEndpoint = new FirstPartyEndpoint(
      endpointCertificate,
      endpointPrivateKey,
      endpointId,
      NODE_INTERNET_ADDRESS,
    );
  });

  beforeEach(async () => {
    const certificateStore = Container.get(DBCertificateStore);
    await certificateStore.save(
      new CertificationPath(endpointCertificate, [gatewayCertificate]),
      await gatewayCertificate.calculateSubjectId(),
    );
  });

  test('PDA expiry date should be the specified one', async () => {
    const pdaPathSerialized = await firstPartyEndpoint.issueAuthorization(
      thirdPartyEndpoint,
      PDA_EXPIRY_DATE,
    );

    const pdaPath = CertificationPath.deserialize(pdaPathSerialized);
    expect(pdaPath.leafCertificate.expiryDate).toEqual(PDA_EXPIRY_DATE);
  });

  test('PDA subject key should be that of third-party endpoint', async () => {
    const pdaPathSerialized = await firstPartyEndpoint.issueAuthorization(
      thirdPartyEndpoint,
      PDA_EXPIRY_DATE,
    );

    const pdaPath = CertificationPath.deserialize(pdaPathSerialized);
    await expect(derSerializePublicKey(await pdaPath.leafCertificate.getPublicKey())).toEqual(
      derSerializePublicKey(thirdPartyEndpoint.identityKey),
    );
  });

  test('PDA issuer should be first-party endpoint', async () => {
    const pdaPathSerialized = await firstPartyEndpoint.issueAuthorization(
      thirdPartyEndpoint,
      PDA_EXPIRY_DATE,
    );

    const pdaPath = CertificationPath.deserialize(pdaPathSerialized);
    await expect(
      pdaPath.leafCertificate.getCertificationPath([], [endpointCertificate]),
    ).resolves.toHaveLength(2);
  });

  test('Chain should include first-party endpoint', async () => {
    const pdaPathSerialized = await firstPartyEndpoint.issueAuthorization(
      thirdPartyEndpoint,
      PDA_EXPIRY_DATE,
    );

    const pdaPath = CertificationPath.deserialize(pdaPathSerialized);
    expect(pdaPath.certificateAuthorities.length).toBeGreaterThanOrEqual(1);
    expect(endpointCertificate.isEqual(pdaPath.certificateAuthorities[0])).toBeTrue();
  });

  test('Chain should include private gateway of first-party endpoint', async () => {
    const pdaPathSerialized = await firstPartyEndpoint.issueAuthorization(
      thirdPartyEndpoint,
      PDA_EXPIRY_DATE,
    );

    const pdaPath = CertificationPath.deserialize(pdaPathSerialized);
    expect(pdaPath.certificateAuthorities.length).toBeGreaterThanOrEqual(2);
    expect(gatewayCertificate.isEqual(pdaPath.certificateAuthorities[1])).toBeTrue();
  });

  test('Error should be thrown if gateway certificate cannot be found', async () => {
    const certificateRepository = getDataSource().getRepository(CertificateEntity);
    await certificateRepository.clear();

    await expect(
      firstPartyEndpoint.issueAuthorization(thirdPartyEndpoint, PDA_EXPIRY_DATE),
    ).rejects.toBeInstanceOf(InvalidEndpointError);
  });
});

describe('generate', () => {
  test('Endpoint should be registered with the private gateway', async () => {
    const preRegisterCall = new PreRegisterNodeCall(REGISTRATION_AUTH_SERIALIZED);
    const registerCall = new RegisterNodeCall(
      new PrivateNodeRegistration(endpointCertificate, gatewayCertificate, NODE_INTERNET_ADDRESS),
    );
    setGSCClientCalls(preRegisterCall, registerCall);

    await FirstPartyEndpoint.generate();

    expect(preRegisterCall.arguments?.nodePublicKey).toBeTruthy();
    expect(registerCall.arguments?.pnrrSerialized).toEqual(REGISTRATION_AUTH_SERIALIZED);
  });

  test('Endpoint private key should be stored', async () => {
    setGSCClientCalls(
      new PreRegisterNodeCall(REGISTRATION_AUTH_SERIALIZED),
      new RegisterNodeCall(
        new PrivateNodeRegistration(endpointCertificate, gatewayCertificate, NODE_INTERNET_ADDRESS),
      ),
    );

    await FirstPartyEndpoint.generate();

    const keystore = Container.get(DBPrivateKeyStore);
    await expect(keystore.retrieveIdentityKey(endpointId)).toResolve();
  });

  test('Endpoint certificate should be stored', async () => {
    setGSCClientCalls(
      new PreRegisterNodeCall(REGISTRATION_AUTH_SERIALIZED),
      new RegisterNodeCall(
        new PrivateNodeRegistration(endpointCertificate, gatewayCertificate, NODE_INTERNET_ADDRESS),
      ),
    );

    await FirstPartyEndpoint.generate();

    const certificateStore = Container.get(DBCertificateStore);
    await expect(
      certificateStore.retrieveLatest(endpointId, await gatewayCertificate.calculateSubjectId()),
    ).resolves.toSatisfy((p) => p.leafCertificate.isEqual(endpointCertificate));
  });

  test('Private gateway identity certificate should be stored', async () => {
    setGSCClientCalls(
      new PreRegisterNodeCall(REGISTRATION_AUTH_SERIALIZED),
      new RegisterNodeCall(
        new PrivateNodeRegistration(endpointCertificate, gatewayCertificate, NODE_INTERNET_ADDRESS),
      ),
    );

    await FirstPartyEndpoint.generate();

    const certificateStore = Container.get(DBCertificateStore);
    const certificationPath = await certificateStore.retrieveLatest(
      endpointId,
      await gatewayCertificate.calculateSubjectId(),
    );
    expect(certificationPath!.certificateAuthorities).toHaveLength(1);
    expect(certificationPath!.certificateAuthorities[0].isEqual(gatewayCertificate)).toBeTrue();
  });

  test('Private gateway id should be stored', async () => {
    const firstPartyEndpointRepository = getDataSource().getRepository(FirstPartyEndpointEntity);
    await expect(firstPartyEndpointRepository.count()).resolves.toEqual(0);
    setGSCClientCalls(
      new PreRegisterNodeCall(REGISTRATION_AUTH_SERIALIZED),
      new RegisterNodeCall(
        new PrivateNodeRegistration(endpointCertificate, gatewayCertificate, NODE_INTERNET_ADDRESS),
      ),
    );

    await FirstPartyEndpoint.generate();

    await expect(
      firstPartyEndpointRepository.count({
        where: {
          id: endpointId,
          gatewayId: await gatewayCertificate.calculateSubjectId(),
        },
      }),
    ).resolves.toEqual(1);
  });

  test('Gateway Internet address should be stored', async () => {
    const firstPartyEndpointRepository = getDataSource().getRepository(FirstPartyEndpointEntity);
    await expect(firstPartyEndpointRepository.count()).resolves.toEqual(0);
    setGSCClientCalls(
      new PreRegisterNodeCall(REGISTRATION_AUTH_SERIALIZED),
      new RegisterNodeCall(
        new PrivateNodeRegistration(endpointCertificate, gatewayCertificate, NODE_INTERNET_ADDRESS),
      ),
    );

    await FirstPartyEndpoint.generate();

    await expect(
      firstPartyEndpointRepository.count({
        where: {
          id: endpointId,
          gatewayInternetAddress: NODE_INTERNET_ADDRESS,
        },
      }),
    ).resolves.toEqual(1);
  });

  test('First-party endpoint address should be stored in configuration', async () => {
    setGSCClientCalls(
      new PreRegisterNodeCall(REGISTRATION_AUTH_SERIALIZED),
      new RegisterNodeCall(
        new PrivateNodeRegistration(endpointCertificate, gatewayCertificate, NODE_INTERNET_ADDRESS),
      ),
    );

    const endpoint = await FirstPartyEndpoint.generate();

    const config = Container.get(Config);
    await expect(config.get(ConfigKey.ACTIVE_FIRST_PARTY_ENDPOINT_ID)).resolves.toEqual(
      endpoint.id,
    );
  });

  test('Endpoint should be returned after registration', async () => {
    setGSCClientCalls(
      new PreRegisterNodeCall(REGISTRATION_AUTH_SERIALIZED),
      new RegisterNodeCall(
        new PrivateNodeRegistration(endpointCertificate, gatewayCertificate, NODE_INTERNET_ADDRESS),
      ),
    );

    const endpoint = await FirstPartyEndpoint.generate();

    expect(endpoint.id).toEqual(endpointId);
  });
});

describe('loadActive', () => {
  beforeEach(registerEndpoint);

  test('Null should be returned if active endpoint address is undefined', async () => {
    const configRepository = getDataSource().getRepository(ConfigItem);
    await configRepository.delete({ key: ConfigKey.ACTIVE_FIRST_PARTY_ENDPOINT_ID });

    await expect(FirstPartyEndpoint.loadActive()).resolves.toBeNull();
  });

  test('Null should be returned if private key cannot be found', async () => {
    const privateKeyRepository = getDataSource().getRepository(IdentityPrivateKey);
    await privateKeyRepository.clear();

    await expect(FirstPartyEndpoint.loadActive()).resolves.toBeNull();
  });

  test('Null should be returned if identity certificate cannot be found', async () => {
    const certificateRepository = getDataSource().getRepository(CertificateEntity);
    await certificateRepository.clear();

    await expect(FirstPartyEndpoint.loadActive()).resolves.toBeNull();
  });

  test('Null should be returned if endpoint entity cannot be found', async () => {
    const firstPartyEndpointRepositoryRepository =
      getDataSource().getRepository(FirstPartyEndpointEntity);
    await firstPartyEndpointRepositoryRepository.clear();

    await expect(FirstPartyEndpoint.loadActive()).resolves.toBeNull();
  });

  test('Existing endpoint should be returned', async () => {
    const endpoint = await FirstPartyEndpoint.loadActive();

    expect(endpoint).toBeTruthy();
    expect(endpoint!.id).toEqual(endpointId);
    expect(endpoint!.identityCertificate.isEqual(endpointCertificate)).toBeTrue();
    expect(endpoint!.gatewayInternetAddress).toEqual(NODE_INTERNET_ADDRESS);
  });
});

describe('loadAll', () => {
  test('Nothing should be returned if there are no endpoints', async () => {
    await expect(FirstPartyEndpoint.loadAll()).resolves.toHaveLength(0);
  });

  test('Existing endpoints should be returned', async () => {
    await registerEndpoint();

    const allEndpoints = await FirstPartyEndpoint.loadAll();

    expect(allEndpoints).toHaveLength(1);
    expect(allEndpoints[0].identityCertificate.isEqual(endpointCertificate)).toBeTrue();
    await expect(derSerializePrivateKey(allEndpoints[0].privateKey)).resolves.toEqual(
      await derSerializePrivateKey(endpointPrivateKey),
    );
    expect(allEndpoints[0].id).toEqual(endpointId);
    expect(allEndpoints[0].gatewayInternetAddress).toEqual(NODE_INTERNET_ADDRESS);
  });

  test('Error should be thrown if certificate is missing', async () => {
    await registerEndpoint();
    const certificateRepository = getDataSource().getRepository(CertificateEntity);
    await certificateRepository.clear();

    await expect(FirstPartyEndpoint.loadAll()).rejects.toThrowWithMessage(
      InvalidEndpointError,
      `Could not find certificate for ${endpointId}`,
    );
  });

  test('Error should be thrown if private key is missing', async () => {
    await registerEndpoint();
    const privateKeyRepositoryRepository = getDataSource().getRepository(IdentityPrivateKey);
    await privateKeyRepositoryRepository.clear();

    await expect(FirstPartyEndpoint.loadAll()).rejects.toThrowWithMessage(
      InvalidEndpointError,
      `Could not find private key for ${endpointId}`,
    );
  });
});

describe('renewCertificate', () => {
  test('Endpoint should be registered with the private gateway', async () => {
    const firstPartyEndpoint = await registerEndpoint();
    const preRegisterCall = new PreRegisterNodeCall(REGISTRATION_AUTH_SERIALIZED);
    const newCertificates = await generateCertificates(
      addSeconds(endpointCertificate.expiryDate, 1),
    );
    const registerCall = new RegisterNodeCall(
      new PrivateNodeRegistration(
        newCertificates.endpoint,
        newCertificates.gateway,
        NODE_INTERNET_ADDRESS,
      ),
    );
    setGSCClientCalls(preRegisterCall, registerCall);

    await firstPartyEndpoint.renewCertificate();

    expect(preRegisterCall.arguments?.nodePublicKey).toBeTruthy();
    expect(registerCall.arguments?.pnrrSerialized).toEqual(REGISTRATION_AUTH_SERIALIZED);
  });

  test('Endpoint certificate should be stored', async () => {
    const firstPartyEndpoint = await registerEndpoint();
    const newCertificates = await generateCertificates(
      addSeconds(endpointCertificate.expiryDate, 1),
    );
    setGSCClientCalls(
      new PreRegisterNodeCall(REGISTRATION_AUTH_SERIALIZED),
      new RegisterNodeCall(
        new PrivateNodeRegistration(
          newCertificates.endpoint,
          newCertificates.gateway,
          NODE_INTERNET_ADDRESS,
        ),
      ),
    );

    await firstPartyEndpoint.renewCertificate();

    const certificateStore = Container.get(DBCertificateStore);
    await expect(
      certificateStore.retrieveLatest(endpointId, await gatewayCertificate.calculateSubjectId()),
    ).resolves.toSatisfy((p) => p.leafCertificate.isEqual(newCertificates.endpoint));
  });

  test('Private gateway identity certificate should be stored', async () => {
    const firstPartyEndpoint = await registerEndpoint();
    const newCertificates = await generateCertificates(
      addSeconds(endpointCertificate.expiryDate, 1),
    );
    setGSCClientCalls(
      new PreRegisterNodeCall(REGISTRATION_AUTH_SERIALIZED),
      new RegisterNodeCall(
        new PrivateNodeRegistration(
          newCertificates.endpoint,
          newCertificates.gateway,
          NODE_INTERNET_ADDRESS,
        ),
      ),
    );

    await firstPartyEndpoint.renewCertificate();

    const certificateStore = Container.get(DBCertificateStore);
    const certificationPath = await certificateStore.retrieveLatest(
      endpointId,
      await gatewayCertificate.calculateSubjectId(),
    );
    expect(certificationPath!.certificateAuthorities).toHaveLength(1);
    expect(
      certificationPath!.certificateAuthorities[0].isEqual(newCertificates.gateway),
    ).toBeTrue();
  });

  test('Private gateway id should be updated if different', async () => {
    const firstPartyEndpoint = await registerEndpoint();
    const newGatewayKeyPair = await generateRSAKeyPair();
    const newCertificates = await generateCertificates(
      addSeconds(endpointCertificate.expiryDate, 1),
      newGatewayKeyPair,
    );
    setGSCClientCalls(
      new PreRegisterNodeCall(REGISTRATION_AUTH_SERIALIZED),
      new RegisterNodeCall(
        new PrivateNodeRegistration(
          newCertificates.endpoint,
          newCertificates.gateway,
          NODE_INTERNET_ADDRESS,
        ),
      ),
    );

    await firstPartyEndpoint.renewCertificate();

    const firstPartyEndpointRepository = getDataSource().getRepository(FirstPartyEndpointEntity);
    await expect(
      firstPartyEndpointRepository.count({
        where: {
          id: endpointId,
          gatewayId: await getIdFromIdentityKey(newGatewayKeyPair.publicKey),
        },
      }),
    ).resolves.toEqual(1);
  });

  test('Gateway Internet address should be updated if different', async () => {
    const newInternetAddress = `not-${NODE_INTERNET_ADDRESS}`;
    const firstPartyEndpoint = await registerEndpoint();
    const newCertificates = await generateCertificates(
      addSeconds(endpointCertificate.expiryDate, 1),
    );
    setGSCClientCalls(
      new PreRegisterNodeCall(REGISTRATION_AUTH_SERIALIZED),
      new RegisterNodeCall(
        new PrivateNodeRegistration(
          newCertificates.endpoint,
          newCertificates.gateway,
          newInternetAddress,
        ),
      ),
    );

    await firstPartyEndpoint.renewCertificate();

    const firstPartyEndpointRepository = getDataSource().getRepository(FirstPartyEndpointEntity);
    await expect(
      firstPartyEndpointRepository.count({
        where: {
          id: endpointId,
          gatewayInternetAddress: newInternetAddress,
        },
      }),
    ).resolves.toEqual(1);
  });

  test('Endpoint should be returned after registration', async () => {
    const originalEndpoint = await registerEndpoint();
    const newCertificates = await generateCertificates(
      addSeconds(endpointCertificate.expiryDate, 1),
    );
    setGSCClientCalls(
      new PreRegisterNodeCall(REGISTRATION_AUTH_SERIALIZED),
      new RegisterNodeCall(
        new PrivateNodeRegistration(
          newCertificates.endpoint,
          newCertificates.gateway,
          NODE_INTERNET_ADDRESS,
        ),
      ),
    );

    const newEndpoint = await originalEndpoint.renewCertificate();

    expect(newEndpoint!.id).toEqual(endpointId);
    await expect(derSerializePrivateKey(newEndpoint!.privateKey)).resolves.toEqual(
      await derSerializePrivateKey(endpointPrivateKey),
    );
    expect(newEndpoint!.identityCertificate.isEqual(newCertificates.endpoint)).toBeTrue();
    expect(newEndpoint!.gatewayInternetAddress).toEqual(NODE_INTERNET_ADDRESS);
  });

  test('Nothing should be returned if new certificate does not expire later', async () => {
    const originalEndpoint = await registerEndpoint();
    setGSCClientCalls(
      new PreRegisterNodeCall(REGISTRATION_AUTH_SERIALIZED),
      new RegisterNodeCall(
        new PrivateNodeRegistration(endpointCertificate, gatewayCertificate, NODE_INTERNET_ADDRESS),
      ),
    );

    await expect(originalEndpoint.renewCertificate()).resolves.toBeNull();
  });

  test('New certificate should not be stored if it does not expire later', async () => {
    const originalEndpoint = await registerEndpoint();
    const newGatewayKeyPair = await generateRSAKeyPair();
    const newCertificates = await generateCertificates(
      endpointCertificate.expiryDate,
      newGatewayKeyPair,
    );
    setGSCClientCalls(
      new PreRegisterNodeCall(REGISTRATION_AUTH_SERIALIZED),
      new RegisterNodeCall(
        new PrivateNodeRegistration(
          newCertificates.endpoint,
          newCertificates.gateway,
          NODE_INTERNET_ADDRESS,
        ),
      ),
    );

    await originalEndpoint.renewCertificate();

    const certificateStore = Container.get(DBCertificateStore);
    await expect(
      certificateStore.retrieveAll(endpointId, await gatewayCertificate.calculateSubjectId()),
    ).resolves.toHaveLength(1);
    const firstPartyEndpointRepository = getDataSource().getRepository(FirstPartyEndpointEntity);
    await expect(
      firstPartyEndpointRepository.count({
        where: {
          id: endpointId,
          gatewayId: await gatewayCertificate.calculateSubjectId(),
        },
      }),
    ).resolves.toEqual(1);
  });

  async function generateCertificates(
    expiryDate: Date,
    gatewayKeyPair?: CryptoKeyPair,
  ): Promise<{ readonly endpoint: Certificate; readonly gateway: Certificate }> {
    const gateway = await issueGatewayCertificate({
      issuerPrivateKey: gatewayKeyPair?.privateKey ?? gatewayPrivateKey,
      subjectPublicKey: gatewayKeyPair?.publicKey ?? (await gatewayCertificate.getPublicKey()),
      validityEndDate: expiryDate,
    });
    const endpoint = await issueEndpointCertificate({
      issuerCertificate: gateway,
      issuerPrivateKey: gatewayKeyPair?.privateKey ?? gatewayPrivateKey,
      subjectPublicKey: await endpointCertificate.getPublicKey(),
      validityEndDate: expiryDate,
    });
    return { endpoint, gateway };
  }
});

async function registerEndpoint(): Promise<FirstPartyEndpoint> {
  await Container.get(Config).set(ConfigKey.ACTIVE_FIRST_PARTY_ENDPOINT_ID, endpointId);
  return createFirstPartyEndpoint(
    endpointPrivateKey,
    endpointCertificate,
    gatewayCertificate,
    NODE_INTERNET_ADDRESS,
    getDataSource(),
  );
}

// tslint:disable-next-line:readonly-array
function setGSCClientCalls(...callQueue: (PreRegisterNodeCall | RegisterNodeCall)[]): void {
  const mockGscClient = new MockGSCClient(callQueue);
  Container.set(GSC_CLIENT, mockGscClient);
}
