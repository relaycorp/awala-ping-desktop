import { bootstrap } from '../lib/bootstrap';
import { FirstPartyEndpoint } from '../lib/endpoints/FirstPartyEndpoint';

export const command = 'register';

export const description = 'Register with the private gateway';

export const builder = {};

interface ArgumentSet {}

export async function handler(_argv: ArgumentSet): Promise<void> {
  await bootstrap();

  const endpoint = await FirstPartyEndpoint.register();
  // tslint:disable-next-line:no-console
  console.log({ endpointPrivateAddress: await endpoint.getPrivateAddress() });
}
