// tslint:disable:no-console

import { getDefaultFirstPartyEndpoint, getDefaultThirdPartyEndpoint } from '../defaultEndpoints';
import { bootstrap } from '../lib/bootstrap';
import { collectPong, sendPing } from '../pinging';

export const command = 'ping';

export const description = 'Send ping and wait for pong';

export const builder = {};

interface ArgumentSet {}

export async function handler(_argv: ArgumentSet): Promise<void> {
  await bootstrap();

  const firstPartyEndpoint = await getDefaultFirstPartyEndpoint();
  const thirdPartyEndpoint = await getDefaultThirdPartyEndpoint();
  const pingId = await sendPing(firstPartyEndpoint, thirdPartyEndpoint);
  console.log(new Date(), `Sent ping ${pingId}`);

  if (await collectPong(pingId, firstPartyEndpoint)) {
    console.log(new Date(), 'Pong received!');
  } else {
    console.error(new Date(), 'Parcel collection ended but pong message was not received');
  }
}
