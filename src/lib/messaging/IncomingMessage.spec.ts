import {
  Certificate,
  generateRSAKeyPair,
  issueEndpointCertificate,
  Parcel,
  ParcelCollection,
  RAMFSyntaxError,
  ServiceMessage,
  SessionlessEnvelopedData,
  StreamingMode,
} from '@relaycorp/relaynet-core';
import { CollectParcelsCall } from '@relaycorp/relaynet-testing';
import { Container } from 'typedi';
import { EntityNotFoundError, getRepository } from 'typeorm';

import {
  arrayBufferFrom,
  arrayToAsyncIterable,
  asyncIterableToArray,
  getPromiseRejection,
  mockLoggerToken,
  partialPinoLog,
  setUpPKIFixture,
  setUpTestDBConnection,
} from '../_test_utils';
import { FirstPartyEndpoint } from '../endpoints/FirstPartyEndpoint';
import InvalidEndpointError from '../endpoints/InvalidEndpointError';
import { PublicThirdPartyEndpoint } from '../endpoints/thirdPartyEndpoints';
import { ThirdPartyEndpoint as PublicThirdPartyEndpointEntity } from '../entities/ThirdPartyEndpoint';
import { DBPrivateKeyStore } from '../keystores/DBPrivateKeyStore';
import { mockGSCClient } from './_test_utils';
import { IncomingMessage } from './IncomingMessage';

setUpTestDBConnection();

const mockLogs = mockLoggerToken();

let firstPartyEndpoint: FirstPartyEndpoint;
let thirdPartyEndpointCertificate: Certificate;
let thirdPartyEndpointPrivateKey: CryptoKey;
let gatewayCertificate: Certificate;
setUpPKIFixture(async (keyPairSet, certPath) => {
  firstPartyEndpoint = new FirstPartyEndpoint(
    certPath.privateEndpoint,
    keyPairSet.privateEndpoint.privateKey,
  );

  thirdPartyEndpointCertificate = certPath.pdaGrantee;
  thirdPartyEndpointPrivateKey = keyPairSet.pdaGrantee.privateKey;

  gatewayCertificate = certPath.privateGateway;
});

