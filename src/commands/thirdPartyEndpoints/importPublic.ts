// tslint:disable:no-console

import getStdin from 'get-stdin';

import { bootstrap } from '../../lib/bootstrap';
import { PublicThirdPartyEndpoint } from '../../lib/endpoints/thirdPartyEndpoints';

export const command = 'import-public publicAddress';

export const description = 'Import a public, third-party endpoint';

export const builder = {};

export async function handler(): Promise<void> {
  await bootstrap();

  const connectionParamsSerialized = await getStdin.buffer();

  if (connectionParamsSerialized.byteLength === 0) {
    throw new Error('Connection params serialization should be passed via stdin');
  }

  const endpoint = await PublicThirdPartyEndpoint.import(connectionParamsSerialized);

  console.log(`Imported endpoint for ${await endpoint.getAddress()}!`);
}
