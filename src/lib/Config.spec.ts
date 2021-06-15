import { getConnection, Repository } from 'typeorm';

import { setUpTestDBConnection } from './_test_utils';
import { Config, ConfigKey } from './Config';
import { ConfigItem } from './entities/ConfigItem';

setUpTestDBConnection();

let config: Config;
let configRepository: Repository<ConfigItem>;
beforeEach(() => {
  const connection = getConnection();
  configRepository = connection.getRepository(ConfigItem);
  config = new Config(configRepository);
});

const TOKEN = ConfigKey.ACTIVE_FIRST_PARTY_ENDPOINT_ID;
const VALUE = 'foo';

describe('get', () => {
  test('Missing key should result in null', async () => {
    await expect(config.get(TOKEN)).resolves.toBeNull();
  });

  test('Existing key should be returned', async () => {
    await config.set(TOKEN, VALUE);

    await expect(config.get(TOKEN)).resolves.toEqual(VALUE);
  });
});

describe('set', () => {
  test('Missing key should be created', async () => {
    await config.set(TOKEN, VALUE);

    await expect(configRepository.findOne(TOKEN)).resolves.toHaveProperty('value', VALUE);
  });

  test('Existing key should be replaced', async () => {
    const newValue = VALUE + ' new';

    await config.set(TOKEN, VALUE);
    await config.set(TOKEN, newValue);

    await expect(configRepository.findOne(TOKEN)).resolves.toHaveProperty('value', newValue);
  });
});
