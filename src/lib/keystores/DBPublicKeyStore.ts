import {
  DBPublicKeyStore as BaseDBPublicKeyStore,
  IdentityPublicKey,
  SessionPublicKey,
} from '@relaycorp/keystore-db';
import { Inject, Service } from 'typedi';
import { DataSource } from 'typeorm';

import { DATA_SOURCE } from '../tokens';

@Service()
export class DBPublicKeyStore extends BaseDBPublicKeyStore {
  constructor(@Inject(DATA_SOURCE) dataSource: DataSource) {
    const identityKeyRepository = dataSource.getRepository(IdentityPublicKey);
    const sessionKeyRepository = dataSource.getRepository(SessionPublicKey);
    super(identityKeyRepository, sessionKeyRepository);
  }
}
