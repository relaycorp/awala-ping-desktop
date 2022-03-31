// tslint:disable:max-classes-per-file

import {
  getPrivateAddressFromIdentityKey,
  PublicNodeConnectionParams,
  SessionKey,
} from '@relaycorp/relaynet-core';
import bufferToArray from 'buffer-to-arraybuffer';
import { Container } from 'typedi';

import { ThirdPartyEndpoint as ThirdPartyEndpointEntity } from '../entities/ThirdPartyEndpoint';
import { DBPublicKeyStore } from '../keystores/DBPublicKeyStore';
import { DATA_SOURCE } from '../tokens';
import { Endpoint } from './Endpoint';
import InvalidEndpointError from './InvalidEndpointError';

export abstract class ThirdPartyEndpoint extends Endpoint {
  public static async load(privateAddress: string): Promise<ThirdPartyEndpoint | null> {
    const dataSource = Container.get(DATA_SOURCE);
    const endpointRepository = dataSource.getRepository(ThirdPartyEndpointEntity);
    const endpointRecord = await endpointRepository.findOne({ where: { privateAddress } });
    if (!endpointRecord) {
      return null;
    }

    const publicKeyStore = Container.get(DBPublicKeyStore);
    const identityKey = await publicKeyStore.retrieveIdentityKey(privateAddress);
    if (!identityKey) {
      throw new InvalidEndpointError('Failed to get public key for endpoint');
    }

    return endpointRecord.publicAddress
      ? new PublicThirdPartyEndpoint(endpointRecord, identityKey)
      : new PrivateThirdPartyEndpoint(endpointRecord, identityKey);
  }

  protected static async importRaw(
    identityKey: CryptoKey,
    sessionKey: SessionKey,
    publicAddress?: string,
  ): Promise<ThirdPartyEndpointEntity> {
    const privateAddress = await getPrivateAddressFromIdentityKey(identityKey);

    const dataSource = Container.get(DATA_SOURCE);
    const endpointRepository = dataSource.getRepository(ThirdPartyEndpointEntity);
    const endpointRecord = endpointRepository.create({
      privateAddress,
      publicAddress,
    });
    await endpointRepository.save(endpointRecord);

    const publicKeyStore = Container.get(DBPublicKeyStore);
    await publicKeyStore.saveIdentityKey(identityKey);
    await publicKeyStore.saveSessionKey(sessionKey, privateAddress, new Date());

    return endpointRecord;
  }

  public constructor(
    endpointRecord: ThirdPartyEndpointEntity,
    public readonly identityKey: CryptoKey,
  ) {
    super(endpointRecord.privateAddress);
  }

  public async getSessionKey(): Promise<SessionKey> {
    const publicKeyStore = Container.get(DBPublicKeyStore);
    const sessionKey = await publicKeyStore.retrieveLastSessionKey(this.privateAddress);
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
    return new PrivateThirdPartyEndpoint(endpointRecord, null as any);
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
      throw new InvalidEndpointError(err, 'Connection params serialization is malformed');
    }

    const endpointRecord = await ThirdPartyEndpoint.importRaw(
      params.identityKey,
      params.sessionKey,
      params.publicAddress,
    );
    return new PublicThirdPartyEndpoint(endpointRecord, params.identityKey);
  }

  public static async load(publicAddress: string): Promise<PublicThirdPartyEndpoint | null> {
    const dataSource = Container.get(DATA_SOURCE);
    const endpointRepository = dataSource.getRepository(ThirdPartyEndpointEntity);
    const endpointRecord = await endpointRepository.findOne({ where: { publicAddress } });
    if (!endpointRecord) {
      return null;
    }

    const publicKeyStore = Container.get(DBPublicKeyStore);
    const identityKey = await publicKeyStore.retrieveIdentityKey(endpointRecord.privateAddress);
    if (!identityKey) {
      throw new InvalidEndpointError('Could not find identity key');
    }

    return new PublicThirdPartyEndpoint(endpointRecord, identityKey);
  }

  public readonly publicAddress: string;

  public constructor(endpointRecord: ThirdPartyEndpointEntity, identityKey: CryptoKey) {
    super(endpointRecord, identityKey);
    this.publicAddress = endpointRecord.publicAddress!;
  }

  public getAddress(): Promise<string> {
    return Promise.resolve(`https://${this.publicAddress}`);
  }
}
