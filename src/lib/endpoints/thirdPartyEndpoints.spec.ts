import { IdentityPublicKey, SessionPublicKey } from '@relaycorp/keystore-db';
import {
  derSerializePublicKey,
  generateECDHKeyPair,
  generateRSAKeyPair,
  getIdFromIdentityKey,
  InvalidNodeConnectionParams,
  NodeConnectionParams,
  SessionKey,
} from '@relaycorp/relaynet-core';
import { Container } from 'typedi';

import { getPromiseRejection, PEER_INTERNET_ADDRESS, setUpTestDataSource } from '../_test_utils';
import { ThirdPartyEndpoint as ThirdPartyEndpointEntity } from '../entities/ThirdPartyEndpoint';
import { DBPublicKeyStore } from '../keystores/DBPublicKeyStore';
import InvalidEndpointError from './InvalidEndpointError';
import {
  PrivateThirdPartyEndpoint,
  PublicThirdPartyEndpoint,
  ThirdPartyEndpoint,
} from './thirdPartyEndpoints';

const getDataSource = setUpTestDataSource();

let endpointIdentityKey: CryptoKey;
let endpointSessionKey: SessionKey;
let endpointId: string;
beforeAll(async () => {
  const endpointKeyPair = await generateRSAKeyPair();
  endpointIdentityKey = endpointKeyPair.publicKey;
  endpointId = await getIdFromIdentityKey(endpointKeyPair.publicKey);

  const endpointSessionKeyPair = await generateECDHKeyPair();
  endpointSessionKey = {
    keyId: Buffer.from('session key id'),
    publicKey: endpointSessionKeyPair.publicKey,
  };
});

let endpointConnectionParams: NodeConnectionParams;
let endpointConnectionParamsSerialized: Buffer;
beforeAll(async () => {
  endpointConnectionParams = new NodeConnectionParams(PEER_INTERNET_ADDRESS, endpointIdentityKey, {
    keyId: Buffer.from('the session key id'),
    publicKey: endpointSessionKey.publicKey,
  });
  endpointConnectionParamsSerialized = Buffer.from(await endpointConnectionParams.serialize());
});

describe('ThirdPartyEndpoint', () => {
  describe('load', () => {
    test('Nothing should be returned if private address is unknown', async () => {
      await expect(ThirdPartyEndpoint.load(endpointId)).resolves.toBeNull();
    });

    test('Error should be thrown if endpoint exists but cannot find public key', async () => {
      const endpointRepository = getDataSource().getRepository(ThirdPartyEndpointEntity);
      await endpointRepository.save(
        endpointRepository.create({
          id: endpointId,
          internetAddress: PEER_INTERNET_ADDRESS,
          isPrivate: false,
        }),
      );

      await expect(ThirdPartyEndpoint.load(endpointId)).rejects.toThrowWithMessage(
        InvalidEndpointError,
        'Failed to get public key for endpoint',
      );
    });

    test('Public endpoint should be returned if found', async () => {
      const endpointRepository = getDataSource().getRepository(ThirdPartyEndpointEntity);
      await endpointRepository.save(
        endpointRepository.create({
          id: endpointId,
          internetAddress: PEER_INTERNET_ADDRESS,
          isPrivate: false,
        }),
      );
      const publicKeyStore = Container.get(DBPublicKeyStore);
      await publicKeyStore.saveIdentityKey(endpointIdentityKey);

      const endpoint = await ThirdPartyEndpoint.load(endpointId);

      expect(endpoint).toBeInstanceOf(PublicThirdPartyEndpoint);
      expect(endpoint!.privateAddress).toEqual(endpointId);
      expect(endpoint!.internetAddress).toEqual(PEER_INTERNET_ADDRESS);
      await expect(derSerializePublicKey(endpoint!.identityKey)).resolves.toEqual(
        await derSerializePublicKey(endpointIdentityKey),
      );
    });

    test('Private endpoint should be returned if found', async () => {
      const endpointRepository = getDataSource().getRepository(ThirdPartyEndpointEntity);
      const endpointRecord = endpointRepository.create({
        id: endpointId,
        internetAddress: PEER_INTERNET_ADDRESS,
        isPrivate: true,
      });
      await endpointRepository.save(endpointRecord);
      const publicKeyStore = Container.get(DBPublicKeyStore);
      await publicKeyStore.saveIdentityKey(endpointIdentityKey);

      const endpoint = await ThirdPartyEndpoint.load(endpointId);

      expect(endpoint).toBeInstanceOf(PrivateThirdPartyEndpoint);
      expect(endpoint!.privateAddress).toEqual(endpointId);
      expect(endpoint!.internetAddress).toEqual(PEER_INTERNET_ADDRESS);
      await expect(derSerializePublicKey(endpoint!.identityKey)).resolves.toEqual(
        await derSerializePublicKey(endpointIdentityKey),
      );
    });
  });

  describe('getSessionKey', () => {
    test('Error should be thrown if key is not found', async () => {
      const endpoint = new StubThirdPartyEndpoint(
        endpointId,
        PEER_INTERNET_ADDRESS,
        endpointIdentityKey,
      );

      await expect(endpoint.getSessionKey()).rejects.toThrowWithMessage(
        InvalidEndpointError,
        `Could not find session key for peer ${endpointId}`,
      );
    });

    test('Key should be returned if found', async () => {
      const endpoint = new StubThirdPartyEndpoint(
        endpointId,
        PEER_INTERNET_ADDRESS,
        endpointIdentityKey,
      );
      const publicKeyStore = Container.get(DBPublicKeyStore);
      await publicKeyStore.saveSessionKey(endpointSessionKey, endpointId, new Date());

      const retrievedSessionKey = await endpoint.getSessionKey();
      expect(retrievedSessionKey.keyId).toEqual(endpointSessionKey.keyId);
      await expect(derSerializePublicKey(retrievedSessionKey.publicKey)).resolves.toEqual(
        await derSerializePublicKey(endpointSessionKey.publicKey),
      );
    });
  });

  class StubThirdPartyEndpoint extends ThirdPartyEndpoint {}
});

