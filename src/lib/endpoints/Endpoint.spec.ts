import { Certificate } from '@relaycorp/relaynet-core';
import { generateNodeKeyPairSet, generatePDACertificationPath } from '@relaycorp/relaynet-testing';

import { Endpoint } from './Endpoint';

let endpointCertificate: Certificate;
beforeAll(async () => {
  const keyPairSet = await generateNodeKeyPairSet();
  const certPath = await generatePDACertificationPath(keyPairSet);

  endpointCertificate = certPath.privateEndpoint;
});

describe('getPrivateAddress', () => {
  test('Private address should be computed from the id certificate', async () => {
    const endpoint = new DummyEndpoint(endpointCertificate);

    await expect(endpoint.getPrivateAddress()).resolves.toEqual(
      await endpointCertificate.calculateSubjectPrivateAddress(),
    );
  });
});

class DummyEndpoint extends Endpoint {
  public async getAddress(): Promise<string> {
    return '42';
  }
}
