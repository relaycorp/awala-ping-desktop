import { addDays } from 'date-fns';
import { promises as fs } from 'fs';
import { dirname, join } from 'path';
import { v4 as uuid4 } from 'uuid';

import { FirstPartyEndpoint } from './endpoints/FirstPartyEndpoint';
import { PublicThirdPartyEndpoint } from './endpoints/PublicThirdPartyEndpoint';
import { ThirdPartyEndpoint } from './endpoints/ThirdPartyEndpoint';
import { OutgoingMessage } from './messaging/OutgoingMessage';

const DEFAULT_PUBLIC_ENDPOINT = 'ping.awala.services';
const DEFAULT_PUBLIC_ENDPOINT_CERT_PATH = join(
  dirname(dirname(__dirname)),
  'data',
  'ping-awala-services-id-cert.der',
);

const PING_MESSAGE_TYPE = 'application/vnd.awala.ping-v1.ping';

export async function sendPing(): Promise<void> {
  const thirdPartyEndpoint = await getDefaultThirdPartyEndpoint();
  const firstPartyEndpoint = await getDefaultFirstPartyEndpoint();
  const authorizationBundle = await firstPartyEndpoint.issueAuthorization(
    thirdPartyEndpoint,
    addDays(new Date(), 30),
  );
  const content = {
    id: uuid4(),
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
}

async function getDefaultThirdPartyEndpoint(): Promise<ThirdPartyEndpoint> {
  const existingEndpoint = await PublicThirdPartyEndpoint.load(DEFAULT_PUBLIC_ENDPOINT);
  if (existingEndpoint) {
    return existingEndpoint;
  }

  const idCertificate = await fs.readFile(DEFAULT_PUBLIC_ENDPOINT_CERT_PATH);
  return PublicThirdPartyEndpoint.import(DEFAULT_PUBLIC_ENDPOINT, idCertificate);
}

async function getDefaultFirstPartyEndpoint(): Promise<FirstPartyEndpoint> {
  const existingEndpoint = await FirstPartyEndpoint.loadActive();
  if (existingEndpoint) {
    return existingEndpoint;
  }

  return FirstPartyEndpoint.register();
}
