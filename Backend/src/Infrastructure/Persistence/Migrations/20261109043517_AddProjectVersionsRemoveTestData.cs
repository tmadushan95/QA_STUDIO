using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace QaStudio.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddProjectVersionsRemoveTestData : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Shared test data is replaced by per-test-case parameters. Keep the old values as one config block, so the
            // worker can still offer them when auto-filling parameters, instead of dropping a team's data silently.
            // Keys starting with "_" were notes, never values.
            migrationBuilder.Sql("""
                IF EXISTS (SELECT 1 FROM dbo.TestDataValues WHERE LEFT([Key], 1) <> N'_')
                   AND NOT EXISTS (SELECT 1 FROM dbo.ConfigEntries WHERE [Key] = N'legacy-test-data')
                    INSERT INTO dbo.ConfigEntries ([Key], Json)
                    SELECT N'legacy-test-data',
                           N'{' + STRING_AGG(CAST(N'"' + STRING_ESCAPE([Key] COLLATE DATABASE_DEFAULT, 'json') + N'":' + (Json COLLATE DATABASE_DEFAULT) AS nvarchar(max)), N',') + N'}'
                    FROM dbo.TestDataValues
                    WHERE LEFT([Key], 1) <> N'_';
                """);

            migrationBuilder.DropTable(
                name: "TestDataValues");

            migrationBuilder.AddColumn<int>(
                name: "ProjectVersionId",
                table: "TestCases",
                type: "int",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "ProjectVersions",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    ProjectId = table.Column<int>(type: "int", nullable: false),
                    Name = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    Description = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: true),
                    ReleaseDate = table.Column<DateOnly>(type: "date", nullable: true),
                    IsCurrent = table.Column<bool>(type: "bit", nullable: false),
                    IsActive = table.Column<bool>(type: "bit", nullable: false),
                    CreatedAtUtc = table.Column<DateTime>(type: "datetime2(3)", precision: 3, nullable: false),
                    UpdatedAtUtc = table.Column<DateTime>(type: "datetime2(3)", precision: 3, nullable: false),
                    RowVersion = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ProjectVersions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ProjectVersions_Projects_ProjectId",
                        column: x => x.ProjectId,
                        principalTable: "Projects",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_TestCases_ProjectVersionId",
                table: "TestCases",
                column: "ProjectVersionId",
                filter: "[ProjectVersionId] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_ProjectVersions_ProjectId_Name",
                table: "ProjectVersions",
                columns: new[] { "ProjectId", "Name" },
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_TestCases_ProjectVersions_ProjectVersionId",
                table: "TestCases",
                column: "ProjectVersionId",
                principalTable: "ProjectVersions",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_TestCases_ProjectVersions_ProjectVersionId",
                table: "TestCases");

            migrationBuilder.DropTable(
                name: "ProjectVersions");

            migrationBuilder.DropIndex(
                name: "IX_TestCases_ProjectVersionId",
                table: "TestCases");

            migrationBuilder.DropColumn(
                name: "ProjectVersionId",
                table: "TestCases");

            migrationBuilder.CreateTable(
                name: "TestDataValues",
                columns: table => new
                {
                    Key = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false, collation: "Latin1_General_100_BIN2"),
                    Json = table.Column<string>(type: "nvarchar(max)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TestDataValues", x => x.Key);
                });
        }
    }
}
