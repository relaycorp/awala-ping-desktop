import { DBPrivateKeyStore, PrivateKey } from '@relaycorp/keystore-db';
import {
  Certificate,
  derSerializePublicKey,
  PrivateNodeRegistration,
} from '@relaycorp/relaynet-core';
import { MockGSCClient, PreRegisterNodeCall, RegisterNodeCall } from '@relaycorp/relaynet-testing';
import bufferToArray from 'buffer-to-arraybuffer';
import { addDays } from 'date-fns';
import { promises as fs } from 'fs';
import { dirname, join } from 'path';
import { Container } from 'typedi';
import { getRepository } from 'typeorm';
import { version as uuidVersion } from 'uuid';

import {
  arrayBufferFrom,
  mockSpy,
  mockToken,
  setUpPKIFixture,
  setUpTestDBConnection,
  useTemporaryAppDirs,
} from './lib/_test_utils';
import { Config, ConfigKey } from './lib/Config';
import { ConfigItem } from './lib/entities/ConfigItem';
import { GatewayCertificate } from './lib/entities/GatewayCertificate';
import { PublicThirdPartyEndpoint } from './lib/entities/PublicThirdPartyEndpoint';
import { OutgoingMessage } from './lib/messaging/OutgoingMessage';
import { GSC_CLIENT } from './lib/tokens';
import { sendPing } from './pinging';

const DEFAULT_PUBLIC_ENDPOINT = 'ping.awala.services';

setUpTestDBConnection();
useTemporaryAppDirs();
mockToken(GSC_CLIENT);

let firstPartyEndpointPrivateKey: CryptoKey;
let firstPartyEndpointCertificate: Certificate;
let thirdPartyEndpointCertificate: Certificate;
let gatewayCertificate: Certificate;
setUpPKIFixture(async (keyPairSet, certPath) => {
  firstPartyEndpointCertificate = certPath.privateEndpoint;
  firstPartyEndpointPrivateKey = keyPairSet.privateEndpoint.privateKey;

  thirdPartyEndpointCertificate = certPath.pdaGrantee;
  gatewayCertificate = certPath.privateGateway;
});

beforeEach(async () => {
  const privateKeyStore = new DBPrivateKeyStore(getRepository(PrivateKey));
  await privateKeyStore.saveNodeKey(firstPartyEndpointPrivateKey, firstPartyEndpointCertificate);

  const config = Container.get(Config);
  await config.set(
    ConfigKey.ACTIVE_FIRST_PARTY_ENDPOINT_ID,
    firstPartyEndpointCertificate.getSerialNumberHex(),
  );

  const gatewayCertificateRepo = getRepository(GatewayCertificate);
  await gatewayCertificateRepo.save(
    gatewayCertificateRepo.create({
      derSerialization: Buffer.from(gatewayCertificate.serialize()),
      expiryDate: await gatewayCertificate.expiryDate,
      privateAddress: await gatewayCertificate.calculateSubjectPrivateAddress(),
    }),
  );

  const thirdPartyEndpointRepo = getRepository(PublicThirdPartyEndpoint);
  await thirdPartyEndpointRepo.save(
    thirdPartyEndpointRepo.create({
      expiryDate: thirdPartyEndpointCertificate.expiryDate,
      identityCertificateSerialized: Buffer.from(thirdPartyEndpointCertificate.serialize()),
      publicAddress: DEFAULT_PUBLIC_ENDPOINT,
    }),
  );
});

