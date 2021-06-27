import { Certificate, issueDeliveryAuthorization } from '@relaycorp/relaynet-core';
import { addDays } from 'date-fns';
import { Container } from 'typedi';
import { getRepository } from 'typeorm';
import { version as uuidVersion } from 'uuid';

import {
  arrayToAsyncIterable,
  mockSpy,
  mockToken,
  setUpPKIFixture,
  setUpTestDBConnection,
  useTemporaryAppDirs,
} from './lib/_test_utils';
import { AuthorizationBundle } from './lib/endpoints/AuthorizationBundle';
import { FirstPartyEndpoint } from './lib/endpoints/FirstPartyEndpoint';
import { PublicThirdPartyEndpoint } from './lib/endpoints/PublicThirdPartyEndpoint';
import { ThirdPartyEndpoint } from './lib/endpoints/ThirdPartyEndpoint';
import { GatewayCertificate } from './lib/entities/GatewayCertificate';
import { DBPrivateKeyStore } from './lib/keystores/DBPrivateKeyStore';
import { IncomingMessage } from './lib/messaging/IncomingMessage';
import { OutgoingMessage } from './lib/messaging/OutgoingMessage';
import { GSC_CLIENT } from './lib/tokens';
import { collectPong, sendPing } from './pinging';

const DEFAULT_PUBLIC_ENDPOINT = 'ping.awala.services';

setUpTestDBConnection();
useTemporaryAppDirs();
mockToken(GSC_CLIENT);

let firstPartyEndpoint: FirstPartyEndpoint;
let thirdPartyEndpoint: ThirdPartyEndpoint;
let gatewayCertificate: Certificate;
setUpPKIFixture(async (keyPairSet, certPath) => {
  firstPartyEndpoint = new FirstPartyEndpoint(
    certPath.privateEndpoint,
    keyPairSet.privateEndpoint.privateKey,
  );

  thirdPartyEndpoint = new PublicThirdPartyEndpoint(DEFAULT_PUBLIC_ENDPOINT, certPath.pdaGrantee);

  gatewayCertificate = certPath.publicGateway;
});

beforeEach(async () => {
  const privateKeyStore = Container.get(DBPrivateKeyStore);
  await privateKeyStore.saveNodeKey(
    firstPartyEndpoint.privateKey,
    firstPartyEndpoint.identityCertificate,
  );

  const gatewayCertificateRepo = getRepository(GatewayCertificate);
  await gatewayCertificateRepo.save(
    gatewayCertificateRepo.create({
      derSerialization: Buffer.from(gatewayCertificate.serialize()),
      expiryDate: await gatewayCertificate.expiryDate,
      privateAddress: await gatewayCertificate.calculateSubjectPrivateAddress(),
    }),
  );
});

