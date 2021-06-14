import { Certificate, CertificateError, issueEndpointCertificate } from '@relaycorp/relaynet-core';
import { subSeconds } from 'date-fns';
import { getRepository } from 'typeorm';

import { getPromiseRejection, setUpPKIFixture, setUpTestDBConnection } from '../_test_utils';
import { PublicThirdPartyEndpoint as PublicThirdPartyEndpointEntity } from '../entities/PublicThirdPartyEndpoint';
import InvalidEndpointError from './InvalidEndpointError';
import { PublicThirdPartyEndpoint } from './PublicThirdPartyEndpoint';

setUpTestDBConnection();

let thirdPartyEndpointKeypair: CryptoKeyPair;
let thirdPartyEndpointCertificate: Certificate;
let thirdPartyEndpointCertificateSerialized: Buffer;
setUpPKIFixture(async (keyPairSet, certPath) => {
  thirdPartyEndpointKeypair = keyPairSet.pdaGrantee;
  thirdPartyEndpointCertificate = certPath.pdaGrantee;
  thirdPartyEndpointCertificateSerialized = Buffer.from(certPath.pdaGrantee.serialize());
});

const PUBLIC_ADDRESS = 'valencia.relaycorp.cloud';

describe('import', () => {
  test('Syntactically invalid public addresses should be refused', async () => {
    const malformedAddress = 'malformed';

    const error = await getPromiseRejection(
      PublicThirdPartyEndpoint.import(malformedAddress, thirdPartyEndpointCertificateSerialized),
      InvalidEndpointError,
    );

    expect(error.message).toEqual(`${malformedAddress} is not a valid public address`);
  });

  test('Malformed identity certificate should be refused', async () => {
    const error = await getPromiseRejection(
      PublicThirdPartyEndpoint.import(
        PUBLIC_ADDRESS,
        Buffer.from('I am a "certificate". MUA HA HA HA'),
      ),
      InvalidEndpointError,
    );

    expect(error.message).toMatch(/^Certificate is malformed:/);
    expect(error.cause()).toBeInstanceOf(Error);
  });

  test('Well-formed yet invalid identity certificate should be refused', async () => {
    const expiryDate = subSeconds(new Date(), 1);
    const expiredCertificate = await issueEndpointCertificate({
      issuerPrivateKey: thirdPartyEndpointKeypair.privateKey,
      subjectPublicKey: thirdPartyEndpointKeypair.publicKey,
      validityEndDate: expiryDate,
      validityStartDate: subSeconds(expiryDate, 1),
    });
    const expiredCertificateSerialized = Buffer.from(expiredCertificate.serialize());

    const error = await getPromiseRejection(
      PublicThirdPartyEndpoint.import(PUBLIC_ADDRESS, expiredCertificateSerialized),
      InvalidEndpointError,
    );

    expect(error.message).toMatch(/^Certificate is well-formed but invalid:/);
    expect(error.cause()).toBeInstanceOf(CertificateError);
  });

  test('Valid endpoint data should be stored', async () => {
    const endpoint = await PublicThirdPartyEndpoint.import(
      PUBLIC_ADDRESS,
      thirdPartyEndpointCertificateSerialized,
    );

    expect(endpoint).toBeInstanceOf(PublicThirdPartyEndpoint);
    const endpointRepository = getRepository(PublicThirdPartyEndpointEntity);
    const storedEndpoint = await endpointRepository.findOne(PUBLIC_ADDRESS);
    expect(storedEndpoint).toBeTruthy();
    expect(storedEndpoint?.publicAddress).toEqual(PUBLIC_ADDRESS);
    expect(storedEndpoint?.identityCertificateSerialized).toEqual(
      thirdPartyEndpointCertificateSerialized,
    );
    expect(storedEndpoint?.expiryDate).toEqual(thirdPartyEndpointCertificate.expiryDate);
  });
});

describe('getAddress', () => {
  test('Output should be public address', async () => {
    const endpoint = await PublicThirdPartyEndpoint.import(
      PUBLIC_ADDRESS,
      thirdPartyEndpointCertificateSerialized,
    );

    await expect(endpoint.getAddress()).resolves.toEqual(`https://${PUBLIC_ADDRESS}`);
  });
});
