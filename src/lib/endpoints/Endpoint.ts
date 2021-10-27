import { getPrivateAddressFromIdentityKey } from '@relaycorp/relaynet-core';

export abstract class Endpoint {
  constructor(public identityPublicKey: CryptoKey) {}

  public async getPrivateAddress(): Promise<string> {
    return getPrivateAddressFromIdentityKey(this.identityPublicKey);
  }

  public abstract getAddress(): Promise<string>;
}
