import BaseError from './BaseError';

test('.name should be taken from the name of the class', () => {
  class FooError extends BaseError {}
  const error = new FooError('Winter is coming');
  expect(error.name).toEqual('FooError');
});
