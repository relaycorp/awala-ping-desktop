import { generateRSAKeyPair, getPrivateAddressFromIdentityKey } from '@relaycorp/relaynet-core';

import { Endpoint } from './Endpoint';

let identityPublicKey: CryptoKey;
beforeAll(async () => {
  const idKeyPair = await generateRSAKeyPair();
  identityPublicKey = idKeyPair.publicKey;
});

describe('getPrivateAddress', () => {
  test('Private address should be computed from the identity key', async () => {
    const endpoint = new DummyEndpoint(identityPublicKey);

    await expect(endpoint.getPrivateAddress()).resolves.toEqual(
      await getPrivateAddressFromIdentityKey(identityPublicKey),
    );
  });
});

class DummyEndpoint extends Endpoint {
  public async getAddress(): Promise<string> {
    return '42';
  }
}
