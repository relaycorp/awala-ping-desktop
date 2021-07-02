import { Parcel } from '@relaycorp/relaynet-core';
import { DeliverParcelCall } from '@relaycorp/relaynet-testing';
import { addDays, subMinutes, subSeconds } from 'date-fns';

import {
  SERVICE_MESSAGE_CONTENT,
  SERVICE_MESSAGE_TYPE,
  setUpPKIFixture,
  setUpTestDBConnection,
} from '../_test_utils';
import { FirstPartyEndpoint } from '../endpoints/FirstPartyEndpoint';
import { PublicThirdPartyEndpoint } from '../endpoints/PublicThirdPartyEndpoint';
import { ThirdPartyEndpoint } from '../endpoints/ThirdPartyEndpoint';
import { mockGSCClient } from './_test_utils';
import { OutgoingMessage } from './OutgoingMessage';

setUpTestDBConnection();

let firstPartyEndpoint: FirstPartyEndpoint;
let thirdPartyEndpoint: ThirdPartyEndpoint;
let thirdPartyPrivateKey: CryptoKey;
setUpPKIFixture(async (keyPairSet, certPath) => {
  firstPartyEndpoint = new FirstPartyEndpoint(
    certPath.privateEndpoint,
    keyPairSet.privateEndpoint.privateKey,
  );

  thirdPartyEndpoint = await PublicThirdPartyEndpoint.import(
    'pawnee.relaycorp.tech',
    Buffer.from(certPath.pdaGrantee.serialize()),
  );
  thirdPartyPrivateKey = keyPairSet.pdaGrantee.privateKey;
});

describe('build', () => {
  test('Service message should be encrypted with recipient key', async () => {
    const message = await OutgoingMessage.build(
      SERVICE_MESSAGE_TYPE,
      SERVICE_MESSAGE_CONTENT,
      firstPartyEndpoint,
      thirdPartyEndpoint,
    );

    const parcel = await Parcel.deserialize(message.parcelSerialized);
    await parcel.unwrapPayload(thirdPartyPrivateKey);
  });

  test('Service message should use the specified type', async () => {
    const message = await OutgoingMessage.build(
      SERVICE_MESSAGE_TYPE,
      SERVICE_MESSAGE_CONTENT,
      firstPartyEndpoint,
      thirdPartyEndpoint,
    );

    const parcel = await Parcel.deserialize(message.parcelSerialized);
    const { payload: serviceMessage } = await parcel.unwrapPayload(thirdPartyPrivateKey);
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
    const { payload: serviceMessage } = await parcel.unwrapPayload(thirdPartyPrivateKey);
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
    expect(parcel.recipientAddress).toEqual(await thirdPartyEndpoint.getAddress());
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
