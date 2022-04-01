import { addDays } from 'date-fns';

import { FirstPartyEndpoint } from './endpoints/FirstPartyEndpoint';

export async function runMaintenance(): Promise<void> {
  await renewExpiringCertificates();
}

async function renewExpiringCertificates(): Promise<void> {
  const allEndpoints = await FirstPartyEndpoint.loadAll();
  const cutoffDate = addDays(new Date(), 90);
  await Promise.all(
    allEndpoints.map(async (endpoint) => {
      if (endpoint.identityCertificate.expiryDate <= cutoffDate) {
        await endpoint.renewCertificate();
      }
    }),
  );
}
