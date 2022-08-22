import {
  Parcel,
  ParcelCollection,
  ParcelCollectionHandshakeSigner,
  ServiceMessage,
  StreamingMode,
} from '@relaycorp/relaynet-core';
import pipe from 'it-pipe';
import { Container } from 'typedi';

import { EndpointManager } from '../endpoints/EndpointManager';
import { FirstPartyEndpoint } from '../endpoints/FirstPartyEndpoint';
import InvalidEndpointError from '../endpoints/InvalidEndpointError';
import { ThirdPartyEndpoint } from '../endpoints/thirdPartyEndpoints';
import { GSC_CLIENT, LOGGER } from '../tokens';
import { Message } from './Message';

export class IncomingMessage extends Message {
  public static async *receive(
    recipients: readonly FirstPartyEndpoint[],
  ): AsyncIterable<IncomingMessage> {
    if (recipients.length === 0) {
      throw new InvalidEndpointError(
        'At least one endpoint must be specified when collecting messages',
      );
    }

    const gscClient = Container.get(GSC_CLIENT);
    const signers = recipients.map(
      (r) => new ParcelCollectionHandshakeSigner(r.identityCertificate, r.privateKey),
    );
    yield* await pipe(
      gscClient.collectParcels(signers, StreamingMode.KEEP_ALIVE),
      await processIncomingParcels(recipients),
    );
  }

  constructor(
    public type: string,
    public content: Buffer,
    public sender: ThirdPartyEndpoint,
    public recipient: FirstPartyEndpoint,
    public ack: () => Promise<void>,
  ) {
    super();
  }
}

async function processIncomingParcels(
  recipients: readonly FirstPartyEndpoint[],
): Promise<(collections: AsyncIterable<ParcelCollection>) => AsyncIterable<IncomingMessage>> {
  const recipientByPrivateAddress = Object.fromEntries(
    await Promise.all(recipients.map(async (r) => [r.privateAddress, r])),
  );
  const endpointManager = Container.get(EndpointManager);
  const endpointByAddress = Object.fromEntries(
    await Promise.all(
      recipients.map(async (e) => [e.privateAddress, await endpointManager.get(e.privateAddress)]),
    ),
  );

  return async function* (
    collections: AsyncIterable<ParcelCollection>,
  ): AsyncIterable<IncomingMessage> {
    const logger = Container.get(LOGGER);

    for await (const collection of collections) {
      let parcel: Parcel;
      let serviceMessage: ServiceMessage;
      try {
        parcel = await collection.deserializeAndValidateParcel();
        const recipientEndpoint = endpointByAddress[parcel.recipient.id];
        serviceMessage = await recipientEndpoint.unwrapMessagePayload(parcel);
      } catch (err) {
        logger.warn({ err }, 'Received invalid parcel');
        await collection.ack();
        continue;
      }

      const peerId = await parcel.senderCertificate.calculateSubjectId();
      const sender = await ThirdPartyEndpoint.load(peerId);
      if (!sender) {
        throw new InvalidEndpointError(
          `Could not find third-party endpoint with private address ${peerId}`,
        );
      }
      const recipient = recipientByPrivateAddress[parcel.recipient.id];
      yield new IncomingMessage(
        serviceMessage.type,
        serviceMessage.content,
        sender,
        recipient,
        async () => {
          await collection.ack();
        },
      );
    }
  };
}
