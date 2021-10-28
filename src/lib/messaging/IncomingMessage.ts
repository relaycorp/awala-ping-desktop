import {
  Parcel,
  ParcelCollection,
  ServiceMessage,
  Signer,
  StreamingMode,
} from '@relaycorp/relaynet-core';
import pipe from 'it-pipe';
import { Container } from 'typedi';

import { FirstPartyEndpoint } from '../endpoints/FirstPartyEndpoint';
import InvalidEndpointError from '../endpoints/InvalidEndpointError';
import { ThirdPartyEndpoint } from '../endpoints/thirdPartyEndpoints';
import { DBPrivateKeyStore } from '../keystores/DBPrivateKeyStore';
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
    const signers = recipients.map((r) => new Signer(r.identityCertificate, r.privateKey));
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
  const privateKeyStore = Container.get(DBPrivateKeyStore);
  const recipientByPrivateAddress = Object.fromEntries(
    await Promise.all(
      recipients.map(async (r) => [
        await r.identityCertificate.calculateSubjectPrivateAddress(),
        r,
      ]),
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
        const payloadUnwrapped = await parcel.unwrapPayload(privateKeyStore);
        serviceMessage = payloadUnwrapped.payload;
      } catch (err) {
        logger.warn({ err }, 'Received invalid parcel');
        await collection.ack();
        continue;
      }

      const peerPrivateAddress = await parcel.senderCertificate.calculateSubjectPrivateAddress();
      const sender = await ThirdPartyEndpoint.load(peerPrivateAddress);
      if (!sender) {
        throw new InvalidEndpointError(
          `Could not find third-party endpoint with private address ${peerPrivateAddress}`,
        );
      }
      const recipient = recipientByPrivateAddress[parcel.recipientAddress];
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
