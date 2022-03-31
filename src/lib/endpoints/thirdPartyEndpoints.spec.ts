import { IdentityPublicKey, SessionPublicKey } from '@relaycorp/keystore-db';
import {
  derSerializePublicKey,
  generateECDHKeyPair,
  generateRSAKeyPair,
  getPrivateAddressFromIdentityKey,
  InvalidPublicNodeConnectionParams,
  PublicNodeConnectionParams,
  SessionKey,
} from '@relaycorp/relaynet-core';
import { subSeconds } from 'date-fns';
import { Container } from 'typedi';

import { getPromiseRejection, setUpTestDataSource } from '../_test_utils';
import { ThirdPartyEndpoint as ThirdPartyEndpointEntity } from '../entities/ThirdPartyEndpoint';
import { DBPublicKeyStore } from '../keystores/DBPublicKeyStore';
import InvalidEndpointError from './InvalidEndpointError';
import {
  PrivateThirdPartyEndpoint,
  PublicThirdPartyEndpoint,
  ThirdPartyEndpoint,
} from './thirdPartyEndpoints';

const getDataSource = setUpTestDataSource();

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
    test('Nothing should be returned if private address is unknown', async () => {
      await expect(ThirdPartyEndpoint.load(endpointPrivateAddress)).resolves.toBeNull();
    });

    test('Error should be thrown if endpoint exists but cannot find public key', async () => {
      const endpointRepository = getDataSource().getRepository(ThirdPartyEndpointEntity);
      await endpointRepository.save(
        endpointRepository.create({
          privateAddress: endpointPrivateAddress,
          publicAddress: PUBLIC_ADDRESS,
        }),
      );

      await expect(ThirdPartyEndpoint.load(endpointPrivateAddress)).rejects.toThrowWithMessage(
        InvalidEndpointError,
        'Failed to get public key for endpoint',
      );
    });

    test('Public endpoint should be returned if found', async () => {
      const endpointRepository = getDataSource().getRepository(ThirdPartyEndpointEntity);
      await endpointRepository.save(
        endpointRepository.create({
          privateAddress: endpointPrivateAddress,
          publicAddress: PUBLIC_ADDRESS,
        }),
      );
      const publicKeyStore = Container.get(DBPublicKeyStore);
      await publicKeyStore.saveIdentityKey(endpointIdentityKey);

      const endpoint = await ThirdPartyEndpoint.load(endpointPrivateAddress);

      expect(endpoint).toBeInstanceOf(PublicThirdPartyEndpoint);
      await expect((endpoint as PublicThirdPartyEndpoint).getAddress()).resolves.toEqual(
        `https://${PUBLIC_ADDRESS}`,
      );
      expect(endpoint!.privateAddress).toEqual(endpointPrivateAddress);
      await expect(derSerializePublicKey(endpoint!.identityKey)).resolves.toEqual(
        await derSerializePublicKey(endpointIdentityKey),
      );
    });

    test('Private endpoint should be returned if public address is not set', async () => {
      const endpointRepository = getDataSource().getRepository(ThirdPartyEndpointEntity);
      const endpointRecord = endpointRepository.create({
        privateAddress: endpointPrivateAddress,
      });
      await endpointRepository.save(endpointRecord);
      const publicKeyStore = Container.get(DBPublicKeyStore);
      await publicKeyStore.saveIdentityKey(endpointIdentityKey);

      const endpoint = await ThirdPartyEndpoint.load(endpointPrivateAddress);

      expect(endpoint).toBeInstanceOf(PrivateThirdPartyEndpoint);
      expect(endpoint!.privateAddress).toEqual(endpointPrivateAddress);
      await expect(derSerializePublicKey(endpoint!.identityKey)).resolves.toEqual(
        await derSerializePublicKey(endpointIdentityKey),
      );
    });
  });

  describe('getSessionKey', () => {
    test('Error should be thrown if key is not found', async () => {
      const endpoint = new StubThirdPartyEndpoint(
        {
          privateAddress: endpointPrivateAddress,
        },
        endpointIdentityKey,
      );

      await expect(endpoint.getSessionKey()).rejects.toThrowWithMessage(
        InvalidEndpointError,
        `Could not find session key for peer ${endpointPrivateAddress}`,
      );
    });

    test('Key should be returned if found', async () => {
      const endpoint = new StubThirdPartyEndpoint(
        {
          privateAddress: endpointPrivateAddress,
        },
        endpointIdentityKey,
      );
      const publicKeyStore = Container.get(DBPublicKeyStore);
      await publicKeyStore.saveSessionKey(endpointSessionKey, endpointPrivateAddress, new Date());

      const retrievedSessionKey = await endpoint.getSessionKey();
      expect(retrievedSessionKey.keyId).toEqual(endpointSessionKey.keyId);
      await expect(derSerializePublicKey(retrievedSessionKey.publicKey)).resolves.toEqual(
        await derSerializePublicKey(endpointSessionKey.publicKey),
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

      const publicKeyStore = Container.get(DBPublicKeyStore);
      const storedKey = await publicKeyStore.retrieveIdentityKey(endpointPrivateAddress);
      await expect(derSerializePublicKey(storedKey!)).resolves.toEqual(
        await derSerializePublicKey(endpointIdentityKey),
      );
    });

    test('Peer session key should be stored', async () => {
      await PrivateThirdPartyEndpoint.import(endpointIdentityKey, endpointSessionKey);

      const publicKeyRepository = getDataSource().getRepository(SessionPublicKey);
      const publicKey = await publicKeyRepository.findOneOrFail({
        where: { peerPrivateAddress: endpointPrivateAddress },
      });
      expect(publicKey.id).toEqual(endpointSessionKey.keyId);
      expect(publicKey.derSerialization).toEqual(
        await derSerializePublicKey(endpointSessionKey.publicKey),
      );
      expect(publicKey.creationDate).toBeBefore(new Date());
      expect(publicKey.creationDate).toBeAfter(subSeconds(new Date(), 2));
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

      test('Identity key should be computed', async () => {
        const serialization = await publicEndpointConnectionParams.serialize();

        const endpoint = await PublicThirdPartyEndpoint.import(Buffer.from(serialization));

        await expect(derSerializePublicKey(endpoint.identityKey)).resolves.toEqual(
          await derSerializePublicKey(publicEndpointConnectionParams.identityKey),
        );
      });

      test('Peer identity key should be stored', async () => {
        const serialization = await publicEndpointConnectionParams.serialize();

        await PublicThirdPartyEndpoint.import(Buffer.from(serialization));

        const publicKeyStore = Container.get(DBPublicKeyStore);
        const key = await publicKeyStore.retrieveIdentityKey(endpointPrivateAddress);
        expect(key).toBeTruthy();
        await expect(derSerializePublicKey(key!)).resolves.toEqual(
          await derSerializePublicKey(publicEndpointConnectionParams.identityKey),
        );
      });

      test('Peer public address should be stored', async () => {
        const serialization = await publicEndpointConnectionParams.serialize();

        await PublicThirdPartyEndpoint.import(Buffer.from(serialization));

        const endpointRepository = getDataSource().getRepository(ThirdPartyEndpointEntity);
        const storedEndpoint = await endpointRepository.findOne({
          where: { privateAddress: endpointPrivateAddress },
        });
        expect(storedEndpoint).toBeTruthy();
        expect(storedEndpoint?.publicAddress).toEqual(PUBLIC_ADDRESS);
      });

      test('Peer session key should be stored', async () => {
        const serialization = await publicEndpointConnectionParams.serialize();

        await PublicThirdPartyEndpoint.import(Buffer.from(serialization));

        const publicKeyRepository = getDataSource().getRepository(SessionPublicKey);
        const publicKey = await publicKeyRepository.findOneOrFail({
          where: { peerPrivateAddress: endpointPrivateAddress },
        });
        expect(publicKey.id).toEqual(publicEndpointConnectionParams.sessionKey.keyId);
        expect(publicKey.derSerialization).toEqual(
          await derSerializePublicKey(endpointSessionKey.publicKey),
        );
        expect(publicKey.creationDate).toBeBefore(new Date());
        expect(publicKey.creationDate).toBeAfter(subSeconds(new Date(), 2));
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
      expect(endpoint!.privateAddress).toEqual(endpointPrivateAddress);
      expect(endpoint!.publicAddress).toEqual(PUBLIC_ADDRESS);
      await expect(derSerializePublicKey(endpoint!.identityKey)).resolves.toEqual(
        await derSerializePublicKey(endpointIdentityKey),
      );
    });

    test('Null should be returned if the endpoint does not exist', async () => {
      await expect(PublicThirdPartyEndpoint.load(PUBLIC_ADDRESS)).resolves.toBeNull();
    });

    test('Error should be thrown if identity key cannot be found', async () => {
      await PublicThirdPartyEndpoint.import(
        Buffer.from(await publicEndpointConnectionParams.serialize()),
      );
      const identityPublicKeyRepository = getDataSource().getRepository(IdentityPublicKey);
      await identityPublicKeyRepository.clear();

      await expect(PublicThirdPartyEndpoint.load(PUBLIC_ADDRESS)).rejects.toThrowWithMessage(
        InvalidEndpointError,
        /^Could not find identity key/,
      );
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
