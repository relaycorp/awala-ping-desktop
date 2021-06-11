import * as awalaCore from '@relaycorp/relaynet-core';
import { MockGSCClient, PreRegisterNodeCall, RegisterNodeCall } from '@relaycorp/relaynet-testing';
import { Container } from 'typedi';
import { getRepository } from 'typeorm';

import { arrayBufferFrom, mockToken, setUpPKIFixture, setUpTestDBConnection } from '../_test_utils';
import { GatewayCertificate } from '../entities/GatewayCertificate';
import { DBPrivateKeyStore } from '../keystores/DBPrivateKeyStore';
import { GSC_CLIENT } from '../tokens';
import { FirstPartyEndpoint } from './FirstPartyEndpoint';

setUpTestDBConnection();

mockToken(GSC_CLIENT);

let endpointCertificate: awalaCore.Certificate;
let gatewayCertificate: awalaCore.Certificate;
setUpPKIFixture((_keyPairSet, certPath) => {
  endpointCertificate = certPath.privateEndpoint;
  gatewayCertificate = certPath.privateGateway;
});

describe('getAddress', () => {
  test('Output should be private address', async () => {
    const endpoint = new FirstPartyEndpoint(endpointCertificate);

    await expect(endpoint.getAddress()).resolves.toEqual(
      await endpointCertificate.calculateSubjectPrivateAddress(),
    );
  });
});

describe('register', () => {
  const stubAuth = arrayBufferFrom('the auth');

  afterEach(() => {
    const mockGscClient = Container.get(GSC_CLIENT) as MockGSCClient;
    expect(mockGscClient.callsRemaining).toEqual(0);
  });

  test('Endpoint should be registered with the private gateway', async () => {
    const preRegisterCall = new PreRegisterNodeCall(stubAuth);
    const registerCall = new RegisterNodeCall(
      new awalaCore.PrivateNodeRegistration(endpointCertificate, gatewayCertificate),
    );
    setGSCClientCalls(preRegisterCall, registerCall);

    await FirstPartyEndpoint.register();

    expect(preRegisterCall.arguments?.nodePublicKey).toBeTruthy();
    expect(registerCall.arguments?.pnrrSerialized).toEqual(stubAuth);
  });

  test('Endpoint key pair should be stored', async () => {
    setGSCClientCalls(
      new PreRegisterNodeCall(stubAuth),
      new RegisterNodeCall(
        new awalaCore.PrivateNodeRegistration(endpointCertificate, gatewayCertificate),
      ),
    );

    await FirstPartyEndpoint.register();

    const keystore = Container.get(DBPrivateKeyStore);
    await expect(keystore.fetchNodeKey(endpointCertificate.getSerialNumber())).toResolve();
  });

  test('Private gateway identity certificate should be stored', async () => {
    setGSCClientCalls(
      new PreRegisterNodeCall(stubAuth),
      new RegisterNodeCall(
        new awalaCore.PrivateNodeRegistration(endpointCertificate, gatewayCertificate),
      ),
    );

    await FirstPartyEndpoint.register();

    const gatewayCertificateRepo = getRepository(GatewayCertificate);
    const storedCertificate = await gatewayCertificateRepo.findOne(
      gatewayCertificate.getSerialNumber().toString('hex'),
    );
    expect(storedCertificate).toBeTruthy();
    await expect(storedCertificate!.derSerialization).toEqual(
      Buffer.from(gatewayCertificate.serialize()),
    );
    expect(storedCertificate!.expiryDate).toEqual(gatewayCertificate.expiryDate);
  });

  test('Endpoint should be returned after registration', async () => {
    setGSCClientCalls(
      new PreRegisterNodeCall(stubAuth),
      new RegisterNodeCall(
        new awalaCore.PrivateNodeRegistration(endpointCertificate, gatewayCertificate),
      ),
    );

    const endpoint = await FirstPartyEndpoint.register();

    await expect(endpoint.getPrivateAddress()).resolves.toEqual(
      await endpointCertificate.calculateSubjectPrivateAddress(),
    );
  });

  // tslint:disable-next-line:readonly-array
  function setGSCClientCalls(...callQueue: Array<PreRegisterNodeCall | RegisterNodeCall>): void {
    const mockGscClient = new MockGSCClient(callQueue);
    Container.set(GSC_CLIENT, mockGscClient);
  }
});
