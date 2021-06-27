import { addDays } from 'date-fns';
import { v4 as uuid4 } from 'uuid';

import { FirstPartyEndpoint } from './lib/endpoints/FirstPartyEndpoint';
import { ThirdPartyEndpoint } from './lib/endpoints/ThirdPartyEndpoint';
import { OutgoingMessage } from './lib/messaging/OutgoingMessage';

const PING_MESSAGE_TYPE = 'application/vnd.awala.ping-v1.ping';

export async function sendPing(
  firstPartyEndpoint: FirstPartyEndpoint,
  thirdPartyEndpoint: ThirdPartyEndpoint,
): Promise<string> {
  const authorizationBundle = await firstPartyEndpoint.issueAuthorization(
    thirdPartyEndpoint,
    addDays(new Date(), 30),
  );
  const pingId = uuid4();
  const content = {
    id: pingId,
    pda: authorizationBundle.pdaSerialized.toString('base64'),
    pda_chain: authorizationBundle.pdaChainSerialized.map((c) => c.toString('base64')),
  };
  const contentSerialized = JSON.stringify(content);
  const message = await OutgoingMessage.build(
    PING_MESSAGE_TYPE,
    Buffer.from(contentSerialized),
    firstPartyEndpoint,
    thirdPartyEndpoint,
  );

  await message.send();

  return pingId;
}
