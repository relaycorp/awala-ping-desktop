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
  public static async load(privateAddress: string): Promise<ThirdPartyEndpoint | null> {
    const endpointRepository = getRepository(ThirdPartyEndpointEntity);
    const endpointRecord = await endpointRepository.findOne({ privateAddress });
    if (!endpointRecord) {
      return null;
    }
    return endpointRecord.publicAddress
      ? new PublicThirdPartyEndpoint(endpointRecord)
      : new PrivateThirdPartyEndpoint(endpointRecord);
  }

  protected static async importRaw(
    identityKey: CryptoKey,
    sessionKey: SessionKey,
    publicAddress?: string,
  ): Promise<ThirdPartyEndpointEntity> {
    const privateAddress = await getPrivateAddressFromIdentityKey(identityKey);

    const endpointRepository = getRepository(ThirdPartyEndpointEntity);
    const endpointRecord = endpointRepository.create({
      identityKeySerialized: await derSerializePublicKey(identityKey),
      privateAddress,
      publicAddress,
    });
    await endpointRepository.save(endpointRecord);

    const publicKeyStore = Container.get(DBPublicKeyStore);
    await publicKeyStore.saveSessionKey(sessionKey, privateAddress, new Date());

    return endpointRecord;
  }

  private readonly identityKeySerialized: Buffer;

  public constructor(endpointRecord: ThirdPartyEndpointEntity) {
    super(endpointRecord.privateAddress);

    this.identityKeySerialized = endpointRecord.identityKeySerialized;
  }

  public async getIdentityKey(): Promise<CryptoKey> {
    return derDeserializeRSAPublicKey(this.identityKeySerialized);
  }

  public async getSessionKey(): Promise<SessionKey> {
    const publicKeyStore = Container.get(DBPublicKeyStore);
    const sessionKey = await publicKeyStore.fetchLastSessionKey(this.privateAddress);
    if (!sessionKey) {
      throw new InvalidEndpointError(`Could not find session key for peer ${this.privateAddress}`);
    }
    return sessionKey;
  }
}

export class PrivateThirdPartyEndpoint extends ThirdPartyEndpoint {
  public static async import(
    identityKey: CryptoKey,
    sessionKey: SessionKey,
  ): Promise<PrivateThirdPartyEndpoint> {
    const endpointRecord = await ThirdPartyEndpoint.importRaw(identityKey, sessionKey);
    return new PrivateThirdPartyEndpoint(endpointRecord);
  }

  public getAddress(): Promise<string> {
    return Promise.resolve(this.privateAddress);
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
      throw new InvalidEndpointError(err as Error, 'Connection params serialization is malformed');
    }

    const endpointRecord = await ThirdPartyEndpoint.importRaw(
      params.identityKey,
      params.sessionKey,
      params.publicAddress,
    );
    return new PublicThirdPartyEndpoint(endpointRecord);
  }

  public static async load(publicAddress: string): Promise<PublicThirdPartyEndpoint | null> {
    const endpointRepository = getRepository(ThirdPartyEndpointEntity);
    const endpointRecord = await endpointRepository.findOne({ publicAddress });
    if (!endpointRecord) {
      return null;
    }
    return new PublicThirdPartyEndpoint(endpointRecord);
  }

  public readonly publicAddress: string;

  public constructor(endpointRecord: ThirdPartyEndpointEntity) {
    super(endpointRecord);
    this.publicAddress = endpointRecord.publicAddress!;
  }

  public getAddress(): Promise<string> {
    return Promise.resolve(`https://${this.publicAddress}`);
  }
}
