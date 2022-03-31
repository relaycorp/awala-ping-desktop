import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity()
export class ThirdPartyEndpoint {
  @PrimaryColumn()
  public readonly privateAddress!: string;

  @Index()
  @Column({ nullable: true })
  public readonly publicAddress?: string;
}
