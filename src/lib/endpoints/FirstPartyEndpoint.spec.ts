import {
  Certificate,
  derSerializePublicKey,
  PrivateNodeRegistration,
} from '@relaycorp/relaynet-core';
import { MockGSCClient, PreRegisterNodeCall, RegisterNodeCall } from '@relaycorp/relaynet-testing';
import bufferToArray from 'buffer-to-arraybuffer';
import { addDays } from 'date-fns';
import { Container } from 'typedi';
import { getRepository } from 'typeorm';

import { arrayBufferFrom, mockToken, setUpPKIFixture, setUpTestDBConnection } from '../_test_utils';
import { Config, ConfigKey } from '../Config';
import { GatewayCertificate } from '../entities/GatewayCertificate';
import { DBPrivateKeyStore } from '../keystores/DBPrivateKeyStore';
import { GSC_CLIENT } from '../tokens';
import { FirstPartyEndpoint } from './FirstPartyEndpoint';
import InvalidEndpointError from './InvalidEndpointError';
import { PrivateThirdPartyEndpoint, ThirdPartyEndpoint } from './thirdPartyEndpoints';

const REGISTRATION_AUTH_SERIALIZED = arrayBufferFrom('the auth');

setUpTestDBConnection();

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
    const gatewayCertificateRepository = getRepository(GatewayCertificate);
    // Insert the right certificate between two invalid ones to ensure the right one is picked
    await gatewayCertificateRepository.insert(
      gatewayCertificateRepository.create({
        derSerialization: Buffer.from('invalid1'),
        expiryDate: new Date(),
        privateAddress: 'deadbeef',
      }),
    );
    await gatewayCertificateRepository.insert(
      gatewayCertificateRepository.create({
        derSerialization: Buffer.from(gatewayCertificate.serialize()),
        expiryDate: gatewayCertificate.expiryDate,
        privateAddress: await gatewayCertificate.calculateSubjectPrivateAddress(),
      }),
    );
    await gatewayCertificateRepository.insert(
      gatewayCertificateRepository.create({
        derSerialization: Buffer.from('invalid2'),
        expiryDate: new Date(),
        privateAddress: 'deadc0de',
      }),
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
    const gatewayCertificateRepository = getRepository(GatewayCertificate);
    await gatewayCertificateRepository.clear();

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

  test('Endpoint key pair should be stored', async () => {
    setGSCClientCalls(
      new PreRegisterNodeCall(REGISTRATION_AUTH_SERIALIZED),
      new RegisterNodeCall(new PrivateNodeRegistration(endpointCertificate, gatewayCertificate)),
    );

    await FirstPartyEndpoint.register();

    const keystore = Container.get(DBPrivateKeyStore);
    await expect(keystore.fetchNodeKey(endpointCertificate.getSerialNumber())).toResolve();
  });

  test('First-party endpoint id should be stored in configuration', async () => {
    setGSCClientCalls(
      new PreRegisterNodeCall(REGISTRATION_AUTH_SERIALIZED),
      new RegisterNodeCall(new PrivateNodeRegistration(endpointCertificate, gatewayCertificate)),
    );

    const endpoint = await FirstPartyEndpoint.register();

    const config = Container.get(Config);
    await expect(config.get(ConfigKey.ACTIVE_FIRST_PARTY_ENDPOINT_ID)).resolves.toEqual(
      endpoint.identityCertificate.getSerialNumberHex(),
    );
  });

  test('Private gateway identity certificate should be stored', async () => {
    setGSCClientCalls(
      new PreRegisterNodeCall(REGISTRATION_AUTH_SERIALIZED),
      new RegisterNodeCall(new PrivateNodeRegistration(endpointCertificate, gatewayCertificate)),
    );

    await FirstPartyEndpoint.register();

    const gatewayCertificateRepo = getRepository(GatewayCertificate);
    const storedCertificate = await gatewayCertificateRepo.findOne(
      await gatewayCertificate.calculateSubjectPrivateAddress(),
    );
    expect(storedCertificate).toBeTruthy();
    await expect(storedCertificate!.derSerialization).toEqual(
      Buffer.from(gatewayCertificate.serialize()),
    );
    expect(storedCertificate!.expiryDate).toEqual(gatewayCertificate.expiryDate);
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

describe('load', () => {
  test('Existing endpoint should be returned', async () => {
    setGSCClientCalls(
      new PreRegisterNodeCall(REGISTRATION_AUTH_SERIALIZED),
      new RegisterNodeCall(new PrivateNodeRegistration(endpointCertificate, gatewayCertificate)),
    );
    await FirstPartyEndpoint.register();

    const endpoint = await FirstPartyEndpoint.loadActive();
    expect(endpoint).toBeTruthy();
    expect(endpoint!.identityCertificate.isEqual(endpointCertificate));
  });

  test('Null should be returned if the endpoint does not exist', async () => {
    await expect(FirstPartyEndpoint.loadActive()).resolves.toBeNull();
  });
});

// tslint:disable-next-line:readonly-array
function setGSCClientCalls(...callQueue: Array<PreRegisterNodeCall | RegisterNodeCall>): void {
  const mockGscClient = new MockGSCClient(callQueue);
  Container.set(GSC_CLIENT, mockGscClient);
}
