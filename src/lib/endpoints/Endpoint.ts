import { Certificate } from '@relaycorp/relaynet-core';

export abstract class Endpoint {
  constructor(public identityCertificate: Certificate) {}

  public async getPrivateAddress(): Promise<string> {
    return this.identityCertificate.calculateSubjectPrivateAddress();
  }

  public abstract getAddress(): Promise<string>;
}
