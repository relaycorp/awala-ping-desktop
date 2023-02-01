import { Parcel, ParcelDeliverySigner, ServiceMessage } from '@relaycorp/relaynet-core';
import { addDays, differenceInSeconds, subMinutes } from 'date-fns';
import { Container } from 'typedi';

import { FirstPartyEndpoint } from '../endpoints/FirstPartyEndpoint';
import { ThirdPartyEndpoint } from '../endpoints/thirdPartyEndpoints';
import { GSC_CLIENT } from '../tokens';
import { Message } from './Message';

export class OutgoingMessage extends Message {
  public static async build(
    type: string,
    content: Buffer,
    sender: FirstPartyEndpoint,
    recipient: ThirdPartyEndpoint,
  ): Promise<OutgoingMessage> {
    const serviceMessage = new ServiceMessage(type, content);
    const channel = await sender.getChannel(recipient);
    const serviceMessageSerialized = await channel.wrapMessagePayload(serviceMessage);
    const now = new Date();
    const creationDate = subMinutes(now, 5);
    const expiryDate = addDays(now, 14);
    const parcel = new Parcel(
      await channel.getOutboundRAMFRecipient(),
      sender.identityCertificate,
      Buffer.from(serviceMessageSerialized),
      {
        creationDate,
        ttl: differenceInSeconds(expiryDate, creationDate),
      },
    );
    const parcelSerialized = await parcel.serialize(sender.privateKey);
    return new OutgoingMessage(parcelSerialized, parcel.id, sender);
  }

  protected constructor(
    public parcelSerialized: ArrayBuffer,
    public parcelId: string,
    protected sender: FirstPartyEndpoint,
  ) {
    super();
  }

  public async send(): Promise<void> {
    const gscClient = Container.get(GSC_CLIENT);
    const signer = new ParcelDeliverySigner(
      this.sender.identityCertificate,
      this.sender.privateKey,
    );
    await gscClient.deliverParcel(this.parcelSerialized, signer);
  }
}
