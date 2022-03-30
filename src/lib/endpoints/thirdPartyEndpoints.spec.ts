import { PublicKey } from '@relaycorp/keystore-db';
import {
  derSerializePublicKey,
  generateECDHKeyPair,
  generateRSAKeyPair,
  getPrivateAddressFromIdentityKey,
  InvalidPublicNodeConnectionParams,
  PublicNodeConnectionParams,
  SessionKey,
} from '@relaycorp/relaynet-core';
import { Container } from 'typedi';
import { getRepository } from 'typeorm';

import { getPromiseRejection, setUpTestDBConnection } from '../_test_utils';
import { ThirdPartyEndpoint as ThirdPartyEndpointEntity } from '../entities/ThirdPartyEndpoint';
import { DBPublicKeyStore } from '../keystores/DBPublicKeyStore';
import InvalidEndpointError from './InvalidEndpointError';
import {
  PrivateThirdPartyEndpoint,
  PublicThirdPartyEndpoint,
  ThirdPartyEndpoint,
} from './thirdPartyEndpoints';

setUpTestDBConnection();

const PUBLIC_ADDRESS = 'valencia.relaycorp.cloud';

let endpointIdentityKey: CryptoKey;
let endpointSessionKey: SessionKey;
let endpointPrivateAddress: string;
beforeAll(async () => {
  const endpointKeyPair = await generateRSAKeyPair();
  endpointIdentityKey = endpointKeyPair.publicKey;
  endpointPrivateAddress = await getPrivateAddressFromIdentityKey(endpointKeyPair.publicKey);

  const endpointSessionKeyPair = await generateECDHKeyPair();
  endpointSessionKey = {
    keyId: Buffer.from('session key id'),
    publicKey: endpointSessionKeyPair.publicKey,
  };
});

describe('ThirdPartyEndpoint', () => {
  describe('load', () => {
    test('Error should be thrown if private address is unknown', async () => {
      await expect(ThirdPartyEndpoint.load(endpointPrivateAddress)).resolves.toBeNull();
    });

    test('Public endpoint should be returned if public address is set', async () => {
      const endpointRepository = getRepository(ThirdPartyEndpointEntity);
      const endpointRecord = endpointRepository.create({
        identityKeySerialized: await derSerializePublicKey(endpointIdentityKey),
        privateAddress: endpointPrivateAddress,
        publicAddress: PUBLIC_ADDRESS,
      });
      await endpointRepository.save(endpointRecord);

      const endpoint = await ThirdPartyEndpoint.load(endpointPrivateAddress);

      expect(endpoint).toBeInstanceOf(PublicThirdPartyEndpoint);
      await expect((endpoint as PublicThirdPartyEndpoint).getAddress()).resolves.toEqual(
        `https://${PUBLIC_ADDRESS}`,
      );
      expect(endpoint!.privateAddress).toEqual(endpointPrivateAddress);
    });

    test('Private endpoint should be returned if public address is not set', async () => {
      const endpointRepository = getRepository(ThirdPartyEndpointEntity);
      const endpointRecord = endpointRepository.create({
        identityKeySerialized: await derSerializePublicKey(endpointIdentityKey),
        privateAddress: endpointPrivateAddress,
      });
      await endpointRepository.save(endpointRecord);

      const endpoint = await ThirdPartyEndpoint.load(endpointPrivateAddress);

      expect(endpoint).toBeInstanceOf(PrivateThirdPartyEndpoint);
      expect(endpoint!.privateAddress).toEqual(endpointPrivateAddress);
    });
  });

  describe('getSessionKey', () => {
    test('Error should be thrown if key is not found', async () => {
      const endpoint = new StubThirdPartyEndpoint({
        identityKeySerialized: await derSerializePublicKey(endpointIdentityKey),
        privateAddress: endpointPrivateAddress,
      });

      await expect(endpoint.getSessionKey()).rejects.toThrowWithMessage(
        InvalidEndpointError,
        `Could not find session key for peer ${endpointPrivateAddress}`,
      );
    });

    test('Key should be returned if found', async () => {
      const endpoint = new StubThirdPartyEndpoint({
        identityKeySerialized: await derSerializePublicKey(endpointIdentityKey),
        privateAddress: endpointPrivateAddress,
      });
      const publicKeyStore = Container.get(DBPublicKeyStore);
      await publicKeyStore.saveSessionKey(endpointSessionKey, endpointPrivateAddress, new Date());

      const retrievedSessionKey = await endpoint.getSessionKey();
      expect(retrievedSessionKey.keyId).toEqual(endpointSessionKey.keyId);
      await expect(derSerializePublicKey(retrievedSessionKey.publicKey)).resolves.toEqual(
        await derSerializePublicKey(endpointSessionKey.publicKey),
      );
    });
  });

  describe('getIdentityKey', () => {
    test('Identity key should be returned deserialized', async () => {
      const identityKeySerialized = await derSerializePublicKey(endpointIdentityKey);
      const endpoint = new StubThirdPartyEndpoint({
        identityKeySerialized,
        privateAddress: endpointPrivateAddress,
      });

      await expect(derSerializePublicKey(await endpoint.getIdentityKey())).resolves.toEqual(
        identityKeySerialized,
      );
    });
  });

  class StubThirdPartyEndpoint extends ThirdPartyEndpoint {
    public async getAddress(): Promise<string> {
      throw new Error('unimplemented');
    }
  }
});

