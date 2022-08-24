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

  public override async get(id: string): Promise<Endpoint | null> {
    const privateKey = await this.keyStores.privateKeyStore.retrieveIdentityKey(id);
    if (!privateKey) {
      return null;
    }
    return new Endpoint(id, privateKey, this.keyStores, {});
  }
}