describe('sendPing', () => {
  let authBundle: AuthorizationBundle;
  const mockIssueAuthorization = mockSpy(
    jest.spyOn(FirstPartyEndpoint.prototype, 'issueAuthorization'),
    () => authBundle,
  );
  beforeEach(async () => {
    const pda = await issueDeliveryAuthorization({
      issuerCertificate: firstPartyEndpoint.identityCertificate,
      issuerPrivateKey: firstPartyEndpoint.privateKey,
      subjectPublicKey: await thirdPartyEndpoint.identityCertificate.getPublicKey(),
      validityEndDate: firstPartyEndpoint.identityCertificate.expiryDate,
    });
    authBundle = {
      pdaChainSerialized: [Buffer.from(firstPartyEndpoint.identityCertificate.serialize())],
      pdaSerialized: Buffer.from(pda.serialize()),
    };
  });

  const mockMessage = {
    send: mockSpy(jest.fn()),
  };
  const mockMessageBuild = mockSpy(jest.spyOn(OutgoingMessage, 'build'), () => mockMessage);

  test('Sender should be first-party endpoint', async () => {
    await sendPing(firstPartyEndpoint, thirdPartyEndpoint);

    const sender = mockMessageBuild.mock.calls[0][2];
    expect(sender.identityCertificate.isEqual(firstPartyEndpoint.identityCertificate));
  });

  test('Recipient should be third-party endpoint', async () => {
    await sendPing(firstPartyEndpoint, thirdPartyEndpoint);

    const recipient = mockMessageBuild.mock.calls[0][3];
    expect(recipient.identityCertificate.isEqual(thirdPartyEndpoint.identityCertificate));
  });

  describe('Service message', () => {
    test('Type should be application/vnd.awala.ping-v1.ping', async () => {
      await sendPing(firstPartyEndpoint, thirdPartyEndpoint);

      expect(mockMessageBuild).toBeCalledWith(
        'application/vnd.awala.ping-v1.ping',
        expect.anything(),
        expect.anything(),
        expect.anything(),
      );
    });

    test('UUID4 should be used as ping id', async () => {
      await sendPing(firstPartyEndpoint, thirdPartyEndpoint);

      const pingMessage = extractServiceMessage();
      expect(uuidVersion(pingMessage.id)).toEqual(4);
    });

    test('New PDA should be included', async () => {
      await sendPing(firstPartyEndpoint, thirdPartyEndpoint);

      const pingMessage = extractServiceMessage();
      expect(pingMessage.pda).toEqual(authBundle.pdaSerialized.toString('base64'));
    });

    test('PDA should be valid for 30 days', async () => {
      await sendPing(firstPartyEndpoint, thirdPartyEndpoint);

      const now = new Date();
      expect(mockIssueAuthorization).toBeCalledWith(
        thirdPartyEndpoint,
        expect.toSatisfy(
          (expiryDate) => expiryDate <= addDays(now, 30) && addDays(now, 29) <= expiryDate,
        ),
      );
    });

    test('PDA chain should be included', async () => {
      await sendPing(firstPartyEndpoint, thirdPartyEndpoint);

      const pingMessage = extractServiceMessage();
      expect(pingMessage.pda_chain).toEqual(
        authBundle.pdaChainSerialized.map((c) => c.toString('base64')),
      );
    });
  });

  test('Message should be sent', async () => {
    await sendPing(firstPartyEndpoint, thirdPartyEndpoint);

    expect(mockMessage.send).toBeCalled();
  });

  test('Ping id should be output', async () => {
    const pingId = await sendPing(firstPartyEndpoint, thirdPartyEndpoint);

    const pingMessage = extractServiceMessage();
    await expect(pingMessage.id).toEqual(pingId);
  });

  function extractServiceMessage(): any {
    expect(mockMessageBuild).toBeCalled();

    const serviceMessageJSON = mockMessageBuild.mock.calls[0][1].toString('utf8');
    return JSON.parse(serviceMessageJSON);
  }
});

describe('receivePong', () => {
  const PING_ID = 'the id';
  const PONG_SERVICE_MESSAGE_TYPE = 'the pong type';

  const mockIncomingMessageReceive = mockSpy(jest.spyOn(IncomingMessage, 'receive'), () =>
    arrayToAsyncIterable([]),
  );

  test('Messages for the default first-party endpoint should be retrieved', async () => {
    await collectPong(PING_ID, firstPartyEndpoint);

    expect(mockIncomingMessageReceive).toBeCalledWith([firstPartyEndpoint]);
  });

  test('Unrelated, incoming messages should be ignored', async () => {
    const ack = jest.fn();
    const unrelatedMessage = new IncomingMessage(
      PONG_SERVICE_MESSAGE_TYPE,
      Buffer.from(`not ${PING_ID}`),
      thirdPartyEndpoint,
      firstPartyEndpoint,
      ack,
    );
    mockIncomingMessageReceive.mockReturnValueOnce(arrayToAsyncIterable([unrelatedMessage]));

    await collectPong(PING_ID, firstPartyEndpoint);

    expect(ack).not.toBeCalled();
  });

  test('Incoming message should be acknowledged if it is the expected one', async () => {
    const ack = jest.fn();
    const expectedMessage = new IncomingMessage(
      PONG_SERVICE_MESSAGE_TYPE,
      Buffer.from(PING_ID),
      thirdPartyEndpoint,
      firstPartyEndpoint,
      ack,
    );
    mockIncomingMessageReceive.mockReturnValueOnce(indefinitelyYieldValue(expectedMessage));

    await collectPong(PING_ID, firstPartyEndpoint);

    expect(ack).toBeCalled();
  });

  async function* indefinitelyYieldValue<T>(value: T): AsyncIterable<T> {
    while (true) {
      yield value;
    }
  }
});
