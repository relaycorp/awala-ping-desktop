// tslint:disable:max-classes-per-file

import {
  derDeserializeRSAPublicKey,
  derSerializePublicKey,
  getPrivateAddressFromIdentityKey,
  PublicNodeConnectionParams,
  SessionKey,
} from '@relaycorp/relaynet-core';
import bufferToArray from 'buffer-to-arraybuffer';
import { Container } from 'typedi';
import { getRepository } from 'typeorm';

import { ThirdPartyEndpoint as ThirdPartyEndpointEntity } from '../entities/ThirdPartyEndpoint';
import { DBPublicKeyStore } from '../keystores/DBPublicKeyStore';
import { Endpoint } from './Endpoint';
import InvalidEndpointError from './InvalidEndpointError';

export abstract class ThirdPartyEndpoint extends Endpoint {
  public static async load(privateAddress: string): Promise<Endpoint | null> {
    const endpointRepository = getRepository(ThirdPartyEndpointEntity);
    const endpointRecord = await endpointRepository.findOne({ privateAddress });
    if (!endpointRecord) {
      return null;
    }
    const identityKey = await derDeserializeRSAPublicKey(endpointRecord.identityKeySerialized);
    return endpointRecord.publicAddress
      ? new PublicThirdPartyEndpoint(endpointRecord.publicAddress, identityKey)
      : new PrivateThirdPartyEndpoint(identityKey);
  }

  public async getSessionKey(): Promise<SessionKey> {
    const publicKeyStore = Container.get(DBPublicKeyStore);
    const privateAddress = await this.getPrivateAddress();
    const sessionKey = await publicKeyStore.fetchLastSessionKey(privateAddress);
    if (!sessionKey) {
      throw new InvalidEndpointError(`Could not find session key for peer ${privateAddress}`);
    }
    return sessionKey;
  }
}

export class PrivateThirdPartyEndpoint extends ThirdPartyEndpoint {
  public getAddress(): Promise<string> {
    throw new Error('implement');
  }
}

export class PublicThirdPartyEndpoint extends ThirdPartyEndpoint {
  public static async import(
    connectionParamsSerialized: Buffer,
  ): Promise<PublicThirdPartyEndpoint> {
    let params: PublicNodeConnectionParams;
    try {
      params = await PublicNodeConnectionParams.deserialize(
        bufferToArray(connectionParamsSerialized),
      );
    } catch (err) {
      throw new InvalidEndpointError(err, 'Connection params serialization is malformed');
    }

    const privateAddress = await getPrivateAddressFromIdentityKey(params.identityKey);
    const endpointRepository = getRepository(ThirdPartyEndpointEntity);
    const endpoint = endpointRepository.create({
      identityKeySerialized: await derSerializePublicKey(params.identityKey),
      privateAddress,
      publicAddress: params.publicAddress,
    });
    await endpointRepository.save(endpoint);

    const publicKeyStore = Container.get(DBPublicKeyStore);
    await publicKeyStore.saveSessionKey(params.sessionKey, privateAddress, new Date());

    return new PublicThirdPartyEndpoint(params.publicAddress, params.identityKey);
  }

  public static async load(publicAddress: string): Promise<PublicThirdPartyEndpoint | null> {
    const endpointRepository = getRepository(ThirdPartyEndpointEntity);
    const endpointRecord = await endpointRepository.findOne({ publicAddress });
    if (!endpointRecord) {
      return null;
    }

    const identityPublicKey = await derDeserializeRSAPublicKey(
      endpointRecord.identityKeySerialized,
    );
    return new PublicThirdPartyEndpoint(publicAddress, identityPublicKey);
  }

  public constructor(protected publicAddress: string, identityPublicKey: CryptoKey) {
    super(identityPublicKey);
  }

  public getAddress(): Promise<string> {
    return Promise.resolve(`https://${this.publicAddress}`);
  }
}
