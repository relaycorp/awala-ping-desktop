import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity()
export class ThirdPartyEndpoint {
  @PrimaryColumn()
  public readonly id!: string;

  @Index()
  @Column()
  public readonly internetAddress!: string;

  @Column()
  public readonly isPrivate!: boolean;
}
