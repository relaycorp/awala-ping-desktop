import { bootstrap } from '../lib/bootstrap';
import { sendPing } from '../pinging';

export const command = 'ping';

export const description = 'Send ping and wait for pong';

export const builder = {};

interface ArgumentSet {}

export async function handler(_argv: ArgumentSet): Promise<void> {
  await bootstrap();

  await sendPing();
}
