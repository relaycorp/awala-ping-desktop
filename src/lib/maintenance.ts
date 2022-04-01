import { addDays } from 'date-fns';
import { Container } from 'typedi';

import { FirstPartyEndpoint } from './endpoints/FirstPartyEndpoint';
import { DBCertificateStore } from './keystores/DBCertificateStore';

export async function runMaintenance(): Promise<void> {
  const certificateStore = Container.get(DBCertificateStore);
  await certificateStore.deleteExpired();

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
