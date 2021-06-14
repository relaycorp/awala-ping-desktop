import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

@Entity()
export class GatewayCertificate {
  @PrimaryColumn()
  public readonly privateAddress!: string;

  @Column()
  public readonly derSerialization!: Buffer;

  @CreateDateColumn()
  public readonly expiryDate!: Date;
}
