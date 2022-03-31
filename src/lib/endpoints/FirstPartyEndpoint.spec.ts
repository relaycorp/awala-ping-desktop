import { Certificate as CertificateEntity, PrivateKey } from '@relaycorp/keystore-db';
import {
  Certificate,
  derSerializePublicKey,
  PrivateNodeRegistration,
} from '@relaycorp/relaynet-core';
import { MockGSCClient, PreRegisterNodeCall, RegisterNodeCall } from '@relaycorp/relaynet-testing';
import bufferToArray from 'buffer-to-arraybuffer';
import { addDays } from 'date-fns';
import { Container } from 'typedi';

import { arrayBufferFrom, mockToken, setUpPKIFixture, setUpTestDataSource } from '../_test_utils';
import { Config, ConfigKey } from '../Config';
import { ConfigItem } from '../entities/ConfigItem';
import { FirstPartyEndpoint as FirstPartyEndpointEntity } from '../entities/FirstPartyEndpoint';
import { DBCertificateStore } from '../keystores/DBCertificateStore';
import { DBPrivateKeyStore } from '../keystores/DBPrivateKeyStore';
import { DATA_SOURCE, GSC_CLIENT } from '../tokens';
import { FirstPartyEndpoint } from './FirstPartyEndpoint';
import InvalidEndpointError from './InvalidEndpointError';
import { PrivateThirdPartyEndpoint, ThirdPartyEndpoint } from './thirdPartyEndpoints';

const REGISTRATION_AUTH_SERIALIZED = arrayBufferFrom('the auth');

setUpTestDataSource();

mockToken(GSC_CLIENT);

let endpointCertificate: Certificate;
let endpointPrivateKey: CryptoKey;
let thirdPartyEndpoint: ThirdPartyEndpoint;
let gatewayCertificate: Certificate;
setUpPKIFixture(async (keyPairSet, certPath) => {
  endpointCertificate = certPath.privateEndpoint;
  endpointPrivateKey = keyPairSet.privateEndpoint.privateKey;

  thirdPartyEndpoint = new PrivateThirdPartyEndpoint({
    identityKeySerialized: await derSerializePublicKey(keyPairSet.pdaGrantee.publicKey),
    privateAddress: await certPath.pdaGrantee.calculateSubjectPrivateAddress(),
  });

  gatewayCertificate = certPath.privateGateway;
});

describe('getAddress', () => {
  test('Output should be private address', async () => {
    const endpoint = new FirstPartyEndpoint(
      endpointCertificate,
      endpointPrivateKey,
      await endpointCertificate.calculateSubjectPrivateAddress(),
    );

    await expect(endpoint.getAddress()).resolves.toEqual(
      await endpointCertificate.calculateSubjectPrivateAddress(),
    );
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
      await endpointCertificate.calculateSubjectPrivateAddress(),
    );
  });

  beforeEach(async () => {
    const certificateStore = Container.get(DBCertificateStore);
    await certificateStore.save(
      endpointCertificate,
      [gatewayCertificate],
      await gatewayCertificate.calculateSubjectPrivateAddress(),
    );
  });

  test('PDA expiry date should be the specified one', async () => {
    const { pdaSerialized } = await firstPartyEndpoint.issueAuthorization(
      thirdPartyEndpoint,
      PDA_EXPIRY_DATE,
    );

    const pda = Certificate.deserialize(bufferToArray(pdaSerialized));
    expect(pda.expiryDate).toEqual(PDA_EXPIRY_DATE);
  });

  test('PDA subject key should be that of third-party endpoint', async () => {
    const { pdaSerialized } = await firstPartyEndpoint.issueAuthorization(
      thirdPartyEndpoint,
      PDA_EXPIRY_DATE,
    );

    const pda = Certificate.deserialize(bufferToArray(pdaSerialized));
    await expect(derSerializePublicKey(await pda.getPublicKey())).toEqual(
      derSerializePublicKey(await thirdPartyEndpoint.getIdentityKey()),
    );
  });

  test('PDA issuer should be first-party endpoint', async () => {
    const { pdaSerialized } = await firstPartyEndpoint.issueAuthorization(
      thirdPartyEndpoint,
      PDA_EXPIRY_DATE,
    );

    const pda = Certificate.deserialize(bufferToArray(pdaSerialized));
    await expect(pda.getCertificationPath([], [endpointCertificate])).resolves.toHaveLength(2);
  });

  test('Chain should include first-party endpoint', async () => {
    const { pdaChainSerialized } = await firstPartyEndpoint.issueAuthorization(
      thirdPartyEndpoint,
      PDA_EXPIRY_DATE,
    );

    const endpointCertificateSerialized = Buffer.from(endpointCertificate.serialize());
    expect(pdaChainSerialized).toContainEqual(endpointCertificateSerialized);
  });

  test('Chain should include private gateway of first-party endpoint', async () => {
    const { pdaChainSerialized } = await firstPartyEndpoint.issueAuthorization(
      thirdPartyEndpoint,
      PDA_EXPIRY_DATE,
    );

    const gatewayCertificateSerialized = Buffer.from(gatewayCertificate.serialize());
    expect(pdaChainSerialized).toContainEqual(gatewayCertificateSerialized);
  });

  test('Error should be thrown if gateway certificate cannot be found', async () => {
    const certificateRepository = Container.get(DATA_SOURCE).getRepository(CertificateEntity);
    await certificateRepository.clear();

    await expect(
      firstPartyEndpoint.issueAuthorization(thirdPartyEndpoint, PDA_EXPIRY_DATE),
    ).rejects.toBeInstanceOf(InvalidEndpointError);
  });
});

