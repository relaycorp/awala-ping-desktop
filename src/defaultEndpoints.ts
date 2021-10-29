import { promises as fs } from 'fs';
import { dirname, join } from 'path';

import { FirstPartyEndpoint } from './lib/endpoints/FirstPartyEndpoint';
import { PublicThirdPartyEndpoint, ThirdPartyEndpoint } from './lib/endpoints/thirdPartyEndpoints';

const DEFAULT_PUBLIC_ENDPOINT = 'ping.awala.services';

const IS_TYPESCRIPT = __filename.endsWith('.ts');
/* istanbul ignore next */
const ROOT_DIR = IS_TYPESCRIPT ? dirname(__dirname) : dirname(dirname(__dirname));
const DEFAULT_CONNECTION_PARAMS_PATH = join(ROOT_DIR, 'data', 'default-connection-params.der');

export async function getDefaultThirdPartyEndpoint(): Promise<ThirdPartyEndpoint> {
  const existingEndpoint = await PublicThirdPartyEndpoint.load(DEFAULT_PUBLIC_ENDPOINT);
  if (existingEndpoint) {
    return existingEndpoint;
  }

  const connectionParamsFile = await fs.readFile(DEFAULT_CONNECTION_PARAMS_PATH);
  return PublicThirdPartyEndpoint.import(connectionParamsFile);
}

export async function getDefaultFirstPartyEndpoint(): Promise<FirstPartyEndpoint> {
  const existingEndpoint = await FirstPartyEndpoint.loadActive();
  if (existingEndpoint) {
    return existingEndpoint;
  }

  return FirstPartyEndpoint.register();
}
