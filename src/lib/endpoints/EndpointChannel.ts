import {
  Certificate,
  Channel,
  KeyStoreSet,
  NodeCryptoOptions,
  Recipient,
} from '@relaycorp/relaynet-core';

export class EndpointChannel extends Channel {
  constructor(
    nodePrivateKey: CryptoKey,
    nodeDeliveryAuth: Certificate,
    peerId: string,
    public readonly peerInternetAddress: string,
    peerPublicKey: CryptoKey,
    keyStores: KeyStoreSet,
    cryptoOptions?: Partial<NodeCryptoOptions>,
  ) {
    super(nodePrivateKey, nodeDeliveryAuth, peerId, peerPublicKey, keyStores, cryptoOptions);
  }

  public override getOutboundRAMFRecipient(): Recipient {
    return { ...super.getOutboundRAMFRecipient(), internetAddress: this.peerInternetAddress };
  }
}
