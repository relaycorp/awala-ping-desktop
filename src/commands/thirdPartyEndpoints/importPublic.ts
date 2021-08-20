// tslint:disable:no-console

import getStdin from 'get-stdin';

import { bootstrap } from '../../lib/bootstrap';
import { PublicThirdPartyEndpoint } from '../../lib/endpoints/PublicThirdPartyEndpoint';

export const command = 'import-public publicAddress';

export const description = 'Import a public, third-party endpoint';

export const builder = {};

interface ArgumentSet {
  readonly publicAddress: string;
}

export async function handler(argv: ArgumentSet): Promise<void> {
  await bootstrap();

  const identityCertificateSerialized = await getStdin.buffer();

  if (identityCertificateSerialized.byteLength === 0) {
    throw new Error('Identity certificate of public endpoint should be passed via stdin');
  }

  await PublicThirdPartyEndpoint.import(argv.publicAddress, identityCertificateSerialized);

  console.log(`Imported endpoint for ${argv.publicAddress}!`);
}
