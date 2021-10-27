export abstract class Endpoint {
  protected constructor(public privateAddress: string) {}

  public abstract getAddress(): Promise<string>;
}
