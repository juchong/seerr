import {
  Column,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import Media from './Media';

/**
 * A title's rating keys on one Plex server. Rating keys are local to each
 * server, so every configured server gets its own row; the primary server's
 * keys are also kept in `Media.ratingKey`/`Media.ratingKey4k`.
 */
@Entity()
@Unique(['media', 'serverId'])
class PlexServerItem {
  @PrimaryGeneratedColumn()
  public id: number;

  @ManyToOne(() => Media, (media) => media.plexServerItems, {
    onDelete: 'CASCADE',
  })
  @Index()
  public media: Media;

  @Column({ type: 'int' })
  @Index()
  public serverId: number;

  @Column({ nullable: true, type: 'varchar' })
  public ratingKey?: string | null;

  @Column({ nullable: true, type: 'varchar' })
  public ratingKey4k?: string | null;

  constructor(init?: Partial<PlexServerItem>) {
    Object.assign(this, init);
  }
}

export default PlexServerItem;
