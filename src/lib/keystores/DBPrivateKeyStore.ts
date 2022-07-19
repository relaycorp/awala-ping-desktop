import {
  DBPrivateKeyStore as BaseDBPrivateKeyStore,
  IdentityPrivateKey,
  SessionPrivateKey,
} from '@relaycorp/keystore-db';
import { Inject, Service } from 'typedi';
import { DataSource } from 'typeorm';

import { DATA_SOURCE } from '../tokens';

@Service()
export class DBPrivateKeyStore extends BaseDBPrivateKeyStore {
  constructor(@Inject(DATA_SOURCE) dataSource: DataSource) {
    const identityKeyRepository = dataSource.getRepository(IdentityPrivateKey);
    const sessionKeyRepository = dataSource.getRepository(SessionPrivateKey);
    super(identityKeyRepository, sessionKeyRepository);
  }
}
