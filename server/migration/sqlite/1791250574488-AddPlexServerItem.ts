import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPlexServerItem1791250574488 implements MigrationInterface {
  name = 'AddPlexServerItem1791250574488';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "plex_server_item" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "serverId" integer NOT NULL, "ratingKey" varchar, "ratingKey4k" varchar, "mediaId" integer, CONSTRAINT "UQ_a2b0453b815acdbb00b8871cd1e" UNIQUE ("mediaId", "serverId"))`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_03485b463bbf5225f1fbd87425" ON "plex_server_item" ("mediaId") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_995703dbaab5dd53a17d5650a1" ON "plex_server_item" ("serverId") `
    );
    await queryRunner.query(`DROP INDEX "IDX_03485b463bbf5225f1fbd87425"`);
    await queryRunner.query(`DROP INDEX "IDX_995703dbaab5dd53a17d5650a1"`);
    await queryRunner.query(
      `CREATE TABLE "temporary_plex_server_item" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "serverId" integer NOT NULL, "ratingKey" varchar, "ratingKey4k" varchar, "mediaId" integer, CONSTRAINT "UQ_a2b0453b815acdbb00b8871cd1e" UNIQUE ("mediaId", "serverId"), CONSTRAINT "FK_03485b463bbf5225f1fbd87425e" FOREIGN KEY ("mediaId") REFERENCES "media" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`
    );
    await queryRunner.query(
      `INSERT INTO "temporary_plex_server_item"("id", "serverId", "ratingKey", "ratingKey4k", "mediaId") SELECT "id", "serverId", "ratingKey", "ratingKey4k", "mediaId" FROM "plex_server_item"`
    );
    await queryRunner.query(`DROP TABLE "plex_server_item"`);
    await queryRunner.query(
      `ALTER TABLE "temporary_plex_server_item" RENAME TO "plex_server_item"`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_03485b463bbf5225f1fbd87425" ON "plex_server_item" ("mediaId") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_995703dbaab5dd53a17d5650a1" ON "plex_server_item" ("serverId") `
    );
    // Server 1's rating keys so far lived only on media; copy them over.
    await queryRunner.query(
      `INSERT INTO "plex_server_item" ("mediaId", "serverId", "ratingKey", "ratingKey4k") SELECT "id", 1, "ratingKey", "ratingKey4k" FROM "media" WHERE "ratingKey" IS NOT NULL OR "ratingKey4k" IS NOT NULL`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_995703dbaab5dd53a17d5650a1"`);
    await queryRunner.query(`DROP INDEX "IDX_03485b463bbf5225f1fbd87425"`);
    await queryRunner.query(
      `ALTER TABLE "plex_server_item" RENAME TO "temporary_plex_server_item"`
    );
    await queryRunner.query(
      `CREATE TABLE "plex_server_item" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "serverId" integer NOT NULL, "ratingKey" varchar, "ratingKey4k" varchar, "mediaId" integer, CONSTRAINT "UQ_a2b0453b815acdbb00b8871cd1e" UNIQUE ("mediaId", "serverId"))`
    );
    await queryRunner.query(
      `INSERT INTO "plex_server_item"("id", "serverId", "ratingKey", "ratingKey4k", "mediaId") SELECT "id", "serverId", "ratingKey", "ratingKey4k", "mediaId" FROM "temporary_plex_server_item"`
    );
    await queryRunner.query(`DROP TABLE "temporary_plex_server_item"`);
    await queryRunner.query(
      `CREATE INDEX "IDX_995703dbaab5dd53a17d5650a1" ON "plex_server_item" ("serverId") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_03485b463bbf5225f1fbd87425" ON "plex_server_item" ("mediaId") `
    );
    await queryRunner.query(`DROP INDEX "IDX_995703dbaab5dd53a17d5650a1"`);
    await queryRunner.query(`DROP INDEX "IDX_03485b463bbf5225f1fbd87425"`);
    await queryRunner.query(`DROP TABLE "plex_server_item"`);
  }
}
