// tslint:disable:no-console

import { getDefaultFirstPartyEndpoint, getDefaultThirdPartyEndpoint } from '../defaultEndpoints';
import { bootstrap } from '../lib/bootstrap';
import { PublicThirdPartyEndpoint, ThirdPartyEndpoint } from '../lib/endpoints/thirdPartyEndpoints';
import { collectPong, sendPing } from '../pinging';

export const command = 'ping [recipient]';

export const description = 'Send a ping and wait for its pong';

export const builder = {};

interface ArgumentSet {
  readonly recipient?: string;
}

export async function handler(argv: ArgumentSet): Promise<void> {
  await bootstrap();

  const firstPartyEndpoint = await getDefaultFirstPartyEndpoint();
  const thirdPartyEndpoint = await getThirdPartyEndpoint(argv.recipient);

  console.log(
    `Sender: ${firstPartyEndpoint.id}
Recipient: ${thirdPartyEndpoint.internetAddress} (${thirdPartyEndpoint.id})
`,
  );

  const { parcelId, pingId } = await sendPing(firstPartyEndpoint, thirdPartyEndpoint);
  console.log(new Date(), `Sent ping ${pingId} (parcel: ${parcelId})`);

  if (await collectPong(pingId, firstPartyEndpoint)) {
    console.log(new Date(), 'Pong received!');
  } else {
    console.error(new Date(), 'Parcel collection ended but pong message was not received');
  }
}

async function getThirdPartyEndpoint(recipient?: string): Promise<ThirdPartyEndpoint> {
  if (recipient) {
    const endpoint = await PublicThirdPartyEndpoint.load(recipient);
    if (!endpoint) {
      throw new Error(`No such third-party endpoint "${recipient}"`);
    }
    return endpoint;
  }

  return getDefaultThirdPartyEndpoint();
}
