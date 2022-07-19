import { Certificate, KeyStoreSet, NodeCryptoOptions } from '@relaycorp/relaynet-core';

import { EndpointChannel } from './EndpointChannel';

export class PublicEndpointChannel extends EndpointChannel {
  constructor(
    nodePrivateKey: CryptoKey,
    nodeDeliveryAuth: Certificate,
    peerPrivateAddress: string,
    protected readonly peerPublicAddress: string,
    peerPublicKey: CryptoKey,
    keyStores: KeyStoreSet,
    cryptoOptions?: Partial<NodeCryptoOptions>,
  ) {
    super(
      nodePrivateKey,
      nodeDeliveryAuth,
      peerPrivateAddress,
      peerPublicKey,
      keyStores,
      cryptoOptions,
    );
  }

  public async getOutboundRAMFAddress(): Promise<string> {
    return `https://${this.peerPublicAddress}`;
  }
}
