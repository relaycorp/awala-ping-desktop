import {
  Certificate,
  derSerializePublicKey,
  getPrivateAddressFromIdentityKey,
} from '@relaycorp/relaynet-core';
import { promises as fs } from 'fs';
import { dirname, join } from 'path';

import { getDefaultFirstPartyEndpoint, getDefaultThirdPartyEndpoint } from './defaultEndpoints';
import { mockSpy, setUpPKIFixture, setUpTestDataSource } from './lib/_test_utils';
import { FirstPartyEndpoint } from './lib/endpoints/FirstPartyEndpoint';
import { PublicThirdPartyEndpoint } from './lib/endpoints/thirdPartyEndpoints';

const DEFAULT_PUBLIC_ENDPOINT = 'ping.awala.services';

setUpTestDataSource();

let firstPartyEndpointPrivateKey: CryptoKey;
let firstPartyEndpointCertificate: Certificate;
let thirdPartyEndpointCertificate: Certificate;
setUpPKIFixture(async (keyPairSet, certPath) => {
  firstPartyEndpointCertificate = certPath.privateEndpoint;
  firstPartyEndpointPrivateKey = keyPairSet.privateEndpoint.privateKey;

  thirdPartyEndpointCertificate = certPath.pdaGrantee;
});

describe('getDefaultThirdPartyEndpoint', () => {
  let mockPublicThirdPartyEndpoint: PublicThirdPartyEndpoint;
  beforeEach(async () => {
    const identityKey = await thirdPartyEndpointCertificate.getPublicKey();
    mockPublicThirdPartyEndpoint = new PublicThirdPartyEndpoint({
      identityKeySerialized: await derSerializePublicKey(identityKey),
      privateAddress: await getPrivateAddressFromIdentityKey(identityKey),
      publicAddress: 'ping.foo.bar',
    });
  });

  const mockPublicThirdPartyEndpointImport = mockSpy(
    jest.spyOn(PublicThirdPartyEndpoint, 'import'),
  );
  const mockPublicThirdPartyEndpointLoad = mockSpy(jest.spyOn(PublicThirdPartyEndpoint, 'load'));

  test('Public endpoint ping.awala.services should be imported if necessary', async () => {
    mockPublicThirdPartyEndpointLoad.mockResolvedValueOnce(null);
    mockPublicThirdPartyEndpointImport.mockResolvedValueOnce(mockPublicThirdPartyEndpoint);

    const endpoint = await getDefaultThirdPartyEndpoint();

    expect(endpoint).toBe(mockPublicThirdPartyEndpoint);
    const isTypescript = __filename.endsWith('.ts');
    const rootDir = isTypescript ? dirname(__dirname) : dirname(dirname(__dirname));
    const connectionParamsFile = await fs.readFile(
      join(rootDir, 'data', 'default-connection-params.der'),
    );
    expect(mockPublicThirdPartyEndpointImport).toBeCalledWith(connectionParamsFile);
  });

  test('Public endpoint ping.awala.services should be reused if it exists', async () => {
    mockPublicThirdPartyEndpointLoad.mockResolvedValueOnce(mockPublicThirdPartyEndpoint);

    const endpoint = await getDefaultThirdPartyEndpoint();

    expect(endpoint).toBe(mockPublicThirdPartyEndpoint);
    expect(mockPublicThirdPartyEndpointLoad).toBeCalledWith(DEFAULT_PUBLIC_ENDPOINT);
    expect(mockPublicThirdPartyEndpointImport).not.toBeCalled();
  });
});

describe('getDefaultFirstPartyEndpoint', () => {
  let mockFirstPartyEndpoint: FirstPartyEndpoint;
  beforeEach(async () => {
    mockFirstPartyEndpoint = new FirstPartyEndpoint(
      firstPartyEndpointCertificate,
      firstPartyEndpointPrivateKey,
      await firstPartyEndpointCertificate.calculateSubjectPrivateAddress(),
    );
  });

  const mockFirstPartyEndpointRegister = mockSpy(
    jest.spyOn(FirstPartyEndpoint, 'register'),
    () => mockFirstPartyEndpoint,
  );
  const mockFirstPartyEndpointLoadActive = mockSpy(jest.spyOn(FirstPartyEndpoint, 'loadActive'));

  test('New first-party endpoint should be created if one does not exist', async () => {
    mockFirstPartyEndpointLoadActive.mockResolvedValueOnce(null);

    const endpoint = await getDefaultFirstPartyEndpoint();

    expect(endpoint).toBe(mockFirstPartyEndpoint);
    expect(mockFirstPartyEndpointRegister).toBeCalled();
  });

  test('Active first-party endpoint should be retrieved if set', async () => {
    mockFirstPartyEndpointLoadActive.mockResolvedValueOnce(mockFirstPartyEndpoint);

    const endpoint = await getDefaultFirstPartyEndpoint();

    expect(endpoint).toBe(mockFirstPartyEndpoint);
    expect(mockFirstPartyEndpointRegister).not.toBeCalled();
  });
});
