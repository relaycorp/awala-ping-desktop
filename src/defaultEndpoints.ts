import { promises as fs } from 'fs';
import { dirname, join } from 'path';

import { FirstPartyEndpoint } from './lib/endpoints/FirstPartyEndpoint';
import { PublicThirdPartyEndpoint } from './lib/endpoints/PublicThirdPartyEndpoint';
import { ThirdPartyEndpoint } from './lib/endpoints/ThirdPartyEndpoint';

const DEFAULT_PUBLIC_ENDPOINT = 'ping.awala.services';

const IS_TYPESCRIPT = __filename.endsWith('.ts');
/* istanbul ignore next */
const ROOT_DIR = IS_TYPESCRIPT ? dirname(__dirname) : dirname(dirname(__dirname));
const DEFAULT_PUBLIC_ENDPOINT_CERT_PATH = join(ROOT_DIR, 'data', 'ping-awala-services-id-cert.der');

export async function getDefaultThirdPartyEndpoint(): Promise<ThirdPartyEndpoint> {
  const existingEndpoint = await PublicThirdPartyEndpoint.load(DEFAULT_PUBLIC_ENDPOINT);
  if (existingEndpoint) {
    return existingEndpoint;
  }

  const idCertificate = await fs.readFile(DEFAULT_PUBLIC_ENDPOINT_CERT_PATH);
  return PublicThirdPartyEndpoint.import(DEFAULT_PUBLIC_ENDPOINT, idCertificate);
}

export async function getDefaultFirstPartyEndpoint(): Promise<FirstPartyEndpoint> {
  const existingEndpoint = await FirstPartyEndpoint.loadActive();
  if (existingEndpoint) {
    return existingEndpoint;
  }

  return FirstPartyEndpoint.register();
}