describe('sendPing', () => {
  const mockMessage = {
    send: mockSpy(jest.fn()),
  };
  const mockMessageBuild = mockSpy(jest.spyOn(OutgoingMessage, 'build'), () => mockMessage);

  test('Public endpoint ping.awala.services should be imported if necessary', async () => {
    const thirdPartyEndpointRepo = getRepository(PublicThirdPartyEndpoint);
    await thirdPartyEndpointRepo.clear();

    await sendPing();

    const endpoint = await thirdPartyEndpointRepo.findOneOrFail({
      publicAddress: DEFAULT_PUBLIC_ENDPOINT,
    });
    const isTypescript = __filename.endsWith('.ts');
    const rootDir = isTypescript
      ? dirname(dirname(__dirname))
      : dirname(dirname(dirname(__dirname)));
    const idCertificate = await fs.readFile(
      join(rootDir, 'data', 'ping-awala-services-id-cert.der'),
    );
    expect(endpoint.identityCertificateSerialized).toEqual(idCertificate);
  });

  test('Public endpoint ping.awala.services should be reused if it exists', async () => {
    await sendPing();

    const thirdPartyEndpointRepo = getRepository(PublicThirdPartyEndpoint);
    const endpoint = await thirdPartyEndpointRepo.findOneOrFail({
      publicAddress: DEFAULT_PUBLIC_ENDPOINT,
    });
    expect(endpoint.identityCertificateSerialized).toEqual(
      Buffer.from(thirdPartyEndpointCertificate.serialize()),
    );
  });

  test('New first-party endpoint should be created if one does not exist', async () => {
    const privateKeyRepo = getRepository(PrivateKey);
    await privateKeyRepo.clear();
    const configItemRepo = getRepository(ConfigItem);
    await configItemRepo.clear();
    const mockGscClient = new MockGSCClient([
      new PreRegisterNodeCall(arrayBufferFrom('auth')),
      new RegisterNodeCall(
        new PrivateNodeRegistration(firstPartyEndpointCertificate, gatewayCertificate),
      ),
    ]);
    Container.set(GSC_CLIENT, mockGscClient);

    await sendPing();

    await expect(privateKeyRepo.count()).resolves.toEqual(1);
  });

  test('Sender should be first-party endpoint', async () => {
    await sendPing();

    const sender = mockMessageBuild.mock.calls[0][2];
    expect(sender.identityCertificate.isEqual(firstPartyEndpointCertificate));
  });

  test('Recipient should be third-party endpoint', async () => {
    await sendPing();

    const recipient = mockMessageBuild.mock.calls[0][3];
    expect(recipient.identityCertificate.isEqual(thirdPartyEndpointCertificate));
  });

  describe('Service message', () => {
    test('Type should be application/vnd.awala.ping-v1.ping', async () => {
      await sendPing();

      expect(mockMessageBuild).toBeCalledWith(
        'application/vnd.awala.ping-v1.ping',
        expect.anything(),
        expect.anything(),
        expect.anything(),
      );
    });

    test('UUID4 should be used as ping id', async () => {
      await sendPing();

      const pingMessage = extractServiceMessage();
      expect(uuidVersion(pingMessage.id)).toEqual(4);
    });

    test('New PDA should be included', async () => {
      await sendPing();

      const pingMessage = extractServiceMessage();
      const pda = Certificate.deserialize(bufferToArray(Buffer.from(pingMessage.pda, 'base64')));
      await expect(
        pda.getCertificationPath([], [firstPartyEndpointCertificate]),
      ).resolves.toHaveLength(2);
      await expect(derSerializePublicKey(await pda.getPublicKey())).resolves.toEqual(
        await derSerializePublicKey(await thirdPartyEndpointCertificate.getPublicKey()),
      );
    });

    test('PDA should be valid for 30 days', async () => {
      await sendPing();

      const pingMessage = extractServiceMessage();
      const pda = Certificate.deserialize(bufferToArray(Buffer.from(pingMessage.pda, 'base64')));
      const now = new Date();
      expect(pda.expiryDate.getTime()).toBeLessThanOrEqual(addDays(now, 30).getTime());
      expect(pda.expiryDate.getTime()).toBeGreaterThan(addDays(now, 29).getTime());
    });

    test('PDA chain should include sender certificate', async () => {
      await sendPing();

      const pingMessage = extractServiceMessage();
      await expect(pingMessage.pda_chain).toContainEqual(
        base64EncodeDERCertificate(firstPartyEndpointCertificate),
      );
    });

    test('PDA chain should include private gateway certificate', async () => {
      await sendPing();

      const pingMessage = extractServiceMessage();
      await expect(pingMessage.pda_chain).toContainEqual(
        base64EncodeDERCertificate(gatewayCertificate),
      );
    });

    function extractServiceMessage(): any {
      expect(mockMessageBuild).toBeCalled();

      const serviceMessageJSON = mockMessageBuild.mock.calls[0][1].toString('utf8');
      return JSON.parse(serviceMessageJSON);
    }
  });

  test('Message should be sent', async () => {
    await sendPing();

    expect(mockMessage.send).toBeCalled();
  });
});

function base64EncodeDERCertificate(certificate: Certificate): string {
  return Buffer.from(certificate.serialize()).toString('base64');
}
