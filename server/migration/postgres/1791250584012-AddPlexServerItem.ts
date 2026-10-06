import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPlexServerItem1791250584012 implements MigrationInterface {
  name = 'AddPlexServerItem1791250584012';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "plex_server_item" ("id" SERIAL NOT NULL, "serverId" integer NOT NULL, "ratingKey" character varying, "ratingKey4k" character varying, "mediaId" integer, CONSTRAINT "UQ_a2b0453b815acdbb00b8871cd1e" UNIQUE ("mediaId", "serverId"), CONSTRAINT "PK_2d37cf86514143cb598a62bb6aa" PRIMARY KEY ("id"))`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_03485b463bbf5225f1fbd87425" ON "plex_server_item" ("mediaId") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_995703dbaab5dd53a17d5650a1" ON "plex_server_item" ("serverId") `
    );
    await queryRunner.query(
      `ALTER TABLE "plex_server_item" ADD CONSTRAINT "FK_03485b463bbf5225f1fbd87425e" FOREIGN KEY ("mediaId") REFERENCES "media"("id") ON DELETE CASCADE ON UPDATE NO ACTION`
    );
    // Server 1's rating keys so far lived only on media; copy them over.
    await queryRunner.query(
      `INSERT INTO "plex_server_item" ("mediaId", "serverId", "ratingKey", "ratingKey4k") SELECT "id", 1, "ratingKey", "ratingKey4k" FROM "media" WHERE "ratingKey" IS NOT NULL OR "ratingKey4k" IS NOT NULL`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "plex_server_item" DROP CONSTRAINT "FK_03485b463bbf5225f1fbd87425e"`
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_995703dbaab5dd53a17d5650a1"`
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_03485b463bbf5225f1fbd87425"`
    );
    await queryRunner.query(`DROP TABLE "plex_server_item"`);
  }
}
