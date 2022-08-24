import {
  Certificate,
  CertificationPath,
  getIdFromIdentityKey,
  issueDeliveryAuthorization,
} from '@relaycorp/relaynet-core';
import { addDays } from 'date-fns';
import { Container } from 'typedi';
import { version as uuidVersion } from 'uuid';

import {
  arrayToAsyncIterable,
  mockSpy,
  mockToken,
  NODE_INTERNET_ADDRESS,
  PEER_INTERNET_ADDRESS,
  setUpPKIFixture,
  setUpTestDataSource,
  useTemporaryAppDirs,
} from './lib/_test_utils';
import { FirstPartyEndpoint } from './lib/endpoints/FirstPartyEndpoint';
import { PublicThirdPartyEndpoint, ThirdPartyEndpoint } from './lib/endpoints/thirdPartyEndpoints';
import { DBCertificateStore } from './lib/keystores/DBCertificateStore';
import { DBPrivateKeyStore } from './lib/keystores/DBPrivateKeyStore';
import { IncomingMessage } from './lib/messaging/IncomingMessage';
import { OutgoingMessage } from './lib/messaging/OutgoingMessage';
import { GSC_CLIENT } from './lib/tokens';
import { collectPong, sendPing } from './pinging';

setUpTestDataSource();
useTemporaryAppDirs();
mockToken(GSC_CLIENT);

let firstPartyEndpoint: FirstPartyEndpoint;
let thirdPartyEndpoint: ThirdPartyEndpoint;
let gatewayCertificate: Certificate;
setUpPKIFixture(async (keyPairSet, certPath) => {
  firstPartyEndpoint = new FirstPartyEndpoint(
    certPath.privateEndpoint,
    keyPairSet.privateEndpoint.privateKey,
    await certPath.privateEndpoint.calculateSubjectId(),
    NODE_INTERNET_ADDRESS,
  );

  thirdPartyEndpoint = new PublicThirdPartyEndpoint(
    await getIdFromIdentityKey(keyPairSet.pdaGrantee.publicKey),
    PEER_INTERNET_ADDRESS,
    keyPairSet.pdaGrantee.publicKey,
  );

  gatewayCertificate = certPath.internetGateway;
});

beforeEach(async () => {
  const privateKeyStore = Container.get(DBPrivateKeyStore);
  await privateKeyStore.saveIdentityKey(firstPartyEndpoint.id, firstPartyEndpoint.privateKey);

  const certificateStore = Container.get(DBCertificateStore);
  await certificateStore.save(
    new CertificationPath(firstPartyEndpoint.identityCertificate, [gatewayCertificate]),
    await gatewayCertificate.calculateSubjectId(),
  );
});

describe('sendPing', () => {
  let pdaPath: CertificationPath;
  const mockIssueAuthorization = mockSpy(
    jest.spyOn(FirstPartyEndpoint.prototype, 'issueAuthorization'),
    () => pdaPath.serialize(),
  );
  beforeEach(async () => {
    const pda = await issueDeliveryAuthorization({
      issuerCertificate: firstPartyEndpoint.identityCertificate,
      issuerPrivateKey: firstPartyEndpoint.privateKey,
      subjectPublicKey: thirdPartyEndpoint.identityKey,
      validityEndDate: firstPartyEndpoint.identityCertificate.expiryDate,
    });
    pdaPath = new CertificationPath(pda, [firstPartyEndpoint.identityCertificate]);
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
    expect(recipient.id).toEqual(thirdPartyEndpoint.id);
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

    test('Internet address of endpoint should be included', async () => {
      await sendPing(firstPartyEndpoint, thirdPartyEndpoint);

      const pingMessage = extractServiceMessage();
      expect(pingMessage.pdaPathSerialized).toEqual(Buffer.from(pdaPath.serialize()));
    });

    test('PDA path should be included', async () => {
      await sendPing(firstPartyEndpoint, thirdPartyEndpoint);

      const pingMessage = extractServiceMessage();
      expect(pingMessage.internetAddress).toEqual(NODE_INTERNET_ADDRESS);
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

  interface Ping {
    readonly id: string;
    readonly internetAddress: string;
    readonly pdaPathSerialized: Buffer;
  }

  function extractServiceMessage(): Ping {
    expect(mockMessageBuild).toBeCalled();

    const serviceMessageJSON = mockMessageBuild.mock.calls[0][1].toString('utf8');
    const pingRaw = JSON.parse(serviceMessageJSON);
    const pdaPathSerialized = Buffer.from(pingRaw.pda_path, 'base64');
    return {
      id: pingRaw.id,
      internetAddress: pingRaw.endpoint_internet_address,
      pdaPathSerialized,
    };
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
    const unrelatedMessageAck = jest.fn();
    const unrelatedMessage = new IncomingMessage(
      PONG_SERVICE_MESSAGE_TYPE,
      Buffer.from(`not ${PING_ID}`),
      thirdPartyEndpoint,
      firstPartyEndpoint,
      unrelatedMessageAck,
    );
    const expectedMessageAck = jest.fn();
    const expectedMessage = new IncomingMessage(
      PONG_SERVICE_MESSAGE_TYPE,
      Buffer.from(PING_ID),
      thirdPartyEndpoint,
      firstPartyEndpoint,
      expectedMessageAck,
    );
    mockIncomingMessageReceive.mockReturnValueOnce(
      arrayToAsyncIterable([unrelatedMessage, expectedMessage]),
    );

    await expect(collectPong(PING_ID, firstPartyEndpoint)).resolves.toBeTrue();

    expect(unrelatedMessageAck).not.toBeCalled();
    expect(expectedMessageAck).toBeCalled();
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

    await expect(collectPong(PING_ID, firstPartyEndpoint)).resolves.toBeTrue();

    expect(ack).toBeCalled();
  });

  test('Error should be thrown if collection ends and ping has not been received', async () => {
    const ack = jest.fn();
    const unrelatedMessage = new IncomingMessage(
      PONG_SERVICE_MESSAGE_TYPE,
      Buffer.from(`not ${PING_ID}`),
      thirdPartyEndpoint,
      firstPartyEndpoint,
      ack,
    );
    mockIncomingMessageReceive.mockReturnValueOnce(arrayToAsyncIterable([unrelatedMessage]));

    await expect(collectPong(PING_ID, firstPartyEndpoint)).resolves.toBeFalse();
  });

  async function* indefinitelyYieldValue<T>(value: T): AsyncIterable<T> {
    while (true) {
      yield value;
    }
  }
});
