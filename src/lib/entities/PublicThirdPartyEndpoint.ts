import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

@Entity()
export class PublicThirdPartyEndpoint {
  @PrimaryColumn()
  public readonly publicAddress!: string;

  @Column()
  public readonly identityCertificateSerialized!: Buffer;

  @CreateDateColumn()
  public readonly expiryDate!: Date;
}
