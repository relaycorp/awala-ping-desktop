import VError from 'verror';

export default class BaseError extends VError {
  override get name(): string {
    return this.constructor.name;
  }
}
