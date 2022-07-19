import { EndpointChannel } from './EndpointChannel';

export class PrivateEndpointChannel extends EndpointChannel {
  public async getOutboundRAMFAddress(): Promise<string> {
    return this.peerPrivateAddress;
  }
}
