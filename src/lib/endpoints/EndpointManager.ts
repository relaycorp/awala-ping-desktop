import { Endpoint, EndpointManager as BaseEndpointManager } from '@relaycorp/relaynet-core';
import { Inject, Service } from 'typedi';

import { DBCertificateStore } from '../keystores/DBCertificateStore';
import { DBPrivateKeyStore } from '../keystores/DBPrivateKeyStore';
import { DBPublicKeyStore } from '../keystores/DBPublicKeyStore';

@Service()
export class EndpointManager extends BaseEndpointManager {
  constructor(
    @Inject() privateKeyStore: DBPrivateKeyStore,
    @Inject() publicKeyStore: DBPublicKeyStore,
    @Inject() certificateStore: DBCertificateStore,
  ) {
    super({ privateKeyStore, publicKeyStore, certificateStore });
  }

  public async get(privateAddress: string): Promise<Endpoint | null> {
    const privateKey = await this.keyStores.privateKeyStore.retrieveIdentityKey(privateAddress);
    if (!privateKey) {
      return null;
    }
    return new Endpoint(privateAddress, privateKey, this.keyStores, {});
  }
}
