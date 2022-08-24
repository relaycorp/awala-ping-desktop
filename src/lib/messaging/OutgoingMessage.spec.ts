import {
  Certificate,
  Endpoint,
  getRSAPublicKeyFromPrivate,
  MockKeyStoreSet,
  NodeConnectionParams,
  Parcel,
  Recipient,
} from '@relaycorp/relaynet-core';
import { DeliverParcelCall } from '@relaycorp/relaynet-testing';
import { addDays, subMinutes, subSeconds } from 'date-fns';

import {
  NODE_INTERNET_ADDRESS,
  PEER_INTERNET_ADDRESS,
  SERVICE_MESSAGE_CONTENT,
  SERVICE_MESSAGE_TYPE,
  setUpPKIFixture,
  setUpTestDataSource,
} from '../_test_utils';
import { FirstPartyEndpoint } from '../endpoints/FirstPartyEndpoint';
import { PrivateThirdPartyEndpoint, ThirdPartyEndpoint } from '../endpoints/thirdPartyEndpoints';
import { mockGSCClient } from './_test_utils';
import { OutgoingMessage } from './OutgoingMessage';

setUpTestDataSource();

let firstPartyEndpoint: FirstPartyEndpoint;
let thirdPartyEndpointCertificate: Certificate;
let thirdPartyEndpointPrivateKey: CryptoKey;
setUpPKIFixture(async (keyPairSet, certPath) => {
  firstPartyEndpoint = new FirstPartyEndpoint(
    certPath.privateEndpoint,
    keyPairSet.privateEndpoint.privateKey,
    await certPath.privateEndpoint.calculateSubjectId(),
    NODE_INTERNET_ADDRESS,
  );

  thirdPartyEndpointCertificate = certPath.pdaGrantee;
  thirdPartyEndpointPrivateKey = keyPairSet.pdaGrantee.privateKey;
});

let thirdPartyEndpoint: ThirdPartyEndpoint;
let thirdPartyReverseEndpoint: Endpoint;
beforeEach(async () => {
  const thirdPartyKeystoreSet = new MockKeyStoreSet();
  thirdPartyReverseEndpoint = new Endpoint(
    await thirdPartyEndpointCertificate.calculateSubjectId(),
    thirdPartyEndpointPrivateKey,
    thirdPartyKeystoreSet,
    {},
  );

  const sessionKey = await thirdPartyReverseEndpoint.generateSessionKey(
    firstPartyEndpoint.privateAddress,
  );

  const connectionParams = new NodeConnectionParams(
    PEER_INTERNET_ADDRESS,
    await getRSAPublicKeyFromPrivate(thirdPartyEndpointPrivateKey),
    sessionKey,
  );
  const connectionParamsSerialized = await connectionParams.serialize();
  thirdPartyEndpoint = await PrivateThirdPartyEndpoint.import(
    Buffer.from(connectionParamsSerialized),
  );
});

describe('build', () => {
  test('Service message should use the specified type', async () => {
    const message = await OutgoingMessage.build(
      SERVICE_MESSAGE_TYPE,
      SERVICE_MESSAGE_CONTENT,
      firstPartyEndpoint,
      thirdPartyEndpoint,
    );

    const parcel = await Parcel.deserialize(message.parcelSerialized);
    const serviceMessage = await thirdPartyReverseEndpoint.unwrapMessagePayload(parcel);
    expect(serviceMessage.type).toEqual(SERVICE_MESSAGE_TYPE);
  });

  test('Service message should contain the specified content', async () => {
    const message = await OutgoingMessage.build(
      SERVICE_MESSAGE_TYPE,
      SERVICE_MESSAGE_CONTENT,
      firstPartyEndpoint,
      thirdPartyEndpoint,
    );

    const parcel = await Parcel.deserialize(message.parcelSerialized);
    const serviceMessage = await thirdPartyReverseEndpoint.unwrapMessagePayload(parcel);
    expect(serviceMessage.content).toEqual(SERVICE_MESSAGE_CONTENT);
  });

  test('Parcel should use the specified sender', async () => {
    const message = await OutgoingMessage.build(
      SERVICE_MESSAGE_TYPE,
      SERVICE_MESSAGE_CONTENT,
      firstPartyEndpoint,
      thirdPartyEndpoint,
    );

    const parcel = await Parcel.deserialize(message.parcelSerialized);
    expect(parcel.senderCertificate.isEqual(firstPartyEndpoint.identityCertificate)).toBeTrue();
  });

  test('Recipient should be the specified one', async () => {
    const message = await OutgoingMessage.build(
      SERVICE_MESSAGE_TYPE,
      SERVICE_MESSAGE_CONTENT,
      firstPartyEndpoint,
      thirdPartyEndpoint,
    );

    const parcel = await Parcel.deserialize(message.parcelSerialized);
    expect(parcel.recipient).toEqual<Recipient>({
      id: thirdPartyEndpoint.privateAddress,
      internetAddress: thirdPartyEndpoint.internetAddress,
    });
  });

  test('Creation date should be 5 minutes in the past', async () => {
    const message = await OutgoingMessage.build(
      SERVICE_MESSAGE_TYPE,
      SERVICE_MESSAGE_CONTENT,
      firstPartyEndpoint,
      thirdPartyEndpoint,
    );

    const parcel = await Parcel.deserialize(message.parcelSerialized);
    const expectedDate = subMinutes(new Date(), 5);
    expect(parcel.creationDate).toBeBefore(expectedDate);
    expect(parcel.creationDate).toBeAfter(subSeconds(expectedDate, 5));
  });

  test('Expiry date should be 14 days from now', async () => {
    const message = await OutgoingMessage.build(
      SERVICE_MESSAGE_TYPE,
      SERVICE_MESSAGE_CONTENT,
      firstPartyEndpoint,
      thirdPartyEndpoint,
    );

    const parcel = await Parcel.deserialize(message.parcelSerialized);
    const expectedDate = addDays(new Date(), 14);
    expect(parcel.expiryDate).toBeAfter(subSeconds(expectedDate, 5));
    expect(parcel.expiryDate).toBeBefore(expectedDate);
  });
});

describe('send', () => {
  const setGSCClientCalls = mockGSCClient();

  test('Generated parcel should be delivered', async () => {
    const message = await OutgoingMessage.build(
      SERVICE_MESSAGE_TYPE,
      SERVICE_MESSAGE_CONTENT,
      firstPartyEndpoint,
      thirdPartyEndpoint,
    );
    const deliverParcelCall = new DeliverParcelCall();
    setGSCClientCalls(deliverParcelCall);

    await message.send();

    expect(deliverParcelCall.wasCalled).toBeTrue();
    expect(deliverParcelCall.arguments!.parcelSerialized).toEqual(message.parcelSerialized);
  });

  test('Delivery signer should be first party endpoint', async () => {
    const message = await OutgoingMessage.build(
      SERVICE_MESSAGE_TYPE,
      SERVICE_MESSAGE_CONTENT,
      firstPartyEndpoint,
      thirdPartyEndpoint,
    );
    const deliverParcelCall = new DeliverParcelCall();
    setGSCClientCalls(deliverParcelCall);

    await message.send();

    expect(deliverParcelCall.wasCalled).toBeTrue();
    expect(
      deliverParcelCall.arguments!.deliverySigner.certificate.isEqual(
        firstPartyEndpoint.identityCertificate,
      ),
    ).toBeTrue();
  });
});