describe('PrivateThirdPartyEndpoint', () => {
  describe('import', () => {
    describeImport(PublicThirdPartyEndpoint.import);

    test('Endpoint should be stored as private', async () => {
      await PrivateThirdPartyEndpoint.import(endpointConnectionParamsSerialized);

      const endpointRepository = getDataSource().getRepository(ThirdPartyEndpointEntity);
      const storedEndpoint = await endpointRepository.findOne({ where: { id: endpointId } });
      expect(storedEndpoint!.isPrivate).toBeTrue();
    });
  });
});

describe('PublicThirdPartyEndpoint', () => {
  describe('import', () => {
    describeImport(PublicThirdPartyEndpoint.import);

    test('Endpoint should be stored as public', async () => {
      await PublicThirdPartyEndpoint.import(endpointConnectionParamsSerialized);

      const endpointRepository = getDataSource().getRepository(ThirdPartyEndpointEntity);
      const storedEndpoint = await endpointRepository.findOne({ where: { id: endpointId } });
      expect(storedEndpoint!.isPrivate).toBeFalse();
    });
  });

  describe('load', () => {
    test('Endpoint should be loaded if it exists', async () => {
      await PublicThirdPartyEndpoint.import(
        Buffer.from(await endpointConnectionParams.serialize()),
      );

      const endpoint = await PublicThirdPartyEndpoint.load(PEER_INTERNET_ADDRESS);
      expect(endpoint).toBeTruthy();
      expect(endpoint!.privateAddress).toEqual(endpointId);
      expect(endpoint!.internetAddress).toEqual(PEER_INTERNET_ADDRESS);
      await expect(derSerializePublicKey(endpoint!.identityKey)).resolves.toEqual(
        await derSerializePublicKey(endpointIdentityKey),
      );
    });

    test('Null should be returned if the endpoint does not exist', async () => {
      await expect(PublicThirdPartyEndpoint.load(PEER_INTERNET_ADDRESS)).resolves.toBeNull();
    });

    test('Error should be thrown if identity key cannot be found', async () => {
      await PublicThirdPartyEndpoint.import(
        Buffer.from(await endpointConnectionParams.serialize()),
      );
      const identityPublicKeyRepository = getDataSource().getRepository(IdentityPublicKey);
      await identityPublicKeyRepository.clear();

      await expect(PublicThirdPartyEndpoint.load(PEER_INTERNET_ADDRESS)).rejects.toThrowWithMessage(
        InvalidEndpointError,
        /^Could not find identity key/,
      );
    });
  });
});

function describeImport<E extends ThirdPartyEndpoint>(
  importFunction: (s: Buffer) => Promise<E>,
): void {
  test('Malformed connection parameters should be refused', async () => {
    const malformedSerialization = Buffer.from('malformed');

    const error = await getPromiseRejection(
      PublicThirdPartyEndpoint.import(malformedSerialization),
      InvalidEndpointError,
    );

    expect(error.message).toMatch(/^Connection params serialization is malformed/);
    expect(error.cause()).toBeInstanceOf(InvalidNodeConnectionParams);
  });

  describe('Well-formed serialization', () => {
    test('Public address should be parsed', async () => {
      const endpoint = await importFunction(endpointConnectionParamsSerialized);

      expect(endpoint.internetAddress).toEqual(PEER_INTERNET_ADDRESS);
    });

    test('Private address should be computed', async () => {
      const endpoint = await importFunction(endpointConnectionParamsSerialized);

      expect(endpoint.privateAddress).toEqual(endpointId);
    });

    test('Identity key should be computed', async () => {
      const endpoint = await importFunction(endpointConnectionParamsSerialized);

      await expect(derSerializePublicKey(endpoint.identityKey)).resolves.toEqual(
        await derSerializePublicKey(endpointConnectionParams.identityKey),
      );
    });

    test('Peer identity key should be stored', async () => {
      await importFunction(endpointConnectionParamsSerialized);

      const publicKeyStore = Container.get(DBPublicKeyStore);
      const key = await publicKeyStore.retrieveIdentityKey(endpointId);
      expect(key).toBeTruthy();
      await expect(derSerializePublicKey(key!)).resolves.toEqual(
        await derSerializePublicKey(endpointConnectionParams.identityKey),
      );
    });

    test('Peer public address should be stored', async () => {
      await importFunction(endpointConnectionParamsSerialized);

      const endpointRepository = getDataSource().getRepository(ThirdPartyEndpointEntity);
      const storedEndpoint = await endpointRepository.findOne({
        where: { id: endpointId },
      });
      expect(storedEndpoint).toBeTruthy();
      expect(storedEndpoint!.internetAddress).toEqual(PEER_INTERNET_ADDRESS);
    });

    test('Peer session key should be stored', async () => {
      const startDate = new Date();

      await importFunction(endpointConnectionParamsSerialized);

      const publicKeyRepository = getDataSource().getRepository(SessionPublicKey);
      const publicKey = await publicKeyRepository.findOneOrFail({
        where: { peerId: endpointId },
      });
      expect(publicKey.id).toEqual(endpointConnectionParams.sessionKey.keyId);
      expect(publicKey.derSerialization).toEqual(
        await derSerializePublicKey(endpointSessionKey.publicKey),
      );
      expect(publicKey.creationDate).toBeBeforeOrEqualTo(new Date());
      expect(publicKey.creationDate).toBeAfterOrEqualTo(startDate);
    });
  });
}
