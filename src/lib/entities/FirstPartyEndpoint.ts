import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity()
export class FirstPartyEndpoint {
  @PrimaryColumn()
  public readonly id!: string;

  @Column()
  public readonly gatewayId!: string;

  @Column()
  public readonly gatewayInternetAddress!: string;
}
