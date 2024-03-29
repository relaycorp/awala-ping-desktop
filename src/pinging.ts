import { addDays } from 'date-fns';
import { v4 as uuid4 } from 'uuid';

import { FirstPartyEndpoint } from './lib/endpoints/FirstPartyEndpoint';
import { ThirdPartyEndpoint } from './lib/endpoints/thirdPartyEndpoints';
import { IncomingMessage } from './lib/messaging/IncomingMessage';
import { OutgoingMessage } from './lib/messaging/OutgoingMessage';

const PING_MESSAGE_TYPE = 'application/vnd.awala.ping-v1.ping';

export interface OutgoingPing {
  readonly parcelId: string;
  readonly pingId: string;
}

export async function sendPing(
  firstPartyEndpoint: FirstPartyEndpoint,
  thirdPartyEndpoint: ThirdPartyEndpoint,
): Promise<OutgoingPing> {
  const pdaPathSerialized = await firstPartyEndpoint.issueAuthorization(
    thirdPartyEndpoint,
    addDays(new Date(), 30),
  );
  const pingId = uuid4();
  const content = {
    id: pingId,
    endpoint_internet_address: firstPartyEndpoint.gatewayInternetAddress,
    pda_path: Buffer.from(pdaPathSerialized).toString('base64'),
  };
  const contentSerialized = JSON.stringify(content);
  const message = await OutgoingMessage.build(
    PING_MESSAGE_TYPE,
    Buffer.from(contentSerialized),
    firstPartyEndpoint,
    thirdPartyEndpoint,
  );

  await message.send();

  return { parcelId: message.parcelId, pingId };
}

export async function collectPong(
  pingId: string,
  firstPartyEndpoint: FirstPartyEndpoint,
): Promise<boolean> {
  const incomingMessages = IncomingMessage.receive([firstPartyEndpoint]);
  const expectedPingId = Buffer.from(pingId);
  let pongFound = false;
  for await (const message of incomingMessages) {
    if (message.content.equals(expectedPingId)) {
      pongFound = true;
      await message.ack();
      break;
    }
  }

  return pongFound;
}
