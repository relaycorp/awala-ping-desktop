// tslint:disable:max-classes-per-file

import { getIdFromIdentityKey, NodeConnectionParams, SessionKey } from '@relaycorp/relaynet-core';
import bufferToArray from 'buffer-to-arraybuffer';
import { Container } from 'typedi';

import { ThirdPartyEndpoint as ThirdPartyEndpointEntity } from '../entities/ThirdPartyEndpoint';
import { DBPublicKeyStore } from '../keystores/DBPublicKeyStore';
import { DATA_SOURCE } from '../tokens';
import { Endpoint } from './Endpoint';
import InvalidEndpointError from './InvalidEndpointError';

interface ImportResult {
  readonly id: string;
  readonly internetAddress: string;
  readonly identityKey: CryptoKey;
}

export abstract class ThirdPartyEndpoint extends Endpoint {
  public static async load(privateAddress: string): Promise<ThirdPartyEndpoint | null> {
    const dataSource = Container.get(DATA_SOURCE);
    const endpointRepository = dataSource.getRepository(ThirdPartyEndpointEntity);
    const endpointRecord = await endpointRepository.findOne({ where: { id: privateAddress } });
    if (!endpointRecord) {
      return null;
    }

    const publicKeyStore = Container.get(DBPublicKeyStore);
    const identityKey = await publicKeyStore.retrieveIdentityKey(privateAddress);
    if (!identityKey) {
      throw new InvalidEndpointError('Failed to get public key for endpoint');
    }

    const endpointClass = endpointRecord.isPrivate
      ? PrivateThirdPartyEndpoint
      : PublicThirdPartyEndpoint;
    return new endpointClass(endpointRecord.id, endpointRecord.internetAddress, identityKey);
  }

  protected static async importRaw(
    connectionParamsSerialized: Buffer,
    isPrivate: boolean,
  ): Promise<ImportResult> {
    let params: NodeConnectionParams;
    try {
      params = await NodeConnectionParams.deserialize(bufferToArray(connectionParamsSerialized));
    } catch (err) {
      throw new InvalidEndpointError(err as Error, 'Connection params serialization is malformed');
    }

    const privateAddress = await getIdFromIdentityKey(params.identityKey);

    const dataSource = Container.get(DATA_SOURCE);
    const endpointRepository = dataSource.getRepository(ThirdPartyEndpointEntity);
    const endpointRecord = endpointRepository.create({
      id: privateAddress,
      internetAddress: params.internetAddress,
      isPrivate,
    });
    await endpointRepository.save(endpointRecord);

    const publicKeyStore = Container.get(DBPublicKeyStore);
    await publicKeyStore.saveIdentityKey(params.identityKey);
    await publicKeyStore.saveSessionKey(params.sessionKey, privateAddress, new Date());

    return {
      id: privateAddress,
      identityKey: params.identityKey,
      internetAddress: params.internetAddress,
    };
  }

  public constructor(
    id: string,
    public readonly internetAddress: string,
    public readonly identityKey: CryptoKey,
  ) {
    super(id);
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
    connectionParamsSerialized: Buffer,
  ): Promise<PrivateThirdPartyEndpoint> {
    const data = await ThirdPartyEndpoint.importRaw(connectionParamsSerialized, true);
    return new PrivateThirdPartyEndpoint(data.id, data.internetAddress, data.identityKey);
  }
}

export class PublicThirdPartyEndpoint extends ThirdPartyEndpoint {
  public static async import(
    connectionParamsSerialized: Buffer,
  ): Promise<PublicThirdPartyEndpoint> {
    const data = await ThirdPartyEndpoint.importRaw(connectionParamsSerialized, false);
    return new PrivateThirdPartyEndpoint(data.id, data.internetAddress, data.identityKey);
  }

  public static override async load(
    publicAddress: string,
  ): Promise<PublicThirdPartyEndpoint | null> {
    const dataSource = Container.get(DATA_SOURCE);
    const endpointRepository = dataSource.getRepository(ThirdPartyEndpointEntity);
    const endpointRecord = await endpointRepository.findOne({
      where: { internetAddress: publicAddress },
    });
    if (!endpointRecord) {
      return null;
    }

    const publicKeyStore = Container.get(DBPublicKeyStore);
    const identityKey = await publicKeyStore.retrieveIdentityKey(endpointRecord.id);
    if (!identityKey) {
      throw new InvalidEndpointError('Could not find identity key');
    }

    return new PublicThirdPartyEndpoint(endpointRecord.id, publicAddress, identityKey);
  }
}