describe('register', () => {
  test('Endpoint should be registered with the private gateway', async () => {
    const preRegisterCall = new PreRegisterNodeCall(REGISTRATION_AUTH_SERIALIZED);
    const registerCall = new RegisterNodeCall(
      new PrivateNodeRegistration(endpointCertificate, gatewayCertificate),
    );
    setGSCClientCalls(preRegisterCall, registerCall);

    await FirstPartyEndpoint.register();

    expect(preRegisterCall.arguments?.nodePublicKey).toBeTruthy();
    expect(registerCall.arguments?.pnrrSerialized).toEqual(REGISTRATION_AUTH_SERIALIZED);
  });

  test('Endpoint private key should be stored', async () => {
    setGSCClientCalls(
      new PreRegisterNodeCall(REGISTRATION_AUTH_SERIALIZED),
      new RegisterNodeCall(new PrivateNodeRegistration(endpointCertificate, gatewayCertificate)),
    );

    await FirstPartyEndpoint.register();

    const keystore = Container.get(DBPrivateKeyStore);
    await expect(
      keystore.retrieveIdentityKey(await endpointCertificate.calculateSubjectPrivateAddress()),
    ).toResolve();
  });

  test('Endpoint certificate should be stored', async () => {
    setGSCClientCalls(
      new PreRegisterNodeCall(REGISTRATION_AUTH_SERIALIZED),
      new RegisterNodeCall(new PrivateNodeRegistration(endpointCertificate, gatewayCertificate)),
    );

    await FirstPartyEndpoint.register();

    const certificateStore = Container.get(DBCertificateStore);
    await expect(
      certificateStore.retrieveLatest(
        await endpointCertificate.calculateSubjectPrivateAddress(),
        await gatewayCertificate.calculateSubjectPrivateAddress(),
      ),
    ).resolves.toSatisfy((p) => p.leafCertificate.isEqual(endpointCertificate));
  });

  test('Private gateway identity certificate should be stored', async () => {
    setGSCClientCalls(
      new PreRegisterNodeCall(REGISTRATION_AUTH_SERIALIZED),
      new RegisterNodeCall(new PrivateNodeRegistration(endpointCertificate, gatewayCertificate)),
    );

    await FirstPartyEndpoint.register();

    const certificateStore = Container.get(DBCertificateStore);
    const certificationPath = await certificateStore.retrieveLatest(
      await endpointCertificate.calculateSubjectPrivateAddress(),
      await gatewayCertificate.calculateSubjectPrivateAddress(),
    );
    expect(certificationPath!.chain).toHaveLength(1);
    expect(certificationPath!.chain[0].isEqual(gatewayCertificate)).toBeTrue();
  });

  test('Private gateway private address should be stored', async () => {
    const firstPartyEndpointRepository =
      Container.get(DATA_SOURCE).getRepository(FirstPartyEndpointEntity);
    await expect(firstPartyEndpointRepository.count()).resolves.toEqual(0);
    setGSCClientCalls(
      new PreRegisterNodeCall(REGISTRATION_AUTH_SERIALIZED),
      new RegisterNodeCall(new PrivateNodeRegistration(endpointCertificate, gatewayCertificate)),
    );

    await FirstPartyEndpoint.register();

    await expect(
      firstPartyEndpointRepository.count({
        where: {
          privateAddress: await endpointCertificate.calculateSubjectPrivateAddress(),
          privateGatewayPrivateAddress: await gatewayCertificate.calculateSubjectPrivateAddress(),
        },
      }),
    ).resolves.toEqual(1);
  });

  test('First-party endpoint address should be stored in configuration', async () => {
    setGSCClientCalls(
      new PreRegisterNodeCall(REGISTRATION_AUTH_SERIALIZED),
      new RegisterNodeCall(new PrivateNodeRegistration(endpointCertificate, gatewayCertificate)),
    );

    const endpoint = await FirstPartyEndpoint.register();

    const config = Container.get(Config);
    await expect(config.get(ConfigKey.ACTIVE_FIRST_PARTY_ENDPOINT_ADDRESS)).resolves.toEqual(
      endpoint.privateAddress,
    );
  });

  test('Endpoint should be returned after registration', async () => {
    setGSCClientCalls(
      new PreRegisterNodeCall(REGISTRATION_AUTH_SERIALIZED),
      new RegisterNodeCall(new PrivateNodeRegistration(endpointCertificate, gatewayCertificate)),
    );

    const endpoint = await FirstPartyEndpoint.register();

    expect(endpoint.privateAddress).toEqual(
      await endpointCertificate.calculateSubjectPrivateAddress(),
    );
  });
});

