import {
  Certificate,
  Parcel,
  ParcelCollection,
  ServiceMessage,
  Signer,
  StreamingMode,
} from '@relaycorp/relaynet-core';
import bufferToArray from 'buffer-to-arraybuffer';
import pipe from 'it-pipe';
import { Container } from 'typedi';
import { getRepository, Repository } from 'typeorm';

import { FirstPartyEndpoint } from '../endpoints/FirstPartyEndpoint';
import InvalidEndpointError from '../endpoints/InvalidEndpointError';
import { PublicThirdPartyEndpoint, ThirdPartyEndpoint } from '../endpoints/thirdPartyEndpoints';
import { ThirdPartyEndpoint as PublicThirdPartyEndpointEntity } from '../entities/ThirdPartyEndpoint';
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

  const publicThirdPartyEndpointRepo = getRepository(PublicThirdPartyEndpointEntity);

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

      const sender = await loadPublicThirdPartyEndpoint(
        await parcel.senderCertificate.calculateSubjectPrivateAddress(),
        publicThirdPartyEndpointRepo,
      );
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

async function loadPublicThirdPartyEndpoint(
  privateAddress: string,
  publicThirdPartyEndpointRepo: Repository<PublicThirdPartyEndpointEntity>,
): Promise<PublicThirdPartyEndpoint> {
  let senderEntity;
  try {
    senderEntity = await publicThirdPartyEndpointRepo.findOneOrFail({ privateAddress });
  } catch (err) {
    throw new InvalidEndpointError(
      err,
      `Could not find third-party endpoint with private address ${privateAddress}`,
    );
  }
  return new PublicThirdPartyEndpoint(
    senderEntity.publicAddress,
    Certificate.deserialize(bufferToArray(senderEntity.identityCertificateSerialized)),
  );
}
