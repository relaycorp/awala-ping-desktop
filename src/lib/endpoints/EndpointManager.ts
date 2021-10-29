import { EndpointManager as BaseEndpointManager } from '@relaycorp/relaynet-core';
import { Inject, Service } from 'typedi';

import { DBPrivateKeyStore } from '../keystores/DBPrivateKeyStore';
import { DBPublicKeyStore } from '../keystores/DBPublicKeyStore';

@Service()
export class EndpointManager extends BaseEndpointManager {
  constructor(
    @Inject() privateKeyStore: DBPrivateKeyStore,
    @Inject() publicKeyStore: DBPublicKeyStore,
  ) {
    super(privateKeyStore, publicKeyStore);
  }
}
