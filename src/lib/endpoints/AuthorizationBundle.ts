export interface AuthorizationBundle {
  readonly pdaSerialized: Buffer;
  readonly pdaChainSerialized: readonly Buffer[];
}