describe('PrivateThirdPartyEndpoint', () => {
  describe('import', () => {
    test('Private address should be computed', async () => {
      const endpoint = await PrivateThirdPartyEndpoint.import(
        endpointIdentityKey,
        endpointSessionKey,
      );

      expect(endpoint.privateAddress).toEqual(endpointPrivateAddress);
    });

    test('Peer identity should be stored', async () => {
      await PrivateThirdPartyEndpoint.import(endpointIdentityKey, endpointSessionKey);

      const endpointRepository = getRepository(ThirdPartyEndpointEntity);
      const storedEndpoint = await endpointRepository.findOne(endpointPrivateAddress);
      expect(storedEndpoint).toBeTruthy();
      expect(storedEndpoint?.identityKeySerialized).toEqual(
        await derSerializePublicKey(endpointIdentityKey),
      );
    });

    test('Peer session key should be stored', async () => {
      const startDate = new Date();

      await PrivateThirdPartyEndpoint.import(endpointIdentityKey, endpointSessionKey);

      const publicKeyRepository = getRepository(PublicKey);
      const publicKey = await publicKeyRepository.findOneOrFail(endpointPrivateAddress);
      expect(publicKey.id).toEqual(endpointSessionKey.keyId);
      expect(publicKey.derSerialization).toEqual(
        await derSerializePublicKey(endpointSessionKey.publicKey),
      );
      expect(publicKey.creationDate).toBeBefore(new Date());
      expect(publicKey.creationDate).toBeAfterOrEqualTo(startDate);
    });
  });

  test('getAddress() should return private address', async () => {
    const endpoint = await PrivateThirdPartyEndpoint.import(
      endpointIdentityKey,
      endpointSessionKey,
    );

    await expect(endpoint.getAddress()).resolves.toEqual(endpointPrivateAddress);
  });
});

describe('PublicThirdPartyEndpoint', () => {
  let publicEndpointConnectionParams: PublicNodeConnectionParams;
  beforeAll(() => {
    publicEndpointConnectionParams = new PublicNodeConnectionParams(
      PUBLIC_ADDRESS,
      endpointIdentityKey,
      {
        keyId: Buffer.from('the session key id'),
        publicKey: endpointSessionKey.publicKey,
      },
    );
  });

  describe('import', () => {
    test('Malformed connection parameters should be refused', async () => {
      const malformedSerialization = Buffer.from('malformed');

      const error = await getPromiseRejection(
        PublicThirdPartyEndpoint.import(malformedSerialization),
        InvalidEndpointError,
      );

      expect(error.message).toMatch(/^Connection params serialization is malformed/);
      expect(error.cause()).toBeInstanceOf(InvalidPublicNodeConnectionParams);
    });

    describe('Well-formed serialization', () => {
      test('Public address should be parsed', async () => {
        const serialization = await publicEndpointConnectionParams.serialize();

        const endpoint = await PublicThirdPartyEndpoint.import(Buffer.from(serialization));

        await expect(endpoint.getAddress()).resolves.toEqual(`https://${PUBLIC_ADDRESS}`);
      });

      test('Private address should be computed', async () => {
        const serialization = await publicEndpointConnectionParams.serialize();

        const endpoint = await PublicThirdPartyEndpoint.import(Buffer.from(serialization));

        expect(endpoint.privateAddress).toEqual(endpointPrivateAddress);
      });

      test('Peer identity should be stored', async () => {
        const serialization = await publicEndpointConnectionParams.serialize();

        await PublicThirdPartyEndpoint.import(Buffer.from(serialization));

        const endpointRepository = getRepository(ThirdPartyEndpointEntity);
        const storedEndpoint = await endpointRepository.findOne(endpointPrivateAddress);
        expect(storedEndpoint).toBeTruthy();
        expect(storedEndpoint?.publicAddress).toEqual(PUBLIC_ADDRESS);
        expect(storedEndpoint?.identityKeySerialized).toEqual(
          await derSerializePublicKey(publicEndpointConnectionParams.identityKey),
        );
      });

      test('Peer session key should be stored', async () => {
        const serialization = await publicEndpointConnectionParams.serialize();
        const startDate = new Date();

        await PublicThirdPartyEndpoint.import(Buffer.from(serialization));

        const publicKeyRepository = getRepository(PublicKey);
        const publicKey = await publicKeyRepository.findOneOrFail(endpointPrivateAddress);
        expect(publicKey.id).toEqual(publicEndpointConnectionParams.sessionKey.keyId);
        expect(publicKey.derSerialization).toEqual(
          await derSerializePublicKey(endpointSessionKey.publicKey),
        );
        expect(publicKey.creationDate).toBeBefore(new Date());
        expect(publicKey.creationDate).toBeAfterOrEqualTo(startDate);
      });
    });
  });

  describe('load', () => {
    test('Endpoint should be loaded if it exists', async () => {
      await PublicThirdPartyEndpoint.import(
        Buffer.from(await publicEndpointConnectionParams.serialize()),
      );

      const endpoint = await PublicThirdPartyEndpoint.load(PUBLIC_ADDRESS);
      expect(endpoint).toBeTruthy();
      expect(endpoint?.privateAddress).toEqual(endpointPrivateAddress);
      expect(endpoint?.publicAddress).toEqual(PUBLIC_ADDRESS);
    });

    test('Null should be returned if the endpoint does not exist', async () => {
      await expect(PublicThirdPartyEndpoint.load(PUBLIC_ADDRESS)).resolves.toBeNull();
    });
  });

  describe('getAddress', () => {
    test('Output should be public address', async () => {
      const endpoint = await PublicThirdPartyEndpoint.import(
        Buffer.from(await publicEndpointConnectionParams.serialize()),
      );

      await expect(endpoint.getAddress()).resolves.toEqual(`https://${PUBLIC_ADDRESS}`);
    });
  });
});
