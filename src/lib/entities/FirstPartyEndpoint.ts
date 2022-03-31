import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity()
export class FirstPartyEndpoint {
  @PrimaryColumn()
  public readonly privateAddress!: string;

  @Column()
  public readonly privateGatewayPrivateAddress!: string;
}
