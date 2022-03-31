import VError from 'verror';

export default class BaseError extends VError {
  get name(): string {
    return this.constructor.name;
  }
}
