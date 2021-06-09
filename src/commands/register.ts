export const command = 'register';

export const description = 'Register with the private gateway';

export const builder = {};

interface ArgumentSet {}

export async function handler(_argv: ArgumentSet): Promise<void> {
  // tslint:disable-next-line:no-console
  console.log('Registering...');
}