describe('receive', () => {
  const setGSCClientCalls = mockGSCClient();

  beforeEach(async () => {
    const privateKeyStore = Container.get(DBPrivateKeyStore);
    await privateKeyStore.saveNodeKey(
      firstPartyEndpoint.privateKey,
      firstPartyEndpoint.identityCertificate,
    );

    await PublicThirdPartyEndpoint.import(
      'wanaka.relaycorp.cloud',
      Buffer.from(thirdPartyEndpointCertificate.serialize()),
    );
  });

  test('At least one recipient should be specified', async () => {
    const error = await getPromiseRejection(
      asyncIterableToArray(IncomingMessage.receive([])),
      InvalidEndpointError,
    );

    expect(error.message).toEqual(
      'At least one endpoint must be specified when collecting messages',
    );
  });

  test('Recipient should be used as parcel collections signer', async () => {
    const parcelCollectionCall = new CollectParcelsCall(arrayToAsyncIterable([]));
    setGSCClientCalls(parcelCollectionCall);

    await asyncIterableToArray(IncomingMessage.receive([firstPartyEndpoint]));

    expect(parcelCollectionCall.wasCalled).toBeTrue();
    expect(parcelCollectionCall.arguments?.nonceSigners).toHaveLength(1);
    expect(
      parcelCollectionCall.arguments!.nonceSigners[0].certificate.isEqual(
        firstPartyEndpoint.identityCertificate,
      ),
    ).toBeTrue();
  });

  test('Parcels should be collected with Keep Alive', async () => {
    const parcelCollectionCall = new CollectParcelsCall(arrayToAsyncIterable([]));
    setGSCClientCalls(parcelCollectionCall);

    await asyncIterableToArray(IncomingMessage.receive([firstPartyEndpoint]));

    expect(parcelCollectionCall.wasCalled).toBeTrue();
    expect(parcelCollectionCall.arguments?.streamingMode).toEqual(StreamingMode.KEEP_ALIVE);
  });

  test('Malformed parcels should be skipped and acknowledged', async () => {
    const collectionAck = jest.fn();
    const parcelCollectionCall = new CollectParcelsCall(
      arrayToAsyncIterable([
        new ParcelCollection(
          arrayBufferFrom('malformed'),
          [firstPartyEndpoint.identityCertificate],
          collectionAck,
        ),
      ]),
    );
    setGSCClientCalls(parcelCollectionCall);

    await expect(
      asyncIterableToArray(IncomingMessage.receive([firstPartyEndpoint])),
    ).resolves.toHaveLength(0);

    expect(collectionAck).toBeCalled();
    expect(mockLogs).toContainEqual(
      partialPinoLog('warn', 'Received invalid parcel', {
        err: expect.objectContaining({ type: RAMFSyntaxError.name }),
      }),
    );
  });

  test('Parcels with malformed payloads should be skipped and acknowledged', async () => {
    const collectionAck = jest.fn();
    const parcelCollectionCall = new CollectParcelsCall(
      arrayToAsyncIterable([
        new ParcelCollection(
          await makeParcelRaw(Buffer.from('malformed')),
          [firstPartyEndpoint.identityCertificate],
          collectionAck,
        ),
      ]),
    );
    setGSCClientCalls(parcelCollectionCall);

    await expect(
      asyncIterableToArray(IncomingMessage.receive([firstPartyEndpoint])),
    ).resolves.toHaveLength(0);

    expect(collectionAck).toBeCalled();
  });

  test('Message should be output if parcel is valid', async () => {
    const { serviceMessage, parcelSerialized } = await makeValidParcel();
    const parcelCollectionCall = new CollectParcelsCall(
      arrayToAsyncIterable([
        new ParcelCollection(parcelSerialized, [firstPartyEndpoint.identityCertificate], jest.fn()),
      ]),
    );
    setGSCClientCalls(parcelCollectionCall);

    const [message] = await asyncIterableToArray(IncomingMessage.receive([firstPartyEndpoint]));

    expect(message).toBeTruthy();
    expect(message.type).toEqual(serviceMessage.type);
    expect(message.content).toEqual(serviceMessage.content);
  });

  test('Parcel collection should not be acknowledged if message is not acknowledged', async () => {
    const { parcelSerialized } = await makeValidParcel();
    const collectionAck = jest.fn();
    const parcelCollectionCall = new CollectParcelsCall(
      arrayToAsyncIterable([
        new ParcelCollection(
          parcelSerialized,
          [firstPartyEndpoint.identityCertificate],
          collectionAck,
        ),
      ]),
    );
    setGSCClientCalls(parcelCollectionCall);

    await asyncIterableToArray(IncomingMessage.receive([firstPartyEndpoint]));

    expect(collectionAck).not.toBeCalled();
  });

  test('Parcel collection should be acknowledged when message is acknowledged', async () => {
    const { parcelSerialized } = await makeValidParcel();
    const collectionAck = jest.fn();
    const parcelCollectionCall = new CollectParcelsCall(
      arrayToAsyncIterable([
        new ParcelCollection(
          parcelSerialized,
          [firstPartyEndpoint.identityCertificate],
          collectionAck,
        ),
      ]),
    );
    setGSCClientCalls(parcelCollectionCall);

    const [message] = await asyncIterableToArray(IncomingMessage.receive([firstPartyEndpoint]));
    await message.ack();

    expect(collectionAck).toBeCalled();
  });

  test('Sender endpoint should be populated if parcel is valid', async () => {
    const { parcelSerialized } = await makeValidParcel();
    const parcelCollectionCall = new CollectParcelsCall(
      arrayToAsyncIterable([
        new ParcelCollection(parcelSerialized, [firstPartyEndpoint.identityCertificate], jest.fn()),
      ]),
    );
    setGSCClientCalls(parcelCollectionCall);

    const [message] = await asyncIterableToArray(IncomingMessage.receive([firstPartyEndpoint]));

    expect(message.sender.identityCertificate.isEqual(thirdPartyEndpointCertificate)).toBeTrue();
  });

  test('Error should be thrown if sender is valid but unknown', async () => {
    const thirdPartyEndpointRepository = getRepository(PublicThirdPartyEndpointEntity);
    await thirdPartyEndpointRepository.clear();
    const { parcelSerialized } = await makeValidParcel();
    const parcelCollectionCall = new CollectParcelsCall(
      arrayToAsyncIterable([
        new ParcelCollection(parcelSerialized, [firstPartyEndpoint.identityCertificate], jest.fn()),
      ]),
    );
    setGSCClientCalls(parcelCollectionCall);

    const error = await getPromiseRejection(
      asyncIterableToArray(IncomingMessage.receive([firstPartyEndpoint])),
      InvalidEndpointError,
    );

    const privateAddress = await thirdPartyEndpointCertificate.calculateSubjectPrivateAddress();
    expect(error.message).toMatch(
      new RegExp(`^Could not find third-party endpoint with private address ${privateAddress}`),
    );
    expect(error.cause()).toBeInstanceOf(EntityNotFoundError);
  });

  test('Recipient endpoint should be set if parcel is valid', async () => {
    const additionalEndpointKeyPair = await generateRSAKeyPair();
    const additionalEndpointCertificate = await issueEndpointCertificate({
      issuerPrivateKey: additionalEndpointKeyPair.privateKey,
      subjectPublicKey: additionalEndpointKeyPair.publicKey,
      validityEndDate: firstPartyEndpoint.identityCertificate.expiryDate,
    });
    const additionalEndpoint = new FirstPartyEndpoint(
      additionalEndpointCertificate,
      additionalEndpointKeyPair.privateKey,
    );
    const { parcelSerialized } = await makeValidParcel();
    const parcelCollectionCall = new CollectParcelsCall(
      arrayToAsyncIterable([
        new ParcelCollection(parcelSerialized, [firstPartyEndpoint.identityCertificate], jest.fn()),
      ]),
    );
    setGSCClientCalls(parcelCollectionCall);

    const [message] = await asyncIterableToArray(
      IncomingMessage.receive([additionalEndpoint, firstPartyEndpoint]),
    );

    expect(message.recipient).toBe(firstPartyEndpoint);
  });
});

export interface GeneratedParcel {
  readonly serviceMessage: ServiceMessage;
  readonly parcelSerialized: ArrayBuffer;
}

async function makeValidParcel(): Promise<GeneratedParcel> {
  const serviceMessage = new ServiceMessage('the type', Buffer.from('the content'));
  const serviceMessageEncrypted = await SessionlessEnvelopedData.encrypt(
    serviceMessage.serialize(),
    firstPartyEndpoint.identityCertificate,
  );
  const payloadSerialized = Buffer.from(serviceMessageEncrypted.serialize());
  const parcelSerialized = await makeParcelRaw(payloadSerialized);
  return {
    parcelSerialized,
    serviceMessage,
  };
}

async function makeParcelRaw(payloadSerialized: Buffer): Promise<ArrayBuffer> {
  const parcel = new Parcel(
    firstPartyEndpoint.privateAddress,
    thirdPartyEndpointCertificate,
    payloadSerialized,
    {
      senderCaCertificateChain: [firstPartyEndpoint.identityCertificate, gatewayCertificate],
    },
  );
  return parcel.serialize(thirdPartyEndpointPrivateKey);
}