describe('loadActive', () => {
  beforeEach(async () => {
    const privateAddress = await endpointCertificate.calculateSubjectPrivateAddress();
    await Container.get(Config).set(ConfigKey.ACTIVE_FIRST_PARTY_ENDPOINT_ADDRESS, privateAddress);
    await Container.get(DBPrivateKeyStore).saveIdentityKey(endpointPrivateKey);

    const privateGatewayPrivateAddress = await gatewayCertificate.calculateSubjectPrivateAddress();
    await Container.get(DBCertificateStore).save(
      endpointCertificate,
      [gatewayCertificate],
      privateGatewayPrivateAddress,
    );

    const firstPartyEndpointRepositoryRepository =
      Container.get(DATA_SOURCE).getRepository(FirstPartyEndpointEntity);
    await firstPartyEndpointRepositoryRepository.save(
      firstPartyEndpointRepositoryRepository.create({
        privateAddress,
        privateGatewayPrivateAddress,
      }),
    );
  });

  test('Null should be returned if active endpoint address is undefined', async () => {
    const configRepository = Container.get(DATA_SOURCE).getRepository(ConfigItem);
    await configRepository.delete({ key: ConfigKey.ACTIVE_FIRST_PARTY_ENDPOINT_ADDRESS });

    await expect(FirstPartyEndpoint.loadActive()).resolves.toBeNull();
  });

  test('Null should be returned if private key cannot be found', async () => {
    const privateKeyRepository = Container.get(DATA_SOURCE).getRepository(PrivateKey);
    await privateKeyRepository.clear();

    await expect(FirstPartyEndpoint.loadActive()).resolves.toBeNull();
  });

  test('Null should be returned if identity certificate cannot be found', async () => {
    const certificateRepository = Container.get(DATA_SOURCE).getRepository(CertificateEntity);
    await certificateRepository.clear();

    await expect(FirstPartyEndpoint.loadActive()).resolves.toBeNull();
  });

  test('Null should be returned if endpoint entity cannot be found', async () => {
    const firstPartyEndpointRepositoryRepository =
      Container.get(DATA_SOURCE).getRepository(FirstPartyEndpointEntity);
    await firstPartyEndpointRepositoryRepository.clear();

    await expect(FirstPartyEndpoint.loadActive()).resolves.toBeNull();
  });

  test('Existing endpoint should be returned', async () => {
    const endpoint = await FirstPartyEndpoint.loadActive();

    expect(endpoint).toBeTruthy();
    expect(endpoint!.privateAddress).toEqual(
      await endpointCertificate.calculateSubjectPrivateAddress(),
    );
    expect(endpoint!.identityCertificate.isEqual(endpointCertificate)).toBeTrue();
  });
});

// tslint:disable-next-line:readonly-array
function setGSCClientCalls(...callQueue: Array<PreRegisterNodeCall | RegisterNodeCall>): void {
  const mockGscClient = new MockGSCClient(callQueue);
  Container.set(GSC_CLIENT, mockGscClient);
}
