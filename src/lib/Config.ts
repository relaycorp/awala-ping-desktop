import { Inject, Service } from 'typedi';
import { DataSource, Repository } from 'typeorm';

import { ConfigItem } from './entities/ConfigItem';
import { DATA_SOURCE } from './tokens';

export enum ConfigKey {
  ACTIVE_FIRST_PARTY_ENDPOINT_ADDRESS = 'first_party_endpoint_address',
}

@Service()
export class Config {
  private readonly repository: Repository<ConfigItem>;

  constructor(@Inject(DATA_SOURCE) dataSource: DataSource) {
    this.repository = dataSource.getRepository(ConfigItem);
  }

  public async get(key: ConfigKey): Promise<string | null> {
    const item = await this.repository.findOne({ where: { key } });
    return item?.value ?? null;
  }

  public async set(key: ConfigKey, value: string): Promise<void> {
    const configItem = await this.repository.create({ key, value });
    await this.repository.save(configItem);
  }
}
