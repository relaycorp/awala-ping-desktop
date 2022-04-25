import { Certificate, DBCertificateStore as BaseDBCertificateStore } from '@relaycorp/keystore-db';
import { Inject, Service } from 'typedi';
import { DataSource } from 'typeorm';

import { DATA_SOURCE } from '../tokens';

@Service()
export class DBCertificateStore extends BaseDBCertificateStore {
  constructor(@Inject(DATA_SOURCE) dataSource: DataSource) {
    const repository = dataSource.getRepository(Certificate);
    super(repository);
  }
}
