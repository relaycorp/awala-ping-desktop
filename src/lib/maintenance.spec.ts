import { CertificationPath, getIdFromIdentityKey } from '@relaycorp/relaynet-core';
import {
  generateIdentityKeyPairSet,
  generatePDACertificationPath,
  NodeKeyPairSet,
} from '@relaycorp/relaynet-testing';
import { addDays, addSeconds } from 'date-fns';
import { Container } from 'typedi';

import { mockSpy, setUpTestDataSource } from './_test_utils';
import { createFirstPartyEndpoint } from './endpoints/_test_utils';
import { FirstPartyEndpoint } from './endpoints/FirstPartyEndpoint';
import { DBCertificateStore } from './keystores/DBCertificateStore';
import { runMaintenance } from './maintenance';

const getDataSource = setUpTestDataSource();

describe('runMaintenance', () => {
  let keyPairSet: NodeKeyPairSet;
  let privateGatewayAddress: string;
  beforeAll(async () => {
    keyPairSet = await generateIdentityKeyPairSet();
    privateGatewayAddress = await getIdFromIdentityKey(keyPairSet.privateGateway.publicKey);
  });

  const mockRenewCertificate = mockSpy(
    jest.spyOn(FirstPartyEndpoint.prototype, 'renewCertificate'),
  );

  const mockDeleteExpiredCertificates = mockSpy(
    jest.spyOn(DBCertificateStore.prototype, 'deleteExpired'),
  );

  test('Expired certificates should be deleted', async () => {
    await runMaintenance();

    expect(mockDeleteExpiredCertificates).toBeCalled();
  });

  describe('Expiring certificates', () => {
    test('Certificates with fewer than 90 days left should be renewed', async () => {
      const cutOffDate = addDays(new Date(), 90);
      const path1 = await generatePDACertificationPath(keyPairSet, cutOffDate);
      const certificateStore = Container.get(DBCertificateStore);
      await certificateStore.save(
        new CertificationPath(path1.privateEndpoint, [path1.privateGateway]),
        privateGatewayAddress,
      );
      await createFirstPartyEndpoint(
        keyPairSet.privateEndpoint.privateKey,
        path1.privateEndpoint,
        path1.privateGateway,
        getDataSource(),
      );

      await runMaintenance();

      expect(mockRenewCertificate).toBeCalled();
    });

    test('Certificates with more than 90 days left should not be renewed', async () => {
      const cutOffDate = addDays(new Date(), 90);
      const path = await generatePDACertificationPath(keyPairSet, addSeconds(cutOffDate, 15));
      const certificateStore = Container.get(DBCertificateStore);
      await certificateStore.save(
        new CertificationPath(path.privateEndpoint, [path.privateGateway]),
        await path.privateGateway.calculateSubjectId(),
      );

      await runMaintenance();

      expect(mockRenewCertificate).not.toBeCalled();
    });
  });
});
