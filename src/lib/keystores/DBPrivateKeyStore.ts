import { DBPrivateKeyStore as BaseDBPrivateKeyStore, PrivateKey } from '@relaycorp/keystore-db';
import { Inject, Service } from 'typedi';
import { DataSource } from 'typeorm';

import { DATA_SOURCE } from '../tokens';

@Service()
export class DBPrivateKeyStore extends BaseDBPrivateKeyStore {
  constructor(@Inject(DATA_SOURCE) dataSource: DataSource) {
    const repository = dataSource.getRepository(PrivateKey);
    super(repository);
  }
}
